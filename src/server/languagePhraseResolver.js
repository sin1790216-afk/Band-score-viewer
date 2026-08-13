import {
  applyBoundaryCriticResult,
  createBoundaryCriticSections,
  createContinuousAnalysisSource,
  createLanguagePhraseAnalysisPlan,
  createLanguagePhraseBreathCandidates,
  createLanguagePhraseBoundaryMetadata,
  createFallbackLanguagePhrases,
  createProtectedLanguagePhrase,
  createLanguagePhraseSourceFingerprint,
  LANGUAGE_PHRASE_STATE_VERSION,
  stitchLanguagePhraseFragments,
  validateLanguagePhraseWindowResult,
} from '../utils/languagePhrases.js';
import { createCoarseDisplayCueTimingProjection } from '../utils/vocalPhrases.js';

function addWindowContext(phrase, window) {
  return {
    ...phrase,
    analysisWindow: {
      endCharOffset: window.endCharOffset,
      key: `${window.segmentIndex}:${window.chunkIndex}`,
      startCharOffset: window.startCharOffset,
    },
  };
}

function createResolutionError(message, code, reason = code) {
  const error = new Error(message);

  error.code = code;
  error.reason = reason;
  return error;
}

function getFallbackCategory(error) {
  const code = typeof error?.code === 'string' ? error.code : '';

  if (
    [
      'api-failure',
      'boundary',
      'configuration',
      'invalid-json',
      'timeout',
      'validation',
    ]
      .includes(code)
  ) {
    return code;
  }

  return 'api-failure';
}

function logFallback(label, detail) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(label, detail);
  }
}

function getTextLength(value) {
  return Array.from(typeof value === 'string' ? value : '').length;
}

function getNonWhitespaceCharacterCount(value) {
  return Array.from(
    typeof value === 'string' ? value.replace(/\s/gu, '') : '',
  ).length;
}

export function createLanguagePhraseWindowDiagnostic({
  fallback = null,
  providerResult = null,
  validation = null,
  window,
}) {
  const continuousSource = createContinuousAnalysisSource(window.entries);

  return {
    aiInput: {
      boundaries: createLanguagePhraseBoundaryMetadata(window.entries),
      breathCandidates: createLanguagePhraseBreathCandidates(window.entries),
      continuousAnalysisText: window.entries
        .map((entry) => entry.analysisText)
        .join(''),
      measures: window.entries.map((entry) => ({
        analysisText: entry.analysisText,
        boundaryBefore: entry.boundaryBefore,
        boundaryReason: entry.boundaryReason,
        candidatePhraseIndex: entry.candidatePhraseIndex,
        lyricGeometry: entry.sourceGeometry,
        lyricLaneKey: entry.lyricLaneKey,
        measureId: entry.measureId,
        measureIndex: entry.measureIndex,
        normalizationBefore: entry.rawLyric,
        rawLyric: entry.rawLyric,
      })),
      sourceCharMap: continuousSource.sourceCharMap,
    },
    aiResult: providerResult,
    fallback,
    context: {
      characterCount: window.characterCount,
      chunkIndex: window.chunkIndex,
      endCharOffset: window.endCharOffset,
      isChunked: window.isChunked,
      startCharOffset: window.startCharOffset,
      windowIndex: window.windowIndex,
    },
    mode: window.mode,
    segmentIndex: window.segmentIndex,
    validation: validation
      ? {
          acceptedPhrases: validation.phrases,
          code: validation.code,
          cueBoundaryDecisions: validation.cueBoundaryDecisions || [],
          cueCorrections: validation.cueCorrections || [],
          cueFallbacks: validation.cueFallbacks || [],
          error: validation.error,
          reason: validation.reason || '',
        }
      : null,
  };
}

