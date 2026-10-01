import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { installHeldNavigationCapture } from '../migration/h2-covered-navigation-capture.mjs';

const targetHref = 'https://example.test/topiarii/';
const expectedTransition = { variant: 'h3', from: '/', to: '/topiarii/' };

function browserHarness({ navigation = new EventTarget() } = {}) {
  let now = 1354;
  let reads = 0;
  const window = { navigation };
  const document = new EventTarget();
  let pageState = 'covered';
  const context = vm.createContext({
    window, document, targetHref, expectedTransition, Date: { now: () => now },
    readGeometry: () => {
      reads += 1;
      return { sampledAt: now, pageState,
        interception: { ...window.__smu1H4CoveredNavigation } };
    }
  });
  const installed = vm.runInContext(`(${installHeldNavigationCapture.toString()})(targetHref, readGeometry, expectedTransition)`, context);
  const cover = (detail = { ...expectedTransition, navigationId: 'independent-fixture' }) => {
    const event = new Event('v2:page-covered');
    event.detail = detail;
    document.dispatchEvent(event);
  };
  const dispatch = ({ href = targetHref, cancelable = true } = {}) => {
    pageState = 'navigating';
    const event = new Event('navigate', { cancelable });
    event.destination = { url: href };
    navigation.dispatchEvent(event);
    return event;
  };
  return { window, installed, dispatch, cover, clock: value => { now = value; }, reads: () => reads };
}

test('coverage is sampled at its event, separately from the next-frame navigation and later PNG', () => {
  const browser = browserHarness();
  browser.clock(1349);
  browser.cover();
  assert.equal(browser.window.__smu1H4CoveredEventGeometry.sampledAt, 1349);
  assert.equal(browser.window.__smu1H4CoveredEventGeometry.pageState, 'covered');
  assert.equal(browser.window.__smu1H4CoveredGeometry, null);
  browser.clock(1367);
  browser.dispatch();
  assert.equal(browser.window.__smu1H4CoveredGeometry.sampledAt, 1367);
  assert.equal(browser.window.__smu1H4CoveredGeometry.pageState, 'navigating');
  browser.clock(1400);
  browser.cover();
  assert.equal(browser.window.__smu1H4CoveredEventGeometry.sampledAt, 1349);
  assert.equal(browser.reads(), 2, 'each event is sampled once without retry');
});

test('unrelated or missing coverage events cannot fabricate a coverage sample', () => {
  for (const detail of [undefined, { ...expectedTransition, navigationId: '' },
    { ...expectedTransition, navigationId: 'id', to: '/other/' },
    { ...expectedTransition, navigationId: 'id', from: '/other/' },
    { ...expectedTransition, navigationId: 'id', variant: 'h2' }]) {
    const browser = browserHarness();
    browser.cover(detail === undefined ? null : detail);
    browser.dispatch();
    browser.cover();
    assert.equal(browser.window.__smu1H4CoveredEventGeometry, null);
    assert.equal(browser.reads(), 1, 'navigation alone is not proof of covered-event geometry');
  }
});

test('held navigation samples synchronously before a delayed CDP reader', () => {
  const browser = browserHarness();
  assert.equal(browser.installed, true);
  const event = browser.dispatch();
  assert.equal(event.defaultPrevented, true);
  assert.equal(browser.reads(), 1);
  assert.equal(browser.window.__smu1H4CoveredGeometry.sampledAt, 1354);
  assert.equal(browser.window.__smu1H4CoveredGeometry.interception.prevented, true);
  browser.clock(1377); // Independent reproduction of the 23 ms polling/RPC gap.
  assert.equal(browser.window.__smu1H4CoveredGeometry.sampledAt, 1354);
  browser.dispatch();
  assert.equal(browser.reads(), 1, 'the held event has one immutable observation, not a retry until passing');
  assert.doesNotThrow(() => JSON.stringify(browser.window.__smu1H4CoveredGeometry));
});

test('unavailable, unrelated and noncancelable navigation cannot fabricate a held sample', () => {
  assert.equal(browserHarness({ navigation: null }).installed, false);
  for (const options of [{ href: 'https://example.test/other/' }, { cancelable: false }]) {
    const browser = browserHarness();
    const event = browser.dispatch(options);
    assert.equal(event.defaultPrevented, false);
    assert.equal(browser.reads(), 0);
    assert.equal(browser.window.__smu1H4CoveredGeometry, null);
    assert.equal(browser.window.__smu1H4CoveredNavigation.prevented, false);
  }
});

const source = await readFile(new URL('../migration/h2-motion-qa.mjs', import.meta.url), 'utf8');
const verification = source.match(/const coveredFrameVerified = (Boolean\([\s\S]*?coveredLifecycle\.ok\));/u)?.[1];
assert.ok(verification, 'exercise the actual filmstrip acceptance expression without running the browser suite');

