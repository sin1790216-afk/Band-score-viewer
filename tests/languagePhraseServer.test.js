import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLanguagePhraseSession,
  registerLanguagePhraseSocketHandlers,
  sendLanguagePhraseState,
} from '../src/server/languagePhraseSession.js';
import {
  createLanguagePhraseAnalysisPlan,
  LANGUAGE_PHRASE_EVENTS,
} from '../src/utils/languagePhrases.js';
import { createLanguagePhraseWindowDiagnostic } from '../src/server/languagePhraseResolver.js';

function measuresFromLyrics(lyrics) {
  return lyrics.map((lyric, index) => ({
    id: `measure-${index + 1}`,
    lyric,
    page: 1,
  }));
}

function createProvider({ fail = false, failCall = 0, invalidCue = false } = {}) {
  let callCount = 0;

  return {
    get callCount() {
      return callCount;
    },
    model: 'test-model',
    async resolveWindow(entries) {
      callCount += 1;

      if (fail || callCount === failCall) {
        throw new Error('provider unavailable');
      }

      const rawText = entries.map((entry) => entry.analysisText).join('');

      return {
        groups: [
          {
            displayCues: invalidCue
              ? [
                  {
                    endMeasureIndex: entries[0].measureIndex,
                    measureIds: [entries[0].measureId],
                    startMeasureIndex: entries[0].measureIndex,
                    text: '변조',
                  },
                ]
              : [
                  {
                    endMeasureIndex: entries.at(-1).measureIndex,
                    measureIds: entries.map((entry) => entry.measureId),
                    startMeasureIndex: entries[0].measureIndex,
                    text: rawText,
                  },
                ],
            displayText: rawText,
            endMeasureIndex: entries.at(-1).measureIndex,
            measureIds: entries.map((entry) => entry.measureId),
            rawText,
            startMeasureIndex: entries[0].measureIndex,
          },
        ],
      };
    },
  };
}

function createBoundaryCriticProvider({
  criticResult,
  firstPassCues,
  firstPassDisplayText,
} = {}) {
  let criticCallCount = 0;
  let firstPassCallCount = 0;

  return {
    get criticCallCount() {
      return criticCallCount;
    },
    get firstPassCallCount() {
      return firstPassCallCount;
    },
    model: 'test-model',
    async resolveBoundaryCritic(sections) {
      criticCallCount += 1;
      return typeof criticResult === 'function'
        ? criticResult(sections)
        : criticResult;
    },
    async resolveWindow(entries) {
      firstPassCallCount += 1;
      const rawText = entries.map((entry) => entry.analysisText).join('');
      const displayText = typeof firstPassDisplayText === 'function'
        ? firstPassDisplayText(rawText)
        : firstPassDisplayText || rawText;
      const displayCues = typeof firstPassCues === 'function'
        ? firstPassCues(displayText, rawText)
        : firstPassCues || [displayText];

      return {
        continuousDisplayText: displayText,
        groups: [
          {
            displayCues: displayCues.map((text) => ({ text })),
            displayText,
            endMeasureIndex: entries.at(-1).measureIndex,
            measureIds: entries.map((entry) => entry.measureId),
            rawText,
            startMeasureIndex: entries[0].measureIndex,
          },
        ],
      };
    },
  };
}

function createFakeSocket(id = 'teacher') {
  const emitted = [];
  const handlers = new Map();

  return {
    emitted,
    handlers,
    id,
    emit(eventName, payload) {
      emitted.push([eventName, payload]);
    },
    on(eventName, handler) {
      handlers.set(eventName, handler);
    },
  };
}

test('같은 가사 분석은 세션 cache를 사용하고 가사 수정 시 invalidate한다', async () => {
  const provider = createProvider();
  const session = createLanguagePhraseSession({ provider });
  const measures = measuresFromLyrics(['종소리가울려퍼지', '네']);
  const first = await session.resolve(measures);
  const second = await session.resolve(structuredClone(measures));

  assert.equal(first.fromCache, false);
  assert.equal(second.fromCache, true);
  assert.equal(provider.callCount, 1);

  const editedMeasures = [measures[0], { ...measures[1], lyric: '요' }];

  assert.equal(session.syncMeasures(editedMeasures), true);
  assert.equal(session.getState(), null);
  await session.resolve(editedMeasures);
  assert.equal(provider.callCount, 2);
});

