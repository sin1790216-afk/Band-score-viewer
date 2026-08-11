const LARGE_LYRIC_GAP_RATIO = 4;
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

export function createVocalPhrases(measures) {
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

  // 향후 문장부호, 쉼 구조와 문맥 분석을 추가하더라도 이 파생 구조와
  // measure.lyric source of truth는 유지할 수 있다.
  return phrases;
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
      measureIndex >= phrase.startMeasureIndex &&
      measureIndex <= phrase.endMeasureIndex,
  );
  const currentPhrase = phrases[currentPhraseIndex] || null;
  const nextPhraseIndex = currentPhrase
    ? currentPhraseIndex + 1 < phrases.length
      ? currentPhraseIndex + 1
      : -1
    : phrases.findIndex(
        (phrase) => phrase.startMeasureIndex > measureIndex,
      );
  const nextPhrase = phrases[nextPhraseIndex] || null;

  return {
    currentPhrase,
    currentPhraseIndex,
    nextPhrase,
    nextPhraseIndex,
  };
}

function hasCompletePhraseGeometry(phrase, measures) {
  if (!phrase) return false;

  return measures
    .slice(phrase.startMeasureIndex, phrase.endMeasureIndex + 1)
    .filter((measure) => getMeaningfulLyric(measure))
    .every((measure) => getGeometryLines(measure).length > 0);
}

function createSingleMeasurePhrase(measures, measureIndex) {
  const measure = measures[measureIndex];
  const lyric = getMeaningfulLyric(measure);

  if (!lyric) return null;

  return {
    endMeasureIndex: measureIndex,
    measureIds: measure?.id ? [measure.id] : [],
    startMeasureIndex: measureIndex,
    text: lyric,
  };
}

function createDisplayPhrases(phrases, measures) {
  return phrases.flatMap((phrase) => {
    if (hasCompletePhraseGeometry(phrase, measures)) return [phrase];

    return measures
      .slice(phrase.startMeasureIndex, phrase.endMeasureIndex + 1)
      .map((_, offset) =>
        createSingleMeasurePhrase(
          measures,
          phrase.startMeasureIndex + offset,
        ),
      )
      .filter(Boolean);
  });
}

export function createVocalViewModel(measures, measureIndex) {
  const safeMeasures = Array.isArray(measures) ? measures : [];
  const phrases = createVocalPhrases(safeMeasures);
  const displayPhrases = createDisplayPhrases(phrases, safeMeasures);
  const phraseContext = getVocalPhraseContext(
    displayPhrases,
    measureIndex,
  );

  return {
    currentMeasure: safeMeasures[measureIndex] || null,
    currentPhrase: phraseContext.currentPhrase,
    currentPhraseIndex: phraseContext.currentPhraseIndex,
    currentText: phraseContext.currentPhrase?.text || '',
    displayPhraseCount: displayPhrases.length,
    displayPhrases,
    nextPhrase: phraseContext.nextPhrase,
    nextPhraseIndex: phraseContext.nextPhraseIndex,
    nextText: phraseContext.nextPhrase?.text || '',
    phraseCount: phrases.length,
    phrases,
  };
}
