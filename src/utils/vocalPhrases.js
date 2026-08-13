import { createVocalDisplayText } from './vocalTextPostprocessing.js';

const LARGE_LYRIC_GAP_RATIO = 4;
const HARD_LYRIC_GAP_RATIO = LARGE_LYRIC_GAP_RATIO * 2;
const MIN_ADAPTIVE_BOUNDARY_GAP_COUNT = 3;
const MIN_ADAPTIVE_BOUNDARY_RATIO = 1.25;
const ROBUST_DEVIATION_MULTIPLIER = 3;
const MAD_TO_STANDARD_DEVIATION = 1.4826;
const PLACEHOLDER_LYRIC_PATTERN =
  /^[\s\-－‐‑‒–—―_＿~〜～·•⋅.．…œŒ♪♫♩♬𝅘𝅥𝅘𝅥𝅮𝅘𝅥𝅯jJqQwW]+$/u;

export function getMeaningfulLyric(measure) {
  const lyric = typeof measure?.lyric === 'string' ? measure.lyric.trim() : '';

  if (!lyric || PLACEHOLDER_LYRIC_PATTERN.test(lyric)) return '';

  return lyric;
}

function isFinitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function getGeometryLines(measure) {
  return Array.isArray(measure?.lyricGeometry?.lines)
    ? measure.lyricGeometry.lines.filter(
        (line) =>
          Number.isInteger(line?.lineIndex) &&
          Number.isFinite(Number(line.startX)) &&
          Number.isFinite(Number(line.endX)) &&
          isFinitePositive(line.referenceGap),
      )
    : [];
}

function getBaselineIdentities(measure) {
  const geometry = measure?.lyricGeometry;

  return getGeometryLines(measure).map(
    (line) =>
      `${Number(geometry.page)}:${Number(geometry.systemIndex)}:${line.lineIndex}`,
  );
}

function hasSameBaselines(previousMeasure, currentMeasure) {
  const previousIdentities = getBaselineIdentities(previousMeasure);
  const currentIdentities = getBaselineIdentities(currentMeasure);

  return (
    previousIdentities.length > 0 &&
    previousIdentities.length === currentIdentities.length &&
    previousIdentities.every(
      (identity, index) => identity === currentIdentities[index],
    )
  );
}

function isAdaptiveBoundaryGap(gap, previousLine, currentLine) {
  const statsLine = [currentLine, previousLine].find(
    (line) =>
      Number(line?.boundaryGapCount) >= MIN_ADAPTIVE_BOUNDARY_GAP_COUNT &&
      isFinitePositive(line?.boundaryGapMedian) &&
      isFinitePositive(line?.boundaryGapMad),
  );

  if (!statsLine) return false;

  const median = Number(statsLine.boundaryGapMedian);
  const mad = Number(statsLine.boundaryGapMad);
  const robustThreshold =
    median +
    ROBUST_DEVIATION_MULTIPLIER * MAD_TO_STANDARD_DEVIATION * mad;

  return (
    gap / median >= MIN_ADAPTIVE_BOUNDARY_RATIO && gap >= robustThreshold
  );
}

function getSameBaselineGapSignals(previousMeasure, currentMeasure) {
  const previousLines = getGeometryLines(previousMeasure);
  const currentLines = getGeometryLines(currentMeasure);

  return currentLines.flatMap((currentLine) => {
    const previousLine = previousLines.find(
      (line) => line.lineIndex === currentLine.lineIndex,
    );

    if (!previousLine) return [];

    const gap = Number(currentLine.startX) - Number(previousLine.endX);
    const referenceGap = Math.max(
      Number(previousLine.referenceGap),
      Number(currentLine.referenceGap),
    );

    return gap > 0 && referenceGap > 0
      ? [
          {
            isAdaptiveOutlier: isAdaptiveBoundaryGap(
              gap,
              previousLine,
              currentLine,
            ),
            referenceRatio: gap / referenceGap,
          },
        ]
      : [];
  });
}

export function isVocalPhraseBoundary(previousMeasure, currentMeasure) {
  const previousGeometry = previousMeasure?.lyricGeometry;
  const currentGeometry = currentMeasure?.lyricGeometry;

  if (!previousGeometry || !currentGeometry) return false;

  if (!hasSameBaselines(previousMeasure, currentMeasure)) return true;

  const gapSignals = getSameBaselineGapSignals(previousMeasure, currentMeasure);

  return (
    gapSignals.length > 0 &&
    gapSignals.every(
      ({ isAdaptiveOutlier, referenceRatio }) =>
        isAdaptiveOutlier || referenceRatio >= LARGE_LYRIC_GAP_RATIO,
    )
  );
}

