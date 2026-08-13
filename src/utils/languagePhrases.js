import {
  createVocalPhrases,
  getMeaningfulLyric,
  isHardVocalPhraseBoundary,
} from './vocalPhrases.js';
import {
  createVocalDisplayText,
  normalizeVocalExtractionArtifacts,
} from './vocalTextPostprocessing.js';

export const LANGUAGE_PHRASE_EVENTS = Object.freeze({
  RESOLVE: 'vocal-phrases:resolve',
  STATE: 'vocal-phrases:state',
});

export const LANGUAGE_PHRASE_STATE_VERSION = 3;
// The acknowledgement covers core resolution, Critic, and Spacing as one job.
export const LANGUAGE_PHRASE_RESOLVE_ACK_TIMEOUT_MS = 180_000;
export const DEFAULT_LANGUAGE_PHRASE_MAX_CONTEXT_CHARACTERS = 4000;
export const DEFAULT_LANGUAGE_PHRASE_WINDOW_OVERLAP_MEASURES = 4;
const LANGUAGE_PHRASE_RESOLVER_REVISION = 'character-span-spacing-critic-v4';
const LANGUAGE_PHRASE_SOURCE_KEY_PREFIX =
  `language-phrases-v${LANGUAGE_PHRASE_STATE_VERSION}-${LANGUAGE_PHRASE_RESOLVER_REVISION}`;
const LANGUAGE_PHRASE_REQUEST_ID_PATTERN = /^[\w-]{1,64}$/u;
let languagePhraseRequestSequence = 0;

export function normalizeLanguagePhraseRequestId(value) {
  return typeof value === 'string' &&
    LANGUAGE_PHRASE_REQUEST_ID_PATTERN.test(value)
    ? value
    : 'unknown';
}

export function createLanguagePhraseRequestId() {
  const randomUuid = globalThis.crypto?.randomUUID?.();

  if (randomUuid) return randomUuid.replaceAll('-', '').slice(0, 12);

  languagePhraseRequestSequence += 1;
  return `${Date.now().toString(36)}-${languagePhraseRequestSequence.toString(36)}`;
}

function normalizeUnicode(value) {
  return typeof value === 'string' ? value.normalize('NFC') : '';
}

function getMeasureId(measure, measureIndex) {
  return typeof measure?.id === 'string' && measure.id
    ? measure.id
    : `measure-index-${measureIndex}`;
}

function getLyricLineIndexes(measure) {
  const lines = Array.isArray(measure?.lyricGeometry?.lines)
    ? measure.lyricGeometry.lines
    : [];

  return lines
    .map((line) => line?.lineIndex)
    .filter(Number.isInteger)
    .sort((left, right) => left - right);
}

function getSourceGeometry(measure) {
  const geometry = measure?.lyricGeometry;

  if (!geometry || !Array.isArray(geometry.lines)) return null;

  return {
    hardBoundaryBefore: geometry.hardBoundaryBefore === true,
    lines: geometry.lines.map((line) => ({
      baselineY: Number(line?.baselineY) || 0,
      boundaryGapCount: Number(line?.boundaryGapCount) || 0,
      boundaryGapMad: Number(line?.boundaryGapMad) || 0,
      boundaryGapMedian: Number(line?.boundaryGapMedian) || 0,
      endX: Number(line?.endX) || 0,
      lineIndex: Number.isInteger(line?.lineIndex) ? line.lineIndex : -1,
      referenceGap: Number(line?.referenceGap) || 0,
      startX: Number(line?.startX) || 0,
    })),
    page: Number(geometry.page) || Number(measure?.page) || 1,
    systemIndex: Number.isInteger(geometry.systemIndex)
      ? geometry.systemIndex
      : -1,
  };
}

function hashString(value) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createLanguagePhraseSourceFingerprint(measures) {
  const source = (Array.isArray(measures) ? measures : []).map(
    (measure, measureIndex) => ({
      geometry: getSourceGeometry(measure),
      id: getMeasureId(measure, measureIndex),
      lyric: typeof measure?.lyric === 'string' ? measure.lyric : '',
    }),
  );

  return hashString(JSON.stringify(source));
}

export function createLanguagePhraseSourceKey(measures) {
  return `${LANGUAGE_PHRASE_SOURCE_KEY_PREFIX}-${createLanguagePhraseSourceFingerprint(
    measures,
  )}`;
}

function createCandidatePhraseIndexes(measures) {
  const indexes = new Map();

  createVocalPhrases(measures).forEach((phrase, phraseIndex) => {
    for (
      let measureIndex = phrase.startMeasureIndex;
      measureIndex <= phrase.endMeasureIndex;
      measureIndex += 1
    ) {
      if (getMeaningfulLyric(measures[measureIndex])) {
        indexes.set(measureIndex, phraseIndex);
      }
    }
  });

  return indexes;
}

function createAnalysisEntry(measure, measureIndex, candidatePhraseIndexes) {
  const lyric = getMeaningfulLyric(measure);

  if (!lyric) return null;

  const analysisText = normalizeVocalExtractionArtifacts(lyric);
  const lyricLineIndexes = getLyricLineIndexes(measure);

  return {
    analysisText,
    boundaryBefore: 'none',
    boundaryReason: '',
    candidatePhraseIndex: candidatePhraseIndexes.get(measureIndex) ?? -1,
    lyricLaneKey: lyricLineIndexes.join(','),
    lyricLineIndexes,
    measureId: getMeasureId(measure, measureIndex),
    measureIndex,
    measureNumber: measureIndex + 1,
    page: Number(measure?.page) || 1,
    rawLyric: normalizeUnicode(lyric),
    sourceGeometry: getSourceGeometry(measure),
    systemIndex: Number.isInteger(measure?.lyricGeometry?.systemIndex)
      ? measure.lyricGeometry.systemIndex
      : -1,
    // `text` remains as a compatibility alias for existing providers/tests.
    text: analysisText,
  };
}

function hasMultipleLyricLanes(entry) {
  return entry.analysisText.includes('\n') || entry.lyricLineIndexes.length > 1;
}

function getSoftBoundaryReason(previousEntry, currentEntry) {
  if (previousEntry.candidatePhraseIndex !== currentEntry.candidatePhraseIndex) {
    return 'geometry-phrase';
  }

  if (
    previousEntry.page !== currentEntry.page ||
    previousEntry.systemIndex !== currentEntry.systemIndex
  ) {
    return 'score-system';
  }

  return '';
}

function getEntriesCharacterCount(entries) {
  return entries.reduce(
    (total, entry) =>
      total + getNonWhitespaceCharacterCount(entry.analysisText),
    0,
  );
}

function createContextWindows(
  segments,
  maxContextCharacters,
  overlapMeasureCount,
) {
  const windows = [];

  segments.forEach((segment, segmentIndex) => {
    const segmentCharacterCount = getEntriesCharacterCount(segment.entries);

    if (
      segment.mode !== 'ai' ||
      segmentCharacterCount <= maxContextCharacters
    ) {
      windows.push({
        characterCount: segmentCharacterCount,
        chunkIndex: 0,
        entries: segment.entries,
        isChunked: false,
        mode: segment.mode,
        segmentIndex,
      });
      return;
    }

    let start = 0;
    let chunkIndex = 0;

    while (start < segment.entries.length) {
      let end = start;
      let characterCount = 0;

      while (end < segment.entries.length) {
        const entryCharacterCount = getNonWhitespaceCharacterCount(
          segment.entries[end].analysisText,
        );

        if (
          end > start &&
          characterCount + entryCharacterCount > maxContextCharacters
        ) {
          break;
        }

        characterCount += entryCharacterCount;
        end += 1;
      }

      windows.push({
        characterCount,
        chunkIndex,
        entries: segment.entries.slice(start, end),
        isChunked: true,
        mode: 'ai',
        segmentIndex,
      });

      if (end >= segment.entries.length) break;
      start = Math.max(start + 1, end - overlapMeasureCount);
      chunkIndex += 1;
    }
  });

  return windows.map((window, windowIndex) => ({
    ...window,
    endCharOffset: window.entries.at(-1)?.continuousCharEnd || 0,
    startCharOffset: window.entries[0]?.continuousCharStart || 0,
    windowIndex,
  }));
}

