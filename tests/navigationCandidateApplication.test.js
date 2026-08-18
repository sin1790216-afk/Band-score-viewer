import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyNavigationCandidate,
  getNavigationCandidateApplicationState,
  NAVIGATION_CANDIDATE_APPLICATION_STATUS,
} from '../src/utils/navigationCandidateApplication.js';
import { collectNavigationEndings } from '../src/utils/navigationEndings.js';
import {
  buildNavigationModel,
} from '../src/utils/navigationModel.js';
import {
  hasNavigationMarker,
  NAVIGATION_MARKER_TYPES,
} from '../src/utils/navigationMarkers.js';
import {
  NAVIGATION_TEXT_MATCH_STATUS,
  reconcileNavigationTextCandidates,
} from '../src/utils/navigationTextDetection.js';

const CURRENT_CONTEXT = Object.freeze({
  candidateMeasureIdentity: 'measures-current',
  candidatePdfIdentity: 'pdf-current',
  currentMeasureIdentity: 'measures-current',
  currentPdfIdentity: 'pdf-current',
});

function createMeasures(count = 8) {
  return Array.from({ length: count }, (_, index) => ({
    height: 0.2,
    id: `m${index + 1}`,
    navigationEndings: [],
    navigationMarkers: [],
    page: 1,
    width: 0.1,
    x: index * 0.1,
    y: 0.2,
  }));
}

function createCandidate(type, measureIndex, changes = {}) {
  return {
    bounds: { height: 0.02, width: 0.02, x: 0.1, y: 0.1 },
    confidence: 'high',
    evidence: {},
    id: `candidate-${type}-${measureIndex}`,
    measureId: `m${measureIndex + 1}`,
    measureIndex,
    pageNumber: 1,
    rawText: type,
    source: 'pdf-text',
    type,
    ...changes,
  };
}

function apply(candidate, measures, context = CURRENT_CONTEXT) {
  return applyNavigationCandidate(candidate, measures, context);
}

function withMarker(measures, measureIndex, type) {
  return measures.map((measure, index) =>
    index === measureIndex
      ? { ...measure, navigationMarkers: [{ type }] }
      : measure,
  );
}

function createRepeatSectionMeasures() {
  let measures = createMeasures();

  measures = apply(
    createCandidate(NAVIGATION_MARKER_TYPES.REPEAT_START, 0),
    measures,
  ).measures;
  measures = apply(
    createCandidate(NAVIGATION_MARKER_TYPES.REPEAT_END, 3),
    measures,
  ).measures;

  return measures;
}

test('미적용 marker 후보를 canonical marker로 추가한다', () => {
  const candidate = createCandidate(NAVIGATION_MARKER_TYPES.DAL_SEGNO, 2);
  const result = apply(candidate, createMeasures());

  assert.equal(result.status, NAVIGATION_CANDIDATE_APPLICATION_STATUS.APPLIED);
  assert.equal(result.changed, true);
  assert.equal(hasNavigationMarker(result.measures[2], candidate.type), true);
});

test('같은 후보를 두 번 적용하면 두 번째는 no-op이다', () => {
  const candidate = createCandidate(NAVIGATION_MARKER_TYPES.DAL_SEGNO, 2);
  const first = apply(candidate, createMeasures());
  const second = apply(candidate, first.measures);

  assert.equal(second.status, NAVIGATION_CANDIDATE_APPLICATION_STATUS.ALREADY_APPLIED);
  assert.equal(second.changed, false);
  assert.equal(second.measures, first.measures);
});

test('같은 Measure에 marker가 이미 있으면 no-op이다', () => {
  const candidate = createCandidate(NAVIGATION_MARKER_TYPES.TO_CODA, 3);
  const measures = withMarker(createMeasures(), 3, candidate.type);
  const result = apply(candidate, measures);

  assert.equal(result.status, NAVIGATION_CANDIDATE_APPLICATION_STATUS.ALREADY_APPLIED);
  assert.equal(result.changed, false);
  assert.equal(result.measures, measures);
});

test('유효하지 않은 Measure index는 적용하지 않는다', () => {
  const result = apply(
    createCandidate(NAVIGATION_MARKER_TYPES.FINE, -1, { measureId: null }),
    createMeasures(),
  );

  assert.equal(result.status, NAVIGATION_CANDIDATE_APPLICATION_STATUS.INVALID_ASSOCIATION);
  assert.equal(result.changed, false);
});

test('PDF 또는 Measure identity가 stale이면 적용하지 않는다', () => {
  const result = apply(
    createCandidate(NAVIGATION_MARKER_TYPES.FINE, 1),
    createMeasures(),
    { ...CURRENT_CONTEXT, currentMeasureIdentity: 'measures-changed' },
  );

  assert.equal(result.status, NAVIGATION_CANDIDATE_APPLICATION_STATUS.STALE);
  assert.equal(result.changed, false);
});

