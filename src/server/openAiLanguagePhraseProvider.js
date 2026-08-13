import {
  createLanguagePhraseBoundaryMetadata,
  createLanguagePhraseBreathCandidates,
} from '../utils/languagePhrases.js';

const DEFAULT_MODEL = 'gpt-4.1-mini';
const DEFAULT_TIMEOUT_MS = 30_000;

const RESPONSE_SCHEMA = {
  additionalProperties: false,
  properties: {
    continuousDisplayText: { type: 'string' },
    groups: {
      items: {
        additionalProperties: false,
        properties: {
          displayCues: {
            items: {
              additionalProperties: false,
              properties: {
                text: { type: 'string' },
              },
              required: ['text'],
              type: 'object',
            },
            type: 'array',
          },
          displayText: { type: 'string' },
          endMeasureIndex: { type: 'integer' },
          measureIds: {
            items: { type: 'string' },
            type: 'array',
          },
          rawText: { type: 'string' },
          startMeasureIndex: { type: 'integer' },
        },
        required: [
          'startMeasureIndex',
          'endMeasureIndex',
          'measureIds',
          'rawText',
          'displayText',
          'displayCues',
        ],
        type: 'object',
      },
      type: 'array',
    },
  },
  required: ['continuousDisplayText', 'groups'],
  type: 'object',
};

const BOUNDARY_CRITIC_RESPONSE_SCHEMA = {
  additionalProperties: false,
  properties: {
    sections: {
      items: {
        additionalProperties: false,
        properties: {
          phrases: {
            items: {
              additionalProperties: false,
              properties: {
                cues: {
                  items: { type: 'string' },
                  type: 'array',
                },
                phraseId: { type: 'string' },
                reasonCategory: {
                  enum: [
                    'unchanged',
                    'grammar',
                    'semantic',
                    'breath',
                    'readability',
                  ],
                  type: 'string',
                },
              },
              required: ['phraseId', 'cues', 'reasonCategory'],
              type: 'object',
            },
            type: 'array',
          },
          sectionId: { type: 'string' },
        },
        required: ['sectionId', 'phrases'],
        type: 'object',
      },
      type: 'array',
    },
  },
  required: ['sections'],
  type: 'object',
};

const KOREAN_SPACING_RESPONSE_SCHEMA = {
  additionalProperties: false,
  properties: {
    sections: {
      items: {
        additionalProperties: false,
        properties: {
          polishedText: { type: 'string' },
          sectionId: { type: 'string' },
        },
        required: ['sectionId', 'polishedText'],
        type: 'object',
      },
      type: 'array',
    },
  },
  required: ['sections'],
  type: 'object',
};