function logBoundaryCriticDiagnostics({
  application,
  error,
  firstPassPhrasesBySegment,
  plan,
  sections,
}) {
  if (process.env.BSV_LANGUAGE_PHRASE_DEBUG !== '1') return;

  console.log('[BoundaryCritic]');
  console.dir(
    {
      AFTER: sections.map((section) => ({
        cues: (application?.phrasesBySegment[section.segmentIndex] || [])
          .flatMap((phrase) => phrase.displayCues.map((cue) => cue.text)),
        sectionId: section.sectionId,
      })),
      BEFORE: sections.map((section) => ({
        cues: firstPassPhrasesBySegment[section.segmentIndex]
          .flatMap((phrase) => phrase.displayCues.map((cue) => cue.text)),
        sectionId: section.sectionId,
      })),
      context: {
        criticRequestCharacterCount: sections.reduce(
          (total, section) =>
            total + getNonWhitespaceCharacterCount(
              section.continuousAnalysisText,
            ),
          0,
        ),
        criticRequestCount: sections.length > 0 ? 1 : 0,
        firstPassRequestCount: plan.windows.filter(
          (window) => window.mode === 'ai',
        ).length,
        sectionCharacterCounts: sections.map((section) => ({
          characterCount: getNonWhitespaceCharacterCount(
            section.continuousAnalysisText,
          ),
          sectionId: section.sectionId,
        })),
        totalAnalysisCharacterCount: plan.segments.reduce(
          (total, segment) =>
            total + getNonWhitespaceCharacterCount(
              segment.entries.map((entry) => entry.analysisText).join(''),
            ),
          0,
        ),
        usedChunking: plan.windows.some((window) => window.isChunked),
      },
      error: error
        ? {
            category: getFallbackCategory(error),
            message: error.message,
          }
        : null,
      validation: application
        ? {
            acceptedSectionCount: application.acceptedSectionCount,
            changedPhraseCount: application.changedPhraseCount,
            details: application.details,
            fallbackSectionCount: application.fallbackSectionCount,
          }
        : null,
    },
    { depth: null },
  );
}

function logLanguagePhraseDiagnostics({
  critic,
  diagnostics,
  phrases,
  sourceKey,
}) {
  if (process.env.BSV_LANGUAGE_PHRASE_DEBUG !== '1') return;

  const finalPhrases = phrases.map((phrase) => ({
    displayCues: createCoarseDisplayCueTimingProjection(
      phrase.displayCues,
    ).map((cue) => ({
      charRange: [cue.startCharOffset, cue.endCharOffset],
      endMeasureIndex: cue.endMeasureIndex,
      measureCount: cue.measureIds.length,
      sourceSpans: cue.sourceSpans,
      startMeasureIndex: cue.startMeasureIndex,
      text: cue.text,
      textLength: getTextLength(cue.text),
      timingProjection: {
        currentThroughMeasure: cue.timingEndMeasureIndex,
        currentFromMeasure: cue.timingStartMeasureIndex,
      },
    })),
    displayText: phrase.displayText,
    endMeasureIndex: phrase.endMeasureIndex,
    startMeasureIndex: phrase.startMeasureIndex,
  }));

  console.log('[VocalPhrasePipeline]');
  console.dir({
    finalPhrases,
    critic,
    sourceKey,
    windows: diagnostics,
  }, {
    depth: null,
  });
}

