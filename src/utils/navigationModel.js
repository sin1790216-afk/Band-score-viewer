import {
  analyzeNavigationMarkers,
  NAVIGATION_MARKER_TYPES,
  normalizeNavigationMarkers,
} from './navigationMarkers.js';
import {
  attachNavigationEndings,
  collectNavigationEndings,
  createManualNavigationEnding,
  getNavigationEndingLabel,
} from './navigationEndings.js';

export function createRepeatSectionId(startMeasureId, endMeasureId) {
  return `repeat:${startMeasureId}:${endMeasureId}`;
}

function getMeasureIndexById(measures) {
  return new Map(measures.map((measure, index) => [measure.id, index]));
}

export function buildNavigationModel(measures) {
  const safeMeasures = Array.isArray(measures) ? measures : [];
  const markerAnalysis = analyzeNavigationMarkers(safeMeasures);
  const measureIndexById = getMeasureIndexById(safeMeasures);
  const issues = [...markerAnalysis.issues];
  const endings = collectNavigationEndings(safeMeasures);
  const repeatSections = [];

  markerAnalysis.repeatPairsByEndId.forEach((startIndex, endMeasureId) => {
    const startMeasure = safeMeasures[startIndex];
    const endIndex = measureIndexById.get(endMeasureId);

    if (!startMeasure || !Number.isInteger(endIndex)) return;

    const sectionEndings = endings
      .filter(
        (ending) =>
          ending.repeatStartMeasureId === startMeasure.id &&
          ending.repeatEndMeasureId === endMeasureId,
      )
      .flatMap((ending) => {
        const endingStartIndex = measureIndexById.get(ending.startMeasureId);
        const endingEndIndex = measureIndexById.get(ending.endMeasureId);

        if (
          !Number.isInteger(endingStartIndex) ||
          !Number.isInteger(endingEndIndex) ||
          endingStartIndex > endingEndIndex ||
          endingEndIndex < startIndex
        ) {
          issues.push({
            code: 'ending-range-invalid',
            measureId: ending.startMeasureId,
            measureIndex: endingStartIndex ?? -1,
            message: `${getNavigationEndingLabel(ending)} 엔딩 범위가 올바르지 않습니다.`,
          });
          return [];
        }

        return [{ ...ending, endIndex: endingEndIndex, startIndex: endingStartIndex }];
      })
      .sort((left, right) => left.startIndex - right.startIndex);
    const passValues = sectionEndings.flatMap((ending) => ending.passes);

    repeatSections.push({
      endIndex,
      endMeasureId,
      endings: sectionEndings,
      id: createRepeatSectionId(startMeasure.id, endMeasureId),
      maxPass: passValues.length > 0 ? Math.max(...passValues) : 2,
      startIndex,
      startMeasureId: startMeasure.id,
    });
  });

  endings.forEach((ending) => {
    if (
      !repeatSections.some(
        (section) =>
          section.startMeasureId === ending.repeatStartMeasureId &&
          section.endMeasureId === ending.repeatEndMeasureId,
      )
    ) {
      issues.push({
        code: 'ending-repeat-section-missing',
        measureId: ending.startMeasureId,
        measureIndex: measureIndexById.get(ending.startMeasureId) ?? -1,
        message: `${getNavigationEndingLabel(ending)} 엔딩의 반복 구간을 찾을 수 없습니다.`,
      });
    }
  });

  return {
    ...markerAnalysis,
    endings,
    issues,
    measureIndexById,
    repeatSections,
  };
}

export function getNavigationModelValidation(measures) {
  const { issues } = buildNavigationModel(measures);

  return {
    isValid: issues.length === 0,
    issues,
    message: issues[0]?.message || '',
  };
}

function setMarkerOnMeasure(measure, type, shouldExist) {
  const markers = normalizeNavigationMarkers(measure.navigationMarkers).filter(
    (marker) => marker.type !== type,
  );

  return {
    ...measure,
    navigationMarkers: shouldExist ? [...markers, { type }] : markers,
  };
}

export function setPointNavigationMarker(measures, type, physicalMeasureNumber) {
  const measureIndex = physicalMeasureNumber - 1;

  if (!measures[measureIndex]) return null;

  return measures.map((measure, index) =>
    setMarkerOnMeasure(measure, type, index === measureIndex),
  );
}

export function clearPointNavigationMarker(measures, type) {
  return measures.map((measure) => setMarkerOnMeasure(measure, type, false));
}

