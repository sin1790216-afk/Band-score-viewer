import assert from 'node:assert/strict';
import test from 'node:test';

import { applyLyricCandidates } from '../src/utils/lyricRecognition.js';
import {
  createVocalPhrases,
  createVocalViewModel,
  getMeaningfulLyric,
  getVocalPhraseContext,
  getVocalPhraseDisplayText,
  isVocalPhraseBoundary,
} from '../src/utils/vocalPhrases.js';
import { normalizeMeasures } from '../src/state/projectState.js';
import { isValidMeasuresState } from '../src/utils/serverSecurity.js';

function measuresFromLyrics(lyrics) {
  return lyrics.map((lyric, index) => ({
    id: `measure-${index + 1}`,
    lyric,
  }));
}

function geometry({
  boundaryGapCount = 0,
  boundaryGapMad = 0,
  boundaryGapMedian = 0,
  endX,
  lineIndex = 0,
  page = 1,
  referenceGap = 0.02,
  startX,
  systemEndX = 0.9,
  systemIndex = 0,
  systemStartX = 0.1,
}) {
  return {
    lines: [
      {
        boundaryGapCount,
        boundaryGapMad,
        boundaryGapMedian,
        endX,
        lineIndex,
        referenceGap,
        startX,
      },
    ],
    page,
    systemEndX,
    systemIndex,
    systemStartX,
  };
}

function measureWithGeometry(lyric, index, lyricGeometry) {
  return { id: `measure-${index + 1}`, lyric, lyricGeometry };
}

test('빈 lyric을 경계로 연속 Measure 가사를 Vocal Phrase로 묶는다', () => {
  const phrases = createVocalPhrases(
    measuresFromLyrics(['매만지는', '바람', '', '한숨처럼', '다가와']),
  );

  assert.deepEqual(phrases, [
    {
      displayText: '매만지는 바람',
      endMeasureIndex: 1,
      measureIds: ['measure-1', 'measure-2'],
      startMeasureIndex: 0,
      text: '매만지는 바람',
    },
    {
      displayText: '한숨처럼 다가와',
      endMeasureIndex: 4,
      measureIds: ['measure-4', 'measure-5'],
      startMeasureIndex: 3,
      text: '한숨처럼 다가와',
    },
  ]);
});

test('첫 Measure가 비어 있으면 다음 가사부터 Phrase가 시작된다', () => {
  const [phrase] = createVocalPhrases(measuresFromLyrics(['', '너에게', '닿기를']));

  assert.equal(phrase.startMeasureIndex, 1);
  assert.equal(phrase.endMeasureIndex, 2);
  assert.equal(phrase.text, '너에게 닿기를');
});

test('마지막 Measure까지 이어지는 가사를 마지막 Phrase에 포함한다', () => {
  const phrases = createVocalPhrases(measuresFromLyrics(['', '마지막', '문장']));

  assert.equal(phrases.length, 1);
  assert.equal(phrases[0].endMeasureIndex, 2);
});

test('모든 lyric이 비어 있으면 Phrase를 만들지 않는다', () => {
  assert.deepEqual(createVocalPhrases(measuresFromLyrics(['', ' ', '\n'])), []);
});

test('한 Measure의 lyric도 하나의 Phrase가 된다', () => {
  assert.deepEqual(createVocalPhrases(measuresFromLyrics(['한마디'])), [
    {
      displayText: '한마디',
      endMeasureIndex: 0,
      measureIds: ['measure-1'],
      startMeasureIndex: 0,
      text: '한마디',
    },
  ]);
});

test('null, undefined와 whitespace lyric을 모두 Phrase 경계로 처리한다', () => {
  const phrases = createVocalPhrases(
    measuresFromLyrics(['첫째', null, '둘째', undefined, '   ', '셋째']),
  );

  assert.deepEqual(
    phrases.map(({ endMeasureIndex, startMeasureIndex, text }) => ({
      endMeasureIndex,
      startMeasureIndex,
      text,
    })),
    [
      { endMeasureIndex: 0, startMeasureIndex: 0, text: '첫째' },
      { endMeasureIndex: 2, startMeasureIndex: 2, text: '둘째' },
      { endMeasureIndex: 5, startMeasureIndex: 5, text: '셋째' },
    ],
  );
});