export function isHardVocalPhraseBoundary(previousMeasure, currentMeasure) {
  if (currentMeasure?.lyricGeometry?.hardBoundaryBefore === true) return true;

  const previousLines = getGeometryLines(previousMeasure);
  const currentLines = getGeometryLines(currentMeasure);

  if (previousLines.length > 0 && currentLines.length > 0) {
    const previousLineIndexes = previousLines.map((line) => line.lineIndex);
    const currentLineIndexes = currentLines.map((line) => line.lineIndex);
    const isDifferentLyricLane =
      previousLineIndexes.length !== currentLineIndexes.length ||
      previousLineIndexes.some(
        (lineIndex, index) => lineIndex !== currentLineIndexes[index],
      );

    if (isDifferentLyricLane) return true;
  }

  if (!hasSameBaselines(previousMeasure, currentMeasure)) return false;

  const gapSignals = getSameBaselineGapSignals(previousMeasure, currentMeasure);

  return (
    gapSignals.length > 0 &&
    gapSignals.every(
      ({ referenceRatio }) => referenceRatio >= HARD_LYRIC_GAP_RATIO,
    )
  );
}

function appendPhraseMeasure(phrase, measure, measureIndex, lyric) {
  return {
    ...phrase,
    endMeasureIndex: measureIndex,
    measureIds: measure?.id
      ? [...phrase.measureIds, measure.id]
      : phrase.measureIds,
    text: `${phrase.text} ${lyric}`,
  };
}

function addDisplayText(phrase, displayTextOptions) {
  return {
    ...phrase,
    displayText: createVocalDisplayText(phrase.text, displayTextOptions),
  };
}

export function createVocalPhrases(measures, displayTextOptions) {
  if (!Array.isArray(measures) || measures.length === 0) return [];

  const phrases = [];
  let currentPhrase = null;
  let previousMeaningfulMeasure = null;

  measures.forEach((measure, measureIndex) => {
    const lyric = getMeaningfulLyric(measure);

    if (!lyric) {
      if (currentPhrase) phrases.push(currentPhrase);
      currentPhrase = null;
      previousMeaningfulMeasure = null;
      return;
    }

    if (
      currentPhrase &&
      isVocalPhraseBoundary(previousMeaningfulMeasure, measure)
    ) {
      phrases.push(currentPhrase);
      currentPhrase = null;
    }

    if (currentPhrase) {
      currentPhrase = appendPhraseMeasure(
        currentPhrase,
        measure,
        measureIndex,
        lyric,
      );
      previousMeaningfulMeasure = measure;
      return;
    }

    currentPhrase = {
      endMeasureIndex: measureIndex,
      measureIds: measure?.id ? [measure.id] : [],
      startMeasureIndex: measureIndex,
      text: lyric,
    };
    previousMeaningfulMeasure = measure;
  });

  if (currentPhrase) phrases.push(currentPhrase);

  // 표시용 후처리는 완성된 Phrase 문맥에만 적용하며 measure.lyric은 건드리지 않는다.
  return phrases.map((phrase) => addDisplayText(phrase, displayTextOptions));
}

export function getVocalPhraseContext(phrases, measureIndex) {
  if (!Array.isArray(phrases) || !Number.isInteger(measureIndex)) {
    return {
      currentPhrase: null,
      currentPhraseIndex: -1,
      nextPhrase: null,
      nextPhraseIndex: -1,
    };
  }

  const currentPhraseIndex = phrases.findIndex(
    (phrase) =>
      measureIndex >=
        (Number.isInteger(phrase.timingStartMeasureIndex)
          ? phrase.timingStartMeasureIndex
          : phrase.startMeasureIndex) &&
      measureIndex <=
        (Number.isInteger(phrase.timingEndMeasureIndex)
          ? phrase.timingEndMeasureIndex
          : phrase.endMeasureIndex),
  );
  const currentPhrase = phrases[currentPhraseIndex] || null;
  const nextPhraseIndex = currentPhrase
    ? currentPhraseIndex + 1 < phrases.length
      ? currentPhraseIndex + 1
      : -1
    : phrases.findIndex(
        (phrase) =>
          (Number.isInteger(phrase.timingStartMeasureIndex)
            ? phrase.timingStartMeasureIndex
            : phrase.startMeasureIndex) > measureIndex,
      );
  const nextPhrase = phrases[nextPhraseIndex] || null;

  return {
    currentPhrase,
    currentPhraseIndex,
    nextPhrase,
    nextPhraseIndex,
  };
}

export function getVocalPhraseDisplayText(phrase) {
  return phrase?.displayText || phrase?.text || '';
}

function hasCompletePhraseGeometry(phrase, measures) {
  if (!phrase) return false;

  return measures
    .slice(phrase.startMeasureIndex, phrase.endMeasureIndex + 1)
    .filter((measure) => getMeaningfulLyric(measure))
    .every((measure) => getGeometryLines(measure).length > 0);
}

