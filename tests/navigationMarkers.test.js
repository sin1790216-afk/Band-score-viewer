import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeNavigationMarkers,
  getNavigationMarkerValidation,
  getNavigationRepeatPolicy,
  NAVIGATION_MARKER_TYPES,
  NAVIGATION_REPEAT_POLICIES,
  normalizeNavigationMarkers,
  setNavigationMarkerRepeatPolicy,
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

test('legacy D.S. marker는 auto 정책을 사용하고 명시 정책만 보존한다', () => {
  const legacyMarker = { type: NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA };
  const replayMarkers = setNavigationMarkerRepeatPolicy(
    [legacyMarker],
    NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
    NAVIGATION_REPEAT_POLICIES.REPLAY,
  );

  assert.equal(
    getNavigationRepeatPolicy(legacyMarker),
    NAVIGATION_REPEAT_POLICIES.AUTO,
  );
  assert.deepEqual(replayMarkers, [
    {
      repeatPolicy: NAVIGATION_REPEAT_POLICIES.REPLAY,
      type: NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
    },
  ]);
  assert.deepEqual(
    normalizeNavigationMarkers([
      {
        repeatPolicy: 'invalid',
        type: NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
      },
    ]),
    [
      {
        repeatPolicy: NAVIGATION_REPEAT_POLICIES.AUTO,
        type: NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
      },
    ],
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

test('Coda/Fine marker type을 canonical marker로 정규화한다', () => {
  const markerTypes = [
    NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
    NAVIGATION_MARKER_TYPES.TO_CODA,
    NAVIGATION_MARKER_TYPES.CODA,
    NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE,
    NAVIGATION_MARKER_TYPES.FINE,
  ];

  assert.deepEqual(
    normalizeNavigationMarkers(markerTypes.map((type) => ({ type }))),
    markerTypes.map((type) => ({ type })),
  );
});

test('D.S. al Coda와 D.S. al Fine target을 분석한다', () => {
  const analysis = analyzeNavigationMarkers([
    createMeasure('m1'),
    createMeasure('m2', [NAVIGATION_MARKER_TYPES.SEGNO]),
    createMeasure('m3', [NAVIGATION_MARKER_TYPES.TO_CODA]),
    createMeasure('m4', [NAVIGATION_MARKER_TYPES.FINE]),
    createMeasure('m5', [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA]),
    createMeasure('m6', [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE]),
    createMeasure('m7', [NAVIGATION_MARKER_TYPES.CODA]),
  ]);

  assert.equal(analysis.segnoIndex, 1);
  assert.equal(analysis.codaIndex, 6);
  assert.equal(analysis.fineIndex, 3);
  assert.deepEqual(analysis.toCodaIndexes, [2]);
  assert.deepEqual(analysis.issues, []);
});

test('Repeat End와 To Coda는 같은 마디에 함께 둘 수 있다', () => {
  const analysis = analyzeNavigationMarkers([
    createMeasure('m1', [NAVIGATION_MARKER_TYPES.REPEAT_START]),
    createMeasure('m2', [
      NAVIGATION_MARKER_TYPES.REPEAT_END,
      NAVIGATION_MARKER_TYPES.TO_CODA,
    ]),
    createMeasure('m3', [NAVIGATION_MARKER_TYPES.CODA]),
  ]);

  assert.equal(
    analysis.issues.some((issue) => issue.code === 'multiple-jump-actions'),
    false,
  );
  assert.equal(analysis.repeatPairsByEndId.get('m2'), 0);
  assert.deepEqual(analysis.toCodaIndexes, [1]);
});

test('Repeat End와 다른 jump command 조합은 계속 validation issue다', () => {
  const analysis = analyzeNavigationMarkers([
    createMeasure('m1', [NAVIGATION_MARKER_TYPES.REPEAT_START]),
    createMeasure('m2', [
      NAVIGATION_MARKER_TYPES.REPEAT_END,
      NAVIGATION_MARKER_TYPES.DAL_SEGNO,
    ]),
    createMeasure('m3', [NAVIGATION_MARKER_TYPES.SEGNO]),
  ]);

  assert.equal(
    analysis.issues.some((issue) => issue.code === 'multiple-jump-actions'),
    true,
  );
});

test('없는 Coda/Fine과 여러 Coda target은 validation issue를 반환한다', () => {
  const validation = getNavigationMarkerValidation([
    createMeasure('m1', [NAVIGATION_MARKER_TYPES.SEGNO]),
    createMeasure('m2', [NAVIGATION_MARKER_TYPES.TO_CODA]),
    createMeasure('m3', [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA]),
    createMeasure('m4', [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE]),
    createMeasure('m5', [NAVIGATION_MARKER_TYPES.CODA]),
    createMeasure('m6', [NAVIGATION_MARKER_TYPES.CODA]),
  ]);

  assert.equal(validation.isValid, false);
  assert.ok(validation.issues.some((issue) => issue.code === 'multiple-codas'));
  assert.ok(validation.issues.some((issue) => issue.code === 'fine-target-invalid'));
});

test('Coda와 Fine이 실제 반환 경로 밖에 있으면 validation issue를 반환한다', () => {
  const validation = getNavigationMarkerValidation([
    createMeasure('m1', [NAVIGATION_MARKER_TYPES.FINE]),
    createMeasure('m2', [NAVIGATION_MARKER_TYPES.SEGNO]),
    createMeasure('m3', [NAVIGATION_MARKER_TYPES.CODA]),
    createMeasure('m4', [NAVIGATION_MARKER_TYPES.TO_CODA]),
    createMeasure('m5', [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA]),
    createMeasure('m6', [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE]),
  ]);

  assert.equal(validation.isValid, false);
  assert.ok(
    validation.issues.some((issue) => issue.code === 'coda-not-after-command'),
  );
  assert.ok(
    validation.issues.some((issue) => issue.code === 'fine-not-on-return-path'),
  );
});
