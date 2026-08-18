import {
  attachNavigationEndings,
  collectNavigationEndings,
  createManualNavigationEnding,
} from './navigationEndings.js';
import { buildNavigationModel } from './navigationModel.js';
import {
  hasNavigationMarker,
  isNavigationMarkerType,
  NAVIGATION_COMMAND_MARKER_TYPES,
  NAVIGATION_MARKER_TYPES,
  normalizeNavigationMarkers,
} from './navigationMarkers.js';

const VOLTA_CANDIDATE_TYPE = 'volta-anchor';
const UNIQUE_MARKER_TYPES = new Set([
  NAVIGATION_MARKER_TYPES.CODA,
  NAVIGATION_MARKER_TYPES.FINE,
  NAVIGATION_MARKER_TYPES.SEGNO,
]);
const JUMP_ACTION_TYPES = new Set([
  NAVIGATION_MARKER_TYPES.REPEAT_END,
  ...NAVIGATION_COMMAND_MARKER_TYPES,
]);

export const NAVIGATION_CANDIDATE_APPLICATION_STATUS = Object.freeze({
  ALREADY_APPLIED: 'already-applied',
  AMBIGUOUS_REPEAT_SECTION: 'ambiguous-repeat-section',
  APPLIED: 'applied',
  AVAILABLE: 'available',
  CONFLICT: 'conflict',
  INVALID_ASSOCIATION: 'invalid-association',
  REPEAT_REQUIRED: 'repeat-required',
  STALE: 'stale',
  UNSUPPORTED: 'unsupported',
});

function createApplicationState(status, message, details = {}) {
  return { ...details, message, status };
}

function isCandidateContextCurrent(context) {
  if (context?.isCurrent === false) return false;

  return context?.candidateMeasureIdentity === context?.currentMeasureIdentity &&
    context?.candidatePdfIdentity === context?.currentPdfIdentity;
}

function getCandidateMeasure(candidate, measures) {
  const measureIndex = Number(candidate?.measureIndex);

  if (!Number.isSafeInteger(measureIndex) || measureIndex < 0) return null;

  const measure = measures[measureIndex];

  if (!measure || !candidate?.measureId) return null;

  return measure.id === candidate.measureId
    ? { measure, measureIndex }
    : { measure, measureIndex, staleMeasureId: true };
}

function getExistingMarkerConflict(candidate, measures, targetMeasureIndex) {
  if (UNIQUE_MARKER_TYPES.has(candidate.type)) {
    const conflictingMeasureIndex = measures.findIndex(
      (measure, measureIndex) =>
        measureIndex !== targetMeasureIndex &&
        hasNavigationMarker(measure, candidate.type),
    );

    if (conflictingMeasureIndex >= 0) {
      return createApplicationState(
        NAVIGATION_CANDIDATE_APPLICATION_STATUS.CONFLICT,
        `다른 위치에 이미 지정됨 (M${conflictingMeasureIndex + 1})`,
        { conflictingMeasureIndex },
      );
    }
  }

  const markerTypes = new Set(
    normalizeNavigationMarkers(measures[targetMeasureIndex]?.navigationMarkers)
      .map((marker) => marker.type),
  );
  const existingJumpTypes = [...markerTypes].filter((type) =>
    JUMP_ACTION_TYPES.has(type),
  );
  const isAllowedRepeatEndToCodaPair =
    (candidate.type === NAVIGATION_MARKER_TYPES.REPEAT_END &&
      markerTypes.has(NAVIGATION_MARKER_TYPES.TO_CODA)) ||
    (candidate.type === NAVIGATION_MARKER_TYPES.TO_CODA &&
      markerTypes.has(NAVIGATION_MARKER_TYPES.REPEAT_END));

  if (
    JUMP_ACTION_TYPES.has(candidate.type) &&
    existingJumpTypes.length > 0 &&
    !isAllowedRepeatEndToCodaPair
  ) {
    return createApplicationState(
      NAVIGATION_CANDIDATE_APPLICATION_STATUS.CONFLICT,
      '현재 마디의 다른 이동 Marker와 충돌합니다.',
    );
  }

  if (
    (candidate.type === NAVIGATION_MARKER_TYPES.FINE && existingJumpTypes.length > 0) ||
    (JUMP_ACTION_TYPES.has(candidate.type) &&
      markerTypes.has(NAVIGATION_MARKER_TYPES.FINE))
  ) {
    return createApplicationState(
      NAVIGATION_CANDIDATE_APPLICATION_STATUS.CONFLICT,
      '현재 마디의 Fine 또는 이동 Marker와 충돌합니다.',
    );
  }

  return null;
}

