import {
  analyzeNavigationMarkers,
  NAVIGATION_MARKER_TYPES,
  normalizeNavigationMarkers,
} from './navigationMarkers.js';
import {
  attachNavigationEndings,
  collectNavigationEndings,
  createManualNavigationEnding,
  deriveNavigationEndingRanges,
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

    const sectionAnchors = endings.filter(
      (ending) =>
        ending.repeatStartMeasureId === startMeasure.id &&
        ending.repeatEndMeasureId === endMeasureId,
    );
    const sectionEndings = deriveNavigationEndingRanges({
      endings: sectionAnchors,
      measureIndexById,
      repeatEndIndex: endIndex,
    })
      .flatMap((ending) => {
        if (
          !Number.isInteger(ending.startIndex) ||
          !Number.isInteger(ending.endIndex) ||
          ending.startIndex > ending.endIndex ||
          ending.startIndex < startIndex ||
          (ending.explicitEndMeasureId &&
            !measureIndexById.has(ending.explicitEndMeasureId))
        ) {
          issues.push({
            code: 'ending-range-invalid',
            measureId: ending.startMeasureId,
            measureIndex: ending.startIndex ?? -1,
            message: `${getNavigationEndingLabel(ending)} 괄호 위치가 올바르지 않습니다.`,
          });
          return [];
        }

        return [ending];
      })
      .sort((left, right) => left.startIndex - right.startIndex);
    sectionEndings.forEach((ending, index) => {
      if (sectionEndings[index - 1]?.startIndex === ending.startIndex) {
        issues.push({
          code: 'ending-anchor-duplicate',
          measureId: ending.startMeasureId,
          measureIndex: ending.startIndex,
          message: `${getNavigationEndingLabel(ending)} 괄호 시작점이 다른 괄호와 겹칩니다.`,
        });
      }
    });
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
        message: `${getNavigationEndingLabel(ending)} 괄호의 도돌이표를 찾을 수 없습니다.`,
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

function setMarkerOnMeasure(measure, type, shouldExist, markerToAdd = { type }) {
  const markers = normalizeNavigationMarkers(measure.navigationMarkers).filter(
    (marker) => marker.type !== type,
  );

  return {
    ...measure,
    navigationMarkers: shouldExist ? [...markers, markerToAdd] : markers,
  };
}

export function setPointNavigationMarker(measures, type, physicalMeasureNumber) {
  const measureIndex = physicalMeasureNumber - 1;
  const markerToMove = measures
    .flatMap((measure) => normalizeNavigationMarkers(measure.navigationMarkers))
    .find((marker) => marker.type === type) || { type };

  if (!measures[measureIndex]) return null;

  return measures.map((measure, index) =>
    setMarkerOnMeasure(measure, type, index === measureIndex, markerToMove),
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

export function addNavigationEnding(measures, section, startMeasureNumber) {
  if (!Array.isArray(measures) || !section) return null;

  const endings = collectNavigationEndings(measures);
  const sectionEndings = endings.filter(
    (ending) =>
      ending.repeatStartMeasureId === section.startMeasureId &&
      ending.repeatEndMeasureId === section.endMeasureId,
  );
  const nextPass = Math.max(0, ...sectionEndings.flatMap((ending) => ending.passes)) + 1;
  const startMeasure = measures[startMeasureNumber - 1];
  const ending = createManualNavigationEnding({
    pass: nextPass,
    repeatEndMeasureId: section.endMeasureId,
    repeatStartMeasureId: section.startMeasureId,
    startMeasureId: startMeasure?.id,
  });

  return ending
    ? attachNavigationEndings(measures, [...endings, ending])
    : null;
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
            explicitEndMeasureId: endMeasure.id,
            startMeasureId: startMeasure.id,
          }
        : ending,
    ),
  );
}

export function updateNavigationEndingAnchor(
  measures,
  endingId,
  startMeasureNumber,
) {
  const startMeasure = measures[startMeasureNumber - 1];

  if (!startMeasure) return null;

  return attachNavigationEndings(
    measures,
    collectNavigationEndings(measures).map((ending) => {
      if (ending.id !== endingId) return ending;

      const { explicitEndMeasureId: _explicitEndMeasureId, ...pointAnchor } = ending;

      return {
        ...pointAnchor,
        startMeasureId: startMeasure.id,
      };
    }),
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