function createSingleMeasurePhrase(
  measures,
  measureIndex,
  displayTextOptions,
) {
  const measure = measures[measureIndex];
  const lyric = getMeaningfulLyric(measure);

  if (!lyric) return null;

  return addDisplayText(
    {
      endMeasureIndex: measureIndex,
      measureIds: measure?.id ? [measure.id] : [],
      startMeasureIndex: measureIndex,
      text: lyric,
    },
    displayTextOptions,
  );
}

function createDisplayPhrases(phrases, measures, displayTextOptions) {
  return phrases.flatMap((phrase) => {
    if (hasCompletePhraseGeometry(phrase, measures)) return [phrase];

    return measures
      .slice(phrase.startMeasureIndex, phrase.endMeasureIndex + 1)
      .map((_, offset) =>
        createSingleMeasurePhrase(
          measures,
          phrase.startMeasureIndex + offset,
          displayTextOptions,
        ),
      )
      .filter(Boolean);
  });
}

export function createCoarseDisplayCueTimingProjection(displayCues) {
  const cues = Array.isArray(displayCues) ? displayCues : [];
  const timingStarts = [];

  cues.forEach((cue, index) => {
    const sourceStart = cue.startMeasureIndex;
    const previousCue = cues[index - 1];
    const previousTimingStart = timingStarts[index - 1];

    if (
      index > 0 &&
      Number.isInteger(sourceStart) &&
      Number.isInteger(previousCue?.endMeasureIndex) &&
      sourceStart <= previousCue.endMeasureIndex
    ) {
      timingStarts.push(
        Math.max(previousCue.endMeasureIndex + 1, previousTimingStart + 1),
      );
      return;
    }

    timingStarts.push(sourceStart);
  });

  return cues.map((cue, index) => {
    const timingStartMeasureIndex = timingStarts[index];
    const nextTimingStart = timingStarts[index + 1];
    let timingEndMeasureIndex = Math.max(
      cue.endMeasureIndex,
      timingStartMeasureIndex,
    );

    if (
      Number.isInteger(nextTimingStart) &&
      nextTimingStart <= timingEndMeasureIndex
    ) {
      timingEndMeasureIndex = nextTimingStart - 1;
    }

    return {
      ...cue,
      timingEndMeasureIndex,
      timingStartMeasureIndex,
    };
  });
}

function createLanguageDisplayCues(languagePhrases) {
  const displayCues = languagePhrases.flatMap((phrase, languagePhraseIndex) => {
    if (!Array.isArray(phrase?.displayCues) || phrase.displayCues.length === 0) {
      return [phrase];
    }

    return phrase.displayCues.map((cue, displayCueIndex) => ({
      displayCueIndex,
      displayText: cue.text,
      endMeasureIndex: cue.endMeasureIndex,
      languagePhraseIndex,
      measureIds: cue.measureIds,
      sourceSpans: cue.sourceSpans,
      startCharOffset: cue.startCharOffset,
      endCharOffset: cue.endCharOffset,
      startMeasureIndex: cue.startMeasureIndex,
      text: cue.text,
    }));
  });

  return createCoarseDisplayCueTimingProjection(displayCues);
}

export function createVocalViewModel(
  measures,
  measureIndex,
  displayTextOptions = {},
) {
  const safeMeasures = Array.isArray(measures) ? measures : [];
  const phrases = createVocalPhrases(safeMeasures, displayTextOptions);
  const languagePhrases = Array.isArray(displayTextOptions.languagePhrases)
    ? displayTextOptions.languagePhrases
    : null;
  const displayPhrases = languagePhrases
    ? createLanguageDisplayCues(languagePhrases)
    : createDisplayPhrases(phrases, safeMeasures, displayTextOptions);
  const phraseContext = getVocalPhraseContext(
    displayPhrases,
    measureIndex,
  );

  return {
    currentMeasure: safeMeasures[measureIndex] || null,
    currentCue: phraseContext.currentPhrase,
    currentPhrase: phraseContext.currentPhrase,
    currentPhraseIndex: phraseContext.currentPhraseIndex,
    currentText: getVocalPhraseDisplayText(phraseContext.currentPhrase),
    displayPhraseCount: displayPhrases.length,
    displayPhrases,
    languagePhraseCount: languagePhrases?.length || 0,
    languagePhrases: languagePhrases || [],
    nextCue: phraseContext.nextPhrase,
    nextPhrase: phraseContext.nextPhrase,
    nextPhraseIndex: phraseContext.nextPhraseIndex,
    nextText: getVocalPhraseDisplayText(phraseContext.nextPhrase),
    phraseCount: phrases.length,
    phrases,
  };
}
