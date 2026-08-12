import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyLyricCandidates,
  createLyricCandidates,
  getSystemLyricRegion,
  isChordSymbolText,
  isLyricText,
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

const NEXT_SYSTEM = {
  contentBottom: 0.9,
  contentTop: 0.5,
  index: 1,
  staffBottom: 0.72,
  staffSpacing: 0.02,
  staffTop: 0.64,
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

  assert.deepEqual(
    candidates.map((candidate) => ({
      lyric: candidate.lyric,
      measureId: candidate.measureId,
      measureIndex: candidate.measureIndex,
      page: candidate.page,
    })),
    [
      { lyric: '솔직히 말했어', measureId: 'm1', measureIndex: 0, page: 1 },
      { lyric: '다음가사', measureId: 'm2', measureIndex: 1, page: 1 },
    ],
  );
  const [firstLine] = candidates[0].lyricGeometry.lines;

  assert.equal(candidates[0].lyricGeometry.page, 1);
  assert.equal(candidates[0].lyricGeometry.systemIndex, 0);
  assert.equal(firstLine.lineIndex, 0);
  assert.equal(firstLine.boundaryGapCount, 1);
  assert.ok(Math.abs(firstLine.boundaryGapMedian - 0.15) < 1e-9);
  assert.equal(firstLine.boundaryGapMad, 0);
  assert.ok(Math.abs(firstLine.startX - 0.15) < 1e-9);
  assert.ok(Math.abs(firstLine.endX - 0.41) < 1e-9);
  assert.ok(Math.abs(firstLine.referenceGap - 0.03) < 1e-9);
});

test('여러 lyric baseline은 한 measure의 줄바꿈으로 보존한다', () => {
  const [candidate] = createLyricCandidates({
    measures: [{ ...MEASURES[0], measureIndex: 0 }],
    systems: [SYSTEM],
    textItems: [text('첫줄', 0.15, 0.32), text('둘째줄', 0.15, 0.37)],
  });

  assert.equal(candidate.lyric, '첫줄\n둘째줄');
});

test('한 staff 아래 세 lyric baseline을 위에서 아래 순서로 보존한다', () => {
  const [candidate] = createLyricCandidates({
    measures: [{ ...MEASURES[0], measureIndex: 0 }],
    systems: [SYSTEM, NEXT_SYSTEM],
    textItems: [
      text('1절', 0.15, 0.32),
      text('2절', 0.15, 0.42),
      text('3절', 0.15, 0.54),
    ],
  });

  assert.equal(candidate.lyric, '1절\n2절\n3절');
  assert.deepEqual(
    candidate.lyricGeometry.lines.map((line) => line.lineIndex),
    [0, 1, 2],
  );
  assert.deepEqual(
    candidate.lyricGeometry.lines.map((line) => line.baselineY),
    [0.32, 0.42, 0.54],
  );
});

test('마지막 staff는 페이지 경계까지 세 lyric baseline을 탐색한다', () => {
  const [candidate] = createLyricCandidates({
    measures: [{ ...MEASURES[0], measureIndex: 0 }],
    systems: [SYSTEM],
    textItems: [
      text('마지막 1절', 0.15, 0.42, 0.1),
      text('마지막 2절', 0.15, 0.54, 0.1),
      text('마지막 3절', 0.15, 0.66, 0.1),
    ],
  });

  assert.equal(candidate.lyric, '마지막 1절\n마지막 2절\n마지막 3절');
});

test('마지막 staff의 기존 영역 밖 단일 footer는 verse로 확장하지 않는다', () => {
  const region = getSystemLyricRegion({
    nextSystem: null,
    system: SYSTEM,
    textItems: [text('공연 안내', 0.15, 0.72, 0.1)],
  });

  assert.deepEqual(region.items, []);
  assert.deepEqual(region.lines, []);
});

test('다중 verse lyric region은 다음 staff 시작 전까지만 사용한다', () => {
  const currentVerses = [
    text('첫 절', 0.15, 0.32),
    text('둘째 절', 0.15, 0.42),
    text('셋째 절', 0.15, 0.54),
  ];
  const currentStaffChord = text('Gm', 0.15, 0.14);
  const nextStaffChord = text('Dm7', 0.15, 0.61);
  const nextStaffLyric = text('다음 줄 가사', 0.15, 0.78, 0.1);
  const lyricRegion = getSystemLyricRegion({
    nextSystem: NEXT_SYSTEM,
    system: SYSTEM,
    textItems: [
      currentStaffChord,
      ...currentVerses,
      nextStaffChord,
      nextStaffLyric,
    ],
  });
  const candidates = createLyricCandidates({
    measures: MEASURES.map((measure, measureIndex) => ({
      ...measure,
      measureIndex,
    })),
    systems: [SYSTEM, NEXT_SYSTEM],
    textItems: [
      currentStaffChord,
      ...currentVerses,
      nextStaffChord,
      nextStaffLyric,
    ],
  });

  assert.deepEqual(lyricRegion.items, currentVerses);
  assert.equal(candidates[0].lyric, '첫 절\n둘째 절\n셋째 절');
  assert.equal(candidates[0].lyric.includes('Dm7'), false);
  assert.equal(candidates[0].lyric.includes('다음 줄 가사'), false);
});