test('Provider 실패 구간은 기존 geometry Phrase로 fallback하고 cache하지 않는다', async () => {
  const session = createLanguagePhraseSession({
    provider: createProvider({ fail: true }),
  });
  const measures = measuresFromLyrics(['앞', '뒤']);
  const first = await session.resolve(measures);
  const second = await session.resolve(measures);

  assert.equal(first.state.fallbackWindowCount, 1);
  assert.equal(first.state.fallbackError, 'provider unavailable');
  assert.equal(first.state.phrases.length, 2);
  assert.equal(second.fromCache, false);
});

test('일반 길이의 연속 lyric section은 한 번의 AI context로 분석한다', async () => {
  const provider = createProvider();
  const session = createLanguagePhraseSession({ provider });
  const measures = measuresFromLyrics(
    Array.from({ length: 10 }, (_, index) => `가사${index + 1}`),
  );
  const result = await session.resolve(measures);

  assert.equal(provider.callCount, 1);
  assert.equal(result.state.phrases.length, 1);
  assert.deepEqual(
    result.state.phrases[0].measureIds,
    Array.from({ length: 10 }, (_, index) => `measure-${index + 1}`),
  );
  assert.equal(
    result.state.phrases[0].displayText,
    Array.from({ length: 10 }, (_, index) => `가사${index + 1}`).join(''),
  );
});

test('겹치는 context가 동의하지 않은 Cue 경계는 chunk 경계로 강제하지 않는다', async () => {
  const provider = {
    model: 'test-model',
    async resolveWindow(entries) {
      const rawText = entries.map((entry) => entry.analysisText).join('');
      const displayCues = entries[0].measureIndex === 0
        ? [
            { text: Array.from(rawText).slice(0, -1).join('') },
            { text: Array.from(rawText).at(-1) },
          ]
        : [{ text: rawText }];

      return {
        continuousDisplayText: rawText,
        groups: [
          {
            displayCues,
            displayText: rawText,
            endMeasureIndex: entries.at(-1).measureIndex,
            measureIds: entries.map((entry) => entry.measureId),
            rawText,
            startMeasureIndex: entries[0].measureIndex,
          },
        ],
      };
    },
  };
  const measures = measuresFromLyrics([
    '가',
    '가',
    '가',
    '가',
    '가',
    '가',
    '가',
    '나다',
    '라',
    '마',
  ]);
  const state = (
    await createLanguagePhraseSession({
      analysisOptions: {
        maxContextCharacters: 9,
        overlapMeasureCount: 1,
      },
      provider,
    }).resolve(measures)
  ).state;

  assert.equal(state.phrases[0].displayCues.length, 1);
  assert.deepEqual(
    [
      state.phrases[0].displayCues[0].startCharOffset,
      state.phrases[0].displayCues[0].endCharOffset,
    ],
    [0, 11],
  );
});

test('겹치는 context가 같은 문자 경계에 동의하면 Measure 내부 Cue 범위를 보존한다', async () => {
  const provider = {
    model: 'test-model',
    async resolveWindow(entries) {
      const rawText = entries.map((entry) => entry.analysisText).join('');
      const splitOffset = entries[0].measureIndex === 0 ? 8 : 1;

      return {
        continuousDisplayText: rawText,
        groups: [
          {
            displayCues: [
              { text: Array.from(rawText).slice(0, splitOffset).join('') },
              { text: Array.from(rawText).slice(splitOffset).join('') },
            ],
            displayText: rawText,
            endMeasureIndex: entries.at(-1).measureIndex,
            measureIds: entries.map((entry) => entry.measureId),
            rawText,
            startMeasureIndex: entries[0].measureIndex,
          },
        ],
      };
    },
  };
  const measures = measuresFromLyrics([
    '가',
    '가',
    '가',
    '가',
    '가',
    '가',
    '가',
    '나다',
    '라',
    '마',
  ]);
  const state = (
    await createLanguagePhraseSession({
      analysisOptions: {
        maxContextCharacters: 9,
        overlapMeasureCount: 1,
      },
      provider,
    }).resolve(measures)
  ).state;
  const [firstCue, secondCue] = state.phrases[0].displayCues;

  assert.deepEqual(
    [firstCue.startCharOffset, firstCue.endCharOffset],
    [0, 8],
  );
  assert.equal(firstCue.sourceSpans.at(-1).measureId, 'measure-8');
  assert.equal(firstCue.sourceSpans.at(-1).analysisEnd, 1);
  assert.equal(secondCue.sourceSpans[0].measureId, 'measure-8');
  assert.equal(secondCue.sourceSpans[0].analysisStart, 1);
  assert.equal(secondCue.endCharOffset, 11);
});