test('음가 연장 placeholder는 원본을 바꾸지 않고 Phrase에서만 빈 가사로 처리한다', () => {
  const placeholders = ['-', '–', '_', '  ', '－', 'œ'];

  placeholders.forEach((lyric) => {
    const measure = { lyric };

    assert.equal(getMeaningfulLyric(measure), '');
    assert.equal(measure.lyric, lyric);
  });

  assert.deepEqual(
    createVocalPhrases(measuresFromLyrics(['앞', '-', '뒤'])).map(
      ({ startMeasureIndex, text }) => ({ startMeasureIndex, text }),
    ),
    [
      { startMeasureIndex: 0, text: '앞' },
      { startMeasureIndex: 2, text: '뒤' },
    ],
  );
});

test('같은 lyric line의 일반적인 작은 gap은 같은 Phrase로 유지한다', () => {
  const measures = [
    measureWithGeometry(
      '매만지는',
      0,
      geometry({ endX: 0.22, startX: 0.1 }),
    ),
    measureWithGeometry(
      '바람',
      1,
      geometry({ endX: 0.34, startX: 0.25 }),
    ),
  ];

  assert.equal(isVocalPhraseBoundary(measures[0], measures[1]), false);
  assert.equal(createVocalPhrases(measures)[0].text, '매만지는 바람');
});

test('같은 system 내부의 상대적으로 큰 lyric gap은 Phrase를 분리한다', () => {
  const measures = [
    measureWithGeometry(
      '매만지는 바람',
      0,
      geometry({ endX: 0.3, startX: 0.1 }),
    ),
    measureWithGeometry(
      '한숨처럼',
      1,
      geometry({ endX: 0.58, startX: 0.42 }),
    ),
  ];

  assert.equal(isVocalPhraseBoundary(measures[0], measures[1]), true);
  assert.deepEqual(
    createVocalPhrases(measures).map((phrase) => phrase.text),
    ['매만지는 바람', '한숨처럼'],
  );
});

test('4배 미만 gap도 같은 baseline 경계 분포의 robust outlier면 Phrase를 분리한다', () => {
  const boundaryStats = {
    boundaryGapCount: 3,
    boundaryGapMad: 0.0004,
    boundaryGapMedian: 0.05,
  };
  const measures = [
    measureWithGeometry(
      '이전 문장',
      0,
      geometry({ ...boundaryStats, endX: 0.3, startX: 0.12 }),
    ),
    measureWithGeometry(
      '다음 문장',
      1,
      geometry({ ...boundaryStats, endX: 0.52, startX: 0.374 }),
    ),
  ];

  assert.ok((0.374 - 0.3) / 0.02 < 4);
  assert.equal(isVocalPhraseBoundary(measures[0], measures[1]), true);
});

test('baseline 경계 분포와 비슷한 4배 미만 gap은 같은 Phrase로 유지한다', () => {
  const boundaryStats = {
    boundaryGapCount: 3,
    boundaryGapMad: 0.004,
    boundaryGapMedian: 0.05,
  };
  const measures = [
    measureWithGeometry(
      '이어지는',
      0,
      geometry({ ...boundaryStats, endX: 0.3, startX: 0.12 }),
    ),
    measureWithGeometry(
      '가사',
      1,
      geometry({ ...boundaryStats, endX: 0.5, startX: 0.355 }),
    ),
  ];

  assert.equal(isVocalPhraseBoundary(measures[0], measures[1]), false);
  assert.equal(createVocalPhrases(measures).length, 1);
});

test('같은 system 안에 큰 gap으로 나뉜 Phrase 두 개를 만든다', () => {
  const spans = [
    [0.1, 0.18],
    [0.21, 0.3],
    [0.5, 0.58],
    [0.61, 0.7],
  ];
  const measures = ['로운 햇살', '종소리', '매만지는', '바람'].map(
    (lyric, index) =>
      measureWithGeometry(
        lyric,
        index,
        geometry({ endX: spans[index][1], startX: spans[index][0] }),
      ),
  );

  assert.deepEqual(
    createVocalPhrases(measures).map(
      ({ endMeasureIndex, startMeasureIndex, text }) => ({
        endMeasureIndex,
        startMeasureIndex,
        text,
      }),
    ),
    [
      { endMeasureIndex: 1, startMeasureIndex: 0, text: '로운 햇살 종소리' },
      { endMeasureIndex: 3, startMeasureIndex: 2, text: '매만지는 바람' },
    ],
  );
});

