import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyLyricCandidates,
  createLyricCandidates,
  normalizePdfTextItems,
} from '../src/utils/lyricRecognition.js';
import {
  exportMeasuresJson,
  importMeasuresJson,
} from '../src/state/projectState.js';

const SYSTEM = {
  contentBottom: 0.5,
  contentTop: 0.1,
  staffBottom: 0.25,
  staffSpacing: 0.02,
  staffTop: 0.17,
  width: 0.8,
  x: 0.1,
};

const MEASURES = [
  { height: 0.4, id: 'm1', lyric: '', page: 1, width: 0.4, x: 0.1, y: 0.1 },
  { height: 0.4, id: 'm2', lyric: '', page: 1, width: 0.4, x: 0.5, y: 0.1 },
];

function text(textValue, x, baselineY, width = 0.02, height = 0.02) {
  return { baselineY, height, text: textValue, width, x, y: baselineY - height };
}

test('PDF text item을 페이지 좌상단 기준 정규화 좌표로 변환한다', () => {
  const [item] = normalizePdfTextItems(
    [{ str: '가사', transform: [10, 0, 0, 10, 250, 500], width: 200 }],
    { height: 1000, transform: [1, 0, 0, -1, 0, 1000], width: 1000 },
  );

  assert.deepEqual(item, {
    baselineY: 0.5,
    height: 0.01,
    text: '가사',
    width: 0.2,
    x: 0.25,
    y: 0.49,
  });
});

test('오선 아래 텍스트를 measure 가로 범위에 연결하고 자연스러운 단어 간격을 만든다', () => {
  const candidates = createLyricCandidates({
    measures: MEASURES.map((measure, measureIndex) => ({
      ...measure,
      measureIndex,
    })),
    systems: [SYSTEM],
    textItems: [
      text('솔', 0.15, 0.32),
      text('직', 0.19, 0.32),
      text('히', 0.23, 0.32),
      text('말했어', 0.34, 0.32, 0.07),
      text('다음', 0.56, 0.32, 0.05),
      text('가사', 0.64, 0.32, 0.05),
    ],
  });

  assert.deepEqual(candidates, [
    { lyric: '솔직히 말했어', measureId: 'm1', measureIndex: 0, page: 1 },
    { lyric: '다음가사', measureId: 'm2', measureIndex: 1, page: 1 },
  ]);
});

test('여러 lyric baseline은 한 measure의 줄바꿈으로 보존한다', () => {
  const [candidate] = createLyricCandidates({
    measures: [{ ...MEASURES[0], measureIndex: 0 }],
    systems: [SYSTEM],
    textItems: [text('첫줄', 0.15, 0.32), text('둘째줄', 0.15, 0.37)],
  });

  assert.equal(candidate.lyric, '첫줄\n둘째줄');
});

test('오선 위 코드와 박자 숫자, 오선 안 기호는 가사 후보에서 제외한다', () => {
  const candidates = createLyricCandidates({
    measures: [{ ...MEASURES[0], measureIndex: 0 }],
    systems: [SYSTEM],
    textItems: [
      text('DM7', 0.15, 0.31),
      text('126', 0.2, 0.32),
      text('œ', 0.25, 0.23),
      text('œœ œ', 0.3, 0.32),
      text('J', 0.35, 0.34),
    ],
  });

  assert.deepEqual(candidates, []);
});

test('빈 text layer는 가사 후보를 만들지 않는다', () => {
  assert.deepEqual(
    createLyricCandidates({ measures: MEASURES, systems: [SYSTEM], textItems: [] }),
    [],
  );
});

test('가사 후보 적용은 빈 lyric만 채우고 기존 수동 가사는 보존한다', () => {
  const originalMeasures = [
    { ...MEASURES[0], lyric: '수동 가사' },
    MEASURES[1],
  ];
  const result = applyLyricCandidates(originalMeasures, [
    { lyric: '자동 후보 1', measureId: 'm1' },
    { lyric: '자동 후보 2\n두 번째 줄', measureId: 'm2' },
  ]);

  assert.equal(result.appliedCount, 1);
  assert.equal(result.preservedCount, 1);
  assert.equal(result.measures[0], originalMeasures[0]);
  assert.equal(result.measures[0].lyric, '수동 가사');
  assert.equal(result.measures[1].lyric, '자동 후보 2\n두 번째 줄');
  assert.equal(originalMeasures[1].lyric, '');
});

test('적용된 자동 가사는 기존 JSON 배열 형식으로 왕복한다', () => {
  const applied = applyLyricCandidates(MEASURES, [
    { lyric: '자동 가사\n둘째 줄', measureId: 'm1' },
  ]).measures;
  const restored = importMeasuresJson(exportMeasuresJson(applied));

  assert.equal(restored[0].lyric, '자동 가사\n둘째 줄');
  assert.equal(Array.isArray(JSON.parse(exportMeasuresJson(applied))), true);
});

test('가사 후보는 적용 전까지 원본 measures를 변경하지 않아 취소할 수 있다', () => {
  const measures = structuredClone(MEASURES);
  const snapshot = structuredClone(measures);

  createLyricCandidates({
    measures: measures.map((measure, measureIndex) => ({ ...measure, measureIndex })),
    systems: [SYSTEM],
    textItems: [text('후보', 0.15, 0.32)],
  });

  assert.deepEqual(measures, snapshot);
});