test('겹친 window 하나가 실패해도 해당 구간만 geometry fallback한다', async () => {
  const session = createLanguagePhraseSession({
    analysisOptions: {
      maxContextCharacters: 8,
      overlapMeasureCount: 1,
    },
    provider: createProvider({ failCall: 2 }),
  });
  const measures = measuresFromLyrics(Array.from({ length: 10 }, () => '가'));
  const result = await session.resolve(measures);

  assert.equal(result.state.fallbackWindowCount, 1);
  assert.deepEqual(result.state.phrases[0].measureIds, [
    'measure-1',
    'measure-2',
    'measure-3',
    'measure-4',
    'measure-5',
    'measure-6',
    'measure-7',
    'measure-8',
  ]);
  assert.deepEqual(
    result.state.phrases.slice(1).map((phrase) => phrase.measureIds),
    [['measure-9'], ['measure-10']],
  );
});

test('Display Cue validation 실패는 Language Phrase를 유지하고 원인을 분류한다', async () => {
  const provider = createProvider({ invalidCue: true });
  const session = createLanguagePhraseSession({ provider });
  const measures = measuresFromLyrics(['앞가사', '뒤가사']);
  const result = await session.resolve(measures);
  const retry = await session.resolve(measures);

  assert.equal(result.state.fallbackWindowCount, 0);
  assert.equal(result.state.displayCueFallbackCount, 1);
  assert.equal(
    result.state.fallbackDetails[0].category,
    'display-cue-validation',
  );
  assert.equal(result.state.fallbackDetails[0].reason, 'cue-character-mismatch');
  assert.equal(result.state.phrases.length, 1);
  assert.equal(retry.fromCache, false);
  assert.equal(provider.callCount, 2);
  const [fallbackCue] = result.state.phrases[0].displayCues;

  assert.equal(fallbackCue.text, '앞가사뒤가사');
  assert.deepEqual(fallbackCue.measureIds, ['measure-1', 'measure-2']);
  assert.deepEqual(
    [fallbackCue.startCharOffset, fallbackCue.endCharOffset],
    [0, 6],
  );
});

test('Teacher 분석 결과를 broadcast하고 late join Vocal에 같은 state를 보낸다', async () => {
  const measures = measuresFromLyrics(['종소리가울려퍼지', '네']);
  const session = createLanguagePhraseSession({ provider: createProvider() });
  const teacherSocket = createFakeSocket();
  const broadcasts = [];
  const io = {
    emit(eventName, payload) {
      broadcasts.push([eventName, payload]);
    },
  };

  registerLanguagePhraseSocketHandlers({
    getMeasures: () => measures,
    io,
    session,
    socket: teacherSocket,
  });
  const resolveHandler = teacherSocket.handlers.get(
    LANGUAGE_PHRASE_EVENTS.RESOLVE,
  );
  let acknowledgement;

  await resolveHandler({}, (result) => {
    acknowledgement = result;
  });

  assert.equal(acknowledgement.ok, true);
  assert.deepEqual(broadcasts.at(-1), [
    LANGUAGE_PHRASE_EVENTS.STATE,
    acknowledgement.state,
  ]);

  const lateVocalSocket = createFakeSocket('late-vocal');

  sendLanguagePhraseState(lateVocalSocket, session);
  assert.deepEqual(lateVocalSocket.emitted, [
    [LANGUAGE_PHRASE_EVENTS.STATE, acknowledgement.state],
  ]);
  assert.deepEqual(
    lateVocalSocket.emitted[0][1].phrases[0].displayCues[0].sourceSpans,
    acknowledgement.state.phrases[0].displayCues[0].sourceSpans,
  );
});