export function createLanguagePhraseAnalysisPlan(
  measures,
  {
    maxContextCharacters = DEFAULT_LANGUAGE_PHRASE_MAX_CONTEXT_CHARACTERS,
    overlapMeasureCount = DEFAULT_LANGUAGE_PHRASE_WINDOW_OVERLAP_MEASURES,
  } = {},
) {
  const safeMeasures = Array.isArray(measures) ? measures : [];
  const candidatePhraseIndexes = createCandidatePhraseIndexes(safeMeasures);
  const safeMaxContextCharacters =
    Number.isInteger(maxContextCharacters) && maxContextCharacters > 0
      ? maxContextCharacters
      : DEFAULT_LANGUAGE_PHRASE_MAX_CONTEXT_CHARACTERS;
  const safeOverlapMeasureCount =
    Number.isInteger(overlapMeasureCount) && overlapMeasureCount >= 1
      ? overlapMeasureCount
      : DEFAULT_LANGUAGE_PHRASE_WINDOW_OVERLAP_MEASURES;
  const segments = [];
  let currentEntries = [];
  let nextSegmentBoundaryReason = 'segment-start';

  function flushSegment(mode = 'ai') {
    if (currentEntries.length === 0) return;

    segments.push({ entries: currentEntries, mode });
    currentEntries = [];
  }

  safeMeasures.forEach((measure, measureIndex) => {
    const entry = createAnalysisEntry(
      measure,
      measureIndex,
      candidatePhraseIndexes,
    );

    if (!entry) {
      flushSegment();
      nextSegmentBoundaryReason = 'lyric-free-gap';
      return;
    }

    if (hasMultipleLyricLanes(entry)) {
      flushSegment();
      segments.push({
        entries: [
          {
            ...entry,
            boundaryBefore: 'hard',
            boundaryReason: 'protected-multiline',
          },
        ],
        mode: 'protected-multiline',
      });
      nextSegmentBoundaryReason = 'protected-multiline';
      return;
    }

    const previousEntry = currentEntries.at(-1) || null;

    if (
      previousEntry &&
      isHardVocalPhraseBoundary(
        safeMeasures[previousEntry.measureIndex],
        measure,
      )
    ) {
      flushSegment();
      nextSegmentBoundaryReason = 'hard-geometry-boundary';
    }

    const currentPreviousEntry = currentEntries.at(-1) || null;
    const softBoundaryReason = currentPreviousEntry
      ? getSoftBoundaryReason(currentPreviousEntry, entry)
      : '';

    currentEntries.push({
      ...entry,
      boundaryBefore: currentPreviousEntry
        ? softBoundaryReason
          ? 'soft'
          : 'none'
        : 'hard',
      boundaryReason: currentPreviousEntry
        ? softBoundaryReason
        : nextSegmentBoundaryReason,
    });
    nextSegmentBoundaryReason = 'segment-start';
  });

  flushSegment();

  let continuousCharOffset = 0;

  segments.forEach((segment) => {
    segment.entries = segment.entries.map((entry) => {
      const continuousCharStart = continuousCharOffset;

      continuousCharOffset += getNonWhitespaceCharacterCount(
        entry.analysisText,
      );

      return {
        ...entry,
        continuousCharEnd: continuousCharOffset,
        continuousCharStart,
      };
    });
  });

  return {
    candidatePhraseCount: createVocalPhrases(safeMeasures).length,
    segments,
    sourceKey: createLanguagePhraseSourceKey(safeMeasures),
    windows: createContextWindows(
      segments,
      safeMaxContextCharacters,
      safeOverlapMeasureCount,
    ),
  };
}

function withoutWhitespace(value) {
  return normalizeUnicode(value).replace(/\s/gu, '');
}

function getCharacterCount(value) {
  return Array.from(normalizeUnicode(value)).length;
}

function getNonWhitespaceCharacterCount(value) {
  return Array.from(withoutWhitespace(value)).length;
}

export function createContinuousAnalysisSource(entries) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const sourceCharMap = [];
  let fallbackContinuousOffset = 0;

  safeEntries.forEach((entry) => {
    const entryStart = Number.isInteger(entry?.continuousCharStart)
      ? entry.continuousCharStart
      : fallbackContinuousOffset;
    let retainedCharacterOffset = 0;

    Array.from(normalizeUnicode(entry?.analysisText)).forEach(
      (character, analysisCharIndex) => {
        if (/\s/u.test(character)) return;

        sourceCharMap.push({
          analysisCharIndex,
          character,
          continuousCharIndex: entryStart + retainedCharacterOffset,
          measureId: entry.measureId,
          measureIndex: entry.measureIndex,
        });
        retainedCharacterOffset += 1;
      },
    );
    fallbackContinuousOffset = entryStart + retainedCharacterOffset;
  });

  return {
    canonicalText: sourceCharMap.map((item) => item.character).join(''),
    continuousAnalysisText: getEntriesAnalysisText(safeEntries),
    endCharOffset: sourceCharMap.at(-1)?.continuousCharIndex + 1 || 0,
    sourceCharMap,
    startCharOffset: sourceCharMap[0]?.continuousCharIndex || 0,
  };
}

function createSourceSpans(sourceCharMap, startCharOffset, endCharOffset) {
  const selectedCharacters = sourceCharMap.filter(
    (item) =>
      item.continuousCharIndex >= startCharOffset &&
      item.continuousCharIndex < endCharOffset,
  );
  const sourceSpans = [];

  selectedCharacters.forEach((item) => {
    const previousSpan = sourceSpans.at(-1);

    if (previousSpan?.measureId === item.measureId) {
      previousSpan.analysisEnd = item.analysisCharIndex + 1;
      return;
    }

    sourceSpans.push({
      analysisEnd: item.analysisCharIndex + 1,
      analysisStart: item.analysisCharIndex,
      measureId: item.measureId,
      measureIndex: item.measureIndex,
    });
  });

  return sourceSpans;
}

function createSourceRangeMetadata(
  entries,
  startCharOffset,
  endCharOffset,
) {
  const source = createContinuousAnalysisSource(entries);
  const sourceSpans = createSourceSpans(
    source.sourceCharMap,
    startCharOffset,
    endCharOffset,
  );
  const expectedCharacterCount = endCharOffset - startCharOffset;
  const actualCharacterCount = source.sourceCharMap.filter(
    (item) =>
      item.continuousCharIndex >= startCharOffset &&
      item.continuousCharIndex < endCharOffset,
  ).length;

  if (
    expectedCharacterCount <= 0 ||
    actualCharacterCount !== expectedCharacterCount ||
    sourceSpans.length === 0
  ) {
    return null;
  }

  return {
    endCharOffset,
    endMeasureIndex: sourceSpans.at(-1).measureIndex,
    measureIds: [...new Set(sourceSpans.map((span) => span.measureId))],
    sourceSpans,
    startCharOffset,
    startMeasureIndex: sourceSpans[0].measureIndex,
  };
}

function createDisplayCueFromRange(
  entries,
  text,
  startCharOffset,
  endCharOffset,
) {
  const sourceRange = createSourceRangeMetadata(
    entries,
    startCharOffset,
    endCharOffset,
  );

  return sourceRange
    ? {
        ...sourceRange,
        text: normalizeUnicode(text),
      }
    : null;
}

export function createLanguagePhraseBoundaryMetadata(entries) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  let continuousTextOffset = 0;
  let normalizedTextOffset = 0;

  return safeEntries.slice(1).map((entry, index) => {
    const previousEntry = safeEntries[index];

    continuousTextOffset += getCharacterCount(previousEntry.analysisText);
    normalizedTextOffset += getNonWhitespaceCharacterCount(
      previousEntry.analysisText,
    );

    return {
      afterMeasureId: previousEntry.measureId,
      beforeMeasureId: entry.measureId,
      boundaryBefore: entry.boundaryBefore,
      boundaryReason: entry.boundaryReason,
      continuousTextOffset,
      leftAnalysisText: previousEntry.analysisText,
      normalizedTextOffset,
      rightAnalysisText: entry.analysisText,
    };
  });
}

const MELISMA_EDGE_PATTERN =
  /(?:[\uFE63\uFF0D]\s*$|^\s*[\uFE63\uFF0D])/u;

function getBoundaryGeometryMetrics(previousEntry, currentEntry) {
  const previousGeometry = previousEntry?.sourceGeometry;
  const currentGeometry = currentEntry?.sourceGeometry;

  if (!previousGeometry || !currentGeometry) return null;

  const sameSurface =
    previousGeometry.page === currentGeometry.page &&
    previousGeometry.systemIndex === currentGeometry.systemIndex;

  if (!sameSurface) {
    return {
      kind: 'score-system-transition',
    };
  }

  const gapMetrics = currentGeometry.lines.flatMap((currentLine) => {
    const previousLine = previousGeometry.lines.find(
      (line) => line.lineIndex === currentLine.lineIndex,
    );

    if (!previousLine) return [];

    const gap = Number(currentLine.startX) - Number(previousLine.endX);
    const referenceGap = Math.max(
      Number(previousLine.referenceGap) || 0,
      Number(currentLine.referenceGap) || 0,
    );

    if (!(gap > 0) || !(referenceGap > 0)) return [];

    return [{
      gap,
      lineIndex: currentLine.lineIndex,
      referenceGap,
      referenceRatio: gap / referenceGap,
    }];
  });

  if (gapMetrics.length > 0) {
    return {
      kind: 'horizontal-lyric-gap',
      metrics: gapMetrics.sort(
        (left, right) => right.referenceRatio - left.referenceRatio,
      )[0],
    };
  }

  return {
    kind: 'lyric-baseline-transition',
  };
}