const INSTRUCTIONS = `You resolve a context window of adjacent song-lyric measures into natural language phrases.
Return every input measureId exactly once, in the original order, grouped only into contiguous groups.
Use this priority order when grouping phrases and choosing display cue boundaries: (1) preserve Korean words, stems, endings, particles, and compound expressions, (2) preserve a natural semantic clause, (3) choose a natural vocal breath, (4) prefer a readable display length, and only then (5) consider a measure boundary.
Existing geometry phrase boundaries, score-system changes, ordinary horizontal gaps, candidatePhraseIndex changes, and measure boundaries marked soft are hints only. Cross them whenever Korean grammar or word continuity requires it.
breathCandidates are score-derived advisory hints, not mandatory cuts. Prefer a candidate only when it is also a natural grammatical or semantic boundary. Never split a Korean word, stem, ending, particle, or compound expression merely to follow geometry.
horizontal-lyric-gap means the PDF shows an unusually large relative lyric gap. score-system-transition or lyric-baseline-transition may suggest a breath but can still belong to the same language phrase. melisma-extension-marker is an extraction-based estimate of a sustained note, not a measured performance timestamp.
Never cross a boundary marked hard and never mix different lyricLaneKey values.
For each group, startMeasureIndex and endMeasureIndex must match its first and last input measure.
rawText must be the exact concatenation of the group's analysisText values. displayText may differ only in whitespace.
Never add, delete, replace, reorder, translate, or correct any non-whitespace character or punctuation.
Use neighboring measures as context. A suffix in a following measure may complete the previous phrase.
continuousAnalysisText is the same ordered measure text without measure separators. Use it as language context while keeping every measure identity and boundary intact.
Return continuousDisplayText as that entire text with natural whitespace only. It is the grammar-first reference for both LanguagePhrase and DisplayCue boundaries.
Determine continuousDisplayText before grouping. For the exact Korean continuations "신이나" + "서", "웃" + "었던", "도사" + "랑스럽고", and "소중" + "하게", use the natural whitespace forms "신이 나서", "웃었던", "도 사랑스럽고", and "소중하게" while preserving every non-whitespace character.
The boundaries array gives each exact measure boundary position in continuousAnalysisText and its normalized non-whitespace character offset. Treat soft boundary metadata only as context, not as an instruction to split.
Examples: "종소리가울려퍼지" + "네" may become "종소리가 울려 퍼지네"; "매만지는바람" may become "매만지는 바람"; "한숨만은깊어져만가고" may become "한숨만은 깊어져만 가고".
Measure extraction may split one Korean word across a soft score-system boundary. For example, "었던날 도사" + "랑스럽 고소중" may remain one language phrase and be displayed as "었던 날도 사랑스럽고 소중". Do not cross a hard boundary to do this.
Do not merge unrelated phrases merely because they are adjacent.
For every language phrase, also return displayCues for karaoke-style reading. A cue contains text only. Cue boundaries may occur inside a measure when Korean words or endings cross a measure boundary.
All cue texts in a group, concatenated in order and with whitespace removed, must equal that group's analysis text exactly. Do not count or return Unicode offsets; the server reconstructs character ranges deterministically from the cue text.
Keep a short phrase as one cue. Readable length near 1-3 measures and roughly 20 Korean characters is only a soft preference, never a hard cut. A longer cue is required when every nearby measure boundary would split a Korean word or grammatical unit.
When a cue would exceed about 24 non-whitespace characters or span more than about 3 measures, normally return two or more cues if any grammar-safe semantic or breathing boundary exists. This is still not a hard numeric cut: keep the longer cue only when every possible split would damage a word, ending, particle, compound expression, or intended meaning.
Prefer a strong horizontal-lyric-gap or melisma candidate when it falls after a complete Korean phrase, ending, or particle. Use length and breath geometry together; never cut at a candidate that breaks grammar merely to satisfy a number. If geometry candidates are grammatically unsafe, choose a better character boundary inside a measure instead.
Choose a natural semantic or breathing boundary even when it falls inside a measure. Never end before a suffix or particle that belongs to the preceding text.
Never put a display cue boundary inside Korean fragments that combine into one word, stem-ending form, particle sequence, or compound expression across measures. Forbidden examples include "신이나" | "서", "웃" | "었던", "도사" | "랑스럽고", and "소중" | "하게". These must remain within one display cue and may be spaced as "신이 나서", "웃었던", "도 사랑스럽고", and "소중하게" without changing characters.
Measure boundaries are musical reference metadata only. They are not mandatory language boundaries and must not prevent a cue from using the first characters of the next measure.
For "어렵고힘들었던시간을넘어서" + "아주많은처음을주었잖아", keep one language phrase when appropriate but return two display cues: "어렵고 힘들었던 시간을 넘어서" and "아주 많은 처음을 주었잖아".
For "분도신이나서날아갈정도로웃었던날도사랑스럽고소중하게키울수있도록", keep the language phrase when appropriate but use readable cues such as "분도 신이 나서 날아갈 정도로", "웃었던 날도 사랑스럽고", and "소중하게 키울 수 있도록". Character-span cue boundaries may fall inside source measures.
Each cue text may differ from its sequential source characters only in whitespace.`;

const BOUNDARY_CRITIC_INSTRUCTIONS = `You are the final global boundary critic for vocal display cues.
Review every section together so cue style, Korean grammar, semantic phrasing, vocal breathing, and readability remain consistent across the song.
The sections are separated by hard boundaries. Return every sectionId and phraseId exactly once, in the original order. Never move, merge, or duplicate text between sections or language phrases.
You may change only the cue boundaries and whitespace inside each phrase. Concatenating a phrase's returned cues and removing whitespace must reproduce that phrase's continuousAnalysisText exactly.
Never add, delete, replace, reorder, translate, or correct any non-whitespace character or punctuation. Do not return character offsets or measure IDs; the server reconstructs all character spans deterministically.
Use this priority order: (1) Korean grammar, (2) semantic units, (3) natural vocal breathing, (4) readable cue length, and then (5) score-derived breath candidates.
Do not split a Korean word, stem and ending, particle sequence, compound expression, adverb-modifier relation, or modifier-noun phrase merely for geometry or length. Avoid boundaries such as "아주 | 많은", "너무 | 좋은", "가장 | 소중한", "사 | 랑스럽고", "웃 | 었던", and "소중 | 하게".
breathCandidates are advisory only. Ignore them whenever they damage Korean grammar, semantics, or modifier relationships. A hard boundary is never negotiable.
Keep already natural cue sequences unchanged. Do not create many tiny cues. Do not collapse a readable multi-cue phrase into one unusually large cue.
When the first pass has "어렵고 힘들었던 시간을 넘어서 아주" and "많은 처음을 주었잖아", prefer "어렵고 힘들었던 시간을 넘어서" and "아주 많은 처음을 주었잖아" while preserving the exact character order.
Set reasonCategory to the main reason for a changed phrase, or unchanged when its cue texts remain exactly the same.`;