test('Socket Provider 실패도 fallback 사용 여부를 acknowledgement에 포함한다', async () => {
  const session = createLanguagePhraseSession({
    provider: createProvider({ fail: true }),
  });
  const socket = createFakeSocket();
  const originalConsoleError = console.error;
  let acknowledgement;

  console.error = () => {};
  try {
    registerLanguagePhraseSocketHandlers({
      getMeasures: () => measuresFromLyrics(['가사']),
      io: { emit() {} },
      session,
      socket,
    });
    await socket.handlers.get(LANGUAGE_PHRASE_EVENTS.RESOLVE)(
      {},
      (result) => {
        acknowledgement = result;
      },
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(acknowledgement.ok, true);
  assert.equal(acknowledgement.state.fallbackWindowCount, 1);
  assert.equal(acknowledgement.state.fallbackDetails[0].category, 'api-failure');
  assert.match(acknowledgement.state.fallbackError, /provider unavailable/);
});

test('API, JSON, timeout 실패 원인을 fallback detail에서 구분한다', async () => {
  const originalConsoleWarn = console.warn;

  console.warn = () => {};
  try {
    for (const category of ['api-failure', 'invalid-json', 'timeout']) {
      const session = createLanguagePhraseSession({
        provider: {
          model: 'test-model',
          async resolveWindow() {
            const error = new Error(category);

            error.code = category;
            throw error;
          },
        },
      });
      const result = await session.resolve(measuresFromLyrics(['가사']));

      assert.equal(result.state.fallbackDetails[0].category, category);
    }
  } finally {
    console.warn = originalConsoleWarn;
  }
});

test('AI validation 실패를 API 실패와 구분하고 세부 원인을 보존한다', async () => {
  const session = createLanguagePhraseSession({
    provider: {
      model: 'test-model',
      async resolveWindow(entries) {
        const rawText = entries.map((entry) => entry.analysisText).join('');

        return {
          groups: [
            {
              displayCues: [
                {
                  endMeasureIndex: entries.at(-1).measureIndex,
                  measureIds: entries.map((entry) => entry.measureId),
                  startMeasureIndex: entries[0].measureIndex,
                  text: rawText,
                },
              ],
              displayText: rawText,
              endMeasureIndex: entries.at(-1).measureIndex,
              measureIds: entries.map((entry) => entry.measureId),
              rawText,
              startMeasureIndex: entries[0].measureIndex + 1,
            },
          ],
        };
      },
    },
  });
  const result = await session.resolve(measuresFromLyrics(['앞', '뒤']));

  assert.equal(result.state.fallbackDetails[0].category, 'validation');
  assert.equal(result.state.fallbackDetails[0].reason, 'invalid-range');
});

test('개발용 진단 snapshot은 raw, analysis, geometry와 AI 결과를 구분한다', () => {
  const measures = measuresFromLyrics(['었던－날 －도사', '랑스럽 고소중']);

  measures[0].lyricGeometry = {
    lines: [{ baselineY: 0.5, endX: 0.4, lineIndex: 0, startX: 0.2 }],
    page: 1,
    systemIndex: 2,
  };
  measures[1].lyricGeometry = {
    lines: [{ baselineY: 0.5, endX: 0.6, lineIndex: 0, startX: 0.4 }],
    page: 1,
    systemIndex: 2,
  };
  const [window] = createLanguagePhraseAnalysisPlan(measures).windows;
  const providerResult = { groups: [] };
  const diagnostic = createLanguagePhraseWindowDiagnostic({
    providerResult,
    validation: {
      code: 'validation',
      cueFallbacks: [],
      error: 'test',
      phrases: null,
      reason: 'character-mismatch',
    },
    window,
  });

  assert.equal(
    diagnostic.aiInput.continuousAnalysisText,
    '었던날 도사랑스럽 고소중',
  );
  assert.equal(
    diagnostic.aiInput.measures[0].normalizationBefore,
    '었던－날 －도사',
  );
  assert.equal(diagnostic.aiInput.measures[0].analysisText, '었던날 도사');
  assert.equal(diagnostic.aiInput.measures[0].lyricGeometry.systemIndex, 2);
  assert.equal(diagnostic.aiInput.boundaries[0].afterMeasureId, 'measure-1');
  assert.equal(diagnostic.aiInput.boundaries[0].beforeMeasureId, 'measure-2');
  assert.equal(diagnostic.aiResult, providerResult);
  assert.equal(diagnostic.validation.reason, 'character-mismatch');
});

test('전곡 Boundary Critic은 아주 | 많은 경계를 문법적으로 옮기고 Measure 내부 span을 복원한다', async () => {
  const provider = createBoundaryCriticProvider({
    criticResult(sections) {
      const [{ phrases, sectionId }] = sections;

      return {
        sections: [
          {
            phrases: [
              {
                cues: [
                  '어렵고 힘들었던 시간을 넘어서',
                  '아주 많은 처음을 주었잖아',
                ],
                phraseId: phrases[0].phraseId,
                reasonCategory: 'grammar',
              },
            ],
            sectionId,
          },
        ],
      };
    },
    firstPassCues: [
      '어렵고 힘들었던 시간을 넘어서 아주',
      '많은 처음을 주었잖아',
    ],
    firstPassDisplayText:
      '어렵고 힘들었던 시간을 넘어서 아주 많은 처음을 주었잖아',
  });
  const measures = measuresFromLyrics([
    '어렵고힘들었던시간을넘어서아주많은',
    '처음을주었잖아',
  ]);
  const state = (
    await createLanguagePhraseSession({ provider }).resolve(measures)
  ).state;
  const [firstCue, secondCue] = state.phrases[0].displayCues;

  assert.equal(provider.firstPassCallCount, 1);
  assert.equal(provider.criticCallCount, 1);
  assert.equal(state.boundaryCritic.status, 'accepted');
  assert.equal(state.boundaryCritic.changedPhraseCount, 1);
  assert.deepEqual(
    state.phrases[0].displayCues.map((cue) => cue.text),
    [
      '어렵고 힘들었던 시간을 넘어서',
      '아주 많은 처음을 주었잖아',
    ],
  );
  assert.equal(firstCue.sourceSpans.at(-1).measureId, 'measure-1');
  assert.equal(secondCue.sourceSpans[0].measureId, 'measure-1');
  assert.equal(firstCue.endCharOffset, secondCue.startCharOffset);
});

test('Critic 문자 변형은 해당 hard section만 fallback하고 다른 section은 독립 적용한다', async () => {
  const provider = createBoundaryCriticProvider({
    criticResult(sections) {
      return {
        sections: sections.map((section, index) => ({
          phrases: [
            {
              cues: index === 0
                ? ['변조된문자']
                : ['정말', '너무 좋은 날'],
              phraseId: section.phrases[0].phraseId,
              reasonCategory: index === 0 ? 'grammar' : 'readability',
            },
          ],
          sectionId: section.sectionId,
        })),
      };
    },
    firstPassCues(displayText) {
      return displayText === '아주 많은 사람'
        ? ['아주', '많은 사람']
        : ['정말 너무', '좋은', '날'];
    },
    firstPassDisplayText(rawText) {
      return rawText === '아주많은사람'
        ? '아주 많은 사람'
        : '정말 너무 좋은 날';
    },
  });
  const measures = measuresFromLyrics([
    '아주많은사람',
    '',
    '정말너무좋은날',
  ]);
  const state = (
    await createLanguagePhraseSession({ provider }).resolve(measures)
  ).state;

  assert.equal(state.boundaryCritic.status, 'partial-fallback');
  assert.equal(state.boundaryCritic.acceptedSectionCount, 1);
  assert.equal(state.boundaryCritic.fallbackSectionCount, 1);
  assert.deepEqual(
    state.phrases[0].displayCues.map((cue) => cue.text),
    ['아주', '많은 사람'],
  );
  assert.deepEqual(
    state.phrases[1].displayCues.map((cue) => cue.text),
    ['정말', '너무 좋은 날'],
  );
});

test('Critic은 단어 중간 경계와 다중 Cue의 거대 단일 Cue 회귀를 거부한다', async () => {
  const cases = [
    {
      candidate: ['사', '랑스럽고 소중하게'],
      firstPass: ['사랑스럽고', '소중하게'],
      lyric: '사랑스럽고소중하게',
      reason: 'more-token-internal-boundaries',
      text: '사랑스럽고 소중하게',
    },
    {
      candidate: ['웃', '었던 날도 소중하게'],
      firstPass: ['웃었던 날도', '소중하게'],
      lyric: '웃었던날도소중하게',
      reason: 'more-token-internal-boundaries',
      text: '웃었던 날도 소중하게',
    },
    {
      candidate: ['웃었던 날도 소중', '하게'],
      firstPass: ['웃었던 날도', '소중하게'],
      lyric: '웃었던날도소중하게',
      reason: 'more-token-internal-boundaries',
      text: '웃었던 날도 소중하게',
    },
    {
      candidate: ['웃었던 날도 소중하게'],
      firstPass: ['웃었던 날도', '소중하게'],
      lyric: '웃었던날도소중하게',
      reason: 'collapsed-readable-cues',
      text: '웃었던 날도 소중하게',
    },
  ];

  for (const fixture of cases) {
    const provider = createBoundaryCriticProvider({
      criticResult(sections) {
        return {
          sections: [
            {
              phrases: [
                {
                  cues: fixture.candidate,
                  phraseId: sections[0].phrases[0].phraseId,
                  reasonCategory: 'readability',
                },
              ],
              sectionId: sections[0].sectionId,
            },
          ],
        };
      },
      firstPassCues: fixture.firstPass,
      firstPassDisplayText: fixture.text,
    });
    const state = (
      await createLanguagePhraseSession({ provider }).resolve(
        measuresFromLyrics([fixture.lyric]),
      )
    ).state;

    assert.deepEqual(
      state.phrases[0].displayCues.map((cue) => cue.text),
      fixture.firstPass,
    );
    assert.equal(state.boundaryCritic.details[0].reason, fixture.reason);
  }
});

test('Critic 결과는 cache와 late join에 동일하게 유지되어 중복 API 호출을 만들지 않는다', async () => {
  const provider = createBoundaryCriticProvider({
    criticResult(sections) {
      return {
        sections: sections.map((section) => ({
          phrases: section.phrases.map((phrase) => ({
            cues: phrase.firstPassCues,
            phraseId: phrase.phraseId,
            reasonCategory: 'unchanged',
          })),
          sectionId: section.sectionId,
        })),
      };
    },
  });
  const measures = measuresFromLyrics(['첫가사', '둘째가사']);
  const session = createLanguagePhraseSession({ provider });
  const first = await session.resolve(measures);
  const second = await session.resolve(structuredClone(measures));
  const lateVocalSocket = createFakeSocket('late-vocal');

  sendLanguagePhraseState(lateVocalSocket, session);
  assert.equal(first.fromCache, false);
  assert.equal(second.fromCache, true);
  assert.equal(provider.firstPassCallCount, 1);
  assert.equal(provider.criticCallCount, 1);
  assert.deepEqual(lateVocalSocket.emitted, [
    [LANGUAGE_PHRASE_EVENTS.STATE, first.state],
  ]);
});

test('이미 자연스러운 Cue는 Critic을 거쳐도 그대로 유지한다', async () => {
  const naturalCues = ['뺨을 매만지는 바람', '한숨만은 깊어져만 가고'];
  const provider = createBoundaryCriticProvider({
    criticResult(sections) {
      return {
        sections: [
          {
            phrases: [
              {
                cues: naturalCues,
                phraseId: sections[0].phrases[0].phraseId,
                reasonCategory: 'unchanged',
              },
            ],
            sectionId: sections[0].sectionId,
          },
        ],
      };
    },
    firstPassCues: naturalCues,
    firstPassDisplayText: naturalCues.join(' '),
  });
  const state = (
    await createLanguagePhraseSession({ provider }).resolve(
      measuresFromLyrics(['뺨을매만지는바람한숨만은깊어져만가고']),
    )
  ).state;

  assert.deepEqual(
    state.phrases[0].displayCues.map((cue) => cue.text),
    naturalCues,
  );
  assert.equal(state.boundaryCritic.changedPhraseCount, 0);
  assert.equal(state.boundaryCritic.details[0].status, 'unchanged');
});

test('Critic이 hard section 구조를 합치면 모든 section이 독립적으로 1차 결과를 유지한다', async () => {
  const provider = createBoundaryCriticProvider({
    criticResult(sections) {
      return {
        sections: [
          {
            phrases: [
              {
                cues: ['앞가사뒤가사'],
                phraseId: sections[0].phrases[0].phraseId,
                reasonCategory: 'semantic',
              },
            ],
            sectionId: sections[0].sectionId,
          },
        ],
      };
    },
  });
  const state = (
    await createLanguagePhraseSession({ provider }).resolve(
      measuresFromLyrics(['앞가사', '', '뒤가사']),
    )
  ).state;

  assert.equal(state.boundaryCritic.fallbackSectionCount, 2);
  assert.deepEqual(
    state.phrases.map((phrase) => phrase.displayCues[0].text),
    ['앞가사', '뒤가사'],
  );
});

test('Critic은 같은 section 안에서도 서로 다른 lyric lane Phrase를 합치지 못한다', async () => {
  const provider = {
    model: 'test-model',
    async resolveBoundaryCritic(sections) {
      return {
        sections: [
          {
            phrases: [
              {
                cues: ['앞가사뒤가사'],
                phraseId: sections[0].phrases[0].phraseId,
                reasonCategory: 'semantic',
              },
            ],
            sectionId: sections[0].sectionId,
          },
        ],
      };
    },
    async resolveWindow(entries) {
      return {
        continuousDisplayText: entries.map((entry) => entry.analysisText).join(''),
        groups: entries.map((entry) => ({
          displayCues: [{ text: entry.analysisText }],
          displayText: entry.analysisText,
          endMeasureIndex: entry.measureIndex,
          measureIds: [entry.measureId],
          rawText: entry.analysisText,
          startMeasureIndex: entry.measureIndex,
        })),
      };
    },
  };
  const measures = measuresFromLyrics(['앞가사', '뒤가사']);

  measures[0].lyricGeometry = {
    lines: [{ lineIndex: 0 }],
    page: 1,
    systemIndex: 0,
  };
  measures[1].lyricGeometry = {
    lines: [{ lineIndex: 1 }],
    page: 1,
    systemIndex: 0,
  };
  const state = (
    await createLanguagePhraseSession({ provider }).resolve(measures)
  ).state;

  assert.equal(state.boundaryCritic.fallbackSectionCount, 1);
  assert.deepEqual(
    state.phrases.map((phrase) => phrase.measureIds),
    [['measure-1'], ['measure-2']],
  );
});

test('Critic API 실패는 1차 결과를 유지하고 같은 입력에서 실패 호출을 반복하지 않는다', async () => {
  let criticCallCount = 0;
  const firstPassProvider = createProvider();
  const provider = {
    get model() {
      return firstPassProvider.model;
    },
    async resolveBoundaryCritic() {
      criticCallCount += 1;
      const error = new Error('critic unavailable');

      error.code = 'api-failure';
      throw error;
    },
    resolveWindow: firstPassProvider.resolveWindow.bind(firstPassProvider),
  };
  const measures = measuresFromLyrics(['자연스러운가사']);
  const session = createLanguagePhraseSession({ provider });
  const first = await session.resolve(measures);
  const second = await session.resolve(measures);

  assert.equal(first.state.boundaryCritic.status, 'fallback');
  assert.equal(first.state.phrases[0].displayCues[0].text, '자연스러운가사');
  assert.equal(second.fromCache, true);
  assert.equal(criticCallCount, 1);
});
