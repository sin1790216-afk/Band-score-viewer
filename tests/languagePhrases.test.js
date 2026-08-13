import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createContinuousAnalysisSource,
  createLanguagePhraseAnalysisPlan,
  createLanguagePhraseBreathCandidates,
  createLanguagePhraseBoundaryMetadata,
  createLanguagePhraseSourceFingerprint,
  createLanguagePhraseSourceKey,
  getLanguagePhrasesForMeasures,
  LANGUAGE_PHRASE_STATE_VERSION,
  validateLanguagePhraseState,
  validateLanguagePhraseWindowResult,
} from '../src/utils/languagePhrases.js';
import {
  createCoarseDisplayCueTimingProjection,
  createVocalViewModel,
} from '../src/utils/vocalPhrases.js';

function geometry({
  endX,
  hardBoundaryBefore = false,
  lineIndex = 0,
  referenceGap = 0.02,
  startX,
  systemIndex = 0,
} = {}) {
  return {
    hardBoundaryBefore,
    lines: [
      {
        endX: endX ?? 0.2,
        lineIndex,
        referenceGap,
        startX: startX ?? 0.1,
      },
    ],
    page: 1,
    systemIndex,
  };
}

function measuresFromLyrics(lyrics) {
  return lyrics.map((lyric, index) => ({
    id: `measure-${index + 1}`,
    lyric,
    lyricGeometry: geometry({
      endX: 0.15 + index * 0.08,
      startX: 0.1 + index * 0.08,
    }),
    page: 1,
  }));
}

function entriesFrom(measures) {
  return createLanguagePhraseAnalysisPlan(measures).segments.flatMap(
    (segment) => segment.entries,
  );
}

function createGroup(entries, measureIds, displayText, overrides = {}) {
  const byId = new Map(entries.map((entry) => [entry.measureId, entry]));
  const groupEntries = measureIds.map((measureId) => byId.get(measureId));

  return {
    displayCues: [
      {
        endMeasureIndex: groupEntries.at(-1)?.measureIndex ?? -1,
        measureIds,
        startMeasureIndex: groupEntries[0]?.measureIndex ?? -1,
        text: displayText,
      },
    ],
    displayText,
    endMeasureIndex: groupEntries.at(-1)?.measureIndex ?? -1,
    measureIds,
    rawText: groupEntries.map((entry) => entry?.analysisText || '').join(''),
    startMeasureIndex: groupEntries[0]?.measureIndex ?? -1,
    ...overrides,
  };
}

function createPerMeasureCues(entries, texts) {
  return entries.map((entry, index) => ({
    endMeasureIndex: entry.measureIndex,
    measureIds: [entry.measureId],
    startMeasureIndex: entry.measureIndex,
    text: texts[index],
  }));
}

function stateFromPhrases(measures, phrases) {
  return {
    analyzedAt: '2026-08-13T00:00:00.000Z',
    candidatePhraseCount: 4,
    model: 'test-model',
    phraseCount: phrases.length,
    phrases,
    sourceKey: createLanguagePhraseSourceKey(measures),
    version: LANGUAGE_PHRASE_STATE_VERSION,
  };
}

test('M6/M7을 하나의 Language Phrase로 merge하고 자연스러운 공백만 보정한다', () => {
  const measures = measuresFromLyrics(['종소리가울려퍼지', '네']);
  const entries = entriesFrom(measures);
  const validation = validateLanguagePhraseWindowResult(entries, {
    groups: [
      createGroup(
        entries,
        ['measure-1', 'measure-2'],
        '종소리가 울려 퍼지네',
      ),
    ],
  });

  assert.equal(validation.error, '');
  const [phrase] = validation.phrases;
  const [cue] = phrase.displayCues;

  assert.equal(phrase.analysisText, '종소리가울려퍼지네');
  assert.equal(phrase.displayText, '종소리가 울려 퍼지네');
  assert.deepEqual(phrase.measureIds, ['measure-1', 'measure-2']);
  assert.deepEqual([phrase.startCharOffset, phrase.endCharOffset], [0, 9]);
  assert.equal(cue.text, phrase.displayText);
  assert.deepEqual(cue.sourceSpans, phrase.sourceSpans);
});

test('한 Measure의 한국어 displayText 띄어쓰기를 검증한다', () => {
  const cases = [
    ['매만지는바람', '매만지는 바람'],
    ['한숨만은깊어져만가고', '한숨만은 깊어져만 가고'],
  ];

  cases.forEach(([lyric, displayText]) => {
    const entries = entriesFrom(measuresFromLyrics([lyric]));
    const result = validateLanguagePhraseWindowResult(entries, {
      groups: [createGroup(entries, ['measure-1'], displayText)],
    });

    assert.equal(result.error, '');
    assert.equal(result.phrases[0].displayText, displayText);
  });
});

test('긴 Language Phrase는 유지하면서 여러 Display Cue로 나눈다', () => {
  const measures = measuresFromLyrics([
    '어렵고힘들었던시간을넘어서',
    '아주많은처음을주었잖아',
  ]);
  const entries = entriesFrom(measures);
  const group = createGroup(
    entries,
    ['measure-1', 'measure-2'],
    '어렵고 힘들었던 시간을 넘어서 아주 많은 처음을 주었잖아',
    {
      displayCues: [
        {
          endMeasureIndex: 0,
          measureIds: ['measure-1'],
          startMeasureIndex: 0,
          text: '어렵고 힘들었던 시간을 넘어서',
        },
        {
          endMeasureIndex: 1,
          measureIds: ['measure-2'],
          startMeasureIndex: 1,
          text: '아주 많은 처음을 주었잖아',
        },
      ],
    },
  );
  const validation = validateLanguagePhraseWindowResult(entries, {
    groups: [group],
  });

  assert.equal(validation.phrases.length, 1);
  assert.equal(validation.phrases[0].displayCues.length, 2);
  assert.equal(
    validation.phrases[0].displayText,
    '어렵고 힘들었던 시간을 넘어서 아주 많은 처음을 주었잖아',
  );
});