export function createLanguagePhraseBreathCandidates(entries) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const boundaries = createLanguagePhraseBoundaryMetadata(safeEntries);

  return boundaries.flatMap((boundary, index) => {
    const previousEntry = safeEntries[index];
    const currentEntry = safeEntries[index + 1];
    const reasons = [];
    let geometryMetrics = null;

    if (
      boundary.boundaryReason === 'geometry-phrase' ||
      boundary.boundaryReason === 'score-system'
    ) {
      geometryMetrics = getBoundaryGeometryMetrics(
        previousEntry,
        currentEntry,
      );

      if (geometryMetrics) reasons.push(geometryMetrics.kind);
    }

    if (
      MELISMA_EDGE_PATTERN.test(previousEntry.rawLyric) ||
      MELISMA_EDGE_PATTERN.test(currentEntry.rawLyric)
    ) {
      reasons.push('melisma-extension-marker');
    }

    if (reasons.length === 0) return [];

    return [
      {
        afterMeasureId: boundary.afterMeasureId,
        afterMeasureIndex: previousEntry.measureIndex,
        afterMeasureNumber: previousEntry.measureNumber,
        beforeMeasureId: boundary.beforeMeasureId,
        beforeMeasureIndex: currentEntry.measureIndex,
        beforeMeasureNumber: currentEntry.measureNumber,
        continuousCharOffset: currentEntry.continuousCharStart,
        leftAnalysisText: previousEntry.analysisText,
        metrics: geometryMetrics?.metrics || null,
        normalizedTextOffset: boundary.normalizedTextOffset,
        reasons,
        rightAnalysisText: currentEntry.analysisText,
        strength: reasons.some(
          (reason) =>
            reason === 'horizontal-lyric-gap' ||
            reason === 'melisma-extension-marker',
        )
          ? 'strong'
          : 'medium',
      },
    ];
  });
}

function getGroupIds(group) {
  return Array.isArray(group?.measureIds) ? group.measureIds : [];
}

function getMeasureIdMismatchReason(expectedIds, returnedIds, prefix = '') {
  const expectedCounts = new Map();
  const returnedCounts = new Map();

  expectedIds.forEach((measureId) =>
    expectedCounts.set(measureId, (expectedCounts.get(measureId) || 0) + 1),
  );
  returnedIds.forEach((measureId) =>
    returnedCounts.set(measureId, (returnedCounts.get(measureId) || 0) + 1),
  );

  if (
    [...returnedCounts].some(
      ([measureId, count]) => count > (expectedCounts.get(measureId) || 0),
    )
  ) {
    return `${prefix}duplicated-measure`;
  }

  if (
    [...expectedCounts].some(
      ([measureId, count]) => count > (returnedCounts.get(measureId) || 0),
    )
  ) {
    return `${prefix}missing-measure`;
  }

  return `${prefix}reordered-measure`;
}

function invalidResult(error, code = 'validation', reason = code) {
  return { code, error, phrases: null, reason };
}

function getEntriesAnalysisText(entries) {
  return entries.map((entry) => entry.analysisText).join('');
}

function getEntriesRawText(entries) {
  return entries.map((entry) => entry.rawLyric).join('');
}

function hasHardBoundaryInside(groupEntries) {
  return groupEntries
    .slice(1)
    .some((entry) => entry.boundaryBefore === 'hard');
}

function mixesKnownLyricLanes(groupEntries) {
  const knownLaneKeys = new Set(
    groupEntries.map((entry) => entry.lyricLaneKey).filter(Boolean),
  );

  return knownLaneKeys.size > 1;
}

function createSingleDisplayCue(groupEntries, displayText) {
  const source = createContinuousAnalysisSource(groupEntries);

  return createDisplayCueFromRange(
    groupEntries,
    displayText,
    source.startCharOffset,
    source.endCharOffset,
  );
}

const NATURAL_CUE_END_PUNCTUATION_PATTERN = /[,.!?;:…，。！？；：)]/u;
const HANGUL_SYLLABLE_PATTERN = /[가-힣]/u;

function getNaturalDisplayBreaks(displayText) {
  const breaks = new Map();
  let normalizedOffset = 0;
  let previousCharacter = '';
  let sawWhitespace = false;

  for (const character of Array.from(normalizeUnicode(displayText))) {
    if (/\s/u.test(character)) {
      if (normalizedOffset > 0) sawWhitespace = true;
      continue;
    }

    if (normalizedOffset > 0) {
      if (sawWhitespace) {
        breaks.set(normalizedOffset, 'language-whitespace');
      } else if (
        NATURAL_CUE_END_PUNCTUATION_PATTERN.test(previousCharacter)
      ) {
        breaks.set(normalizedOffset, 'clause-punctuation');
      }
    }

    previousCharacter = character;
    normalizedOffset += 1;
    sawWhitespace = false;
  }

  return breaks;
}

function getTokenContinuationReason(displayText, normalizedTextOffset) {
  const characters = Array.from(withoutWhitespace(displayText));
  const leftCharacter = characters[normalizedTextOffset - 1] || '';
  const rightCharacter = characters[normalizedTextOffset] || '';

  return HANGUL_SYLLABLE_PATTERN.test(leftCharacter) &&
    HANGUL_SYLLABLE_PATTERN.test(rightCharacter)
    ? 'korean-token-continuation'
    : 'token-continuation';
}

function createCueBoundaryGuidance(groupEntries, displayText) {
  const naturalBreaks = getNaturalDisplayBreaks(displayText);

  return createLanguagePhraseBoundaryMetadata(groupEntries).map((boundary) => {
    if (boundary.boundaryBefore === 'hard') {
      return {
        ...boundary,
        canBreak: true,
        naturalBreakReason: 'hard-boundary',
      };
    }

    const naturalBreakReason = naturalBreaks.get(
      boundary.normalizedTextOffset,
    );

    return {
      ...boundary,
      canBreak: Boolean(naturalBreakReason),
      naturalBreakReason:
        naturalBreakReason ||
        getTokenContinuationReason(
          displayText,
          boundary.normalizedTextOffset,
        ),
    };
  });
}

function joinCueTexts(leftText, rightText) {
  return `${normalizeUnicode(leftText).trimEnd()}${normalizeUnicode(
    rightText,
  ).trimStart()}`;
}

function sliceDisplayTextByNormalizedRange(displayText, startOffset, endOffset) {
  const characters = Array.from(normalizeUnicode(displayText));
  let normalizedOffset = 0;
  let startCharacterIndex = characters.length;
  let endCharacterIndex = characters.length;

  for (let index = 0; index < characters.length; index += 1) {
    if (/\s/u.test(characters[index])) continue;

    if (normalizedOffset === startOffset) startCharacterIndex = index;
    normalizedOffset += 1;

    if (normalizedOffset === endOffset) {
      endCharacterIndex = index + 1;
      break;
    }
  }

  return characters.slice(startCharacterIndex, endCharacterIndex).join('').trim();
}

function getContinuousDisplayTextForEntries(
  allEntries,
  selectedEntries,
  continuousDisplayText,
) {
  const firstIndex = allEntries.findIndex(
    (entry) => entry.measureId === selectedEntries[0]?.measureId,
  );

  if (firstIndex < 0 || selectedEntries.length === 0) return '';

  const startOffset = allEntries
    .slice(0, firstIndex)
    .reduce(
      (total, entry) =>
        total + getNonWhitespaceCharacterCount(entry.analysisText),
      0,
    );
  const selectedCharacterCount = selectedEntries.reduce(
    (total, entry) =>
      total + getNonWhitespaceCharacterCount(entry.analysisText),
    0,
  );

  return sliceDisplayTextByNormalizedRange(
    continuousDisplayText,
    startOffset,
    startOffset + selectedCharacterCount,
  );
}

