import { waitForRenderedTool } from './rendered-tool-ready.mjs';

// A calculator uses #project without replacing its document. Navigating back
// to the same pathname may therefore leave the mutated DOM alive. Leave first,
// let pagehide finish its save, then clear the disposable origin and load anew.
export async function restorePublicBaseline(browser, { origin, requestedUrl }) {
  const target = new URL(requestedUrl);
  if (target.origin !== origin || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
    throw new Error('Public QA baseline accepts only its disposable loopback origin.');
  }
  await browser.navigate('about:blank', { waitForFonts: false, waitAfterMs: 0 });
  await browser.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
  await browser.navigate(requestedUrl, { waitForFonts: false });
  await browser.evaluate(`(${waitForRenderedTool.toString()})()`);
}