test('다음 staff system의 lyric baseline은 수평 공백과 무관하게 새 Phrase가 된다', () => {
  const measures = [
    measureWithGeometry(
      '이어지는',
      0,
      geometry({ endX: 0.88, startX: 0.7, systemIndex: 0 }),
    ),
    measureWithGeometry(
      '가사',
      1,
      geometry({ endX: 0.25, startX: 0.12, systemIndex: 1 }),
    ),
  ];

  assert.equal(isVocalPhraseBoundary(measures[0], measures[1]), true);
  assert.deepEqual(
    createVocalPhrases(measures).map((phrase) => phrase.text),
    ['이어지는', '가사'],
  );
});

test('같은 staff system에서도 lyric baseline이 바뀌면 새 Phrase가 된다', () => {
  const measures = [
    measureWithGeometry(
      '첫 번째 가사 줄',
      0,
      geometry({ endX: 0.42, lineIndex: 0, startX: 0.12, systemIndex: 0 }),
    ),
    measureWithGeometry(
      '두 번째 가사 줄',
      1,
      geometry({ endX: 0.44, lineIndex: 1, startX: 0.14, systemIndex: 0 }),
    ),
  ];

  assert.equal(isVocalPhraseBoundary(measures[0], measures[1]), true);
  assert.equal(createVocalPhrases(measures).length, 2);
});

test('20개가 넘는 meaningful lyric도 실제 큰 gap에서 여러 Phrase로 분리한다', () => {
  const starts = [0.1, 0.16, 0.22, 0.28, 0.52, 0.58, 0.64];
  const measures = Array.from({ length: 21 }, (_, index) => {
    const systemIndex = Math.floor(index / starts.length);
    const localIndex = index % starts.length;
    const startX = starts[localIndex];

    return measureWithGeometry(
      `가사${index + 1}`,
      index,
      geometry({
        endX: startX + 0.02,
        startX,
        systemIndex,
      }),
    );
  });

  const phrases = createVocalPhrases(measures);

  assert.ok(phrases.length > 1);
  assert.equal(phrases.flatMap((phrase) => phrase.measureIds).length, 21);
});

test('Measure lyric 수정 후 새 입력에서 Phrase를 즉시 다시 계산한다', () => {
  const measures = measuresFromLyrics(['매만지는', '바람']);
  const beforeEdit = createVocalPhrases(measures);
  const afterEdit = createVocalPhrases(
    measures.map((measure, index) =>
      index === 1 ? { ...measure, lyric: '바람처럼' } : measure,
    ),
  );

  assert.equal(beforeEdit[0].text, '매만지는 바람');
  assert.equal(afterEdit[0].text, '매만지는 바람처럼');
});

test('자동 가사 후보가 measure.lyric에 적용되면 별도 데이터 없이 Phrase가 생성된다', () => {
  const measures = measuresFromLyrics(['', '', '']);
  const applied = applyLyricCandidates(measures, [
    { lyric: '자동', measureId: 'measure-1' },
    { lyric: '가사', measureId: 'measure-2' },
  ]).measures;

  assert.equal(createVocalPhrases(applied)[0].text, '자동 가사');
});

test('Phrase 시작, 중간, 끝 Measure는 모두 같은 currentPhrase를 반환한다', () => {
  const phrases = createVocalPhrases(
    measuresFromLyrics(['시작', '중간', '끝', '', '다음']),
  );

  const start = getVocalPhraseContext(phrases, 0).currentPhrase;
  const middle = getVocalPhraseContext(phrases, 1).currentPhrase;
  const end = getVocalPhraseContext(phrases, 2).currentPhrase;

  assert.equal(start, phrases[0]);
  assert.equal(middle, phrases[0]);
  assert.equal(end, phrases[0]);
});

test('currentMeasure에는 해당 lyric baseline의 Phrase 하나만 반환한다', () => {
  const measures = [
    measureWithGeometry(
      '첫 줄 앞',
      0,
      geometry({ endX: 0.24, lineIndex: 0, startX: 0.1 }),
    ),
    measureWithGeometry(
      '첫 줄 뒤',
      1,
      geometry({ endX: 0.4, lineIndex: 0, startX: 0.27 }),
    ),
    measureWithGeometry(
      '둘째 줄 앞',
      2,
      geometry({ endX: 0.24, lineIndex: 1, startX: 0.1 }),
    ),
    measureWithGeometry(
      '둘째 줄 뒤',
      3,
      geometry({ endX: 0.4, lineIndex: 1, startX: 0.27 }),
    ),
  ];
  const phrases = createVocalPhrases(measures);
  const context = getVocalPhraseContext(phrases, 2);

  assert.equal(phrases.length, 2);
  assert.equal(context.currentPhrase?.text, '둘째 줄 앞 둘째 줄 뒤');
  assert.equal(context.currentPhrase?.startMeasureIndex, 2);
  assert.equal(context.nextPhrase, null);
});

