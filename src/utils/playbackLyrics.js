import { buildNavigationModel } from './navigationModel.js';

function getLyricLines(lyric) {
  return typeof lyric === 'string' ? lyric.split(/\r?\n/u) : [''];
}

function getGeometryLines(measure) {
  return Array.isArray(measure?.lyricGeometry?.lines)
    ? measure.lyricGeometry.lines.filter((line) =>
        Number.isInteger(line?.lineIndex) && line.lineIndex >= 0
      )
    : [];
}

function getSystemKey(measure, measureIndex) {
  const geometry = measure?.lyricGeometry;
  const page = Number(geometry?.page ?? measure?.page);

  return Number.isFinite(page) && Number.isInteger(geometry?.systemIndex)
    ? `${page}:${geometry.systemIndex}`
    : `measure:${measure?.id || measureIndex}`;
}

function createSystemLaneIndexes(measures) {
  const laneIndexesBySystem = new Map();

  measures.forEach((measure, measureIndex) => {
    const geometryLines = getGeometryLines(measure);

    if (geometryLines.length === 0) return;

    const systemKey = getSystemKey(measure, measureIndex);
    const laneIndexes = laneIndexesBySystem.get(systemKey) || new Set();

    geometryLines.forEach((line) => laneIndexes.add(line.lineIndex));
    laneIndexesBySystem.set(systemKey, laneIndexes);
  });

  return new Map(
    [...laneIndexesBySystem].map(([systemKey, laneIndexes]) => [
      systemKey,
      [...laneIndexes].sort((left, right) => left - right),
    ]),
  );
}

function selectMeasureLyricLane(measure, selectedLaneIndex) {
  const geometryLines = getGeometryLines(measure);

  if (geometryLines.length === 0 || !Number.isInteger(selectedLaneIndex)) {
    return { measure, selectedLaneIndex: null };
  }

  const lyricLines = getLyricLines(measure.lyric);

  if (selectedLaneIndex >= lyricLines.length) {
    return { measure, selectedLaneIndex: null };
  }

  const selectedGeometryLines = getGeometryLines(measure).filter(
    (line) => line.lineIndex === selectedLaneIndex,
  );
  const selectedLyric = lyricLines[selectedLaneIndex] || '';
  const isAlreadySelected =
    measure.lyric === selectedLyric &&
    geometryLines.length === selectedGeometryLines.length;

  if (isAlreadySelected) {
    return { measure, selectedLaneIndex };
  }

  return {
    measure: {
      ...measure,
      lyric: selectedLyric,
      lyricGeometry: {
        ...measure.lyricGeometry,
        lines: selectedGeometryLines,
      },
    },
    selectedLaneIndex,
  };
}

function getActiveRepeatSection(measures, playbackStep) {
  if (
    !playbackStep?.repeatSectionId ||
    !playbackStep.measureId ||
    !Array.isArray(measures)
  ) {
    return null;
  }

  const currentMeasureIndex = measures.findIndex(
    (measure) => measure?.id === playbackStep.measureId,
  );
  const section = buildNavigationModel(measures).repeatSections.find(
    (candidate) => candidate.id === playbackStep.repeatSectionId,
  );

  if (!section) return null;

  const sectionEndIndex = Math.max(
    section.endIndex,
    ...section.endings.map((ending) => ending.endIndex),
  );

  return currentMeasureIndex >= section.startIndex &&
    currentMeasureIndex <= sectionEndIndex
    ? { ...section, sectionEndIndex }
    : null;
}

function getRepeatPass(playbackStep, activeRepeatSection) {
  const repeatPass = Number(playbackStep?.repeatPass);

  return activeRepeatSection && Number.isSafeInteger(repeatPass) && repeatPass > 0
    ? repeatPass
    : 1;
}

export function createPlaybackLyricProjection(measures, playbackStep = null) {
  const safeMeasures = Array.isArray(measures) ? measures : [];
  const activeRepeatSection = getActiveRepeatSection(safeMeasures, playbackStep);
  const repeatPass = getRepeatPass(playbackStep, activeRepeatSection);
  const activeLaneIndex = repeatPass - 1;
  const laneIndexesBySystem = createSystemLaneIndexes(safeMeasures);
  const selectedLaneIndexes = [];
  let didProject = false;

  const projectedMeasures = safeMeasures.map((measure, measureIndex) => {
    const isInsideActiveRepeat = Boolean(
      activeRepeatSection &&
      measureIndex >= activeRepeatSection.startIndex &&
      measureIndex <= activeRepeatSection.sectionEndIndex
    );

    const logicalLaneIndex = isInsideActiveRepeat ? activeLaneIndex : 0;
    const systemLaneIndexes = laneIndexesBySystem.get(
      getSystemKey(measure, measureIndex),
    );

    if (!systemLaneIndexes?.length) {
      selectedLaneIndexes.push(null);
      return measure;
    }

    const selectedLaneIndex = systemLaneIndexes[
      Math.min(logicalLaneIndex, systemLaneIndexes.length - 1)
    ];
    const selection = selectMeasureLyricLane(measure, selectedLaneIndex);

    selectedLaneIndexes.push(selection.selectedLaneIndex);
    if (selection.measure !== measure) didProject = true;

    return selection.measure;
  });

  return {
    activeLaneIndex,
    activeRepeatSectionId: activeRepeatSection?.id || null,
    measures: didProject ? projectedMeasures : safeMeasures,
    repeatPass,
    selectedLaneIndexes,
  };
}