function getNormalizedCandidatePasses(candidate) {
  if (!Array.isArray(candidate?.passes)) return [];

  return [...new Set(candidate.passes.map(Number))]
    .filter((pass) => Number.isSafeInteger(pass) && pass > 0)
    .sort((left, right) => left - right);
}

function getExactRepeatSections(candidate, repeatSections) {
  const endingStructure = candidate?.evidence?.endingStructure;

  if (endingStructure?.repeatStartMeasureId && endingStructure?.repeatEndMeasureId) {
    return repeatSections.filter((section) =>
      section.startMeasureId === endingStructure.repeatStartMeasureId &&
      section.endMeasureId === endingStructure.repeatEndMeasureId
    );
  }

  const repeatStructure = candidate?.evidence?.repeatStructure;

  if (!repeatStructure?.measureId) return [];

  if (repeatStructure.type === NAVIGATION_MARKER_TYPES.REPEAT_START) {
    return repeatSections.filter(
      (section) => section.startMeasureId === repeatStructure.measureId,
    );
  }

  if (repeatStructure.type === NAVIGATION_MARKER_TYPES.REPEAT_END) {
    return repeatSections.filter(
      (section) => section.endMeasureId === repeatStructure.measureId,
    );
  }

  return [];
}

function findRepeatSectionsForVolta(candidate, repeatSections) {
  const exactSections = getExactRepeatSections(candidate, repeatSections);

  if (exactSections.length > 0) return exactSections;

  return repeatSections.filter((section) =>
    candidate.measureIndex >= section.startIndex &&
    candidate.measureIndex <= section.endIndex + 1
  );
}

function getVoltaApplicationState(candidate, measures, targetMeasure) {
  const passes = getNormalizedCandidatePasses(candidate);

  if (
    passes.length === 0 ||
    passes.length !== candidate.passes.length ||
    JSON.stringify(passes) !== JSON.stringify(candidate.passes)
  ) {
    return createApplicationState(
      NAVIGATION_CANDIDATE_APPLICATION_STATUS.UNSUPPORTED,
      '괄호의 연주 횟수를 확인해주세요.',
    );
  }

  const existingEnding = collectNavigationEndings(measures).find((ending) =>
    ending.startMeasureId === targetMeasure.id &&
    JSON.stringify(ending.passes) === JSON.stringify(passes)
  );

  if (existingEnding) {
    return createApplicationState(
      NAVIGATION_CANDIDATE_APPLICATION_STATUS.ALREADY_APPLIED,
      '이미 지정됨',
    );
  }

  const repeatSections = buildNavigationModel(measures).repeatSections;

  if (repeatSections.length === 0) {
    return createApplicationState(
      NAVIGATION_CANDIDATE_APPLICATION_STATUS.REPEAT_REQUIRED,
      '도돌이표를 먼저 적용하세요.',
    );
  }

  const matchingSections = findRepeatSectionsForVolta(candidate, repeatSections);

  if (matchingSections.length === 0) {
    return createApplicationState(
      NAVIGATION_CANDIDATE_APPLICATION_STATUS.REPEAT_REQUIRED,
      '연결할 도돌이표 구간을 먼저 확인하세요.',
    );
  }

  if (matchingSections.length > 1) {
    return createApplicationState(
      NAVIGATION_CANDIDATE_APPLICATION_STATUS.AMBIGUOUS_REPEAT_SECTION,
      '연결할 도돌이표 구간이 모호합니다.',
    );
  }

  const [repeatSection] = matchingSections;

  return createApplicationState(
    NAVIGATION_CANDIDATE_APPLICATION_STATUS.AVAILABLE,
    '',
    {
      passes,
      repeatSection: {
        endMeasureId: repeatSection.endMeasureId,
        id: repeatSection.id,
        startMeasureId: repeatSection.startMeasureId,
      },
    },
  );
}