test('빈 lyric Measure에는 currentPhrase가 없다', () => {
  const phrases = createVocalPhrases(measuresFromLyrics(['현재', '', '다음']));

  assert.equal(getVocalPhraseContext(phrases, 1).currentPhrase, null);
});

test('현재 Phrase 또는 빈 Measure 뒤의 nextPhrase를 찾는다', () => {
  const phrases = createVocalPhrases(
    measuresFromLyrics(['현재', '문장', '', '다음', '문장']),
  );

  assert.equal(getVocalPhraseContext(phrases, 0).nextPhrase, phrases[1]);
  assert.equal(getVocalPhraseContext(phrases, 2).nextPhrase, phrases[1]);
  assert.equal(getVocalPhraseContext(phrases, 4).nextPhrase, null);
});

test('Measure lyric 내부 줄바꿈은 보존하고 Measure 사이에만 공백을 둔다', () => {
  const [phrase] = createVocalPhrases(
    measuresFromLyrics(['첫 줄\n둘째 줄', '다음 마디']),
  );

  assert.equal(phrase.text, '첫 줄\n둘째 줄 다음 마디');
});

test('Vocal View model은 세 verse와 빈 중간 line을 손실하지 않는다', () => {
  const multilineLyric = '1절 가사\n\n3절 가사';
  const model = createVocalViewModel(measuresFromLyrics([multilineLyric]), 0);

  assert.equal(model.currentText, multilineLyric);
  assert.equal(model.currentPhrase?.text, multilineLyric);
});

test('AI LanguagePhrase가 빈 배열이면 geometry Phrase로 fallback한다', () => {
  const measures = [
    measureWithGeometry('현재 가사', 0, geometry({ endX: 0.2, startX: 0.1 })),
    { id: 'empty', lyric: '' },
    measureWithGeometry('다음 가사', 2, geometry({ endX: 0.5, startX: 0.4 })),
  ];
  const model = createVocalViewModel(measures, 0, { languagePhrases: [] });

  assert.equal(model.currentText, '현재 가사');
  assert.equal(model.nextText, '다음 가사');
});

test('4개 Phrase 중 currentMeasure가 속한 Phrase 하나만 Vocal text로 선택한다', () => {
  const measures = [
    measureWithGeometry('첫 Phrase', 0, geometry({ endX: 0.2, startX: 0.1 })),
    { id: 'empty-1', lyric: '' },
    measureWithGeometry('둘째 앞', 2, geometry({ endX: 0.35, startX: 0.2 })),
    measureWithGeometry('둘째 뒤', 3, geometry({ endX: 0.52, startX: 0.38 })),
    { id: 'empty-2', lyric: '' },
    measureWithGeometry('셋째 Phrase', 5, geometry({ endX: 0.7, startX: 0.6 })),
    { id: 'empty-3', lyric: '' },
    measureWithGeometry('넷째 Phrase', 7, geometry({ endX: 0.9, startX: 0.8 })),
  ];
  const model = createVocalViewModel(measures, 3);

  assert.equal(model.phraseCount, 4);
  assert.equal(model.currentPhrase?.startMeasureIndex, 2);
  assert.equal(model.currentPhrase?.endMeasureIndex, 3);
  assert.equal(model.currentText, '둘째 앞 둘째 뒤');
  assert.notEqual(
    model.currentText,
    model.phrases.map((phrase) => phrase.text).join(' '),
  );
});

test('currentPhrase가 없으면 곡 전체 lyric을 fallback으로 표시하지 않는다', () => {
  const measures = measuresFromLyrics(['', '첫 Phrase', '', '둘째 Phrase']);
  const model = createVocalViewModel(measures, 0);

  assert.equal(model.currentPhrase, null);
  assert.equal(model.currentText, '');
  assert.equal(model.nextText, '첫 Phrase');
  assert.notEqual(model.nextText, '첫 Phrase 둘째 Phrase');
});

test('geometry가 없는 기존 snapshot은 현재와 다음 Measure lyric만 안전하게 표시한다', () => {
  const measures = measuresFromLyrics(['첫째', '둘째', '셋째']);
  const model = createVocalViewModel(measures, 1);

  assert.equal(model.phrases.length, 1);
  assert.equal(model.phrases[0].text, '첫째 둘째 셋째');
  assert.equal(model.currentPhrase?.startMeasureIndex, 1);
  assert.equal(model.currentPhrase?.endMeasureIndex, 1);
  assert.equal(model.currentText, '둘째');
  assert.equal(model.nextPhrase?.startMeasureIndex, 2);
  assert.equal(model.nextText, '셋째');
});