function applyGrammarFirstCueBoundaries(groupEntries, displayText, cues) {
  const guidance = createCueBoundaryGuidance(groupEntries, displayText);
  const groupSource = createContinuousAnalysisSource(groupEntries);
  const guidanceByCharOffset = new Map(
    guidance.map((boundary) => [
      groupSource.startCharOffset + boundary.normalizedTextOffset,
      boundary,
    ]),
  );
  const correctedCues = [];
  const corrections = [];

  cues.forEach((cue) => {
    const previousCue = correctedCues.at(-1);
    const boundary = previousCue
      ? guidanceByCharOffset.get(cue.startCharOffset)
      : null;

    if (previousCue && boundary && !boundary.canBreak) {
      const mergedText = sliceDisplayTextByNormalizedRange(
        displayText,
        previousCue.startCharOffset - groupSource.startCharOffset,
        cue.endCharOffset - groupSource.startCharOffset,
      );

      correctedCues[correctedCues.length - 1] = createDisplayCueFromRange(
        groupEntries,
        mergedText,
        previousCue.startCharOffset,
        cue.endCharOffset,
      );
      corrections.push({
        afterMeasureId: boundary.afterMeasureId,
        beforeMeasureId: boundary.beforeMeasureId,
        message: '한국어 단어 또는 어미 내부의 Display Cue 경계를 합쳤습니다.',
        normalizedTextOffset: boundary.normalizedTextOffset,
        reason: boundary.naturalBreakReason,
      });
      return;
    }

    correctedCues.push(cue);
  });

  const cueStartOffsets = new Set(
    correctedCues.slice(1).map((cue) => cue.startCharOffset),
  );
  const boundaryDecisions = guidance.map((boundary) => {
    const shouldBreak = cueStartOffsets.has(
      groupSource.startCharOffset + boundary.normalizedTextOffset,
    );

    return {
      afterMeasureId: boundary.afterMeasureId,
      beforeMeasureId: boundary.beforeMeasureId,
      decision: shouldBreak ? 'BREAK' : 'NO_BREAK',
      normalizedTextOffset: boundary.normalizedTextOffset,
      reason: shouldBreak
        ? boundary.naturalBreakReason
        : boundary.canBreak
          ? 'grammar-context-preserved'
          : boundary.naturalBreakReason,
    };
  });

  return { boundaryDecisions, corrections, cues: correctedCues };
}

function applyGrammarFirstLanguagePhraseBoundaries(
  entries,
  continuousDisplayText,
  phrases,
) {
  const guidance = createCueBoundaryGuidance(entries, continuousDisplayText);
  const guidanceByNextMeasureId = new Map(
    guidance.map((boundary) => [boundary.beforeMeasureId, boundary]),
  );
  const correctedPhrases = [];
  const corrections = [];

  phrases.forEach((phrase) => {
    const previousPhrase = correctedPhrases.at(-1);
    const boundary = previousPhrase
      ? guidanceByNextMeasureId.get(phrase.measureIds[0])
      : null;

    if (previousPhrase && boundary && !boundary.canBreak) {
      const groupEntries = entries.filter(
        (entry) =>
          entry.measureIndex >= previousPhrase.startMeasureIndex &&
          entry.measureIndex <= phrase.endMeasureIndex,
      );
      const displayText = joinCueTexts(
        previousPhrase.displayText,
        phrase.displayText,
      );
      const cueResult = applyGrammarFirstCueBoundaries(
        groupEntries,
        displayText,
        [...previousPhrase.displayCues, ...phrase.displayCues],
      );
      const rawText = getEntriesRawText(groupEntries);
      const source = createContinuousAnalysisSource(groupEntries);
      const sourceRange = createSourceRangeMetadata(
        groupEntries,
        source.startCharOffset,
        source.endCharOffset,
      );

      correctedPhrases[correctedPhrases.length - 1] = {
        analysisText: getEntriesAnalysisText(groupEntries),
        displayCues: cueResult.cues,
        displayText,
        ...sourceRange,
        rawText,
        text: rawText,
      };
      corrections.push({
        afterMeasureId: boundary.afterMeasureId,
        beforeMeasureId: boundary.beforeMeasureId,
        message: '한국어 단어 또는 어미 내부의 Language Phrase 경계를 합쳤습니다.',
        normalizedTextOffset: boundary.normalizedTextOffset,
        reason: boundary.naturalBreakReason,
      });
      return;
    }

    correctedPhrases.push(phrase);
  });

  return { corrections, phrases: correctedPhrases };
}

function mergeGrammarConnectedResultGroups(
  entries,
  groups,
  continuousDisplayText,
) {
  const guidance = createCueBoundaryGuidance(entries, continuousDisplayText);
  const guidanceByNextMeasureId = new Map(
    guidance.map((boundary) => [boundary.beforeMeasureId, boundary]),
  );
  const mergedGroups = [];
  const corrections = [];

  groups.forEach((group) => {
    const previousGroup = mergedGroups.at(-1);
    const measureIds = getGroupIds(group);
    const boundary = previousGroup
      ? guidanceByNextMeasureId.get(measureIds[0])
      : null;

    if (previousGroup && boundary && !boundary.canBreak) {
      const mergedMeasureIds = [
        ...getGroupIds(previousGroup),
        ...measureIds,
      ];
      const mergedEntries = entries.filter((entry) =>
        mergedMeasureIds.includes(entry.measureId),
      );
      const mergedDisplayText = getContinuousDisplayTextForEntries(
        entries,
        mergedEntries,
        continuousDisplayText,
      );

      mergedGroups[mergedGroups.length - 1] = {
        displayCues: [
          ...(Array.isArray(previousGroup.displayCues)
            ? previousGroup.displayCues
            : []),
          ...(Array.isArray(group.displayCues) ? group.displayCues : []),
        ],
        displayText: mergedDisplayText,
        endMeasureIndex: mergedEntries.at(-1).measureIndex,
        measureIds: mergedMeasureIds,
        rawText: getEntriesAnalysisText(mergedEntries),
        startMeasureIndex: mergedEntries[0].measureIndex,
      };
      corrections.push({
        afterMeasureId: boundary.afterMeasureId,
        beforeMeasureId: boundary.beforeMeasureId,
        message: '한국어 단어 또는 어미 내부의 AI Phrase 경계를 합쳤습니다.',
        normalizedTextOffset: boundary.normalizedTextOffset,
        reason: boundary.naturalBreakReason,
      });
      return;
    }

    mergedGroups.push(group);
  });

  return { corrections, groups: mergedGroups };
}

function validateDisplayCues(groupEntries, displayCues, displayText) {
  if (!Array.isArray(displayCues) || displayCues.length === 0) {
    return {
      error: 'AI 응답에 Display Cue가 없습니다.',
      cues: null,
      reason: 'cue-missing-character',
    };
  }

  const source = createContinuousAnalysisSource(groupEntries);
  const concatenatedCueText = displayCues
    .map((cue) => (typeof cue?.text === 'string' ? cue.text : ''))
    .join('');

  if (withoutWhitespace(concatenatedCueText) !== source.canonicalText) {
    return {
      error: 'Display Cue가 연속 원본 문자를 정확히 한 번 사용하지 않았습니다.',
      cues: null,
      reason: 'cue-character-mismatch',
    };
  }

  let charOffset = source.startCharOffset;
  const cues = [];
  const corrections = [];

  for (const cue of displayCues) {
    const cueCharacterCount = getNonWhitespaceCharacterCount(cue?.text);

    if (
      typeof cue.text !== 'string' ||
      cueCharacterCount <= 0
    ) {
      return {
        error: 'Display Cue 형식이 올바르지 않습니다.',
        cues: null,
        reason: 'cue-invalid-format',
      };
    }

    const endCharOffset = charOffset + cueCharacterCount;
    const sourceText = source.sourceCharMap
      .filter(
        (item) =>
          item.continuousCharIndex >= charOffset &&
          item.continuousCharIndex < endCharOffset,
      )
      .map((item) => item.character)
      .join('');

    if (sourceText !== withoutWhitespace(cue.text)) {
      return {
        error: 'Display Cue가 원본 가사의 문자 순서 또는 내용을 변경했습니다.',
        cues: null,
        reason: 'cue-character-mismatch',
      };
    }

    const normalizedCue = createDisplayCueFromRange(
      groupEntries,
      cue.text,
      charOffset,
      endCharOffset,
    );

    if (!normalizedCue) {
      return {
        error: 'Display Cue의 원본 문자 범위를 복원하지 못했습니다.',
        cues: null,
        reason: 'cue-invalid-range',
      };
    }

    if (
      Number.isInteger(cue.startMeasureIndex) &&
      Number.isInteger(cue.endMeasureIndex) &&
      (cue.startMeasureIndex !== normalizedCue.startMeasureIndex ||
        cue.endMeasureIndex !== normalizedCue.endMeasureIndex)
    ) {
      corrections.push({
        expectedEndMeasureIndex: normalizedCue.endMeasureIndex,
        expectedStartMeasureIndex: normalizedCue.startMeasureIndex,
        providedEndMeasureIndex: cue.endMeasureIndex,
        providedStartMeasureIndex: cue.startMeasureIndex,
        reason: 'cue-invalid-range',
      });
    }

    cues.push(normalizedCue);
    charOffset = endCharOffset;
  }

  const grammarResult = applyGrammarFirstCueBoundaries(
    groupEntries,
    displayText,
    cues,
  );

  return {
    boundaryDecisions: grammarResult.boundaryDecisions,
    corrections: [...corrections, ...grammarResult.corrections],
    error: '',
    cues: grammarResult.cues,
    reason: '',
  };
}

