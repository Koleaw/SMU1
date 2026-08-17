import assert from 'node:assert/strict';
import test from 'node:test';
import { planCanonicalMediaSelection } from './media-selection.mjs';

function lease(clientId, canonicalPath) {
  return { clientId, canonicalPath };
}

test('visible queue order is preserved while new same-byte uploads are deduplicated', () => {
  const items = [
    { clientId: 'new-a' },
    { clientId: 'new-b' },
    { clientId: 'new-c' }
  ];
  const leases = new Map([
    ['new-a', lease('new-a', '/uploads/a.jpg')],
    ['new-b', lease('new-b', '/uploads/a.jpg')],
    ['new-c', lease('new-c', '/uploads/c.jpg')]
  ]);
  const result = planCanonicalMediaSelection(items, leases);
  assert.deepEqual(result.leases.map((entry) => entry.clientId), ['new-a', 'new-c']);
  assert.deepEqual(result.omittedDuplicates, [{ clientId: 'new-b', canonicalPath: '/uploads/a.jpg' }]);
});

test('legacy existing duplicates stay exact but a newly selected duplicate is omitted', () => {
  const items = [
    { clientId: 'existing-1', existingPath: '/uploads/a.jpg', existingValue: '/uploads/a.jpg' },
    { clientId: 'new-a' },
    { clientId: 'existing-2', existingPath: '/uploads/a.jpg', existingValue: { src: '/uploads/a.jpg', caption: 'legacy duplicate' } },
    { clientId: 'new-b' }
  ];
  const leases = new Map(items.map((item) => [item.clientId, lease(item.clientId, item.existingPath || (item.clientId === 'new-b' ? '/uploads/b.jpg' : '/uploads/a.jpg'))]));
  const result = planCanonicalMediaSelection(items, leases);
  assert.deepEqual(result.leases.map((entry) => entry.clientId), ['existing-1', 'existing-2', 'new-b']);
  assert.deepEqual(result.omittedDuplicates.map((entry) => entry.clientId), ['new-a']);
});

test('missing or malformed upload results are excluded fail-closed', () => {
  const result = planCanonicalMediaSelection(
    [{ clientId: 'missing' }, { clientId: 'invalid' }, { clientId: 'valid' }],
    new Map([['invalid', { clientId: 'invalid', canonicalPath: '' }], ['valid', lease('valid', '/uploads/valid.webp')]])
  );
  assert.deepEqual(result.leases, [lease('valid', '/uploads/valid.webp')]);
  assert.deepEqual(result.omittedDuplicates, []);
});