const KOREAN_SPACING_INSTRUCTIONS = `You are the final Korean spacing polisher for song lyrics.
Review every hard-boundary section together for consistent Korean spacing, but return each section independently with the exact same sectionId and order.
You may insert, delete, or move whitespace only. Never add, delete, replace, reorder, translate, or correct any non-whitespace character, punctuation, English letter, number, or hyphen.
Use continuousAnalysisText as the canonical character sequence and acceptedDisplayText as the current spacing reference. Improve only spacing that is clearly unnatural.
Resolve Korean word continuity across source measure and display cue boundaries. Inspect whether whitespace between adjacent Hangul syllables splits one lexical word, compound expression, stem, ending, or particle sequence.
Preserve already natural text such as "뺨을 매만지는 바람". Preserve English and numeric tokens such as "K-pop" and "10-20" exactly except for surrounding whitespace when Korean context clearly requires it.
Do not return offsets, measure IDs, phrase IDs, explanations, or corrected spelling. The server reconstructs all character and source spans deterministically.`;

const FINAL_KOREAN_SPACING_CRITIC_INSTRUCTIONS = `You are an independent final spacing critic for Korean song lyrics.
Review every hard-boundary section together, but return every section independently with the exact same sectionId and order.
continuousAnalysisText is the immutable canonical character sequence. firstPassText is a spacing candidate that may contain subtle lexical errors, but it may also contain correct Korean word boundaries. Evaluate it independently and make the smallest clearly justified whitespace correction.
Inspect every whitespace boundary between adjacent Hangul syllables in full section context. Remove whitespace only with high confidence that it splits one lexical word, compound expression conventionally written without a space, stem, ending, or particle sequence. Do not collapse a valid boundary between separate determiners, pronouns, adverbs, nouns, or other independently written words. Add or move whitespace only when Korean grammar clearly requires it.
Preserve already natural first-pass spacing. When a boundary is ambiguous rather than clearly wrong, keep the first-pass boundary instead of inventing a new spelling convention.
You may change whitespace only. Never add, delete, replace, reorder, translate, or correct any non-whitespace character, punctuation, English letter, number, or hyphen.
Do not change LanguagePhrase or DisplayCue boundaries. Do not return offsets, measure IDs, phrase IDs, explanations, or corrected spelling. The server projects accepted whitespace onto its existing character spans and cue ranges.`;

function createProviderError(message, code) {
  const error = new Error(message);

  error.code = code;
  return error;
}

function parseResponseText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;

  for (const outputItem of payload?.output || []) {
    for (const contentItem of outputItem?.content || []) {
      if (
        contentItem?.type === 'output_text' &&
        typeof contentItem.text === 'string'
      ) {
        return contentItem.text;
      }
    }
  }

  return '';
}

function getTimeoutMs(value) {
  const timeoutMs = Number(value);

  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_TIMEOUT_MS;
}