test('짧은 Language Phrase는 하나의 Display Cue로 유지한다', () => {
  const entries = entriesFrom(measuresFromLyrics(['매만지는바람']));
  const validation = validateLanguagePhraseWindowResult(entries, {
    groups: [createGroup(entries, ['measure-1'], '매만지는 바람')],
  });

  const [cue] = validation.phrases[0].displayCues;

  assert.equal(cue.text, '매만지는 바람');
  assert.deepEqual([cue.startCharOffset, cue.endCharOffset], [0, 6]);
  assert.deepEqual(cue.measureIds, ['measure-1']);
});

test('5마디 Language Phrase도 Language 범위는 유지하고 Cue만 분리한다', () => {
  const measures = measuresFromLyrics(['하나', '둘', '셋', '넷', '다섯']);
  const entries = entriesFrom(measures);
  const group = createGroup(
    entries,
    entries.map((entry) => entry.measureId),
    '하나 둘 셋 넷 다섯',
    {
      displayCues: [
        {
          endMeasureIndex: 1,
          measureIds: ['measure-1', 'measure-2'],
          startMeasureIndex: 0,
          text: '하나 둘',
        },
        {
          endMeasureIndex: 4,
          measureIds: ['measure-3', 'measure-4', 'measure-5'],
          startMeasureIndex: 2,
          text: '셋 넷 다섯',
        },
      ],
    },
  );
  const validation = validateLanguagePhraseWindowResult(entries, {
    groups: [group],
  });

  assert.equal(validation.phrases.length, 1);
  assert.deepEqual(
    validation.phrases[0].displayCues.map((cue) => cue.measureIds),
    [
      ['measure-1', 'measure-2'],
      ['measure-3', 'measure-4', 'measure-5'],
    ],
  );
});

test('잘못된 Display Cue만 Language Phrase displayText 단일 Cue로 fallback한다', () => {
  const entries = entriesFrom(measuresFromLyrics(['앞가사', '뒤가사']));
  const group = createGroup(
    entries,
    ['measure-1', 'measure-2'],
    '앞 가사 뒤 가사',
    {
      displayCues: [
        {
          endMeasureIndex: 0,
          measureIds: ['measure-1'],
          startMeasureIndex: 0,
          text: '없는 글자',
        },
      ],
    },
  );
  const validation = validateLanguagePhraseWindowResult(entries, {
    groups: [group],
  });

  assert.equal(validation.error, '');
  assert.equal(validation.cueFallbacks.length, 1);
  assert.equal(validation.phrases.length, 1);
  const [cue] = validation.phrases[0].displayCues;

  assert.equal(cue.text, '앞 가사 뒤 가사');
  assert.deepEqual(cue.measureIds, ['measure-1', 'measure-2']);
  assert.deepEqual([cue.startCharOffset, cue.endCharOffset], [0, 6]);
});

test('검증된 Measure ID가 있으면 잘못된 Cue 범위 숫자만 안전하게 정규화한다', () => {
  const measures = measuresFromLyrics(['앞가사', '뒤가사']);
  const entries = entriesFrom(measures);
  const group = createGroup(
    entries,
    ['measure-1', 'measure-2'],
    '앞 가사 뒤 가사',
    {
      displayCues: [
        {
          endMeasureIndex: 99,
          measureIds: ['measure-1'],
          startMeasureIndex: 99,
          text: '앞 가사',
        },
        {
          endMeasureIndex: 100,
          measureIds: ['measure-2'],
          startMeasureIndex: 100,
          text: '뒤 가사',
        },
      ],
    },
  );
  const validation = validateLanguagePhraseWindowResult(entries, {
    groups: [group],
  });

  assert.equal(validation.cueFallbacks.length, 0);
  assert.equal(validation.cueCorrections.length, 2);
  assert.deepEqual(
    validation.phrases[0].displayCues.map((cue) => [
      cue.startMeasureIndex,
      cue.endMeasureIndex,
    ]),
    [
      [0, 0],
      [1, 1],
    ],
  );
});

test('세 Measure merge와 merge하지 않는 그룹을 모두 허용한다', () => {
  const entries = entriesFrom(measuresFromLyrics(['하', '나', '로']));
  const merged = validateLanguagePhraseWindowResult(entries, {
    groups: [
      createGroup(
        entries,
        ['measure-1', 'measure-2', 'measure-3'],
        '하나로',
      ),
    ],
  });
  const separated = validateLanguagePhraseWindowResult(entries, {
    groups: entries.map((entry) =>
      createGroup(entries, [entry.measureId], entry.analysisText),
    ),
  });

  assert.equal(merged.phrases.length, 1);
  assert.equal(separated.phrases.length, 3);
});

test('Measure 누락, 중복, 역순과 비연속 재배치를 거부한다', () => {
  const entries = entriesFrom(measuresFromLyrics(['가', '나', '다']));
  const invalidGroups = [
    [createGroup(entries, ['measure-1', 'measure-2'], '가나')],
    [
      createGroup(entries, ['measure-1', 'measure-2'], '가나'),
      createGroup(entries, ['measure-2', 'measure-3'], '나다'),
    ],
    [createGroup(entries, ['measure-2', 'measure-1', 'measure-3'], '나다가')],
    [
      createGroup(entries, ['measure-1', 'measure-3'], '가다'),
      createGroup(entries, ['measure-2'], '나'),
    ],
  ];

  invalidGroups.forEach((groups) => {
    assert.equal(
      validateLanguagePhraseWindowResult(entries, { groups }).phrases,
      null,
    );
  });

  assert.equal(
    validateLanguagePhraseWindowResult(entries, {
      groups: [createGroup(entries, ['measure-1', 'measure-2'], '가나')],
    }).reason,
    'missing-measure',
  );
  assert.equal(
    validateLanguagePhraseWindowResult(entries, {
      groups: [
        createGroup(entries, ['measure-1', 'measure-2'], '가나'),
        createGroup(entries, ['measure-2', 'measure-3'], '나다'),
      ],
    }).reason,
    'duplicated-measure',
  );
  assert.equal(
    validateLanguagePhraseWindowResult(entries, {
      groups: [createGroup(entries, ['measure-2', 'measure-1', 'measure-3'], '나다가')],
    }).reason,
    'reordered-measure',
  );
});