export function validateLanguagePhraseWindowResult(entries, result) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return invalidResult('분석할 Measure가 없습니다.', 'validation', 'missing-measure');
  }

  if (!result || !Array.isArray(result.groups) || result.groups.length === 0) {
    return invalidResult(
      'AI 응답에 Phrase 그룹이 없습니다.',
      'validation',
      'missing-measure',
    );
  }

  const expectedIds = entries.map((entry) => entry.measureId);
  const returnedIds = result.groups.flatMap(getGroupIds);
  const continuousDisplayText =
    typeof result.continuousDisplayText === 'string'
      ? normalizeUnicode(result.continuousDisplayText)
      : result.groups.map((group) => group?.displayText || '').join(' ');

  if (
    returnedIds.length !== expectedIds.length ||
    returnedIds.some((measureId, index) => measureId !== expectedIds[index])
  ) {
    return invalidResult(
      'AI 응답의 Measure가 누락, 중복 또는 재정렬되었습니다.',
      'validation',
      getMeasureIdMismatchReason(expectedIds, returnedIds),
    );
  }

  if (
    withoutWhitespace(continuousDisplayText) !==
    withoutWhitespace(getEntriesAnalysisText(entries))
  ) {
    return invalidResult(
      'AI가 연속 표시 가사의 문자를 변경했습니다.',
      'validation',
      'character-mismatch',
    );
  }

  const grammarConnectedResult = mergeGrammarConnectedResultGroups(
    entries,
    result.groups,
    continuousDisplayText,
  );
  let entryOffset = 0;
  const phrases = [];
  const cueBoundaryDecisions = [];
  const cueCorrections = [...grammarConnectedResult.corrections];
  const cueFallbacks = [];

  for (const group of grammarConnectedResult.groups) {
    const measureIds = getGroupIds(group);

    if (
      measureIds.length === 0 ||
      typeof group.rawText !== 'string' ||
      typeof group.displayText !== 'string' ||
      !Number.isInteger(group.startMeasureIndex) ||
      !Number.isInteger(group.endMeasureIndex)
    ) {
      return invalidResult(
        'AI Phrase 형식이 올바르지 않습니다.',
        'validation',
        'invalid-format',
      );
    }

    const groupEntries = entries.slice(
      entryOffset,
      entryOffset + measureIds.length,
    );
    const expectedAnalysisText = getEntriesAnalysisText(groupEntries);
    const expectedStartIndex = groupEntries[0].measureIndex;
    const expectedEndIndex = groupEntries.at(-1).measureIndex;

    if (
      group.startMeasureIndex !== expectedStartIndex ||
      group.endMeasureIndex !== expectedEndIndex
    ) {
      return invalidResult(
        'AI Phrase의 Measure 범위가 올바르지 않습니다.',
        'validation',
        'invalid-range',
      );
    }

    if (hasHardBoundaryInside(groupEntries)) {
      return invalidResult(
        'AI Phrase가 확정 경계를 통과했습니다.',
        'boundary',
        'hard-boundary-cross',
      );
    }

    if (mixesKnownLyricLanes(groupEntries)) {
      return invalidResult(
        'AI Phrase가 서로 다른 가사 lane을 혼합했습니다.',
        'boundary',
        'verse-lane-mismatch',
      );
    }

    if (
      withoutWhitespace(expectedAnalysisText) !==
        withoutWhitespace(group.rawText) ||
      withoutWhitespace(expectedAnalysisText) !==
        withoutWhitespace(group.displayText)
    ) {
      return invalidResult(
        'AI가 허용된 extraction 정리 범위 밖의 문자를 변경했습니다.',
        'validation',
        'character-mismatch',
      );
    }

    const rawText = getEntriesRawText(groupEntries);
    const cueValidation = validateDisplayCues(
      groupEntries,
      group.displayCues,
      group.displayText,
    );
    const displayCues = cueValidation.cues || [
      createSingleDisplayCue(groupEntries, group.displayText),
    ];

    cueValidation.corrections?.forEach((correction) => {
      cueCorrections.push({
        endMeasureIndex: expectedEndIndex,
        message: 'Display Cue 범위를 Measure ID 기준으로 정규화했습니다.',
        startMeasureIndex: expectedStartIndex,
        ...correction,
      });
    });
    cueValidation.boundaryDecisions?.forEach((decision) => {
      cueBoundaryDecisions.push({
        endMeasureIndex: expectedEndIndex,
        startMeasureIndex: expectedStartIndex,
        ...decision,
      });
    });

    if (!cueValidation.cues) {
      cueFallbacks.push({
        endMeasureIndex: expectedEndIndex,
        message: cueValidation.error,
        reason: cueValidation.reason,
        startMeasureIndex: expectedStartIndex,
      });
    }

    const phraseSource = createContinuousAnalysisSource(groupEntries);
    const phraseSourceRange = createSourceRangeMetadata(
      groupEntries,
      phraseSource.startCharOffset,
      phraseSource.endCharOffset,
    );

    phrases.push({
      analysisText: expectedAnalysisText,
      displayCues,
      displayText: normalizeUnicode(group.displayText),
      ...phraseSourceRange,
      rawText,
      text: rawText,
    });
    entryOffset += measureIds.length;
  }

  const phraseBoundaryResult = applyGrammarFirstLanguagePhraseBoundaries(
    entries,
    continuousDisplayText,
    phrases,
  );

  phraseBoundaryResult.corrections.forEach((correction) => {
    cueCorrections.push(correction);
    cueBoundaryDecisions.push({
      ...correction,
      decision: 'NO_BREAK',
    });
  });

  return {
    code: '',
    cueBoundaryDecisions,
    cueCorrections,
    cueFallbacks,
    error: '',
    phrases: phraseBoundaryResult.phrases,
    reason: '',
  };
}

function createBoundaryCriticSectionId(segment, segmentIndex) {
  const source = createContinuousAnalysisSource(segment.entries);

  return `section-${segmentIndex}-${source.startCharOffset}-${source.endCharOffset}`;
}

function createBoundaryCriticPhraseId(sectionId, phrase, phraseIndex) {
  return `${sectionId}-phrase-${phraseIndex}-${phrase.startCharOffset}-${phrase.endCharOffset}`;
}

export function createBoundaryCriticSections(segments, phrasesBySegment) {
  return (Array.isArray(segments) ? segments : []).flatMap(
    (segment, segmentIndex) => {
      if (segment?.mode !== 'ai' || !Array.isArray(segment.entries)) return [];

      const phrases = Array.isArray(phrasesBySegment?.[segmentIndex])
        ? phrasesBySegment[segmentIndex]
        : [];

      if (phrases.length === 0) return [];

      const source = createContinuousAnalysisSource(segment.entries);
      const sectionId = createBoundaryCriticSectionId(segment, segmentIndex);

      return [
        {
          breathCandidates: createLanguagePhraseBreathCandidates(
            segment.entries,
          ),
          continuousAnalysisText: source.continuousAnalysisText,
          entries: segment.entries,
          phrases: phrases.map((phrase, phraseIndex) => ({
            firstPassCues: phrase.displayCues.map((cue) => cue.text),
            phrase,
            phraseId: createBoundaryCriticPhraseId(
              sectionId,
              phrase,
              phraseIndex,
            ),
          })),
          sectionId,
          segmentIndex,
        },
      ];
    },
  );
}

function countUnsafeCueBoundaries(phrase, cues) {
  const naturalBreaks = getNaturalDisplayBreaks(phrase.displayText);

  return cues.slice(0, -1).filter((cue) =>
    !naturalBreaks.has(cue.endCharOffset - phrase.startCharOffset)
  ).length;
}

function getCueRegressionReason(phrase, candidateCues) {
  const firstPassCues = Array.isArray(phrase.displayCues)
    ? phrase.displayCues
    : [];

  if (
    countUnsafeCueBoundaries(phrase, candidateCues) >
    countUnsafeCueBoundaries(phrase, firstPassCues)
  ) {
    return 'more-token-internal-boundaries';
  }

  if (firstPassCues.length > 1 && candidateCues.length === 1) {
    return 'collapsed-readable-cues';
  }

  if (
    firstPassCues.length > 0 &&
    candidateCues.length > firstPassCues.length * 2
  ) {
    return 'excessive-fragmentation';
  }

  const getSingleCharacterCueCount = (cues) => cues.filter(
    (cue) => getNonWhitespaceCharacterCount(cue.text) === 1,
  ).length;

  if (
    getSingleCharacterCueCount(candidateCues) >
    getSingleCharacterCueCount(firstPassCues)
  ) {
    return 'more-single-character-cues';
  }

  return '';
}

function haveSameCueTexts(leftCues, rightCues) {
  return (
    leftCues.length === rightCues.length &&
    leftCues.every((cue, index) => cue.text === rightCues[index]?.text)
  );
}

