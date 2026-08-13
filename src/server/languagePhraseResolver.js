import {
  applyBoundaryCriticResult,
  applyFinalKoreanSpacingCriticResult,
  applyKoreanSpacingPolishResult,
  createBoundaryCriticSections,
  createContinuousAnalysisSource,
  createLanguagePhraseAnalysisPlan,
  createLanguagePhraseBreathCandidates,
  createLanguagePhraseBoundaryMetadata,
  createFallbackLanguagePhrases,
  createProtectedLanguagePhrase,
  createLanguagePhraseSourceFingerprint,
  LANGUAGE_PHRASE_STATE_VERSION,
  normalizeLanguagePhraseRequestId,
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

function logKoreanSpacingDiagnostics({ application, error, sections }) {
  if (process.env.BSV_LANGUAGE_PHRASE_DEBUG !== '1') return;

  console.log('[KoreanSpacingPolish]');
  console.dir(
    {
      sections: sections.map((section) => {
        const detail = application?.details.find(
          (item) => item.sectionId === section.sectionId,
        );

        return {
          POLISHED: detail?.polishedText || null,
          SOURCE: section.continuousAnalysisText,
          reason: detail?.reason || '',
          sectionId: section.sectionId,
          validation: detail && detail.status !== 'fallback'
            ? 'accepted'
            : 'fallback',
        };
      }),
      error: error
        ? {
            category: getFallbackCategory(error),
            message: error.message,
          }
        : null,
      requestCount: sections.length > 0 ? 1 : 0,
    },
    { depth: null },
  );

  const boundaryDecisions = application?.details.flatMap((detail) =>
    Array.isArray(detail.boundaryDecisions) ? detail.boundaryDecisions : [],
  ) || [];

  if (boundaryDecisions.length > 0) {
    console.log('[WordBoundaryGuard]');
    console.table(boundaryDecisions.map((decision) => ({
      decision: decision.decision,
      finalBoundary: decision.finalBoundary,
      originalBoundary: decision.originalBoundary,
      reason: decision.reason,
      sectionId: decision.sectionId,
    })));
  }
}

function logFinalSpacingCriticDiagnostics({ application, error, sections }) {
  if (process.env.BSV_LANGUAGE_PHRASE_DEBUG !== '1') return;

  console.log('[FinalSpacingCritic]');
  console.dir(
    {
      sections: sections.map((section) => {
        const detail = application?.details.find(
          (item) => item.sectionId === section.sectionId,
        );

        return {
          FINAL: detail?.polishedText || null,
          FIRST_PASS: section.phrases
            .map((item) => item.phrase.displayText)
            .join(' '),
          SOURCE: section.continuousAnalysisText,
          reason: detail?.reason || '',
          sectionId: section.sectionId,
          validation: detail && detail.status !== 'fallback'
            ? 'accepted'
            : 'fallback',
        };
      }),
      error: error
        ? {
            category: getFallbackCategory(error),
            message: error.message,
          }
        : null,
      requestCount: sections.length > 0 ? 1 : 0,
    },
    { depth: null },
  );
}

function logLanguagePhraseDiagnostics({
  critic,
  diagnostics,
  finalSpacingCritic,
  phrases,
  spacingPolish,
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
    finalSpacingCritic,
    sourceKey,
    spacingPolish,
    windows: diagnostics,
  }, {
    depth: null,
  });
}

function logLanguagePhraseRequest(requestId, event, details = {}) {
  if (process.env.BSV_LANGUAGE_PHRASE_DEBUG !== '1') return;

  console.log(`[LanguagePhraseRequest ${requestId}] ${event}`, details);
}