test('문자 추가, 삭제, 변경은 거부하고 공백 변경만 허용한다', () => {
  const entries = entriesFrom(measuresFromLyrics(['매만지는바람']));

  ['매만지는 큰 바람', '매만지는', '매만지는사람'].forEach((displayText) => {
    assert.equal(
      validateLanguagePhraseWindowResult(entries, {
        groups: [createGroup(entries, ['measure-1'], displayText)],
      }).phrases,
      null,
    );
  });
  assert.equal(
    validateLanguagePhraseWindowResult(entries, {
      groups: [createGroup(entries, ['measure-1'], '매만지는 바람')],
    }).phrases.length,
    1,
  );
});

test('일반 geometry Phrase 경계는 soft이고 명시·초대형 gap은 hard다', () => {
  const softGapMeasures = measuresFromLyrics(['종소리가울려퍼지', '네']);
  const hardGapMeasures = measuresFromLyrics(['앞', '뒤']);
  const explicitMeasures = measuresFromLyrics(['앞', '뒤']);

  softGapMeasures[0].lyricGeometry = geometry({
    endX: 0.2,
    referenceGap: 0.02,
    startX: 0.1,
  });
  softGapMeasures[1].lyricGeometry = geometry({
    endX: 0.4,
    referenceGap: 0.02,
    startX: 0.3,
  });
  hardGapMeasures[0].lyricGeometry = geometry({
    endX: 0.2,
    referenceGap: 0.02,
    startX: 0.1,
  });
  hardGapMeasures[1].lyricGeometry = geometry({
    endX: 0.5,
    referenceGap: 0.02,
    startX: 0.4,
  });
  explicitMeasures[1].lyricGeometry = geometry({ hardBoundaryBefore: true });

  assert.equal(createLanguagePhraseAnalysisPlan(softGapMeasures).segments.length, 1);
  assert.equal(
    createLanguagePhraseAnalysisPlan(softGapMeasures).segments[0].entries[1]
      .boundaryBefore,
    'soft',
  );
  assert.equal(createLanguagePhraseAnalysisPlan(hardGapMeasures).segments.length, 2);
  assert.equal(createLanguagePhraseAnalysisPlan(explicitMeasures).segments.length, 2);
});

test('큰 lyric gap과 melisma 표시는 문법보다 낮은 breath candidate로 전달한다', () => {
  const gapMeasures = measuresFromLyrics(['앞말', '뒷말']);

  gapMeasures[0].lyricGeometry = geometry({
    endX: 0.2,
    referenceGap: 0.02,
    startX: 0.1,
  });
  gapMeasures[1].lyricGeometry = geometry({
    endX: 0.5,
    referenceGap: 0.02,
    startX: 0.3,
  });
  const gapEntries = createLanguagePhraseAnalysisPlan(gapMeasures).windows[0]
    .entries;
  const [gapCandidate] = createLanguagePhraseBreathCandidates(gapEntries);

  assert.deepEqual(gapCandidate.reasons, ['horizontal-lyric-gap']);
  assert.equal(gapCandidate.strength, 'strong');
  assert.ok(Math.abs(gapCandidate.metrics.referenceRatio - 5) < 1e-9);

  const melismaEntries = createLanguagePhraseAnalysisPlan(
    measuresFromLyrics(['이어짐 －', '다음말']),
  ).windows[0].entries;
  const [melismaCandidate] = createLanguagePhraseBreathCandidates(
    melismaEntries,
  );

  assert.ok(melismaCandidate.reasons.includes('melisma-extension-marker'));
  assert.equal(melismaCandidate.strength, 'strong');
});

test('빈 lyric, 다른 lyric lane과 multiline verse는 서로 섞지 않는다', () => {
  const emptyMeasures = measuresFromLyrics(['앞', '', '뒤']);
  const laneMeasures = measuresFromLyrics(['첫 절', '둘째 절']);

  laneMeasures[1].lyricGeometry = geometry({ lineIndex: 1 });

  assert.equal(createLanguagePhraseAnalysisPlan(emptyMeasures).segments.length, 2);
  assert.equal(
    createLanguagePhraseAnalysisPlan(emptyMeasures).segments[1].entries[0]
      .boundaryReason,
    'lyric-free-gap',
  );
  assert.equal(createLanguagePhraseAnalysisPlan(laneMeasures).segments.length, 2);

  const multilineMeasures = measuresFromLyrics(['1절\n2절', '다음']);
  const multilinePlan = createLanguagePhraseAnalysisPlan(multilineMeasures);

  assert.equal(multilinePlan.windows[0].mode, 'protected-multiline');
  assert.deepEqual(
    multilinePlan.windows.map((window) =>
      window.entries.map((entry) => entry.measureId),
    ),
    [['measure-1'], ['measure-2']],
  );
});

test('일반 곡 길이의 연속 lyric section은 마디 수와 무관하게 한 context로 유지한다', () => {
  const measures = measuresFromLyrics(
    Array.from({ length: 28 }, (_, index) => `가사${index + 1}`),
  );
  const plan = createLanguagePhraseAnalysisPlan(measures);

  assert.equal(plan.windows.length, 1);
  assert.equal(plan.windows[0].entries.length, 28);
  assert.equal(plan.windows[0].isChunked, false);
});