test('candidate Measure ID가 현재 위치와 다르면 stale로 거부한다', () => {
  const result = apply(
    createCandidate(NAVIGATION_MARKER_TYPES.FINE, 1, { measureId: 'old-m2' }),
    createMeasures(),
  );

  assert.equal(result.status, NAVIGATION_CANDIDATE_APPLICATION_STATUS.STALE);
  assert.equal(result.changed, false);
});

test('유일 marker가 다른 위치에 있으면 몰래 이동하지 않는다', () => {
  const measures = withMarker(createMeasures(), 0, NAVIGATION_MARKER_TYPES.SEGNO);
  const result = apply(
    createCandidate(NAVIGATION_MARKER_TYPES.SEGNO, 4),
    measures,
  );

  assert.equal(result.status, NAVIGATION_CANDIDATE_APPLICATION_STATUS.CONFLICT);
  assert.equal(result.changed, false);
  assert.equal(hasNavigationMarker(result.measures[0], NAVIGATION_MARKER_TYPES.SEGNO), true);
  assert.equal(hasNavigationMarker(result.measures[4], NAVIGATION_MARKER_TYPES.SEGNO), false);
});

test('Repeat Start와 Repeat End는 각각 적용할 수 있다', () => {
  const start = apply(
    createCandidate(NAVIGATION_MARKER_TYPES.REPEAT_START, 1),
    createMeasures(),
  );
  const end = apply(
    createCandidate(NAVIGATION_MARKER_TYPES.REPEAT_END, 5),
    start.measures,
  );

  assert.equal(hasNavigationMarker(end.measures[1], NAVIGATION_MARKER_TYPES.REPEAT_START), true);
  assert.equal(hasNavigationMarker(end.measures[5], NAVIGATION_MARKER_TYPES.REPEAT_END), true);
  assert.deepEqual(
    buildNavigationModel(end.measures).repeatSections.map((section) => [
      section.startIndex,
      section.endIndex,
    ]),
    [[1, 5]],
  );
});

for (const type of [
  NAVIGATION_MARKER_TYPES.SEGNO,
  NAVIGATION_MARKER_TYPES.CODA,
  NAVIGATION_MARKER_TYPES.DAL_SEGNO,
  NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
  NAVIGATION_MARKER_TYPES.TO_CODA,
  NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE,
  NAVIGATION_MARKER_TYPES.FINE,
]) {
  test(`${type} 후보를 canonical marker로 적용한다`, () => {
    const result = apply(createCandidate(type, 2), createMeasures());

    assert.equal(result.status, NAVIGATION_CANDIDATE_APPLICATION_STATUS.APPLIED);
    assert.equal(hasNavigationMarker(result.measures[2], type), true);
  });
}

test('Coda가 다른 위치에 있으면 충돌로 처리한다', () => {
  const measures = withMarker(createMeasures(), 6, NAVIGATION_MARKER_TYPES.CODA);
  const result = apply(
    createCandidate(NAVIGATION_MARKER_TYPES.CODA, 2),
    measures,
  );

  assert.equal(result.status, NAVIGATION_CANDIDATE_APPLICATION_STATUS.CONFLICT);
  assert.equal(result.changed, false);
});

test('Repeat End와 To Coda는 같은 마디에 함께 적용할 수 있다', () => {
  const measures = withMarker(
    createMeasures(),
    3,
    NAVIGATION_MARKER_TYPES.REPEAT_END,
  );
  const result = apply(
    createCandidate(NAVIGATION_MARKER_TYPES.TO_CODA, 3),
    measures,
  );

  assert.equal(result.status, NAVIGATION_CANDIDATE_APPLICATION_STATUS.APPLIED);
  assert.equal(hasNavigationMarker(result.measures[3], NAVIGATION_MARKER_TYPES.REPEAT_END), true);
  assert.equal(hasNavigationMarker(result.measures[3], NAVIGATION_MARKER_TYPES.TO_CODA), true);
});

test('Repeat section에 1. 괄호와 2. 괄호를 적용한다', () => {
  let measures = createRepeatSectionMeasures();
  const firstCandidate = createCandidate('volta-anchor', 2, {
    passes: [1],
    source: 'pdf-hybrid',
  });
  const secondCandidate = createCandidate('volta-anchor', 4, {
    passes: [2],
    source: 'pdf-hybrid',
  });

  measures = apply(firstCandidate, measures).measures;
  measures = apply(secondCandidate, measures).measures;

  assert.deepEqual(
    collectNavigationEndings(measures).map((ending) => ({
      passes: ending.passes,
      startMeasureId: ending.startMeasureId,
    })),
    [
      { passes: [1], startMeasureId: 'm3' },
      { passes: [2], startMeasureId: 'm5' },
    ],
  );
});