test('Measure마다 세 verse의 x 위치를 독립적으로 연결한다', () => {
  const candidates = createLyricCandidates({
    measures: MEASURES.map((measure, measureIndex) => ({
      ...measure,
      measureIndex,
    })),
    systems: [SYSTEM, NEXT_SYSTEM],
    textItems: [
      text('너에게', 0.15, 0.32, 0.08),
      text('다음으로', 0.56, 0.32, 0.08),
      text('그날의', 0.15, 0.42, 0.08),
      text('기억을', 0.56, 0.42, 0.08),
      text('언젠가', 0.15, 0.54, 0.08),
      text('만나자', 0.56, 0.54, 0.08),
    ],
  });

  assert.deepEqual(
    candidates.map(({ lyric, measureId }) => ({ lyric, measureId })),
    [
      { lyric: '너에게\n그날의\n언젠가', measureId: 'm1' },
      { lyric: '다음으로\n기억을\n만나자', measureId: 'm2' },
    ],
  );
});

test('중간 verse가 빈 Measure에서도 line slot을 당기지 않는다', () => {
  const candidates = createLyricCandidates({
    measures: MEASURES.map((measure, measureIndex) => ({
      ...measure,
      measureIndex,
    })),
    systems: [SYSTEM, NEXT_SYSTEM],
    textItems: [
      text('너에게', 0.15, 0.32, 0.08),
      text('둘째 절', 0.56, 0.42, 0.08),
      text('언젠가', 0.15, 0.54, 0.08),
    ],
  });

  assert.equal(candidates[0].lyric, '너에게\n\n언젠가');
  assert.deepEqual(
    candidates[0].lyricGeometry.lines.map((line) => line.lineIndex),
    [0, 2],
  );
  assert.equal(candidates[1].lyric, '\n둘째 절\n');
  assert.deepEqual(
    candidates[1].lyricGeometry.lines.map((line) => line.lineIndex),
    [1],
  );
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

test('명확한 chord와 분리된 suffix는 제외하고 일반 영문 가사는 유지한다', () => {
  const chords = [
    'Dm7',
    'Eb/Bb',
    'Gm',
    'C7(b9)',
    'F#m',
    'Asus4',
    'M7',
    'm/B',
    '/D',
    '/F',
    'aug',
  ];
  const lyrics = ['Come with me', 'All about you', 'Maybe tomorrow'];

  chords.forEach((value) => {
    assert.equal(isChordSymbolText(value), true, value);
    assert.equal(isLyricText(value), false, value);
  });
  lyrics.forEach((value) => {
    assert.equal(isChordSymbolText(value), false, value);
    assert.equal(isLyricText(value), true, value);
  });
  assert.equal(isLyricText('example.com'), false);
  assert.equal(isLyricText('https://example.com/score'), false);
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

test('가사 후보 geometry는 원본 lyric 보존 여부와 무관하게 runtime measure에 적용된다', () => {
  const lyricGeometry = {
    lines: [{ endX: 0.4, lineIndex: 0, referenceGap: 0.02, startX: 0.2 }],
    page: 1,
    systemEndX: 0.9,
    systemIndex: 0,
    systemStartX: 0.1,
  };
  const result = applyLyricCandidates(
    [{ ...MEASURES[0], lyric: '수동 가사' }],
    [{ lyric: '자동 후보', lyricGeometry, measureId: 'm1' }],
  );

  assert.equal(result.measures[0].lyric, '수동 가사');
  assert.equal(result.measures[0].lyricGeometry, lyricGeometry);
});

test('적용된 자동 가사는 기존 JSON 배열 형식으로 왕복한다', () => {
  const applied = applyLyricCandidates(MEASURES, [
    {
      lyric: '자동 가사\n둘째 줄',
      lyricGeometry: {
        lines: [
          { endX: 0.4, lineIndex: 0, referenceGap: 0.02, startX: 0.2 },
        ],
        page: 1,
        systemEndX: 0.9,
        systemIndex: 0,
        systemStartX: 0.1,
      },
      measureId: 'm1',
    },
  ]).measures;
  const exported = exportMeasuresJson(applied);
  const restored = importMeasuresJson(exported);

  assert.equal(restored[0].lyric, '자동 가사\n둘째 줄');
  assert.deepEqual(restored[0].lyricGeometry, applied[0].lyricGeometry);
  assert.deepEqual(JSON.parse(exported)[0].lyricGeometry, applied[0].lyricGeometry);
  assert.equal(Array.isArray(JSON.parse(exported)), true);
});

test('세 줄 자동 가사는 JSON round-trip에서 빈 line slot까지 유지한다', () => {
  const multilineLyric = '1절 가사\n\n3절 가사';
  const applied = applyLyricCandidates(MEASURES, [
    { lyric: multilineLyric, measureId: 'm1' },
  ]).measures;
  const restored = importMeasuresJson(exportMeasuresJson(applied));

  assert.equal(restored[0].lyric, multilineLyric);
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