export function createWordBoundaryMap(spacedText) {
  const boundaries = [];
  const canonicalCharacters = [];
  let previousCharacter = '';
  let sawWhitespace = false;

  for (const character of Array.from(normalizeUnicode(spacedText || ''))) {
    if (/\s/u.test(character)) {
      if (canonicalCharacters.length > 0) sawWhitespace = true;
      continue;
    }

    if (canonicalCharacters.length > 0) {
      const isWordBoundary = sawWhitespace;
      const isPunctuationBoundary =
        NATURAL_CUE_END_PUNCTUATION_PATTERN.test(previousCharacter);

      boundaries.push({
        canBreak: isWordBoundary || isPunctuationBoundary,
        isInsideKoreanWord:
          !isWordBoundary &&
          !isPunctuationBoundary &&
          HANGUL_SYLLABLE_PATTERN.test(previousCharacter) &&
          HANGUL_SYLLABLE_PATTERN.test(character),
        leftCharacter: previousCharacter,
        offset: canonicalCharacters.length,
        reason: isWordBoundary
          ? 'language-whitespace'
          : isPunctuationBoundary
            ? 'clause-punctuation'
            : 'token-continuation',
        rightCharacter: character,
      });
    }

    canonicalCharacters.push(character);
    previousCharacter = character;
    sawWhitespace = false;
  }

  return {
    boundaries,
    canonicalText: canonicalCharacters.join(''),
    safeBoundaryOffsets: boundaries
      .filter((boundary) => boundary.canBreak)
      .map((boundary) => boundary.offset),
  };
}

function guardKoreanWordCueBoundaries({
  breathCandidates,
  originalBoundaries,
  phraseEndOffset,
  phraseStartOffset,
  sectionStartOffset,
  wordBoundaryMap,
}) {
  const boundaryByOffset = new Map(
    wordBoundaryMap.boundaries.map((boundary) => [
      sectionStartOffset + boundary.offset,
      boundary,
    ]),
  );
  const safeBoundaryOffsets = wordBoundaryMap.safeBoundaryOffsets
    .map((offset) => sectionStartOffset + offset)
    .filter(
      (offset) => offset > phraseStartOffset && offset < phraseEndOffset,
    );
  const breathOffsets = new Set(
    (Array.isArray(breathCandidates) ? breathCandidates : [])
      .map((candidate) => candidate?.continuousCharOffset)
      .filter(Number.isInteger),
  );
  const decisions = [];
  const finalBoundaries = new Set();

  originalBoundaries.forEach((originalBoundary) => {
    const boundary = boundaryByOffset.get(originalBoundary);

    if (!boundary?.isInsideKoreanWord) {
      finalBoundaries.add(originalBoundary);
      return;
    }

    const [nearestBoundary] = safeBoundaryOffsets
      .filter((candidate) => !finalBoundaries.has(candidate))
      .sort((left, right) => {
        const distanceDifference =
          Math.abs(left - originalBoundary) -
          Math.abs(right - originalBoundary);

        if (distanceDifference !== 0) return distanceDifference;

        const breathDifference =
          Number(breathOffsets.has(right)) - Number(breathOffsets.has(left));

        return breathDifference || left - right;
      });

    if (Number.isInteger(nearestBoundary)) {
      finalBoundaries.add(nearestBoundary);
      decisions.push({
        decision: 'moved',
        finalBoundary: nearestBoundary,
        originalBoundary,
        reason: 'inside-korean-word',
      });
      return;
    }

    decisions.push({
      decision: 'removed',
      finalBoundary: null,
      originalBoundary,
      reason: 'inside-korean-word-no-safe-boundary',
    });
  });

  return {
    boundaries: [...finalBoundaries]
      .filter(
        (offset) => offset > phraseStartOffset && offset < phraseEndOffset,
      )
      .sort((left, right) => left - right),
    decisions,
  };
}

function applyKoreanSpacingResult(
  sections,
  result,
  { preserveCueBoundaries = false } = {},
) {
  const safeSections = Array.isArray(sections) ? sections : [];
  const returnedSections = Array.isArray(result?.sections)
    ? result.sections
    : [];
  const returnedSectionsById = new Map();

  returnedSections.forEach((section) => {
    const matches = returnedSectionsById.get(section?.sectionId) || [];

    matches.push(section);
    returnedSectionsById.set(section?.sectionId, matches);
  });

  const details = [];
  const phrasesBySegment = [];
  let acceptedSectionCount = 0;
  let changedSectionCount = 0;
  let fallbackSectionCount = 0;

  safeSections.forEach((section) => {
    const firstPassPhrases = section.phrases.map((item) => item.phrase);
    const [returnedSection] = returnedSectionsById.get(section.sectionId) || [];
    const polishedText = returnedSection?.polishedText;
    const sectionSource = createContinuousAnalysisSource(section.entries);
    const hasValidShape =
      returnedSectionsById.get(section.sectionId)?.length === 1 &&
      typeof polishedText === 'string';
    const hasMatchingCharacters =
      hasValidShape &&
      withoutWhitespace(polishedText) === sectionSource.canonicalText;

    if (!hasValidShape || !hasMatchingCharacters) {
      phrasesBySegment[section.segmentIndex] = firstPassPhrases;
      fallbackSectionCount += 1;
      details.push({
        reason: hasValidShape
          ? 'spacing-character-mismatch'
          : 'spacing-section-shape-mismatch',
        sectionId: section.sectionId,
        status: 'fallback',
      });
      return;
    }

    const wordBoundaryMap = createWordBoundaryMap(polishedText);
    const sectionDecisions = [];
    const nextPhrases = section.phrases.map((item) => {
      const phrase = item.phrase;
      const phraseEntries = section.entries.filter(
        (entry) =>
          entry.measureIndex >= phrase.startMeasureIndex &&
          entry.measureIndex <= phrase.endMeasureIndex,
      );
      const phraseStartOffset = phrase.startCharOffset;
      const phraseEndOffset = phrase.endCharOffset;
      const originalBoundaries = phrase.displayCues
        .slice(0, -1)
        .map((cue) => cue.endCharOffset);
      const guardedBoundaries = preserveCueBoundaries
        ? { boundaries: originalBoundaries, decisions: [] }
        : guardKoreanWordCueBoundaries({
            breathCandidates: section.breathCandidates,
            originalBoundaries,
            phraseEndOffset,
            phraseStartOffset,
            sectionStartOffset: sectionSource.startCharOffset,
            wordBoundaryMap,
          });
      const cueEndOffsets = [
        ...guardedBoundaries.boundaries,
        phraseEndOffset,
      ];
      let cueStartOffset = phraseStartOffset;
      const displayCues = cueEndOffsets.map((cueEndOffset) => {
        const cueText = sliceDisplayTextByNormalizedRange(
          polishedText,
          cueStartOffset - sectionSource.startCharOffset,
          cueEndOffset - sectionSource.startCharOffset,
        );
        const cue = createDisplayCueFromRange(
          phraseEntries,
          cueText,
          cueStartOffset,
          cueEndOffset,
        );

        cueStartOffset = cueEndOffset;
        return cue;
      });
      const phraseDisplayText = sliceDisplayTextByNormalizedRange(
        polishedText,
        phraseStartOffset - sectionSource.startCharOffset,
        phraseEndOffset - sectionSource.startCharOffset,
      );

      guardedBoundaries.decisions.forEach((decision) => {
        sectionDecisions.push({
          ...decision,
          phraseId: item.phraseId,
          sectionId: section.sectionId,
        });
      });

      return displayCues.every(Boolean) && phraseDisplayText
        ? {
            ...phrase,
            displayCues,
            displayText: phraseDisplayText,
          }
        : null;
    });

    if (nextPhrases.some((phrase) => !phrase)) {
      phrasesBySegment[section.segmentIndex] = firstPassPhrases;
      fallbackSectionCount += 1;
      details.push({
        reason: 'spacing-source-span-reconstruction',
        sectionId: section.sectionId,
        status: 'fallback',
      });
      return;
    }

    const acceptedDisplayText = firstPassPhrases
      .map((phrase) => phrase.displayText)
      .join(' ');
    const didChange = polishedText !== acceptedDisplayText;

    phrasesBySegment[section.segmentIndex] = nextPhrases;
    acceptedSectionCount += 1;
    if (didChange) changedSectionCount += 1;
    details.push({
      boundaryDecisions: sectionDecisions,
      polishedText,
      sectionId: section.sectionId,
      sourceText: section.continuousAnalysisText,
      status: didChange ? 'changed' : 'unchanged',
    });
  });

  return {
    acceptedSectionCount,
    changedSectionCount,
    details,
    fallbackSectionCount,
    phrasesBySegment,
  };
}

export function applyKoreanSpacingPolishResult(sections, result) {
  return applyKoreanSpacingResult(sections, result);
}