test('Teacher와 Vocal은 같은 measures와 index에서 같은 표시 모델을 계산한다', () => {
  const measures = [
    measureWithGeometry('현재 앞', 0, geometry({ endX: 0.2, startX: 0.1 })),
    measureWithGeometry('현재 뒤', 1, geometry({ endX: 0.36, startX: 0.23 })),
    { id: 'empty', lyric: '' },
    measureWithGeometry('다음', 3, geometry({ endX: 0.6, startX: 0.5 })),
  ];

  assert.deepEqual(
    createVocalViewModel(measures, 1),
    createVocalViewModel(structuredClone(measures), 1),
  );
});

test('lyricGeometry는 Socket 직렬화와 project normalization 후에도 Phrase 계산에 유지된다', () => {
  const teacherMeasures = [
    measureWithGeometry('첫 Phrase', 0, geometry({ endX: 0.2, startX: 0.1 })),
    measureWithGeometry(
      '둘째 Phrase',
      1,
      geometry({ endX: 0.45, startX: 0.32, systemIndex: 1 }),
    ),
  ];
  const socketPayload = JSON.parse(JSON.stringify(normalizeMeasures(teacherMeasures)));

  assert.equal(isValidMeasuresState(socketPayload), true);
  assert.deepEqual(
    socketPayload.map((measure) => measure.lyricGeometry),
    teacherMeasures.map((measure) => measure.lyricGeometry),
  );
  assert.deepEqual(
    createVocalViewModel(socketPayload, 1).currentPhrase,
    createVocalViewModel(teacherMeasures, 1).currentPhrase,
  );
});

test('Vocal rendered text는 선택된 currentPhrase.displayText를 우선 사용한다', () => {
  const measures = [
    measureWithGeometry('매 만 지 는', 0, geometry({ endX: 0.2, startX: 0.1 })),
    measureWithGeometry('바 람', 1, geometry({ endX: 0.35, startX: 0.23 })),
  ];
  const model = createVocalViewModel(measures, 0);

  assert.equal(model.currentPhrase?.text, '매 만 지 는 바 람');
  assert.equal(model.currentPhrase?.displayText, '매만지는바람');
  assert.equal(model.currentText, model.currentPhrase?.displayText);
});

test('Vocal current와 next는 각 Phrase의 displayText를 사용하고 선택 순서는 유지한다', () => {
  const measures = [
    measureWithGeometry('매 만 지 는 바 람', 0, geometry({ endX: 0.2, startX: 0.1 })),
    { id: 'empty', lyric: '' },
    measureWithGeometry('한 숨 처 럼 다 가 와', 2, geometry({ endX: 0.5, startX: 0.4 })),
  ];
  const model = createVocalViewModel(measures, 0);

  assert.equal(model.currentPhraseIndex, 0);
  assert.equal(model.nextPhraseIndex, 1);
  assert.equal(model.currentText, '매만지는바람');
  assert.equal(model.nextText, '한숨처럼다가와');
});

test('displayText가 없으면 Vocal View model은 원본 text로 안전하게 fallback한다', () => {
  assert.equal(getVocalPhraseDisplayText({ text: '원본 가사' }), '원본 가사');
  assert.equal(getVocalPhraseDisplayText(null), '');
});

test('Phrase 4개에서 current와 next를 같은 context로 선택한다', () => {
  const phrases = [
    { endMeasureIndex: 1, startMeasureIndex: 0, text: 'Phrase 0' },
    { endMeasureIndex: 5, startMeasureIndex: 4, text: 'Phrase 1' },
    { endMeasureIndex: 9, startMeasureIndex: 9, text: 'Phrase 2' },
    { endMeasureIndex: 13, startMeasureIndex: 12, text: 'Phrase 3' },
  ];
  const firstMeasure = getVocalPhraseContext(phrases, 4);
  const samePhraseMeasure = getVocalPhraseContext(phrases, 5);
  const nextPhraseMeasure = getVocalPhraseContext(phrases, 9);

  assert.equal(firstMeasure.currentPhraseIndex, 1);
  assert.equal(firstMeasure.nextPhraseIndex, 2);
  assert.equal(samePhraseMeasure.currentPhraseIndex, 1);
  assert.equal(samePhraseMeasure.nextPhraseIndex, 2);
  assert.equal(nextPhraseMeasure.currentPhraseIndex, 2);
  assert.equal(nextPhraseMeasure.nextPhraseIndex, 3);
});

