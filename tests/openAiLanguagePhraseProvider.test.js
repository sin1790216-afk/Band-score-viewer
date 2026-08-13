import assert from 'node:assert/strict';
import test from 'node:test';

import { createOpenAiLanguagePhraseProvider } from '../src/server/openAiLanguagePhraseProvider.js';

const ENTRIES = [
  {
    analysisText: '종소리가울려퍼지',
    boundaryBefore: 'hard',
    boundaryReason: 'segment-start',
    candidatePhraseIndex: 0,
    lyricLaneKey: '0',
    measureId: 'measure-1',
    measureIndex: 0,
    measureNumber: 1,
    rawLyric: '종소리가울려퍼지',
  },
  {
    analysisText: '네',
    boundaryBefore: 'soft',
    boundaryReason: 'geometry-phrase',
    candidatePhraseIndex: 1,
    lyricLaneKey: '0',
    measureId: 'measure-2',
    measureIndex: 1,
    measureNumber: 2,
    rawLyric: '네',
  },
];

test('OpenAI provider는 서버 key와 structured output schema로 Responses API를 호출한다', async () => {
  let request;
  const provider = createOpenAiLanguagePhraseProvider({
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      request = { options, url };
      return {
        async json() {
          return {
            output: [
              {
                content: [
                  {
                    text: JSON.stringify({
                      continuousDisplayText: '종소리가 울려 퍼지네',
                      groups: [
                        {
                          displayCues: [
                            {
                              text: '종소리가 울려 퍼지네',
                            },
                          ],
                          displayText: '종소리가 울려 퍼지네',
                          endMeasureIndex: 1,
                          measureIds: ['measure-1', 'measure-2'],
                          rawText: '종소리가울려퍼지네',
                          startMeasureIndex: 0,
                        },
                      ],
                    }),
                    type: 'output_text',
                  },
                ],
              },
            ],
          };
        },
        ok: true,
      };
    },
    model: 'test-model',
  });
  const result = await provider.resolveWindow(ENTRIES, {
    breathCandidates: [
      {
        afterMeasureId: 'measure-1',
        beforeMeasureId: 'measure-2',
        continuousCharOffset: 8,
        reasons: ['horizontal-lyric-gap'],
        strength: 'strong',
      },
    ],
    window: {
      isChunked: false,
    },
  });
  const body = JSON.parse(request.options.body);

  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  assert.equal(body.model, 'test-model');
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.ok(
    body.text.format.schema.properties.groups.items.required.includes(
      'displayCues',
    ),
  );
  assert.deepEqual(
    body.text.format.schema.properties.groups.items.properties.displayCues.items
      .required,
    ['text'],
  );
  assert.ok(body.text.format.schema.required.includes('continuousDisplayText'));
  const input = JSON.parse(body.input);

  assert.equal(input.continuousAnalysisText, '종소리가울려퍼지네');
  assert.equal(input.boundaries.length, 1);
  assert.equal(input.boundaries[0].afterMeasureId, 'measure-1');
  assert.equal(input.boundaries[0].beforeMeasureId, 'measure-2');
  assert.equal(input.boundaries[0].normalizedTextOffset, 8);
  assert.equal(input.breathCandidates[0].strength, 'strong');
  assert.equal(input.contextWindow.isChunked, false);
  assert.equal(input.measures[0].analysisText, '종소리가울려퍼지');
  assert.equal(input.measures[1].boundaryBefore, 'soft');
  assert.equal(input.measures[1].candidatePhraseIndex, 1);
  assert.equal(result.groups[0].displayText, '종소리가 울려 퍼지네');
  assert.equal(result.groups[0].displayCues.length, 1);
  assert.match(body.instructions, /preserve Korean words/);
  assert.match(body.instructions, /soft preference, never a hard cut/);
  assert.match(body.instructions, /"신이나" \| "서"/);
  assert.match(body.instructions, /"신이 나서"/);
  assert.match(body.instructions, /Do not count or return Unicode offsets/);
  assert.match(body.instructions, /Cue boundaries may occur inside a measure/);
  assert.match(body.instructions, /advisory hints, not mandatory cuts/);
});

test('OpenAI provider는 key 없음, HTTP 오류와 잘못된 JSON을 실패로 반환한다', async () => {
  const withoutKey = createOpenAiLanguagePhraseProvider({ apiKey: '' });
  const httpFailure = createOpenAiLanguagePhraseProvider({
    apiKey: 'test-key',
    fetchImpl: async () => ({ ok: false, status: 429 }),
  });
  const invalidJson = createOpenAiLanguagePhraseProvider({
    apiKey: 'test-key',
    fetchImpl: async () => ({
      async json() {
        return { output_text: 'not-json' };
      },
      ok: true,
    }),
  });

  await assert.rejects(() => withoutKey.resolveWindow(ENTRIES), /OPENAI_API_KEY/);
  await assert.rejects(
    () => httpFailure.resolveWindow(ENTRIES),
    (error) => error.code === 'api-failure' && /429/.test(error.message),
  );
  await assert.rejects(
    () => invalidJson.resolveWindow(ENTRIES),
    (error) => error.code === 'invalid-json' && /JSON/.test(error.message),
  );
});

test('OpenAI provider는 timeout과 네트워크 실패를 구분한다', async () => {
  const timeout = createOpenAiLanguagePhraseProvider({
    apiKey: 'test-key',
    fetchImpl: async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('aborted');

          error.name = 'AbortError';
          reject(error);
        });
      }),
    timeoutMs: 1,
  });
  const networkFailure = createOpenAiLanguagePhraseProvider({
    apiKey: 'test-key',
    fetchImpl: async () => {
      throw new TypeError('network down');
    },
  });

  await assert.rejects(
    () => timeout.resolveWindow(ENTRIES),
    (error) => error.code === 'timeout',
  );
  await assert.rejects(
    () => networkFailure.resolveWindow(ENTRIES),
    (error) => error.code === 'api-failure',
  );
});