export async function resolveLanguagePhraseState({
  analysisOptions,
  measures,
  now = () => new Date().toISOString(),
  provider,
  requestId: rawRequestId,
}) {
  const requestId = normalizeLanguagePhraseRequestId(rawRequestId);

  if (!provider || typeof provider.resolveWindow !== 'function') {
    throw new Error('AI 가사 Provider를 사용할 수 없습니다.');
  }

  const plan = createLanguagePhraseAnalysisPlan(measures, analysisOptions);
  const fragmentsBySegment = plan.segments.map(() => []);
  const fallbackDetails = [];
  const cueFallbackDetails = [];
  const diagnostics = [];

  logLanguagePhraseRequest(requestId, 'resolver started', {
    candidatePhraseCount: plan.candidatePhraseCount,
    windowCount: plan.windows.length,
  });

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
  logLanguagePhraseRequest(requestId, 'core resolved', {
    fallbackWindowCount: fallbackDetails.length,
    phraseCount: firstPassPhrasesBySegment.flat().length,
  });
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
  logLanguagePhraseRequest(requestId, 'critic completed', {
    fallbackSectionCount: critic.fallbackSectionCount,
    status: critic.status,
  });
  const spacingSections = createBoundaryCriticSections(
    plan.segments,
    finalPhrasesBySegment,
  );
  let spacingApplication = null;
  let spacingError = null;
  let polishedPhrasesBySegment = finalPhrasesBySegment;

  if (
    spacingSections.length > 0 &&
    typeof provider.resolveKoreanSpacing === 'function'
  ) {
    try {
      const spacingResult = await provider.resolveKoreanSpacing(spacingSections);

      spacingApplication = applyKoreanSpacingPolishResult(
        spacingSections,
        spacingResult,
      );
      polishedPhrasesBySegment = finalPhrasesBySegment.map(
        (phrases, segmentIndex) =>
          spacingApplication.phrasesBySegment[segmentIndex] || phrases,
      );
    } catch (error) {
      spacingError = error;
      logFallback('[vocal-phrases] korean spacing fallback', {
        category: getFallbackCategory(error),
        message:
          error instanceof Error ? error.message : 'Korean Spacing 실패',
      });
    }
  }

  const spacingPolish = {
    acceptedSectionCount: spacingApplication?.acceptedSectionCount || 0,
    attempted:
      spacingSections.length > 0 &&
      typeof provider.resolveKoreanSpacing === 'function',
    changedSectionCount: spacingApplication?.changedSectionCount || 0,
    details: spacingApplication?.details || [],
    fallbackSectionCount:
      spacingApplication?.fallbackSectionCount ||
      (spacingError ? spacingSections.length : 0),
    requestCharacterCount: spacingSections.reduce(
      (total, section) =>
        total + getNonWhitespaceCharacterCount(section.continuousAnalysisText),
      0,
    ),
    requestCount:
      spacingSections.length > 0 &&
      typeof provider.resolveKoreanSpacing === 'function'
        ? 1
        : 0,
    sectionCount: spacingSections.length,
    status: spacingError
      ? 'fallback'
      : spacingApplication
        ? spacingApplication.acceptedSectionCount === 0
          ? 'fallback'
          : spacingApplication.fallbackSectionCount > 0
            ? 'partial-fallback'
            : 'accepted'
        : spacingSections.length > 0
          ? 'unavailable'
          : 'not-needed',
  };
  logLanguagePhraseRequest(requestId, 'spacing completed', {
    fallbackSectionCount: spacingPolish.fallbackSectionCount,
    status: spacingPolish.status,
  });
  const finalSpacingSections = createBoundaryCriticSections(
    plan.segments,
    polishedPhrasesBySegment,
  );
  let finalSpacingApplication = null;
  let finalSpacingError = null;
  let finalSpacingPhrasesBySegment = polishedPhrasesBySegment;

  if (
    finalSpacingSections.length > 0 &&
    typeof provider.resolveKoreanSpacingCritic === 'function'
  ) {
    try {
      const finalSpacingResult = await provider.resolveKoreanSpacingCritic(
        finalSpacingSections,
      );

      finalSpacingApplication = applyFinalKoreanSpacingCriticResult(
        finalSpacingSections,
        finalSpacingResult,
      );
      finalSpacingPhrasesBySegment = polishedPhrasesBySegment.map(
        (phrases, segmentIndex) =>
          finalSpacingApplication.phrasesBySegment[segmentIndex] || phrases,
      );
    } catch (error) {
      finalSpacingError = error;
      logFallback('[vocal-phrases] final spacing critic fallback', {
        category: getFallbackCategory(error),
        message:
          error instanceof Error ? error.message : 'Final Spacing Critic 실패',
      });
    }
  }

  const finalSpacingCritic = {
    acceptedSectionCount: finalSpacingApplication?.acceptedSectionCount || 0,
    attempted:
      finalSpacingSections.length > 0 &&
      typeof provider.resolveKoreanSpacingCritic === 'function',
    changedSectionCount: finalSpacingApplication?.changedSectionCount || 0,
    details: finalSpacingApplication?.details || [],
    fallbackSectionCount:
      finalSpacingApplication?.fallbackSectionCount ||
      (finalSpacingError ? finalSpacingSections.length : 0),
    requestCharacterCount: finalSpacingSections.reduce(
      (total, section) =>
        total + getNonWhitespaceCharacterCount(section.continuousAnalysisText),
      0,
    ),
    requestCount:
      finalSpacingSections.length > 0 &&
      typeof provider.resolveKoreanSpacingCritic === 'function'
        ? 1
        : 0,
    sectionCount: finalSpacingSections.length,
    status: finalSpacingError
      ? 'fallback'
      : finalSpacingApplication
        ? finalSpacingApplication.acceptedSectionCount === 0
          ? 'fallback'
          : finalSpacingApplication.fallbackSectionCount > 0
            ? 'partial-fallback'
            : 'accepted'
        : finalSpacingSections.length > 0
          ? 'unavailable'
          : 'not-needed',
  };
  logLanguagePhraseRequest(requestId, 'final spacing critic completed', {
    fallbackSectionCount: finalSpacingCritic.fallbackSectionCount,
    status: finalSpacingCritic.status,
  });
  const phrases = finalSpacingPhrasesBySegment.flat();

  logBoundaryCriticDiagnostics({
    application: criticApplication,
    error: criticError,
    firstPassPhrasesBySegment,
    plan,
    sections: criticSections,
  });
  logKoreanSpacingDiagnostics({
    application: spacingApplication,
    error: spacingError,
    sections: spacingSections,
  });
  logFinalSpacingCriticDiagnostics({
    application: finalSpacingApplication,
    error: finalSpacingError,
    sections: finalSpacingSections,
  });

  logLanguagePhraseDiagnostics({
    critic,
    diagnostics,
    finalSpacingCritic,
    phrases,
    spacingPolish,
    sourceKey: plan.sourceKey,
  });
  logLanguagePhraseRequest(requestId, 'resolver success', {
    phraseCount: phrases.length,
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
    finalSpacingCritic,
    koreanSpacingPolish: spacingPolish,
    version: LANGUAGE_PHRASE_STATE_VERSION,
  };
}