test('매우 큰 section만 문자량 기준으로 나누고 여러 마디 context를 겹친다', () => {
  const measures = measuresFromLyrics(Array.from({ length: 12 }, () => '가'));
  const plan = createLanguagePhraseAnalysisPlan(measures, {
    maxContextCharacters: 8,
    overlapMeasureCount: 4,
  });

  assert.deepEqual(
    plan.windows.map((window) => window.entries.map((entry) => entry.measureId)),
    [
      Array.from({ length: 8 }, (_, index) => `measure-${index + 1}`),
      Array.from({ length: 8 }, (_, index) => `measure-${index + 5}`),
    ],
  );
  assert.ok(plan.windows.every((window) => window.isChunked));
});

test('extraction separator는 analysisText에서만 제거하고 일반 하이픈은 보존한다', () => {
  const measures = measuresFromLyrics([
    '웃었던 -',
    '날',
    '- 도사...',
    '랑스럽고소중',
    'K-pop 10-20 A - B 서울 - 부산',
  ]);
  const entries = entriesFrom(measures);

  assert.deepEqual(
    entries.map((entry) => entry.analysisText),
    [
      '웃었던',
      '날',
      '도사...',
      '랑스럽고소중',
      'K-pop 10-20 A - B 서울 - 부산',
    ],
  );
  assert.deepEqual(
    measures.map((measure) => measure.lyric),
    [
      '웃었던 -',
      '날',
      '- 도사...',
      '랑스럽고소중',
      'K-pop 10-20 A - B 서울 - 부산',
    ],
  );
});

test('artifact 정리 범위는 허용하지만 그 밖의 문자를 바꾸면 거부한다', () => {
  const measures = measuresFromLyrics([
    '웃었던 -',
    '날',
    '- 도사',
    '랑스럽고소중',
  ]);
  const entries = entriesFrom(measures);
  const valid = validateLanguagePhraseWindowResult(entries, {
    groups: [
      createGroup(
        entries,
        ['measure-1', 'measure-2', 'measure-3', 'measure-4'],
        '웃었던 날도 사랑스럽고 소중',
      ),
    ],
  });
  const invalid = validateLanguagePhraseWindowResult(entries, {
    groups: [
      createGroup(
        entries,
        ['measure-1', 'measure-2', 'measure-3', 'measure-4'],
        '웃었던 그날도 사랑스럽고 소중',
      ),
    ],
  });

  assert.equal(valid.phrases[0].rawText, '웃었던 -날- 도사랑스럽고소중');
  assert.equal(valid.phrases[0].analysisText, '웃었던날도사랑스럽고소중');
  assert.equal(invalid.phrases, null);
  assert.equal(invalid.reason, 'character-mismatch');
});

test('전각 melisma separator는 analysisText에서만 제거한다', () => {
  const measures = measuresFromLyrics(['었던－날 －도사', '랑스럽 고소중']);
  const entries = entriesFrom(measures);

  assert.deepEqual(
    entries.map((entry) => entry.analysisText),
    ['었던날 도사', '랑스럽 고소중'],
  );
  assert.deepEqual(
    measures.map((measure) => measure.lyric),
    ['었던－날 －도사', '랑스럽 고소중'],
  );
});

test('artifact 정리도 lyric lane과 hard boundary를 넘지 않는다', () => {
  const laneMeasures = measuresFromLyrics(['앞 -', '- 뒤']);

  laneMeasures[1].lyricGeometry = geometry({ lineIndex: 1 });
  const lanePlan = createLanguagePhraseAnalysisPlan(laneMeasures);

  assert.equal(lanePlan.segments.length, 2);
  assert.deepEqual(
    lanePlan.segments.map((segment) => segment.entries[0].analysisText),
    ['앞', '뒤'],
  );

  const boundaryMeasures = measuresFromLyrics(['앞 -', '- 뒤']);

  boundaryMeasures[1].lyricGeometry = geometry({ hardBoundaryBefore: true });
  const boundaryPlan = createLanguagePhraseAnalysisPlan(boundaryMeasures);

  assert.equal(boundaryPlan.segments.length, 2);
  assert.deepEqual(
    boundaryPlan.segments.map((segment) => segment.entries[0].analysisText),
    ['앞', '뒤'],
  );
});

test('최종 Language Phrase는 merged 시작과 끝 Measure에서 같은 current/next를 제공한다', () => {
  const measures = measuresFromLyrics([
    '종소리가울려퍼지',
    '네',
    '매만지는바람',
    '한숨만은깊어져만가고',
  ]);
  const entries = entriesFrom(measures);
  const validation = validateLanguagePhraseWindowResult(entries, {
    groups: [
      createGroup(
        entries,
        ['measure-1', 'measure-2'],
        '종소리가 울려 퍼지네',
      ),
      createGroup(entries, ['measure-3'], '매만지는 바람'),
      createGroup(entries, ['measure-4'], '한숨만은 깊어져만 가고'),
    ],
  });
  const state = stateFromPhrases(measures, validation.phrases);
  const languagePhrases = getLanguagePhrasesForMeasures(state, measures);
  const atStart = createVocalViewModel(measures, 0, { languagePhrases });
  const atEnd = createVocalViewModel(measures, 1, { languagePhrases });
  const atNext = createVocalViewModel(measures, 2, { languagePhrases });

  assert.equal(atStart.currentText, '종소리가 울려 퍼지네');
  assert.equal(atEnd.currentText, '종소리가 울려 퍼지네');
  assert.equal(atStart.nextText, '매만지는 바람');
  assert.equal(atNext.currentText, '매만지는 바람');
  assert.equal(atNext.nextText, '한숨만은 깊어져만 가고');
});