export function getNavigationCandidateApplicationState(
  candidate,
  measures,
  context,
) {
  const safeMeasures = Array.isArray(measures) ? measures : [];

  if (!isCandidateContextCurrent(context)) {
    return createApplicationState(
      NAVIGATION_CANDIDATE_APPLICATION_STATUS.STALE,
      '악보가 변경되었습니다. 후보를 다시 찾아주세요.',
    );
  }

  const target = getCandidateMeasure(candidate, safeMeasures);

  if (!target) {
    return createApplicationState(
      NAVIGATION_CANDIDATE_APPLICATION_STATUS.INVALID_ASSOCIATION,
      '위치 확인 필요',
    );
  }

  if (target.staleMeasureId) {
    return createApplicationState(
      NAVIGATION_CANDIDATE_APPLICATION_STATUS.STALE,
      '마디가 변경되었습니다. 후보를 다시 찾아주세요.',
    );
  }

  if (candidate.type === VOLTA_CANDIDATE_TYPE) {
    return getVoltaApplicationState(candidate, safeMeasures, target.measure);
  }

  if (!isNavigationMarkerType(candidate.type)) {
    return createApplicationState(
      NAVIGATION_CANDIDATE_APPLICATION_STATUS.UNSUPPORTED,
      '지원하지 않는 Navigation 후보입니다.',
    );
  }

  if (hasNavigationMarker(target.measure, candidate.type)) {
    return createApplicationState(
      NAVIGATION_CANDIDATE_APPLICATION_STATUS.ALREADY_APPLIED,
      '이미 지정됨',
    );
  }

  const conflict = getExistingMarkerConflict(
    candidate,
    safeMeasures,
    target.measureIndex,
  );

  return conflict || createApplicationState(
    NAVIGATION_CANDIDATE_APPLICATION_STATUS.AVAILABLE,
    '',
  );
}

export function applyNavigationCandidate(candidate, measures, context) {
  const safeMeasures = Array.isArray(measures) ? measures : [];
  const applicationState = getNavigationCandidateApplicationState(
    candidate,
    safeMeasures,
    context,
  );

  if (applicationState.status !== NAVIGATION_CANDIDATE_APPLICATION_STATUS.AVAILABLE) {
    return { ...applicationState, changed: false, measures: safeMeasures };
  }

  const targetMeasure = safeMeasures[candidate.measureIndex];

  if (candidate.type === VOLTA_CANDIDATE_TYPE) {
    const ending = createManualNavigationEnding({
      passes: applicationState.passes,
      repeatEndMeasureId: applicationState.repeatSection.endMeasureId,
      repeatStartMeasureId: applicationState.repeatSection.startMeasureId,
      startMeasureId: targetMeasure.id,
    });

    if (!ending) {
      return {
        changed: false,
        measures: safeMeasures,
        message: '괄호를 적용하지 못했습니다.',
        status: NAVIGATION_CANDIDATE_APPLICATION_STATUS.UNSUPPORTED,
      };
    }

    return {
      changed: true,
      measures: attachNavigationEndings(
        safeMeasures,
        [...collectNavigationEndings(safeMeasures), ending],
      ),
      message: '적용했습니다.',
      status: NAVIGATION_CANDIDATE_APPLICATION_STATUS.APPLIED,
    };
  }

  const nextMeasures = safeMeasures.map((measure, measureIndex) => {
    if (measureIndex !== candidate.measureIndex) return measure;

    return {
      ...measure,
      navigationMarkers: [
        ...normalizeNavigationMarkers(measure.navigationMarkers),
        { type: candidate.type },
      ],
    };
  });

  return {
    changed: true,
    measures: nextMeasures,
    message: '적용했습니다.',
    status: NAVIGATION_CANDIDATE_APPLICATION_STATUS.APPLIED,
  };
}
