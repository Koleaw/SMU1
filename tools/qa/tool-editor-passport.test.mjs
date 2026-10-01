import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {bindingFieldPathExists} from './route-passport-equivalence.mjs';

const page=await readFile(new URL('../../src/components/tools/ToolPage.astro',import.meta.url),'utf8');
const hub=await readFile(new URL('../../src/pages/instrumenty/index.astro',import.meta.url),'utf8');
const passport=await readFile(new URL('./route-passport-browser.mjs',import.meta.url),'utf8');

test('every indexed methodology binding resolves through real content using the editor path grammar',async()=>{
  const templates=[...page.matchAll(/binding\(`([^`]+)`\)/gu)].map(match=>match[1]);
  assert.equal(templates.length,4);
  for(const id of ['metal','raskroy','fundament','ograzhdenie','plitka','maf','zdanie']){
    const record=JSON.parse(await readFile(new URL(`../../src/content/tools/${id}.json`,import.meta.url),'utf8'));
    for(const template of templates){
      const root=template.split('[')[0];
      assert.ok(Array.isArray(record[root]),`${id}: ${template}`);
      for(let index=0;index<record[root].length;index++){
        const path=template.replace('${i}',String(index));
        assert.ok(bindingFieldPathExists(record,path),`${id}: ${path}`);
      }
    }
    assert.equal(bindingFieldPathExists(record,'inputs.0'),false,'dot-index typo stays invalid');
  }
});

test('tool cards bind their real content while generated links and template copy have explicit owners',()=>{
  assert.match(hub,/owner:\{collection:'tools',slug:id\}/u);
  assert.match(hub,/binding\(tool\.id,'title'\)/u);
  assert.match(hub,/binding\(tool\.id,'description'\)/u);
  assert.match(hub,/class="tool-card"[^>]*\{\.\.\.card\}/u);
  assert.match(hub,/class="tool-heading" \{\.\.\.fixed\}/u);
  assert.match(page,/class="tool-breadcrumb"[^>]*\{\.\.\.fixed\}/u);
});

test('observed tool markup wins over its shared catalog shell without reclassifying other pages',()=>{
  const expression=passport.match(/const toolVariant = ([\s\S]*?);\s*return \{\s*location:/u)?.[0].replace(/\s*return \{\s*location:$/u,'');
  assert.ok(expression);
  const inspect=selectors=>vm.runInNewContext(`${expression}; ({family:actualRendererFamily,variant:toolVariant})`,{
    document:{querySelector:selector=>selectors.includes(selector)?{}:null},catalogPrototype:''
  });
  for(const [selectors,family,variant]of[
    [['[data-tool-app]','[data-catalog-v2-root]'],'tool','calculator'],
    [['.tools-page .tool-grid','[data-catalog-v2-root]'],'tool','archive'],
    [['[data-catalog-v2-root]'],'catalog',''],
    [['[data-home-final-root]'],'home',''],
    [[], 'unclassified','']
  ]){
    const actual=inspect(selectors);assert.equal(actual.family,family);assert.equal(actual.variant,variant);
  }
  assert.match(passport,/if \(expected\.rendererFamily === 'tool'\) return snapshot\.toolVariant \|\| 'unknown';/u);
});
