import assert from 'node:assert/strict';
import test from 'node:test';

import { formatMeasureRange, parseMeasureRange } from '../src/utils/measureRange.js';

test('measure range parser accepts one measure, hyphen, tilde, and whitespace', () => {
  assert.deepEqual(parseMeasureRange('4', 10), { end: 4, start: 4 });
  assert.deepEqual(parseMeasureRange('5-7', 10), { end: 7, start: 5 });
  assert.deepEqual(parseMeasureRange('5~7', 10), { end: 7, start: 5 });
  assert.deepEqual(parseMeasureRange(' 5 - 7 ', 10), { end: 7, start: 5 });
  assert.deepEqual(parseMeasureRange(' 5 ~ 7 ', 10), { end: 7, start: 5 });
  assert.equal(formatMeasureRange(4, 4), '4');
  assert.equal(formatMeasureRange(5, 7), '5-7');
});

test('measure range parser rejects invalid or out-of-score ranges without clamping', () => {
  ['0', '-1', '7-5', 'abc', '3--', '999'].forEach((value) => {
    assert.equal(parseMeasureRange(value, 20), null);
  });
});