test('Vocal current와 next는 Language Phrase가 아니라 Display Cue 기준이다', () => {
  const measures = measuresFromLyrics([
    '어렵고힘들었던시간을넘어서',
    '아주많은처음을주었잖아',
    '다음가사',
  ]);
  const entries = entriesFrom(measures);
  const validation = validateLanguagePhraseWindowResult(entries, {
    groups: [
      createGroup(
        entries,
        ['measure-1', 'measure-2'],
        '어렵고 힘들었던 시간을 넘어서 아주 많은 처음을 주었잖아',
        {
          displayCues: [
            {
              endMeasureIndex: 0,
              measureIds: ['measure-1'],
              startMeasureIndex: 0,
              text: '어렵고 힘들었던 시간을 넘어서',
            },
            {
              endMeasureIndex: 1,
              measureIds: ['measure-2'],
              startMeasureIndex: 1,
              text: '아주 많은 처음을 주었잖아',
            },
          ],
        },
      ),
      createGroup(entries, ['measure-3'], '다음 가사'),
    ],
  });
  const languagePhrases = validation.phrases;
  const first = createVocalViewModel(measures, 0, { languagePhrases });
  const second = createVocalViewModel(measures, 1, { languagePhrases });

  assert.equal(first.languagePhraseCount, 2);
  assert.equal(first.displayPhraseCount, 3);
  assert.equal(first.currentText, '어렵고 힘들었던 시간을 넘어서');
  assert.equal(first.nextText, '아주 많은 처음을 주었잖아');
  assert.equal(second.currentText, '아주 많은 처음을 주었잖아');
  assert.equal(second.nextText, '다음 가사');
});

test('AI state는 같은 source lyric에서만 사용하고 가사 수정 시 폐기한다', () => {
  const measures = measuresFromLyrics(['원본']);
  const entries = entriesFrom(measures);
  const phrases = validateLanguagePhraseWindowResult(entries, {
    groups: [createGroup(entries, ['measure-1'], '원본')],
  }).phrases;
  const state = stateFromPhrases(measures, phrases);
  const editedMeasures = [{ ...measures[0], lyric: '수정' }];

  assert.equal(validateLanguagePhraseState(state, measures), state);
  assert.equal(getLanguagePhrasesForMeasures(state, editedMeasures), null);
});

test('resolver revision만 다른 state는 원본 fingerprint와 전체 span 검증이 맞으면 유지한다', () => {
  const measures = measuresFromLyrics(['동일원본']);
  const entries = entriesFrom(measures);
  const phrases = validateLanguagePhraseWindowResult(entries, {
    groups: [createGroup(entries, ['measure-1'], '동일 원본')],
  }).phrases;
  const state = stateFromPhrases(measures, phrases);
  const fingerprint = createLanguagePhraseSourceFingerprint(measures);
  const stateFromOlderServer = {
    ...state,
    sourceKey: `language-phrases-v3-older-server-${fingerprint}`,
  };

  assert.equal(
    validateLanguagePhraseState(stateFromOlderServer, measures),
    stateFromOlderServer,
  );
  assert.equal(
    validateLanguagePhraseState(
      { ...stateFromOlderServer, sourceKey: 'language-phrases-v3-old-deadbeef' },
      measures,
    ),
    null,
  );
});

test('수신한 state가 빈 lyric hard boundary를 넘으면 client validation에서 폐기한다', () => {
  const measures = measuresFromLyrics(['앞', '', '뒤']);
  const state = stateFromPhrases(measures, [
    {
      analysisText: '앞뒤',
      displayText: '앞뒤',
      endMeasureIndex: 2,
      measureIds: ['measure-1', 'measure-3'],
      rawText: '앞뒤',
      startMeasureIndex: 0,
      text: '앞뒤',
    },
  ]);

  assert.equal(validateLanguagePhraseState(state, measures), null);
});

test('staff system의 geometry 후보 경계는 soft boundary라 같은 AI segment에 남는다', () => {
  const measures = measuresFromLyrics(['이어지', '네']);

  measures[0].lyricGeometry = geometry({ systemIndex: 0 });
  measures[1].lyricGeometry = geometry({ systemIndex: 1 });

  const plan = createLanguagePhraseAnalysisPlan(measures);

  assert.equal(plan.candidatePhraseCount, 2);
  assert.equal(plan.segments.length, 1);
  assert.deepEqual(
    plan.segments[0].entries.map((entry) => entry.measureId),
    ['measure-1', 'measure-2'],
  );
});

test('Case A-D: 한국어 단어와 어미 내부의 Measure Cue 경계는 합친다', () => {
  const cases = [
    {
      displayText: '신이 나서',
      lyrics: ['신이나', '서'],
      splitTexts: ['신이 나', '서'],
    },
    {
      displayText: '웃었던',
      lyrics: ['웃', '었던'],
      splitTexts: ['웃', '었던'],
    },
    {
      displayText: '도 사랑스럽고',
      lyrics: ['도사', '랑스럽고'],
      splitTexts: ['도 사', '랑스럽고'],
    },
    {
      displayText: '소중하게',
      lyrics: ['소중', '하게'],
      splitTexts: ['소중', '하게'],
    },
  ];

  cases.forEach(({ displayText, lyrics, splitTexts }) => {
    const entries = entriesFrom(measuresFromLyrics(lyrics));
    const group = createGroup(
      entries,
      entries.map((entry) => entry.measureId),
      displayText,
      { displayCues: createPerMeasureCues(entries, splitTexts) },
    );
    const validation = validateLanguagePhraseWindowResult(entries, {
      groups: [group],
    });

    assert.equal(validation.phrases[0].displayCues.length, 1);
    assert.equal(validation.phrases[0].displayCues[0].text, displayText);
    assert.equal(
      validation.cueCorrections[0].reason,
      'korean-token-continuation',
    );
    assert.equal(validation.cueBoundaryDecisions[0].decision, 'NO_BREAK');

    const splitGroupValidation = validateLanguagePhraseWindowResult(entries, {
      continuousDisplayText: displayText,
      groups: entries.map((entry, index) =>
        createGroup(entries, [entry.measureId], splitTexts[index]),
      ),
    });

    assert.equal(splitGroupValidation.phrases.length, 1);
    assert.equal(splitGroupValidation.phrases[0].displayCues.length, 1);
    assert.equal(splitGroupValidation.phrases[0].displayText, displayText);
    assert.ok(
      splitGroupValidation.cueCorrections.some(
        (correction) => correction.reason === 'korean-token-continuation',
      ),
    );
  });
});

