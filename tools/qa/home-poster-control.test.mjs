import assert from 'node:assert/strict';
import test from 'node:test';
import { homePosterControlLayout } from '../../src/admin/shell/home-poster-control.mjs';
const poster = (width=1423) => ({ binding: { renderer: { family: 'home' }, ownerCollection: 'static-pages', recordSlug: 'home', role: 'home-hero-poster-desktop' }, rect: { left:0, top:0, right:width, bottom:758, width, height:758 } });
const video = (row) => ({ binding: {...row.binding, role:'home-hero-video'}, rect:{...row.rect} });

test('overlapping Home poster receives a visible independent 44px target below the header', () => {
  const row=poster(), viewport={left:165,top:30,right:900,bottom:700};
  const result=homePosterControlLayout(row,[row,video(row)],viewport,96);
  assert.equal(result.height,44);assert(result.width>=44);
  assert(result.left>=viewport.left&&result.right<=viewport.right);
  assert(result.top>=108&&result.bottom<=viewport.bottom);
});

test('poster control placement fits desktop, mobile and 320px canvas widths', () => {
  for(const width of [1423,390,320]){
    const row=poster(width),viewport={left:0,top:0,right:width,bottom:758};
    const result=homePosterControlLayout(row,[row,video(row)],viewport,92);
    assert(result.left>=0&&result.right<=width);
    assert.equal(result.height,44);assert.equal(result.top,104);
  }
});

test('unrelated images, owners and non-overlapping video retain their ordinary targets', () => {
  const row=poster(),viewport={left:0,top:0,right:1423,bottom:758};
  assert.equal(homePosterControlLayout(row,[row],viewport,90),null);
  assert.equal(homePosterControlLayout({...row,binding:{...row.binding,role:'product-photo'}},[video(row)],viewport,90),null);
  assert.equal(homePosterControlLayout(row,[{...video(row),binding:{...video(row).binding,recordSlug:'other'}}],viewport,90),null);
  assert.equal(homePosterControlLayout(row,[{...video(row),rect:{...row.rect,left:100}}],viewport,90),null);
});

test('poster remains within a partially scrolled media area and canvas viewport', () => {
  const row=poster();row.rect={...row.rect,top:-220,bottom:538};
  const viewport={left:0,top:40,right:900,bottom:460};
  const result=homePosterControlLayout(row,[row,video(row)],viewport,92);
  assert(result.top>=104&&result.bottom<=460);
});
test('a matching poster is explicitly hidden when its remaining media lies above the header', () => {
  const row=poster();row.rect={...row.rect,top:-728,bottom:30};
  assert.deepEqual(homePosterControlLayout(row,[row,video(row)],{left:0,top:0,right:1423,bottom:758},92),{hidden:true});
});

test('a matching poster never exceeds a narrow or empty visible canvas intersection', () => {
  const row=poster();
  for (const viewport of [{left:0,top:0,right:40,bottom:758},{left:1500,top:0,right:1600,bottom:758},{left:0,top:0,right:1423,bottom:30}]) {
    assert.deepEqual(homePosterControlLayout(row,[row,video(row)],viewport,92),{hidden:true});
  }
});