test('OpenAI provider는 모든 hard section을 한 번의 Boundary Critic 요청으로 보낸다', async () => {
  let requestBody;
  const sections = [
    {
      breathCandidates: [],
      continuousAnalysisText: '아주많은처음',
      phrases: [
        {
          firstPassCues: ['아주', '많은 처음'],
          phrase: { analysisText: '아주많은처음' },
          phraseId: 'phrase-1',
        },
      ],
      sectionId: 'section-1',
    },
    {
      breathCandidates: [],
      continuousAnalysisText: '다음가사',
      phrases: [
        {
          firstPassCues: ['다음 가사'],
          phrase: { analysisText: '다음가사' },
          phraseId: 'phrase-2',
        },
      ],
      sectionId: 'section-2',
    },
  ];
  const responsePayload = {
    sections: sections.map((section) => ({
      phrases: section.phrases.map((phrase) => ({
        cues: phrase.firstPassCues,
        phraseId: phrase.phraseId,
        reasonCategory: 'unchanged',
      })),
      sectionId: section.sectionId,
    })),
  };
  const provider = createOpenAiLanguagePhraseProvider({
    apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        async json() {
          return { output_text: JSON.stringify(responsePayload) };
        },
        ok: true,
      };
    },
  });

  const result = await provider.resolveBoundaryCritic(sections);
  const input = JSON.parse(requestBody.input);

  assert.deepEqual(result, responsePayload);
  assert.equal(requestBody.text.format.name, 'global_vocal_boundary_critic');
  assert.equal(input.sections.length, 2);
  assert.equal(input.sections[0].phrases[0].phraseId, 'phrase-1');
  assert.equal(input.sections[1].phrases[0].phraseId, 'phrase-2');
  assert.match(requestBody.instructions, /Never move, merge, or duplicate/);
  assert.match(requestBody.instructions, /"아주 \| 많은"/);
});

test('OpenAI provider는 모든 section을 한 번의 Korean Spacing 요청으로 보낸다', async () => {
  let requestBody;
  const sections = [
    {
      continuousAnalysisText: '저멀리서핑도는눈물이이름을붙여준내일',
      phrases: [
        {
          phrase: {
            displayText: '저 멀리서 핑 도는 눈물이 이름을 붙여준 내일',
          },
        },
      ],
      sectionId: 'section-1',
    },
    {
      continuousAnalysisText: '천진난만한이런기분도',
      phrases: [
        {
          phrase: { displayText: '천진난만한 이런기분도' },
        },
      ],
      sectionId: 'section-2',
    },
  ];
  const responsePayload = {
    sections: [
      {
        polishedText: '저 멀리서 핑 도는 눈물이 이름을 붙여준 내일',
        sectionId: 'section-1',
      },
      {
        polishedText: '천진난만한 이런 기분도',
        sectionId: 'section-2',
      },
    ],
  };
  const provider = createOpenAiLanguagePhraseProvider({
    apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        async json() {
          return { output_text: JSON.stringify(responsePayload) };
        },
        ok: true,
      };
    },
  });

  const result = await provider.resolveKoreanSpacing(sections);
  const input = JSON.parse(requestBody.input);

  assert.deepEqual(result, responsePayload);
  assert.equal(requestBody.text.format.name, 'global_korean_spacing_polish');
  assert.equal(input.sections.length, 2);
  assert.equal(
    input.sections[0].acceptedDisplayText,
    '저 멀리서 핑 도는 눈물이 이름을 붙여준 내일',
  );
  assert.equal(
    input.sections[1].continuousAnalysisText,
    '천진난만한이런기분도',
  );
  assert.match(requestBody.instructions, /whitespace only/);
  assert.match(requestBody.instructions, /K-pop/);
  assert.match(requestBody.instructions, /10-20/);
});

test('OpenAI provider는 전체 section의 첫 spacing을 한 번의 Final Spacing Critic 요청으로 보낸다', async () => {
  let requestBody;
  const sections = [
    {
      continuousAnalysisText: '천진난만한이런기분도',
      phrases: [
        {
          phrase: { displayText: '천 진난만한 이런 기분도' },
        },
      ],
      sectionId: 'section-1',
    },
  ];
  const responsePayload = {
    sections: [
      {
        polishedText: '천진난만한 이런 기분도',
        sectionId: 'section-1',
      },
    ],
  };
  const provider = createOpenAiLanguagePhraseProvider({
    apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        async json() {
          return { output_text: JSON.stringify(responsePayload) };
        },
        ok: true,
      };
    },
  });

  const result = await provider.resolveKoreanSpacingCritic(sections);
  const input = JSON.parse(requestBody.input);

  assert.deepEqual(result, responsePayload);
  assert.equal(requestBody.text.format.name, 'final_korean_spacing_critic');
  assert.equal(input.sections.length, 1);
  assert.equal(input.sections[0].continuousAnalysisText, '천진난만한이런기분도');
  assert.equal(input.sections[0].firstPassText, '천 진난만한 이런 기분도');
  assert.match(requestBody.instructions, /Evaluate it independently/i);
  assert.match(requestBody.instructions, /smallest clearly justified/i);
  assert.match(requestBody.instructions, /whitespace only/i);
  assert.match(
    requestBody.instructions,
    /Do not change LanguagePhrase or DisplayCue boundaries/,
  );
});