test('Volta의 복수 passes를 순서대로 보존한다', () => {
  const candidate = createCandidate('volta-anchor', 2, {
    passes: [1, 3],
    source: 'pdf-hybrid',
  });
  const result = apply(candidate, createRepeatSectionMeasures());

  assert.deepEqual(collectNavigationEndings(result.measures)[0].passes, [1, 3]);
});

test('Repeat section이 없으면 Volta 적용을 거부한다', () => {
  const result = apply(
    createCandidate('volta-anchor', 2, { passes: [1] }),
    createMeasures(),
  );

  assert.equal(result.status, NAVIGATION_CANDIDATE_APPLICATION_STATUS.REPEAT_REQUIRED);
  assert.equal(result.changed, false);
});

test('두 Repeat section에 걸치는 Volta는 모호함으로 거부한다', () => {
  let measures = createMeasures(7);

  measures = withMarker(measures, 0, NAVIGATION_MARKER_TYPES.REPEAT_START);
  measures = withMarker(measures, 2, NAVIGATION_MARKER_TYPES.REPEAT_END);
  measures = withMarker(measures, 3, NAVIGATION_MARKER_TYPES.REPEAT_START);
  measures = withMarker(measures, 5, NAVIGATION_MARKER_TYPES.REPEAT_END);

  const result = apply(
    createCandidate('volta-anchor', 3, { passes: [2] }),
    measures,
  );

  assert.equal(
    result.status,
    NAVIGATION_CANDIDATE_APPLICATION_STATUS.AMBIGUOUS_REPEAT_SECTION,
  );
  assert.equal(result.changed, false);
});

test('명시된 repeat evidence가 모호한 위치의 Volta section을 결정한다', () => {
  let measures = createMeasures(7);

  measures = withMarker(measures, 0, NAVIGATION_MARKER_TYPES.REPEAT_START);
  measures = withMarker(measures, 2, NAVIGATION_MARKER_TYPES.REPEAT_END);
  measures = withMarker(measures, 3, NAVIGATION_MARKER_TYPES.REPEAT_START);
  measures = withMarker(measures, 5, NAVIGATION_MARKER_TYPES.REPEAT_END);

  const result = apply(
    createCandidate('volta-anchor', 3, {
      evidence: {
        repeatStructure: {
          measureId: 'm4',
          type: NAVIGATION_MARKER_TYPES.REPEAT_START,
        },
      },
      passes: [2],
    }),
    measures,
  );

  assert.equal(result.status, NAVIGATION_CANDIDATE_APPLICATION_STATUS.APPLIED);
  assert.equal(collectNavigationEndings(result.measures)[0].repeatStartMeasureId, 'm4');
});

test('같은 Volta가 이미 있으면 no-op이다', () => {
  const candidate = createCandidate('volta-anchor', 2, { passes: [1] });
  const first = apply(candidate, createRepeatSectionMeasures());
  const second = apply(candidate, first.measures);

  assert.equal(second.status, NAVIGATION_CANDIDATE_APPLICATION_STATUS.ALREADY_APPLIED);
  assert.equal(second.changed, false);
});

test('적용 후 reconcile 결과가 MATCHED_EXISTING_MARKER로 바뀐다', () => {
  const candidate = createCandidate(NAVIGATION_MARKER_TYPES.DAL_SEGNO, 2);
  const result = apply(candidate, createMeasures());
  const [reconciled] = reconcileNavigationTextCandidates(
    [candidate],
    result.measures,
  );

  assert.equal(
    reconciled.matchStatus,
    NAVIGATION_TEXT_MATCH_STATUS.MATCHED_EXISTING_MARKER,
  );
});

test('canonical Project data에 candidate 진단 metadata를 복사하지 않는다', () => {
  const candidate = createCandidate(NAVIGATION_MARKER_TYPES.SEGNO, 2, {
    evidence: { glyph: 'custom-symbol' },
  });
  const result = apply(candidate, createMeasures());
  const serialized = JSON.stringify(result.measures);

  assert.equal(serialized.includes('candidate-segno'), false);
  assert.equal(serialized.includes('custom-symbol'), false);
  assert.equal(serialized.includes('pdf-text'), false);
  assert.deepEqual(result.measures[2].navigationMarkers, [{ type: 'segno' }]);
});

test('UI 상태 계산도 적용과 같은 stale 검증을 사용한다', () => {
  const state = getNavigationCandidateApplicationState(
    createCandidate(NAVIGATION_MARKER_TYPES.SEGNO, 1),
    createMeasures(),
    { ...CURRENT_CONTEXT, currentPdfIdentity: 'pdf-changed' },
  );

  assert.equal(state.status, NAVIGATION_CANDIDATE_APPLICATION_STATUS.STALE);
});
