import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countMeasuresByPage,
  createMeasureRecognitionRuntimeDiagnostics,
  isCurrentMeasureRecognitionResult,
  prepareRecognizedMeasures,
} from '../src/utils/measureRecognitionRuntime.js';
import {
  NORMALIZED_COORDINATE_SPACE,
  NORMALIZED_COORDINATE_STATUS,
} from '../src/utils/measureCoordinates.js';

function createCandidate(page, x) {
  return {
    height: 0.08,
    page,
    width: 0.2,
    x,
    y: 0.25,
  };
}

test('runtime 적용 단계는 정상 인식 후보를 누락하지 않는다', () => {
  const candidates = [
    createCandidate(1, 0.1),
    createCandidate(1, 0.3),
    createCandidate(2, 0.1),
  ];
  const measures = prepareRecognizedMeasures(candidates, 126);

  assert.equal(measures.length, candidates.length);
  assert.deepEqual(
    measures.map(({ height, page, width, x, y }) => ({
      height,
      page,
      width,
      x,
      y,
    })),
    candidates,
  );
  assert.equal(measures.every((measure) => measure.bpm === 126), true);
  assert.equal(
    measures.every(
      (measure) =>
        measure.coordinateHeight === 1 &&
        measure.coordinateSpace === NORMALIZED_COORDINATE_SPACE &&
        measure.coordinateStatus === NORMALIZED_COORDINATE_STATUS &&
        measure.coordinateWidth === 1,
    ),
    true,
  );
});

test('runtime 진단은 페이지별 recognizer/applied 합계를 같은 기준으로 집계한다', () => {
  const candidates = [
    createCandidate(1, 0.1),
    createCandidate(1, 0.3),
    createCandidate(2, 0.1),
  ];
  const measures = prepareRecognizedMeasures(candidates, 120);
  const diagnostics = createMeasureRecognitionRuntimeDiagnostics({
    appliedMeasures: measures,
    fileName: 'score.pdf',
    pageDiagnostics: [{ pageNumber: 1 }, { pageNumber: 2 }],
    recognizedMeasures: candidates,
  });

  assert.deepEqual(countMeasuresByPage(candidates), { 1: 2, 2: 1 });
  assert.equal(diagnostics.recognizedTotal, 3);
  assert.equal(diagnostics.appliedTotal, 3);
  assert.deepEqual(diagnostics.recognizedByPage, { 1: 2, 2: 1 });
  assert.deepEqual(diagnostics.appliedByPage, { 1: 2, 2: 1 });
});

test('새 PDF 선택 뒤 완료된 이전 인식 결과는 stale로 판정한다', () => {
  const previousPdf = {};
  const nextPdf = {};

  assert.equal(
    isCurrentMeasureRecognitionResult({
      currentPdfBlob: previousPdf,
      currentVersion: 4,
      requestedPdfBlob: previousPdf,
      requestedVersion: 4,
    }),
    true,
  );
  assert.equal(
    isCurrentMeasureRecognitionResult({
      currentPdfBlob: nextPdf,
      currentVersion: 5,
      requestedPdfBlob: previousPdf,
      requestedVersion: 4,
    }),
    false,
  );
});