export function addRepeatSection(measures, startMeasureNumber, endMeasureNumber) {
  const startIndex = startMeasureNumber - 1;
  const endIndex = endMeasureNumber - 1;

  if (!measures[startIndex] || !measures[endIndex] || startIndex > endIndex) {
    return null;
  }

  return measures.map((measure, index) => {
    let nextMeasure = measure;

    if (index === startIndex) {
      nextMeasure = setMarkerOnMeasure(
        nextMeasure,
        NAVIGATION_MARKER_TYPES.REPEAT_START,
        true,
      );
    }
    if (index === endIndex) {
      nextMeasure = setMarkerOnMeasure(
        nextMeasure,
        NAVIGATION_MARKER_TYPES.REPEAT_END,
        true,
      );
    }

    return nextMeasure;
  });
}

export function updateRepeatSectionRange(
  measures,
  section,
  startMeasureNumber,
  endMeasureNumber,
) {
  const startIndex = startMeasureNumber - 1;
  const endIndex = endMeasureNumber - 1;

  if (!measures[startIndex] || !measures[endIndex] || startIndex > endIndex) {
    return null;
  }

  const nextStartId = measures[startIndex].id;
  const nextEndId = measures[endIndex].id;
  const endings = collectNavigationEndings(measures).map((ending) =>
    ending.repeatStartMeasureId === section.startMeasureId &&
    ending.repeatEndMeasureId === section.endMeasureId
      ? {
          ...ending,
          repeatEndMeasureId: nextEndId,
          repeatStartMeasureId: nextStartId,
        }
      : ending,
  );
  const withMovedMarkers = measures.map((measure, index) => {
    let nextMeasure = measure;

    if (measure.id === section.startMeasureId || index === startIndex) {
      nextMeasure = setMarkerOnMeasure(
        nextMeasure,
        NAVIGATION_MARKER_TYPES.REPEAT_START,
        index === startIndex,
      );
    }
    if (measure.id === section.endMeasureId || index === endIndex) {
      nextMeasure = setMarkerOnMeasure(
        nextMeasure,
        NAVIGATION_MARKER_TYPES.REPEAT_END,
        index === endIndex,
      );
    }

    return nextMeasure;
  });

  return attachNavigationEndings(withMovedMarkers, endings);
}

export function addNavigationEnding(measures, section) {
  const endings = collectNavigationEndings(measures);
  const sectionEndings = endings.filter(
    (ending) =>
      ending.repeatStartMeasureId === section.startMeasureId &&
      ending.repeatEndMeasureId === section.endMeasureId,
  );
  const nextPass = Math.max(0, ...sectionEndings.flatMap((ending) => ending.passes)) + 1;
  const furthestEndingIndex = Math.max(
    section.endIndex - 1,
    ...sectionEndings.map((ending) =>
      measures.findIndex((measure) => measure.id === ending.endMeasureId),
    ),
  );
  const defaultIndex = Math.min(furthestEndingIndex + 1, measures.length - 1);
  const defaultMeasureId = measures[defaultIndex]?.id;
  const ending = createManualNavigationEnding({
    endMeasureId: defaultMeasureId,
    pass: nextPass,
    repeatEndMeasureId: section.endMeasureId,
    repeatStartMeasureId: section.startMeasureId,
    startMeasureId: defaultMeasureId,
  });

  return ending
    ? attachNavigationEndings(measures, [...endings, ending])
    : measures;
}

export function updateNavigationEndingRange(
  measures,
  endingId,
  startMeasureNumber,
  endMeasureNumber,
) {
  const startMeasure = measures[startMeasureNumber - 1];
  const endMeasure = measures[endMeasureNumber - 1];

  if (!startMeasure || !endMeasure || startMeasureNumber > endMeasureNumber) {
    return null;
  }

  return attachNavigationEndings(
    measures,
    collectNavigationEndings(measures).map((ending) =>
      ending.id === endingId
        ? {
            ...ending,
            endMeasureId: endMeasure.id,
            startMeasureId: startMeasure.id,
          }
        : ending,
    ),
  );
}

export function removeNavigationEnding(measures, endingId) {
  return attachNavigationEndings(
    measures,
    collectNavigationEndings(measures).filter((ending) => ending.id !== endingId),
  );
}

export function getNavigationEndingBadges(measures) {
  const badgesByMeasureId = new Map();

  collectNavigationEndings(measures).forEach((ending) => {
    const badges = badgesByMeasureId.get(ending.startMeasureId) || [];

    badges.push({ id: ending.id, label: getNavigationEndingLabel(ending) });
    badgesByMeasureId.set(ending.startMeasureId, badges);
  });

  return badgesByMeasureId;
}