test('Case E-F: 모든 마디 경계가 단어 내부면 길이보다 문법을 우선한다', () => {
  const lyrics = [
    '천진난만한이런기분도신이나',
    '서날아갈정도로웃',
    '었던날도사',
    '랑스럽고소중',
    '하게키울수있도록',
  ];
  const splitTexts = [
    '천진난만한 이런 기분도 신이 나',
    '서 날아갈 정도로 웃',
    '었던 날도 사',
    '랑스럽고 소중',
    '하게 키울 수 있도록',
  ];
  const displayText =
    '천진난만한 이런 기분도 신이 나서 날아갈 정도로 웃었던 날도 사랑스럽고 소중하게 키울 수 있도록';
  const entries = entriesFrom(measuresFromLyrics(lyrics));
  const group = createGroup(
    entries,
    entries.map((entry) => entry.measureId),
    displayText,
    { displayCues: createPerMeasureCues(entries, splitTexts) },
  );
  const validation = validateLanguagePhraseWindowResult(entries, {
    groups: [group],
  });
  const [cue] = validation.phrases[0].displayCues;

  assert.equal(validation.phrases.length, 1);
  assert.equal(validation.cueCorrections.length, 4);
  assert.equal(cue.measureIds.length, 5);
  assert.ok(Array.from(cue.text.replace(/\s/gu, '')).length > 22);
  assert.equal(cue.text, displayText);
});

test('AI가 단어 조각을 인접 Phrase로 옮겨도 grammar 연결 group을 먼저 합쳐 검증한다', () => {
  const entries = entriesFrom(measuresFromLyrics(['신이나', '서날아']));
  const validation = validateLanguagePhraseWindowResult(entries, {
    continuousDisplayText: '신이 나서 날아',
    groups: [
      createGroup(entries, ['measure-1'], '신이 나서'),
      createGroup(entries, ['measure-2'], '날아'),
    ],
  });

  assert.equal(validation.error, '');
  assert.equal(validation.phrases.length, 1);
  assert.equal(validation.phrases[0].displayText, '신이 나서 날아');
  assert.equal(validation.phrases[0].displayCues.length, 2);
  assert.ok(
    validation.cueCorrections.some(
      (correction) =>
        correction.message ===
        '한국어 단어 또는 어미 내부의 AI Phrase 경계를 합쳤습니다.',
    ),
  );
});

test('Case G-H: hard boundary와 다른 lyric lane은 문법보다 우선해 merge를 거부한다', () => {
  const hardBoundaryMeasures = measuresFromLyrics(['신이나', '서']);

  hardBoundaryMeasures[1].lyricGeometry = geometry({
    hardBoundaryBefore: true,
  });
  const hardEntries = entriesFrom(hardBoundaryMeasures);
  const hardResult = validateLanguagePhraseWindowResult(hardEntries, {
    groups: [
      createGroup(
        hardEntries,
        hardEntries.map((entry) => entry.measureId),
        '신이 나서',
      ),
    ],
  });

  assert.equal(hardResult.phrases, null);
  assert.equal(hardResult.reason, 'hard-boundary-cross');

  const laneMeasures = measuresFromLyrics(['신이나', '서']);

  laneMeasures[1].lyricGeometry = geometry({ lineIndex: 1 });
  const laneEntries = entriesFrom(laneMeasures);
  const laneResult = validateLanguagePhraseWindowResult(laneEntries, {
    groups: [
      createGroup(
        laneEntries,
        laneEntries.map((entry) => entry.measureId),
        '신이 나서',
      ),
    ],
  });

  assert.equal(laneResult.phrases, null);
  assert.equal(laneResult.reason, 'hard-boundary-cross');
});

test('Case I: 종소리가울려퍼지 + 네는 한 Cue로 유지한다', () => {
  const entries = entriesFrom(
    measuresFromLyrics(['종소리가울려퍼지', '네']),
  );
  const validation = validateLanguagePhraseWindowResult(entries, {
    groups: [
      createGroup(
        entries,
        entries.map((entry) => entry.measureId),
        '종소리가 울려 퍼지네',
      ),
    ],
  });

  assert.equal(validation.phrases[0].displayCues.length, 1);
  assert.equal(
    validation.phrases[0].displayCues[0].text,
    '종소리가 울려 퍼지네',
  );
});

test('Case J: extraction artifact 정리 후 단어 내부 Cue 경계를 합친다', () => {
  const entries = entriesFrom(
    measuresFromLyrics(['었던－날 －도사', '랑스럽 고소중']),
  );
  const displayText = '었던 날도 사랑스럽고 소중';
  const group = createGroup(
    entries,
    entries.map((entry) => entry.measureId),
    displayText,
    {
      displayCues: createPerMeasureCues(entries, [
        '었던 날도 사',
        '랑스럽고 소중',
      ]),
    },
  );
  const validation = validateLanguagePhraseWindowResult(entries, {
    groups: [group],
  });

  assert.equal(validation.phrases[0].analysisText, '었던날 도사랑스럽 고소중');
  const [cue] = validation.phrases[0].displayCues;

  assert.equal(cue.text, displayText);
  assert.deepEqual(cue.measureIds, ['measure-1', 'measure-2']);
  assert.deepEqual(cue.sourceSpans, [
    {
      analysisEnd: 6,
      analysisStart: 0,
      measureId: 'measure-1',
      measureIndex: 0,
    },
    {
      analysisEnd: 7,
      analysisStart: 0,
      measureId: 'measure-2',
      measureIndex: 1,
    },
  ]);
});

