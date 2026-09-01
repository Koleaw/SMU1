import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateEntranceClsDelta,
  evaluateTransitionFrameEvidence
} from '../migration/h2-motion-evidence-contracts.mjs';

test('transition zero offset is an early semantic checkpoint while nonzero offsets keep fixed tolerance', () => {
  const rows = [
    {
      name: 'observed H3 zero frame remains before its next checkpoint',
      input: { offset: 0, actualOffset: 62, requestedOffsets: [0, 120, 224], phase: 'cover', pageState: 'covering' },
      ok: true,
      mode: 'earliest-observable'
    },
    {
      name: 'observed calm zero frame remains before its next checkpoint',
      input: { offset: 0, actualOffset: 53, requestedOffsets: [0, 110, 220], phase: 'reveal', pageState: 'revealing' },
      ok: true,
      mode: 'earliest-observable'
    },
    {
      name: 'zero frame rejects the next checkpoint boundary',
      input: { offset: 0, actualOffset: 120, requestedOffsets: [0, 120, 224], phase: 'cover', pageState: 'covering' },
      ok: false,
      mode: 'earliest-observable'
    },
    {
      name: 'zero frame rejects a negative observed offset',
      input: { offset: 0, actualOffset: -1, requestedOffsets: [0, 120], phase: 'cover', pageState: 'covering' },
      ok: false,
      mode: 'earliest-observable'
    },
    {
      name: 'zero frame requires the semantic transition phase',
      input: { offset: 0, actualOffset: 20, requestedOffsets: [0, 120], phase: 'reveal', pageState: 'done' },
      ok: false,
      mode: 'earliest-observable'
    },
    {
      name: 'nonzero frame accepts exactly fifty milliseconds',
      input: { offset: 120, actualOffset: 170, requestedOffsets: [0, 120, 224], phase: 'cover', pageState: 'covered' },
      ok: true,
      mode: 'exact-offset'
    },
    {
      name: 'nonzero frame rejects fifty-one milliseconds',
      input: { offset: 120, actualOffset: 171, requestedOffsets: [0, 120, 224], phase: 'cover', pageState: 'covering' },
      ok: false,
      mode: 'exact-offset'
    }
  ];

  for (const row of rows) {
    const evidence = evaluateTransitionFrameEvidence(row.input);
    assert.equal(evidence.ok, row.ok, row.name);
    assert.equal(evidence.mode, row.mode, row.name);
    assert.equal(evidence.actualOffset, row.input.actualOffset, `${row.name}: actualOffset evidence`);
  }
});

test('entrance CLS evidence preserves initial cumulative shift and gates only the motion delta', () => {
  const observed = evaluateEntranceClsDelta({
    readyLayoutShift: 0.0050489381348107105,
    startLayoutShift: 0.0050489381348107105,
    finalLayoutShift: 0.0050489381348107105
  });
  assert.deepEqual(observed, {
    ok: true,
    baselineSource: 'entrance-start',
    baseline: 0.0050489381348107105,
    ready: 0.0050489381348107105,
    start: 0.0050489381348107105,
    final: 0.0050489381348107105,
    delta: 0,
    maximumDelta: 0.001,
    initialCumulative: 0.0050489381348107105,
    valid: true
  });

  const rows = [
    { name: 'ready is the fallback baseline', input: { readyLayoutShift: 0.02, finalLayoutShift: 0.0205 }, ok: true, source: 'entrance-ready' },
    { name: 'exact motion budget passes', input: { startLayoutShift: 0.01, finalLayoutShift: 0.011 }, ok: true, source: 'entrance-start' },
    { name: 'motion delta above budget fails', input: { startLayoutShift: 0.01, finalLayoutShift: 0.0111 }, ok: false, source: 'entrance-start' },
    { name: 'decreasing cumulative CLS is invalid', input: { startLayoutShift: 0.02, finalLayoutShift: 0.01 }, ok: false, source: 'entrance-start' },
    { name: 'missing baseline cannot mask cumulative CLS', input: { finalLayoutShift: 0.005 }, ok: false, source: 'unavailable' }
  ];
  for (const row of rows) {
    const evidence = evaluateEntranceClsDelta(row.input);
    assert.equal(evidence.ok, row.ok, row.name);
    assert.equal(evidence.baselineSource, row.source, row.name);
    assert.equal(evidence.final, row.input.finalLayoutShift, `${row.name}: final cumulative evidence`);
  }
});
