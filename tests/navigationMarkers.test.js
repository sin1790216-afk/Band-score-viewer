import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeNavigationMarkers,
  getNavigationMarkerValidation,
  NAVIGATION_MARKER_TYPES,
  normalizeNavigationMarkers,
  toggleNavigationMarker,
} from '../src/utils/navigationMarkers.js';

function createMeasure(id, markerTypes = []) {
  return {
    id,
    navigationMarkers: markerTypes.map((type) => ({ type })),
  };
}

test('navigation markers normalize legacy omissions and remove duplicates', () => {
  assert.deepEqual(normalizeNavigationMarkers(undefined), []);
  assert.deepEqual(
    normalizeNavigationMarkers([
      { type: NAVIGATION_MARKER_TYPES.SEGNO },
      { type: NAVIGATION_MARKER_TYPES.SEGNO },
      { type: 'unknown' },
    ]),
    [{ type: NAVIGATION_MARKER_TYPES.SEGNO }],
  );
});

test('marker toggle adds and removes one marker type without changing others', () => {
  const withSegno = toggleNavigationMarker([], NAVIGATION_MARKER_TYPES.SEGNO);
  const withRepeatStart = toggleNavigationMarker(
    withSegno,
    NAVIGATION_MARKER_TYPES.REPEAT_START,
  );

  assert.deepEqual(withRepeatStart, [
    { type: NAVIGATION_MARKER_TYPES.SEGNO },
    { type: NAVIGATION_MARKER_TYPES.REPEAT_START },
  ]);
  assert.deepEqual(
    toggleNavigationMarker(withRepeatStart, NAVIGATION_MARKER_TYPES.SEGNO),
    [{ type: NAVIGATION_MARKER_TYPES.REPEAT_START }],
  );
});

test('marker analysis pairs a simple repeat and resolves one Segno', () => {
  const measures = [
    createMeasure('m1'),
    createMeasure('m2', [NAVIGATION_MARKER_TYPES.REPEAT_START]),
    createMeasure('m3', [NAVIGATION_MARKER_TYPES.REPEAT_END]),
    createMeasure('m4', [NAVIGATION_MARKER_TYPES.SEGNO]),
    createMeasure('m5', [NAVIGATION_MARKER_TYPES.DAL_SEGNO]),
  ];
  const analysis = analyzeNavigationMarkers(measures);

  assert.equal(analysis.repeatPairsByEndId.get('m3'), 1);
  assert.equal(analysis.segnoIndex, 3);
  assert.deepEqual(analysis.issues, []);
});

test('invalid marker targets are reported and remain safe to ignore', () => {
  const validation = getNavigationMarkerValidation([
    createMeasure('m1', [NAVIGATION_MARKER_TYPES.REPEAT_END]),
    createMeasure('m2', [NAVIGATION_MARKER_TYPES.DAL_SEGNO]),
  ]);

  assert.equal(validation.isValid, false);
  assert.deepEqual(
    validation.issues.map((issue) => issue.code),
    ['repeat-start-missing', 'segno-missing'],
  );
});