test('연속 분석 문자열의 Measure boundary offset을 명시적으로 계산한다', () => {
  const entries = entriesFrom(measuresFromLyrics(['신이나', '서', '다음 가사']));
  const boundaries = createLanguagePhraseBoundaryMetadata(entries);

  assert.deepEqual(
    boundaries.map((boundary) => ({
      afterMeasureId: boundary.afterMeasureId,
      beforeMeasureId: boundary.beforeMeasureId,
      continuousTextOffset: boundary.continuousTextOffset,
      normalizedTextOffset: boundary.normalizedTextOffset,
    })),
    [
      {
        afterMeasureId: 'measure-1',
        beforeMeasureId: 'measure-2',
        continuousTextOffset: 3,
        normalizedTextOffset: 3,
      },
      {
        afterMeasureId: 'measure-2',
        beforeMeasureId: 'measure-3',
        continuousTextOffset: 4,
        normalizedTextOffset: 4,
      },
    ],
  );
});

test('continuous source map은 artifact 정리 후 retained character를 원본 Measure에 매핑한다', () => {
  const measures = measuresFromLyrics(['었던－날 －도사', '랑스럽 고소중']);
  const originalLyrics = measures.map((measure) => measure.lyric);
  const entries = entriesFrom(measures);
  const source = createContinuousAnalysisSource(entries);

  assert.equal(source.continuousAnalysisText, '었던날 도사랑스럽 고소중');
  assert.equal(source.canonicalText, '었던날도사랑스럽고소중');
  assert.deepEqual(
    source.sourceCharMap.slice(0, 5).map((item) => ({
      analysisCharIndex: item.analysisCharIndex,
      character: item.character,
      continuousCharIndex: item.continuousCharIndex,
      measureId: item.measureId,
    })),
    [
      { analysisCharIndex: 0, character: '었', continuousCharIndex: 0, measureId: 'measure-1' },
      { analysisCharIndex: 1, character: '던', continuousCharIndex: 1, measureId: 'measure-1' },
      { analysisCharIndex: 2, character: '날', continuousCharIndex: 2, measureId: 'measure-1' },
      { analysisCharIndex: 4, character: '도', continuousCharIndex: 3, measureId: 'measure-1' },
      { analysisCharIndex: 5, character: '사', continuousCharIndex: 4, measureId: 'measure-1' },
    ],
  );
  assert.deepEqual(
    measures.map((measure) => measure.lyric),
    originalLyrics,
  );
});

test('Display Cue는 다음 Measure 첫 글자에서 끝나고 같은 Measure 중간에서 다시 시작할 수 있다', () => {
  const measures = measuresFromLyrics(['신이나', '서날아갈']);
  const entries = entriesFrom(measures);
  const validation = validateLanguagePhraseWindowResult(entries, {
    continuousDisplayText: '신이 나서 날아갈',
    groups: [
      createGroup(entries, ['measure-1', 'measure-2'], '신이 나서 날아갈', {
        displayCues: [{ text: '신이 나서' }, { text: '날아갈' }],
      }),
    ],
  });
  const [firstCue, secondCue] = validation.phrases[0].displayCues;

  assert.deepEqual([firstCue.startCharOffset, firstCue.endCharOffset], [0, 4]);
  assert.deepEqual(firstCue.sourceSpans, [
    {
      analysisEnd: 3,
      analysisStart: 0,
      measureId: 'measure-1',
      measureIndex: 0,
    },
    {
      analysisEnd: 1,
      analysisStart: 0,
      measureId: 'measure-2',
      measureIndex: 1,
    },
  ]);
  assert.deepEqual([secondCue.startCharOffset, secondCue.endCharOffset], [4, 7]);
  assert.deepEqual(secondCue.sourceSpans, [
    {
      analysisEnd: 4,
      analysisStart: 1,
      measureId: 'measure-2',
      measureIndex: 1,
    },
  ]);
  assert.deepEqual(firstCue.measureIds, ['measure-1', 'measure-2']);
  assert.deepEqual(secondCue.measureIds, ['measure-2']);
});

test('10cm 회귀 구간은 단어를 끊지 않고 세 character-span Cue로 매핑한다', () => {
  const lyrics = [
    '천진난만한이런기분도신이나',
    '서날아갈정도로웃',
    '었던날도사',
    '랑스럽고소중',
    '하게키울수있도록',
  ];
  const measures = measuresFromLyrics(lyrics);
  const entries = entriesFrom(measures);
  const displayText =
    '천진난만한 이런 기분도 신이 나서 날아갈 정도로 웃었던 날도 사랑스럽고 소중하게 키울 수 있도록';
  const cueTexts = [
    '천진난만한 이런 기분도 신이 나서',
    '날아갈 정도로 웃었던 날도',
    '사랑스럽고 소중하게 키울 수 있도록',
  ];
  const validation = validateLanguagePhraseWindowResult(entries, {
    continuousDisplayText: displayText,
    groups: [
      createGroup(
        entries,
        entries.map((entry) => entry.measureId),
        displayText,
        { displayCues: cueTexts.map((text) => ({ text })) },
      ),
    ],
  });
  const cues = validation.phrases[0].displayCues;
  const source = createContinuousAnalysisSource(entries);

  assert.deepEqual(cues.map((cue) => cue.text), cueTexts);
  assert.equal(cues[0].sourceSpans.at(-1).measureId, 'measure-2');
  assert.equal(cues[0].sourceSpans.at(-1).analysisEnd, 1);
  assert.equal(cues[1].sourceSpans[0].analysisStart, 1);
  assert.equal(cues[1].sourceSpans.at(-1).measureId, 'measure-3');
  assert.equal(cues[2].sourceSpans[0].measureId, 'measure-3');
  assert.equal(cues[2].sourceSpans[0].analysisStart, 4);
  assert.deepEqual(
    cues.map((cue) => [cue.startCharOffset, cue.endCharOffset]),
    cues.map((cue, index) => [
      index === 0 ? source.startCharOffset : cues[index - 1].endCharOffset,
      cue.endCharOffset,
    ]),
  );
  assert.equal(cues.at(-1).endCharOffset, source.endCharOffset);
  assert.equal(
    cues.map((cue) => cue.text.replace(/\s/gu, '')).join(''),
    source.canonicalText,
  );
  ['신이나서', '웃었던', '사랑스럽고', '소중하게'].forEach((word) => {
    assert.ok(cueTexts.some((text) => text.replace(/\s/gu, '').includes(word)));
  });
});

