import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { CdpBrowser, preferredChromePath } from './cdp-browser.mjs';

test('native search arrows skip collapsed descriptions and enter them after expansion',
  { skip: !preferredChromePath(), timeout: 30000 }, async () => {
    const source = await readFile(new URL('../../src/scripts/public-search.mjs', import.meta.url));
    const entries = Array.from({ length: 14 }, (_, i) => ({
      title: `Контур ${String(i + 1).padStart(2, '0')}`, description: 'Уличное изделие.', keywords: '',
      kind: 'product', href: `/items/contour-${i + 1}/`
    }));
    entries.push({ title: 'Овал', description: 'Вазон с металлическим контуром.', keywords: '', kind: 'product', href: '/items/oval/' });
    const html = `<!doctype html><html lang="ru"><meta charset="utf-8">
      <style>a,li{display:block}dialog{height:700px;width:700px}ol{margin:0}</style>
      <dialog data-search-dialog data-search-index="/index.json" data-search-base="/">
      <form><input data-search-input aria-label="Поиск"><button type="button" data-search-clear>Очистить</button></form>
      <p data-search-status></p><button data-search-retry>Повторить</button><div data-search-suggestions></div>
      <div data-search-results></div><button data-search-more>Ещё</button></dialog>
      <script type="module">import{initPublicSearch}from'/search.mjs';const d=document.querySelector('dialog');d.showModal();initPublicSearch(d);</script>`;
    const server = createServer((req, res) => {
      const js = req.url === '/search.mjs', json = req.url === '/index.json';
      res.writeHead(200, { 'content-type': js ? 'text/javascript' : json ? 'application/json' : 'text/html; charset=utf-8' });
      res.end(js ? source : json ? JSON.stringify({ version: 1, entries }) : html);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await new CdpBrowser().start();
    const waitFor = async expression => {
      const end = Date.now() + 5000;
      while (Date.now() < end) {
        if (await browser.evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error(`Search did not reach expected state: ${expression}`);
    };
    const key = () => browser.dispatchKey('ArrowDown', { code: 'ArrowDown' });
    const click = async selector => {
      const point = await browser.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView();const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await browser.dispatchClick(point);
    };
    try {
      await browser.navigate(`http://127.0.0.1:${server.address().port}/`);
      await waitFor(`document.querySelector('[data-search-status]').textContent.startsWith('Найдите')`);
      await browser.evaluate(`document.querySelector('input').focus()`);
      await browser.send('Input.insertText', { text: 'Контур' });
      await waitFor(`document.querySelector('[data-search-results] > ol')?.children.length === 12`);
      assert.equal(await browser.evaluate(`document.querySelector('details').open`), false);
      for (let i = 0; i < 12; i++) {
        await key();
        assert.equal(await browser.evaluate(`document.activeElement===document.querySelectorAll('[data-search-results] > ol a')[${i}]`), true);
      }
      await key();
      assert.equal(await browser.evaluate(`document.activeElement===document.querySelector('input')`), true, 'after the last visible title, focus returns to the input');
      await click('summary');
      await browser.evaluate(`document.querySelector('input').focus()`);
      for (let i = 0; i < 13; i++) await key();
      assert.equal(await browser.evaluate(`document.activeElement===document.querySelector('details a')`), true, 'expanded descriptions participate in arrow navigation');
      await key();
      assert.equal(await browser.evaluate(`document.activeElement===document.querySelector('input')`), true);
      await click('summary');
      await click('[data-search-more]');
      assert.equal(await browser.evaluate(`document.querySelector('[data-search-results] > ol').children.length`), 14);
      assert.equal(await browser.evaluate(`document.activeElement===document.querySelectorAll('[data-search-results] > ol a')[12]`), true, 'pagination focuses the first new title');
      await key(); await key();
      assert.equal(await browser.evaluate(`document.activeElement===document.querySelector('input')`), true);
    } finally {
      await browser.close(); server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
