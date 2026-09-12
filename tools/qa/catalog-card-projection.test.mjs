import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getAtPath } from '../../src/admin/state/history-store.mjs';
const source = await readFile(new URL('../../src/admin/shell/visual-editor-app.mjs', import.meta.url), 'utf8');
const start = source.indexOf('  function canvasMediaItems(');
const end = source.indexOf('  function canvasStructuredListValue(', start);
const mediaPath = new Function(source.slice(source.indexOf('function mediaPath('), source.indexOf('function activeEntry(')) + '; return mediaPath;')();
const resolve = new Function('getAtPath', 'mediaPath', 'canvasMediaItem', source.slice(start, end) + '; return canvasMediaItems;')(getAtPath, mediaPath, (_record, item, alt) => ({src:mediaPath(item), alt}));
const binding = {renderer:{family:'catalog-card'},coverPath:'image'};
const project = content => resolve({history:{snapshot:()=>({value:content})}}, binding, content.gallery);

test('catalog card keeps its selected cover and projects exactly one image', () => {
  assert.deepEqual(project({image:'/cover.png',gallery:['/gallery1.png','/gallery2.png'],title:'Card'}),[{src:'/cover.png',alt:'Card'}]);
});
test('card fallback accepts string/object media, skips placeholders and empty values', () => {
  for(const image of ['', '   ', null, '/assets/images/placeholders/empty.svg', {src:''}, {src:'   '}, {image:'/legacy.png'}, {url:'/legacy.png'}, {path:'/legacy.png'}]) assert.equal(project({image,gallery:['',{src:' /real.png '},'/other.png']})[0].src,'/real.png');
  assert.deepEqual(project({image:'',gallery:[]}),[]);
  assert.equal(project({image:{src:'/cover.png'},gallery:['/other.png']})[0].src,'/cover.png');
});
test('a real cover-role change and Undo update the one projected image', () => {
  const record={image:'/one.png',gallery:['/gallery.png']};assert.equal(project(record)[0].src,'/one.png');
  record.image='/two.png';assert.equal(project(record)[0].src,'/two.png');
  record.image='/one.png';assert.equal(project(record)[0].src,'/one.png');
});
test('detail galleries with coverPath retain all gallery items', () => {
  assert.deepEqual(resolve({history:{snapshot:()=>({value:{image:'/cover.png'}})}},{renderer:{family:'product-detail'},coverPath:'image'},['/one.png','/two.png']).map(x=>x.src),['/one.png','/two.png']);
});
const layout = await readFile(new URL('../../src/layouts/PublicV2Layout.astro', import.meta.url),'utf8');
const reorderStart=layout.indexOf('              const parent = roots[0]?.parentElement;');
const reorderEnd=layout.indexOf('              queueGeometry();',reorderStart);
const reorder=new Function('roots','rows',layout.slice(reorderStart,reorderEnd));
function rootsFixture(){const parent={children:[],moves:0,append(node){this.moves++;this.children.splice(this.children.indexOf(node),1);this.children.push(node);}};const roots=[0,1,2].map(id=>({id,parentElement:parent}));parent.children=[...roots];return{parent,roots};}
test('already matching reorder projection performs zero DOM operations',()=>{const{parent,roots}=rootsFixture();reorder(roots,roots);assert.equal(parent.moves,0);assert.deepEqual(parent.children,roots);});
test('changed order remains supported; duplicate, unknown and foreign roots cannot mutate',()=>{const{parent,roots}=rootsFixture();reorder([roots[1],roots[0],roots[2]],roots);assert.deepEqual(parent.children.map(x=>x.id),[1,0,2]);for(const invalid of [[roots[0],roots[0],roots[2]],[...roots,{id:3,parentElement:parent}],[roots[0],roots[1],{id:3,parentElement:{}}]]){parent.moves=0;reorder(invalid,roots);assert.equal(parent.moves,0);}});

test('card ready keeps responsive sources and real cover Undo restores the original picture',()=>{
  const attrs = initial => ({data:new Map(Object.entries(initial)),getAttribute(name){return this.data.has(name)?this.data.get(name):null;},setAttribute(name,value){this.data.set(name,value);},removeAttribute(name){this.data.delete(name);}});
  const sourceNode=attrs({srcset:'/cover-400.avif 400w, /cover-800.avif 800w'});
  class Image { set src(value) { this.setAttribute('src', value); } get src() { return this.getAttribute('src'); } set alt(value) { this.setAttribute('alt', value); } get alt() { return this.getAttribute('alt'); } }
  const image=Object.assign(new Image(),attrs({src:'/_media/cover.jpg',srcset:'/_media/cover-400.jpg 400w',sizes:'24vw',alt:'Card'}),{dataset:{smu1CanonicalMedia:'/cover.png'},closest:()=>({querySelectorAll:()=>[sourceNode]})});
  const element={querySelector:q=>q==='img'?image:null,closest:()=>({classList:{toggle(){}}}),classList:{toggle(){}}};
  const writeStart=layout.indexOf('          const writeLiveImage =');
  const writeEnd=layout.indexOf('          const clearLiveImage =',writeStart);
  const write=new Function('HTMLImageElement',layout.slice(writeStart,writeEnd)+'; return writeLiveImage;')(Image);
  const cardStart=layout.indexOf('          const projectLiveCardCover =');
  const cardEnd=layout.indexOf('          const liveGalleries =',cardStart);
  const projectCard=new Function('liveCardCovers','writeLiveImage','clearLiveImage',layout.slice(cardStart,cardEnd)+'; return projectLiveCardCover;')(new WeakMap(),write,()=>{});
  const original=Object.fromEntries(image.data),originalSource=sourceNode.getAttribute('srcset');
  projectCard(element,binding,{items:[{src:'/cover.png',alt:'Card'}]});
  assert.deepEqual(Object.fromEntries(image.data),original);assert.equal(sourceNode.getAttribute('srcset'),originalSource);
  projectCard(element,binding,{items:[{src:'/new.png',alt:'New'}]});assert.equal(image.getAttribute('src'),'/new.png');assert.equal(image.getAttribute('srcset'),null);assert.equal(sourceNode.getAttribute('srcset'),null);
  projectCard(element,binding,{items:[{src:'/cover.png',alt:'Card'}]});assert.deepEqual(Object.fromEntries(image.data),original);assert.equal(sourceNode.getAttribute('srcset'),originalSource);
});