export function createOpenAiLanguagePhraseProvider({
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = globalThis.fetch,
  model = process.env.OPENAI_VOCAL_MODEL || DEFAULT_MODEL,
  timeoutMs = getTimeoutMs(process.env.OPENAI_VOCAL_TIMEOUT_MS),
} = {}) {
  async function requestStructuredOutput({
    input,
    instructions,
    schema,
    schemaName,
  }) {
    if (!apiKey) {
      throw createProviderError(
        'OPENAI_API_KEY가 서버에 설정되지 않았습니다.',
        'configuration',
      );
    }

    if (typeof fetchImpl !== 'function') {
      throw createProviderError(
        '서버에서 OpenAI API를 호출할 수 없습니다.',
        'configuration',
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl('https://api.openai.com/v1/responses', {
        body: JSON.stringify({
          input: JSON.stringify(input),
          instructions,
          model,
          text: {
            format: {
              name: schemaName,
              schema,
              strict: true,
              type: 'json_schema',
            },
          },
        }),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw createProviderError(
          `OpenAI API 요청 실패 (${response.status})`,
          'api-failure',
        );
      }

      let payload;

      try {
        payload = await response.json();
      } catch {
        throw createProviderError(
          'OpenAI API 응답 JSON을 읽지 못했습니다.',
          'invalid-json',
        );
      }
      const responseText = parseResponseText(payload);

      if (!responseText) {
        throw createProviderError(
          'OpenAI API 응답에 구조화된 결과가 없습니다.',
          'invalid-json',
        );
      }

      try {
        return JSON.parse(responseText);
      } catch {
        throw createProviderError(
          'OpenAI API의 구조화된 결과가 올바른 JSON이 아닙니다.',
          'invalid-json',
        );
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw createProviderError(
          'OpenAI API 요청 시간이 초과되었습니다.',
          'timeout',
        );
      }

      if (typeof error?.code === 'string') throw error;

      throw createProviderError(
        error instanceof Error
          ? `OpenAI API 통신 실패: ${error.message}`
          : 'OpenAI API 통신에 실패했습니다.',
        'api-failure',
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return {
    model,

    resolveBoundaryCritic(sections) {
      return requestStructuredOutput({
        input: {
          sections: sections.map((section) => ({
            breathCandidates: section.breathCandidates,
            continuousAnalysisText: section.continuousAnalysisText,
            phrases: section.phrases.map((item) => ({
              continuousAnalysisText: item.phrase.analysisText,
              firstPassCues: item.firstPassCues,
              phraseId: item.phraseId,
            })),
            sectionId: section.sectionId,
          })),
        },
        instructions: BOUNDARY_CRITIC_INSTRUCTIONS,
        schema: BOUNDARY_CRITIC_RESPONSE_SCHEMA,
        schemaName: 'global_vocal_boundary_critic',
      });
    },

    resolveKoreanSpacing(sections) {
      return requestStructuredOutput({
        input: {
          sections: sections.map((section) => ({
            acceptedDisplayText: section.phrases
              .map((item) => item.phrase.displayText)
              .join(' '),
            continuousAnalysisText: section.continuousAnalysisText,
            sectionId: section.sectionId,
          })),
        },
        instructions: KOREAN_SPACING_INSTRUCTIONS,
        schema: KOREAN_SPACING_RESPONSE_SCHEMA,
        schemaName: 'global_korean_spacing_polish',
      });
    },

    resolveKoreanSpacingCritic(sections) {
      return requestStructuredOutput({
        input: {
          sections: sections.map((section) => ({
            continuousAnalysisText: section.continuousAnalysisText,
            firstPassText: section.phrases
              .map((item) => item.phrase.displayText)
              .join(' '),
            sectionId: section.sectionId,
          })),
        },
        instructions: FINAL_KOREAN_SPACING_CRITIC_INSTRUCTIONS,
        schema: KOREAN_SPACING_RESPONSE_SCHEMA,
        schemaName: 'final_korean_spacing_critic',
      });
    },

    resolveWindow(entries, context = {}) {
      return requestStructuredOutput({
        input: {
          boundaries: createLanguagePhraseBoundaryMetadata(entries),
          breathCandidates: Array.isArray(context.breathCandidates)
            ? context.breathCandidates
            : createLanguagePhraseBreathCandidates(entries),
          continuousAnalysisText: entries
            .map((entry) => entry.analysisText)
            .join(''),
          contextWindow: context.window || null,
          measures: entries.map((entry) => ({
            analysisText: entry.analysisText,
            boundaryBefore: entry.boundaryBefore,
            boundaryReason: entry.boundaryReason,
            candidatePhraseIndex: entry.candidatePhraseIndex,
            lyricLaneKey: entry.lyricLaneKey,
            measureId: entry.measureId,
            measureIndex: entry.measureIndex,
            measureNumber: entry.measureNumber,
            rawLyric: entry.rawLyric,
          })),
        },
        instructions: INSTRUCTIONS,
        schema: RESPONSE_SCHEMA,
        schemaName: 'language_phrase_groups',
      });
    },
  };
}