function acceptanceFixture() {
  const coveredExpectedLabel = 'Топиарии';
  const coveredToken = { version: 2, variant: 'h3', target: '/topiarii/', label: coveredExpectedLabel, navigationId: 'independent-fixture' };
  const geometry = { href: 'https://example.test/', pageState: 'navigating', pageVariant: 'h3', locked: true,
    interception: { cancelable: true, prevented: true }, sheetLeft: 0, sheetRight: 1440, overlayWidth: 1440,
    gridVisible: true, labelVisible: true, transitionLabel: coveredExpectedLabel, token: JSON.stringify(coveredToken) };
  return {
    coveredGeometry: structuredClone(geometry), coveredPreGeometry: structuredClone(geometry), coveredPostGeometry: structuredClone(geometry),
    coveredEventGeometry: { ...structuredClone(geometry), pageState: 'covered', token: null,
      event: { ...expectedTransition, navigationId: coveredToken.navigationId } },
    coveredExpectedLabel, coveredToken, TOKEN_VERSION: 2, coveredSemanticEvent: true,
    coveredLifecycle: { ok: true }, coveredTokenAdded: true, coveredTokenRemoved: true,
    routes: { home: '/', deep: '/topiarii/' }, hrefFor: route => `https://example.test${route}`, targetValue: href => new URL(href).pathname,
    classify: href => ({ normalizedPathname: new URL(href).pathname }),
    coveredCapture: { filename: 'held.png', held: true, arrived: true, usable: true,
      actualOffset: 349, semanticSampleOffset: 349, navigationSampleOffset: 367, captureStartOffset: 377, captureEndOffset: 430, coveredEventOffset: 349,
      arrivalProof: { handoffConsumed: true, bootstrapReason: 'valid-token', navigationId: coveredToken.navigationId, pageVariant: 'h3', token: null } }
  };
}

test('actual acceptance retains strict semantic deadlines and independently checks the live PNG window', () => {
  const check = fixture => vm.runInNewContext(verification, fixture);
  assert.equal(check(acceptanceFixture()), true, 'PNG may be later than the valid synchronous semantic event');
  for (const value of [249, 361, null, Number.NaN]) {
    const fixture = acceptanceFixture();
    fixture.coveredCapture.actualOffset = value;
    assert.equal(check(fixture), false, `semantic sample ${value} must fail the original 250–360 ms bounds`);
  }
  for (const value of [249, 361]) {
    const fixture = acceptanceFixture();
    fixture.coveredCapture.coveredEventOffset = value;
    assert.equal(check(fixture), false, 'the original covered-event bounds also remain enforced');
  }
  for (const field of ['coveredEventGeometry', 'coveredGeometry', 'coveredPreGeometry', 'coveredPostGeometry']) {
    const fixture = acceptanceFixture();
    fixture[field].sheetLeft = 4;
    assert.equal(check(fixture), false, `${field}: a valid earlier event cannot hide an uncovered PNG`);
  }
  for (const field of ['coveredPreGeometry', 'coveredPostGeometry']) {
    const fixture = acceptanceFixture();
    fixture[field].token = 'changed-token';
    assert.equal(check(fixture), false, `${field}: handoff must remain intact through capture`);
  }
  for (const timing of [{ navigationSampleOffset: 348 }, { captureStartOffset: 366 }, { captureEndOffset: 376 }, { captureEndOffset: 1000 }]) {
    const fixture = acceptanceFixture();
    Object.assign(fixture.coveredCapture, timing);
    assert.equal(check(fixture), false, 'timestamps must be monotonic and the original <1000 ms PNG deadline remains');
  }
  for (const [field, value] of [['from', '/other/'], ['to', '/other/'], ['navigationId', 'another-navigation'], ['variant', 'h2']]) {
    const fixture = acceptanceFixture();
    fixture.coveredEventGeometry.event[field] = value;
    assert.equal(check(fixture), false, 'covered event must belong to the exact captured navigation');
  }
});

test('capture evidence records real PNG timing separately from the navigation sample', () => {
  assert.match(source, /capture\.actualCaptureOffset = captureStartOffset;/u);
  assert.match(source, /capture\.semanticSampleOffset = actualOffset;/u);
  assert.match(source, /preCaptureGeometry: coveredCapture\.preCaptureGeometry/u);
  assert.match(source, /semanticSampleOffset: coveredCapture\.semanticSampleOffset/u);
  assert.match(source, /eventGeometry: coveredCapture\.eventGeometry/u);
  assert.match(source, /navigationSampleOffset: coveredCapture\.navigationSampleOffset/u);
});