export async function resolveLanguagePhraseState({
  analysisOptions,
  measures,
  now = () => new Date().toISOString(),
  provider,
}) {
  if (!provider || typeof provider.resolveWindow !== 'function') {
    throw new Error('AI 가사 Provider를 사용할 수 없습니다.');
  }

  const plan = createLanguagePhraseAnalysisPlan(measures, analysisOptions);
  const fragmentsBySegment = plan.segments.map(() => []);
  const fallbackDetails = [];
  const cueFallbackDetails = [];
  const diagnostics = [];

  for (const window of plan.windows) {
    if (window.mode === 'protected-multiline') {
      const protectedPhrase = createProtectedLanguagePhrase(window.entries[0]);

      fragmentsBySegment[window.segmentIndex].push(
        addWindowContext(protectedPhrase, window),
      );
      diagnostics.push(
        createLanguagePhraseWindowDiagnostic({
          validation: {
            code: '',
            cueCorrections: [],
            cueFallbacks: [],
            error: '',
            phrases: [protectedPhrase],
            reason: '',
          },
          window,
        }),
      );
      continue;
    }

    let providerResult = null;
    let validation = null;

    try {
      providerResult = await provider.resolveWindow(window.entries, {
        breathCandidates: createLanguagePhraseBreathCandidates(window.entries),
        window: {
          characterCount: window.characterCount,
          chunkIndex: window.chunkIndex,
          endCharOffset: window.endCharOffset,
          isChunked: window.isChunked,
          startCharOffset: window.startCharOffset,
        },
      });
      validation = validateLanguagePhraseWindowResult(
        window.entries,
        providerResult,
      );

      if (!validation.phrases) {
        throw createResolutionError(
          validation.error,
          validation.code,
          validation.reason,
        );
      }

      fragmentsBySegment[window.segmentIndex].push(
        ...validation.phrases.map((phrase) =>
          addWindowContext(phrase, window),
        ),
      );
      validation.cueFallbacks.forEach((fallback) => {
        const detail = {
          category: 'display-cue-validation',
          message: fallback.message,
          ...fallback,
        };

        cueFallbackDetails.push(detail);
        logFallback('[vocal-phrases] display cue fallback', detail);
      });
      diagnostics.push(
        createLanguagePhraseWindowDiagnostic({
          providerResult,
          validation,
          window,
        }),
      );
    } catch (error) {
      const detail = {
        category: getFallbackCategory(error),
        endMeasureIndex: window.entries.at(-1).measureIndex,
        message: error instanceof Error ? error.message : 'AI 가사 분석 실패',
        reason:
          typeof error?.reason === 'string'
            ? error.reason
            : getFallbackCategory(error),
        startMeasureIndex: window.entries[0].measureIndex,
      };

      fallbackDetails.push(detail);
      logFallback('[vocal-phrases] language window fallback', detail);
      diagnostics.push(
        createLanguagePhraseWindowDiagnostic({
          fallback: detail,
          providerResult,
          validation,
          window,
        }),
      );
      fragmentsBySegment[window.segmentIndex].push(
        ...createFallbackLanguagePhrases(window.entries).map((phrase) =>
          addWindowContext(phrase, window),
        ),
      );
    }
  }

  const firstPassPhrasesBySegment = plan.segments.map((segment, segmentIndex) =>
    stitchLanguagePhraseFragments(
      segment.entries,
      fragmentsBySegment[segmentIndex],
    ),
  );
  const criticSections = createBoundaryCriticSections(
    plan.segments,
    firstPassPhrasesBySegment,
  );
  let criticApplication = null;
  let criticError = null;
  let finalPhrasesBySegment = firstPassPhrasesBySegment;

  if (
    criticSections.length > 0 &&
    typeof provider.resolveBoundaryCritic === 'function'
  ) {
    try {
      const criticResult = await provider.resolveBoundaryCritic(criticSections);

      criticApplication = applyBoundaryCriticResult(
        criticSections,
        criticResult,
      );
      finalPhrasesBySegment = firstPassPhrasesBySegment.map(
        (phrases, segmentIndex) =>
          criticApplication.phrasesBySegment[segmentIndex] || phrases,
      );
    } catch (error) {
      criticError = error;
      logFallback('[vocal-phrases] boundary critic fallback', {
        category: getFallbackCategory(error),
        message:
          error instanceof Error ? error.message : 'Boundary Critic 실패',
      });
    }
  }

  const criticRequestCharacterCount = criticSections.reduce(
    (total, section) =>
      total + getNonWhitespaceCharacterCount(section.continuousAnalysisText),
    0,
  );
  const critic = {
    acceptedSectionCount: criticApplication?.acceptedSectionCount || 0,
    attempted:
      criticSections.length > 0 &&
      typeof provider.resolveBoundaryCritic === 'function',
    changedPhraseCount: criticApplication?.changedPhraseCount || 0,
    details: criticApplication?.details || [],
    fallbackSectionCount:
      criticApplication?.fallbackSectionCount ||
      (criticError ? criticSections.length : 0),
    requestCharacterCount: criticRequestCharacterCount,
    requestCount:
      criticSections.length > 0 &&
      typeof provider.resolveBoundaryCritic === 'function'
        ? 1
        : 0,
    sectionCount: criticSections.length,
    status: criticError
      ? 'fallback'
      : criticApplication
        ? criticApplication.fallbackSectionCount > 0
          ? 'partial-fallback'
          : 'accepted'
        : criticSections.length > 0
          ? 'unavailable'
          : 'not-needed',
  };
  const phrases = finalPhrasesBySegment.flat();

  logBoundaryCriticDiagnostics({
    application: criticApplication,
    error: criticError,
    firstPassPhrasesBySegment,
    plan,
    sections: criticSections,
  });

  logLanguagePhraseDiagnostics({
    critic,
    diagnostics,
    phrases,
    sourceKey: plan.sourceKey,
  });

  return {
    analyzedAt: now(),
    candidatePhraseCount: plan.candidatePhraseCount,
    displayCueFallbackCount: cueFallbackDetails.length,
    fallbackDetails: [...fallbackDetails, ...cueFallbackDetails],
    fallbackError: fallbackDetails[0]?.message || '',
    fallbackWindowCount: fallbackDetails.length,
    model: provider.model || '',
    phraseCount: phrases.length,
    phrases,
    sourceFingerprint: createLanguagePhraseSourceFingerprint(measures),
    sourceKey: plan.sourceKey,
    boundaryCritic: critic,
    version: LANGUAGE_PHRASE_STATE_VERSION,
  };
}