test('Phrase 사이와 첫 Phrase 이전의 빈 Measure는 이후 첫 Phrase를 next로 반환한다', () => {
  const phrases = [
    { endMeasureIndex: 2, startMeasureIndex: 1, text: 'Phrase A' },
    { endMeasureIndex: 6, startMeasureIndex: 5, text: 'Phrase B' },
  ];
  const beforeFirst = getVocalPhraseContext(phrases, 0);
  const betweenPhrases = getVocalPhraseContext(phrases, 3);

  assert.equal(beforeFirst.currentPhraseIndex, -1);
  assert.equal(beforeFirst.nextPhraseIndex, 0);
  assert.equal(beforeFirst.nextPhrase, phrases[0]);
  assert.equal(betweenPhrases.currentPhraseIndex, -1);
  assert.equal(betweenPhrases.nextPhraseIndex, 1);
  assert.equal(betweenPhrases.nextPhrase, phrases[1]);
});

test('마지막 Phrase 이후와 잘못된 index는 Phrase 0으로 돌아가지 않는다', () => {
  const phrases = [
    { endMeasureIndex: 1, startMeasureIndex: 0, text: 'Phrase A' },
    { endMeasureIndex: 4, startMeasureIndex: 3, text: 'Phrase B' },
  ];
  const lastPhrase = getVocalPhraseContext(phrases, 4);
  const afterLast = getVocalPhraseContext(phrases, 5);
  const invalid = getVocalPhraseContext(phrases, Number.NaN);

  assert.equal(lastPhrase.nextPhraseIndex, -1);
  assert.equal(lastPhrase.nextPhrase, null);
  assert.equal(afterLast.currentPhraseIndex, -1);
  assert.equal(afterLast.nextPhraseIndex, -1);
  assert.equal(afterLast.nextPhrase, null);
  assert.equal(invalid.currentPhraseIndex, -1);
  assert.equal(invalid.nextPhraseIndex, -1);
});

test('measureIndex가 다음 Phrase로 이동하면 currentText와 nextText가 함께 갱신된다', () => {
  const measures = [
    measureWithGeometry('Phrase A', 0, geometry({ endX: 0.2, startX: 0.1 })),
    { id: 'empty-1', lyric: '' },
    measureWithGeometry('Phrase B', 2, geometry({ endX: 0.4, startX: 0.3 })),
    { id: 'empty-2', lyric: '' },
    measureWithGeometry('Phrase C', 4, geometry({ endX: 0.6, startX: 0.5 })),
    { id: 'empty-3', lyric: '' },
    measureWithGeometry('Phrase D', 6, geometry({ endX: 0.8, startX: 0.7 })),
  ];

  assert.deepEqual(
    [0, 2, 4].map((measureIndex) => {
      const model = createVocalViewModel(measures, measureIndex);

      return [model.currentText, model.nextText];
    }),
    [
      ['Phrase A', 'Phrase B'],
      ['Phrase B', 'Phrase C'],
      ['Phrase C', 'Phrase D'],
    ],
  );
});

test('Socket sync measureIndex 흐름에서도 Vocal current와 next가 함께 이동한다', () => {
  const teacherMeasures = [
    measureWithGeometry('A', 0, geometry({ endX: 0.2, startX: 0.1 })),
    { id: 'empty-1', lyric: '' },
    measureWithGeometry('B', 2, geometry({ endX: 0.4, startX: 0.3 })),
    { id: 'empty-2', lyric: '' },
    measureWithGeometry('C', 4, geometry({ endX: 0.6, startX: 0.5 })),
    { id: 'empty-3', lyric: '' },
    measureWithGeometry('D', 6, geometry({ endX: 0.8, startX: 0.7 })),
  ];
  const vocalMeasures = JSON.parse(
    JSON.stringify(normalizeMeasures(teacherMeasures)),
  );
  const receivedSyncStates = [0, 2, 4].map((measureIndex) => ({
    measureIndex,
    pageNumber: 1,
  }));

  assert.deepEqual(
    receivedSyncStates.map(({ measureIndex }) => {
      const model = createVocalViewModel(vocalMeasures, measureIndex);

      return `${model.currentText}->${model.nextText}`;
    }),
    ['A->B', 'B->C', 'C->D'],
  );
});