test('Cue 문자 누락, 중복, 역순과 철자 또는 조사 변경을 모두 거부한다', () => {
  const entries = entriesFrom(measuresFromLyrics(['신이나', '서날아갈']));
  const invalidCueSets = [
    ['신이 나서', '날아'],
    ['신이 나서', '서날아갈'],
    ['서날아갈', '신이 나'],
    ['신이 너서', '날아갈'],
  ];

  invalidCueSets.forEach((cueTexts) => {
    const validation = validateLanguagePhraseWindowResult(entries, {
      groups: [
        createGroup(entries, ['measure-1', 'measure-2'], '신이 나서 날아갈', {
          displayCues: cueTexts.map((text) => ({ text })),
        }),
      ],
    });

    assert.equal(validation.phrases[0].displayCues.length, 1);
    assert.equal(validation.cueFallbacks[0].reason, 'cue-character-mismatch');
  });
});

test('hard boundary와 lyric lane은 character span이 넘어가지 못한다', () => {
  const hardMeasures = measuresFromLyrics(['앞', '뒤']);

  hardMeasures[1].lyricGeometry = geometry({ hardBoundaryBefore: true });
  const hardEntries = entriesFrom(hardMeasures);
  const hardValidation = validateLanguagePhraseWindowResult(hardEntries, {
    groups: [createGroup(hardEntries, ['measure-1', 'measure-2'], '앞뒤')],
  });

  assert.equal(hardValidation.phrases, null);
  assert.equal(hardValidation.reason, 'hard-boundary-cross');

  const laneMeasures = measuresFromLyrics(['앞', '뒤']);

  laneMeasures[1].lyricGeometry = geometry({ lineIndex: 1 });
  const laneEntries = entriesFrom(laneMeasures);
  const laneValidation = validateLanguagePhraseWindowResult(laneEntries, {
    groups: [createGroup(laneEntries, ['measure-1', 'measure-2'], '앞뒤')],
  });

  assert.equal(laneValidation.phrases, null);
});

test('공유 Measure의 outgoing Cue는 유지하고 incoming Cue는 다음 Measure부터 current가 된다', () => {
  const measures = measuresFromLyrics(['신이나', '서날아갈', '정도로웃']);
  const entries = entriesFrom(measures);
  const validation = validateLanguagePhraseWindowResult(entries, {
    groups: [
      createGroup(
        entries,
        entries.map((entry) => entry.measureId),
        '신이 나서 날아갈 정도로 웃',
        {
          displayCues: [
            { text: '신이 나서' },
            { text: '날아갈 정도로 웃' },
          ],
        },
      ),
    ],
  });
  const projected = createCoarseDisplayCueTimingProjection(
    validation.phrases[0].displayCues,
  );
  const atSharedMeasure = createVocalViewModel(measures, 1, {
    languagePhrases: validation.phrases,
  });
  const atNextMeasure = createVocalViewModel(measures, 2, {
    languagePhrases: validation.phrases,
  });

  assert.deepEqual(
    projected.map((cue) => [
      cue.timingStartMeasureIndex,
      cue.timingEndMeasureIndex,
    ]),
    [[0, 1], [2, 2]],
  );
  assert.equal(atSharedMeasure.currentText, '신이 나서');
  assert.equal(atSharedMeasure.nextText, '날아갈 정도로 웃');
  assert.equal(atNextMeasure.currentText, '날아갈 정도로 웃');
});

test('Socket 직렬화 형태와 legacy v3 state 모두 authoritative source spans로 복원한다', () => {
  const measures = measuresFromLyrics(['신이나', '서날아갈']);
  const entries = entriesFrom(measures);
  const phrases = validateLanguagePhraseWindowResult(entries, {
    groups: [
      createGroup(entries, ['measure-1', 'measure-2'], '신이 나서 날아갈', {
        displayCues: [{ text: '신이 나서' }, { text: '날아갈' }],
      }),
    ],
  }).phrases;
  const serializedState = JSON.parse(
    JSON.stringify(stateFromPhrases(measures, phrases)),
  );
  const socketPhrases = getLanguagePhrasesForMeasures(serializedState, measures);
  const legacyState = structuredClone(serializedState);

  legacyState.phrases.forEach((phrase) => {
    delete phrase.startCharOffset;
    delete phrase.endCharOffset;
    delete phrase.sourceSpans;
    phrase.displayCues.forEach((cue) => {
      delete cue.startCharOffset;
      delete cue.endCharOffset;
      delete cue.sourceSpans;
    });
  });

  assert.deepEqual(socketPhrases[0].displayCues[0].sourceSpans, [
    {
      analysisEnd: 3,
      analysisStart: 0,
      measureId: 'measure-1',
      measureIndex: 0,
    },
    {
      analysisEnd: 1,
      analysisStart: 0,
      measureId: 'measure-2',
      measureIndex: 1,
    },
  ]);
  assert.deepEqual(
    getLanguagePhrasesForMeasures(legacyState, measures)[0].displayCues[0]
      .sourceSpans,
    socketPhrases[0].displayCues[0].sourceSpans,
  );
  assert.deepEqual(measures.map((measure) => measure.lyric), [
    '신이나',
    '서날아갈',
  ]);
});
