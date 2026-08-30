import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSizes } from '../src/core/sizes.js';

test('normalizes fluid native size formats', () => {
  assert.equal(normalizeSizes('fluid'), 'fluid');
  assert.equal(normalizeSizes('"fluid"'), 'fluid');
  assert.equal(normalizeSizes(['fluid']), 'fluid');
  assert.equal(normalizeSizes(undefined, { adUnitType: 'native', slotKey: 'ad-results' }), 'fluid');
  assert.equal(normalizeSizes(null, { adUnitType: 'native', slotKey: 'ad-results' }), null);
});

test('normalizes numeric display size serializations to GPT pairs', () => {
  assert.deepEqual(normalizeSizes([[320, 50], [728, 90]]), [[320, 50], [728, 90]]);
  assert.deepEqual(normalizeSizes([320, 50, 728, 90]), [[320, 50], [728, 90]]);
  assert.deepEqual(normalizeSizes('320,50,728,90'), [[320, 50], [728, 90]]);
  assert.deepEqual(normalizeSizes(['320x50', '728x90']), [[320, 50], [728, 90]]);
  assert.deepEqual(normalizeSizes('320x50,728x90'), [[320, 50], [728, 90]]);
  assert.deepEqual(normalizeSizes(undefined, { adUnitType: 'banner', slotKey: 'ad-sidebar' }), [[300, 250], [300, 600]]);
});

test('rejects invalid or odd-length numeric size data', () => {
  assert.throws(() => normalizeSizes([320, 50, 728]), /odd numeric length/);
  assert.throws(() => normalizeSizes('320,50,728'), /odd numeric length/);
  assert.throws(() => normalizeSizes([[320, 50, 728]]), /Invalid ad size pair/);
  assert.throws(() => normalizeSizes('not-a-size'), /Unsupported ad size configuration/);
});