export function applyFinalKoreanSpacingCriticResult(sections, result) {
  return applyKoreanSpacingResult(sections, result, {
    preserveCueBoundaries: true,
  });
}

export function applyBoundaryCriticResult(sections, result) {
  const safeSections = Array.isArray(sections) ? sections : [];
  const returnedSections = Array.isArray(result?.sections)
    ? result.sections
    : [];
  const returnedSectionsById = new Map();

  returnedSections.forEach((section) => {
    const matches = returnedSectionsById.get(section?.sectionId) || [];

    matches.push(section);
    returnedSectionsById.set(section?.sectionId, matches);
  });

  const details = [];
  let acceptedSectionCount = 0;
  let changedPhraseCount = 0;
  let fallbackSectionCount = 0;

  const phrasesBySegment = [];

  safeSections.forEach((section) => {
    const firstPassPhrases = section.phrases.map((item) => item.phrase);
    const [returnedSection] = returnedSectionsById.get(section.sectionId) || [];
    const returnedPhrases = Array.isArray(returnedSection?.phrases)
      ? returnedSection.phrases
      : [];
    const expectedPhraseIds = section.phrases.map((item) => item.phraseId);
    const returnedPhraseIds = returnedPhrases.map((item) => item?.phraseId);
    const hasValidSectionShape =
      returnedSectionsById.get(section.sectionId)?.length === 1 &&
      returnedPhraseIds.length === expectedPhraseIds.length &&
      returnedPhraseIds.every(
        (phraseId, index) => phraseId === expectedPhraseIds[index],
      );

    if (!hasValidSectionShape) {
      phrasesBySegment[section.segmentIndex] = firstPassPhrases;
      fallbackSectionCount += 1;
      details.push({
        reason: 'section-shape-mismatch',
        sectionId: section.sectionId,
        status: 'fallback',
      });
      return;
    }

    const sectionDetails = [];
    const candidatePhrases = section.phrases.map((item, phraseIndex) => {
      const returnedPhrase = returnedPhrases[phraseIndex];
      const cueTexts = Array.isArray(returnedPhrase?.cues)
        ? returnedPhrase.cues
        : [];
      const phraseEntries = section.entries.filter(
        (entry) =>
          entry.measureIndex >= item.phrase.startMeasureIndex &&
          entry.measureIndex <= item.phrase.endMeasureIndex,
      );
      const validation = validateDisplayCues(
        phraseEntries,
        cueTexts.map((text) => ({ text })),
        item.phrase.displayText,
      );

      if (!validation.cues) {
        sectionDetails.push({
          phraseId: item.phraseId,
          reason: validation.reason || 'cue-validation',
          sectionId: section.sectionId,
          status: 'fallback',
        });
        return item.phrase;
      }

      const regressionReason = getCueRegressionReason(
        item.phrase,
        validation.cues,
      );

      if (regressionReason) {
        sectionDetails.push({
          phraseId: item.phraseId,
          reason: regressionReason,
          sectionId: section.sectionId,
          status: 'fallback',
        });
        return item.phrase;
      }

      return {
        ...item.phrase,
        displayCues: validation.cues,
        boundaryCriticReason: returnedPhrase.reasonCategory || 'unchanged',
      };
    });

    if (sectionDetails.length > 0) {
      phrasesBySegment[section.segmentIndex] = firstPassPhrases;
      fallbackSectionCount += 1;
      details.push(...sectionDetails);
      return;
    }

    const nextPhrases = candidatePhrases.map((phrase, phraseIndex) => {
      const { boundaryCriticReason, ...nextPhrase } = phrase;
      const didChange = !haveSameCueTexts(
        firstPassPhrases[phraseIndex].displayCues,
        phrase.displayCues,
      );

      if (didChange) changedPhraseCount += 1;
      details.push({
        phraseId: section.phrases[phraseIndex].phraseId,
        reason: boundaryCriticReason,
        sectionId: section.sectionId,
        status: didChange ? 'changed' : 'unchanged',
      });
      return nextPhrase;
    });

    phrasesBySegment[section.segmentIndex] = nextPhrases;
    acceptedSectionCount += 1;
  });

  return {
    acceptedSectionCount,
    changedPhraseCount,
    details,
    fallbackSectionCount,
    phrasesBySegment,
  };
}

export function createProtectedLanguagePhrase(entry) {
  const displayText = createVocalDisplayText(entry.analysisText);
  const source = createContinuousAnalysisSource([entry]);
  const sourceRange = createSourceRangeMetadata(
    [entry],
    source.startCharOffset,
    source.endCharOffset,
  );

  return {
    analysisText: entry.analysisText,
    displayCues: [createSingleDisplayCue([entry], displayText)],
    displayText,
    ...sourceRange,
    rawText: entry.rawLyric,
    text: entry.rawLyric,
  };
}

function createFallbackPhrase(entries) {
  const rawText = entries.map((entry) => entry.rawLyric).join(' ');
  const analysisText = entries.map((entry) => entry.analysisText).join(' ');
  const displayText = createVocalDisplayText(analysisText);
  const source = createContinuousAnalysisSource(entries);
  const sourceRange = createSourceRangeMetadata(
    entries,
    source.startCharOffset,
    source.endCharOffset,
  );

  return {
    analysisText,
    displayCues: [createSingleDisplayCue(entries, displayText)],
    displayText,
    ...sourceRange,
    rawText,
    text: rawText,
  };
}

export function createFallbackLanguagePhrases(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const phrases = [];
  let currentEntries = [];
  let currentCandidatePhraseIndex = null;

  function flushPhrase() {
    if (currentEntries.length > 0) {
      phrases.push(createFallbackPhrase(currentEntries));
    }

    currentEntries = [];
    currentCandidatePhraseIndex = null;
  }

  entries.forEach((entry) => {
    const hasGeometry = entry.lyricLineIndexes.length > 0;
    const canAppend =
      hasGeometry &&
      currentEntries.length > 0 &&
      currentCandidatePhraseIndex === entry.candidatePhraseIndex;

    if (!canAppend) flushPhrase();

    currentEntries.push(entry);
    currentCandidatePhraseIndex = entry.candidatePhraseIndex;

    if (!hasGeometry) flushPhrase();
  });

  flushPhrase();
  return phrases;
}

function dropLeadingCharacters(value, count) {
  if (count <= 0) return value;

  let consumed = 0;
  let offset = 0;

  for (const character of value) {
    offset += character.length;
    if (!/\s/u.test(character)) consumed += 1;
    if (consumed >= count) return value.slice(offset);
  }

  return '';
}

function stitchDisplayText(groupEntries, fragments) {
  const orderedFragments = [...fragments].sort(
    (left, right) =>
      left.startMeasureIndex - right.startMeasureIndex ||
      right.endMeasureIndex - left.endMeasureIndex,
  );
  let displayText = '';
  let coveredEndIndex = groupEntries[0].measureIndex - 1;

  orderedFragments.forEach((fragment) => {
    if (fragment.endMeasureIndex <= coveredEndIndex) return;

    if (!displayText) {
      displayText = fragment.displayText;
      coveredEndIndex = fragment.endMeasureIndex;
      return;
    }

    const overlapEntries = groupEntries.filter(
      (entry) =>
        entry.measureIndex >= fragment.startMeasureIndex &&
        entry.measureIndex <= coveredEndIndex,
    );
    const overlapCharacterCount = Array.from(
      withoutWhitespace(getEntriesAnalysisText(overlapEntries)),
    ).length;
    const suffix = dropLeadingCharacters(
      fragment.displayText,
      overlapCharacterCount,
    );

    displayText = `${displayText.trimEnd()}${suffix}`;
    coveredEndIndex = fragment.endMeasureIndex;
  });

  const analysisText = getEntriesAnalysisText(groupEntries);

  if (withoutWhitespace(displayText) !== withoutWhitespace(analysisText)) {
    return createVocalDisplayText(analysisText);
  }

  return displayText;
}

function stitchPhraseFragments(entries, fragments) {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const entryIndexById = new Map(
    entries.map((entry, index) => [entry.measureId, index]),
  );
  const parents = entries.map((_, index) => index);

  function find(index) {
    if (parents[index] !== index) parents[index] = find(parents[index]);
    return parents[index];
  }

  function union(left, right) {
    const leftRoot = find(left);
    const rightRoot = find(right);

    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  }

  fragments.forEach((fragment) => {
    fragment.measureIds.slice(1).forEach((measureId, index) => {
      const leftIndex = entryIndexById.get(fragment.measureIds[index]);
      const rightIndex = entryIndexById.get(measureId);

      if (Number.isInteger(leftIndex) && Number.isInteger(rightIndex)) {
        union(leftIndex, rightIndex);
      }
    });
  });

  const groups = [];
  let currentGroup = [];

  entries.forEach((entry, index) => {
    if (currentGroup.length > 0 && find(index) !== find(index - 1)) {
      groups.push(currentGroup);
      currentGroup = [];
    }

    currentGroup.push(entry);
  });
  if (currentGroup.length > 0) groups.push(currentGroup);

  return groups.map((groupEntries) => {
    const groupIds = new Set(groupEntries.map((entry) => entry.measureId));
    const groupFragments = fragments.filter((fragment) =>
      fragment.measureIds.some((measureId) => groupIds.has(measureId)),
    );
    const rawText = getEntriesRawText(groupEntries);
    const analysisText = getEntriesAnalysisText(groupEntries);
    const source = createContinuousAnalysisSource(groupEntries);
    const sourceRange = createSourceRangeMetadata(
      groupEntries,
      source.startCharOffset,
      source.endCharOffset,
    );

    return {
      analysisText,
      displayText: stitchDisplayText(groupEntries, groupFragments),
      ...sourceRange,
      rawText,
      text: rawText,
    };
  });
}

function createStitchedDisplayCues(
  groupEntries,
  phraseFragments,
  displayText,
) {
  const source = createContinuousAnalysisSource(groupEntries);
  const contexts = new Map();

  phraseFragments.forEach((fragment, fragmentIndex) => {
    const context = fragment?.analysisWindow;
    const contextKey = context?.key || `fragment-${fragmentIndex}`;
    const contextRecord = contexts.get(contextKey) || {
      boundaryOffsets: new Set(),
      endCharOffset: Number.isInteger(context?.endCharOffset)
        ? context.endCharOffset
        : fragment.endCharOffset,
      startCharOffset: Number.isInteger(context?.startCharOffset)
        ? context.startCharOffset
        : fragment.startCharOffset,
    };

    if (
      Number.isInteger(fragment?.endCharOffset) &&
      fragment.endCharOffset < contextRecord.endCharOffset
    ) {
      contextRecord.boundaryOffsets.add(fragment.endCharOffset);
    }

    (Array.isArray(fragment?.displayCues) ? fragment.displayCues : []).forEach(
      (cue) => {
        if (
          Number.isInteger(cue?.endCharOffset) &&
          Number.isInteger(fragment?.endCharOffset) &&
          cue.endCharOffset < fragment.endCharOffset &&
          cue.endCharOffset > source.startCharOffset &&
          cue.endCharOffset < source.endCharOffset
        ) {
          contextRecord.boundaryOffsets.add(cue.endCharOffset);
        }
      },
    );

    contexts.set(contextKey, contextRecord);
  });

  const candidateBoundaryOffsets = new Set(
    [...contexts.values()].flatMap((context) => [
      ...context.boundaryOffsets,
    ]),
  );
  const internalBoundaryOffsets = [...candidateBoundaryOffsets].filter(
    (boundaryOffset) => {
      const coveringContexts = [...contexts.values()].filter(
        (context) =>
          context.startCharOffset < boundaryOffset &&
          boundaryOffset < context.endCharOffset,
      );

      return (
        coveringContexts.length <= 1 ||
        coveringContexts.every((context) =>
          context.boundaryOffsets.has(boundaryOffset),
        )
      );
    },
  );

  const endOffsets = [
    ...internalBoundaryOffsets.sort((left, right) => left - right),
    source.endCharOffset,
  ];
  let startCharOffset = source.startCharOffset;

  return endOffsets.map((endCharOffset) => {
    const cueText = sliceDisplayTextByNormalizedRange(
      displayText,
      startCharOffset - source.startCharOffset,
      endCharOffset - source.startCharOffset,
    );
    const cue = createDisplayCueFromRange(
      groupEntries,
      cueText,
      startCharOffset,
      endCharOffset,
    );

    startCharOffset = endCharOffset;
    return cue;
  }).filter(Boolean);
}

export function stitchLanguagePhraseFragments(entries, fragments) {
  const stitchedPhrases = stitchPhraseFragments(entries, fragments);

  return stitchedPhrases.map((phrase) => {
    const groupEntries = entries.filter(
      (entry) =>
        entry.measureIndex >= phrase.startMeasureIndex &&
        entry.measureIndex <= phrase.endMeasureIndex,
    );
    const groupIds = new Set(groupEntries.map((entry) => entry.measureId));
    const phraseFragments = fragments.filter((fragment) =>
      fragment.measureIds.some((measureId) => groupIds.has(measureId)),
    );
    const stitchedCues = createStitchedDisplayCues(
      groupEntries,
      phraseFragments,
      phrase.displayText,
    );

    const candidateCues =
      stitchedCues.length > 0
        ? stitchedCues
        : [createSingleDisplayCue(groupEntries, phrase.displayText)];
    const grammarResult = applyGrammarFirstCueBoundaries(
      groupEntries,
      phrase.displayText,
      candidateCues,
    );

    return {
      ...phrase,
      displayCues: grammarResult.cues,
    };
  });
}

export function validateLanguagePhraseState(state, measures) {
  const sourceFingerprint = createLanguagePhraseSourceFingerprint(measures);
  const savedSourceFingerprint =
    typeof state?.sourceFingerprint === 'string'
      ? state.sourceFingerprint
      : state?.sourceKey?.match(/-([\da-f]{8})$/u)?.[1];

  if (
    !state ||
    (state.sourceKey !== createLanguagePhraseSourceKey(measures) &&
      savedSourceFingerprint !== sourceFingerprint)
  ) {
    return null;
  }

  if (
    state.version !== LANGUAGE_PHRASE_STATE_VERSION ||
    !Array.isArray(state.phrases)
  ) {
    return null;
  }

  const plan = createLanguagePhraseAnalysisPlan(measures);
  const entries = plan.segments.flatMap((segment) => segment.entries);
  const validation = validateLanguagePhraseWindowResult(entries, {
    continuousDisplayText: state.phrases
      .map((phrase) => phrase.displayText)
      .join(' '),
    groups: state.phrases.map((phrase) => ({
      displayCues: phrase.displayCues?.map((cue) => ({ text: cue.text })),
      displayText: phrase.displayText,
      endMeasureIndex: phrase.endMeasureIndex,
      measureIds: phrase.measureIds,
      rawText: phrase.analysisText || phrase.rawText || phrase.text,
      startMeasureIndex: phrase.startMeasureIndex,
    })),
  });

  if (
    !validation.phrases ||
    validation.cueFallbacks.length > 0 ||
    state.phraseCount !== state.phrases.length
  ) {
    return null;
  }

  const hasMatchingRanges = validation.phrases.every((phrase, index) => {
    const savedPhrase = state.phrases[index];

    return (
      savedPhrase?.startMeasureIndex === phrase.startMeasureIndex &&
      savedPhrase?.endMeasureIndex === phrase.endMeasureIndex
    );
  });

  if (!hasMatchingRanges) return null;

  const hasCharacterSpans = state.phrases.every((phrase, phraseIndex) => {
    const normalizedPhrase = validation.phrases[phraseIndex];

    return (
      phrase.startCharOffset === normalizedPhrase.startCharOffset &&
      phrase.endCharOffset === normalizedPhrase.endCharOffset &&
      JSON.stringify(phrase.sourceSpans) ===
        JSON.stringify(normalizedPhrase.sourceSpans) &&
      phrase.displayCues?.every((cue, cueIndex) => {
        const normalizedCue = normalizedPhrase.displayCues[cueIndex];

        return (
          cue.startCharOffset === normalizedCue?.startCharOffset &&
          cue.endCharOffset === normalizedCue?.endCharOffset &&
          JSON.stringify(cue.sourceSpans) ===
            JSON.stringify(normalizedCue?.sourceSpans)
        );
      })
    );
  });

  return hasCharacterSpans
    ? state
    : {
        ...state,
        phrases: validation.phrases,
      };
}

export function evaluateLanguagePhraseResolveResponse({
  measures,
  response,
  transportError,
}) {
  if (transportError) {
    return {
      accepted: false,
      message: 'AI 가사 문장 정리에 실패했습니다.',
      reason: 'transport-timeout',
      state: null,
    };
  }

  if (!response?.ok) {
    return {
      accepted: false,
      message: response?.error || 'AI 가사 문장 정리에 실패했습니다.',
      reason: response?.reason || 'server-error',
      state: null,
    };
  }

  const state = validateLanguagePhraseState(response.state, measures);

  if (!state) {
    return {
      accepted: false,
      message: '현재 가사와 분석 결과가 달라 기존 Phrase를 계속 사용합니다.',
      reason: 'stale-source',
      state: null,
    };
  }

  return {
    accepted: true,
    message: '',
    reason: 'accepted',
    state,
  };
}

export function getLanguagePhrasesForMeasures(state, measures) {
  return validateLanguagePhraseState(state, measures)?.phrases || null;
}
