export const NAVIGATION_MARKER_TYPES = Object.freeze({
  DAL_SEGNO: 'dal-segno',
  REPEAT_END: 'repeat-end',
  REPEAT_START: 'repeat-start',
  SEGNO: 'segno',
});

export const NAVIGATION_MARKER_OPTIONS = Object.freeze([
  { description: '반복 시작', label: '||:', shortLabel: '||:', type: NAVIGATION_MARKER_TYPES.REPEAT_START },
  { description: '반복 끝', label: ':||', shortLabel: ':||', type: NAVIGATION_MARKER_TYPES.REPEAT_END },
  { label: 'Segno', shortLabel: 'Segno', type: NAVIGATION_MARKER_TYPES.SEGNO },
  { label: 'D.S.', shortLabel: 'D.S.', type: NAVIGATION_MARKER_TYPES.DAL_SEGNO },
]);

const VALID_NAVIGATION_MARKER_TYPES = new Set(
  NAVIGATION_MARKER_OPTIONS.map((option) => option.type),
);

function getMarkerType(marker) {
  return typeof marker === 'string' ? marker : marker?.type;
}

export function isNavigationMarkerType(value) {
  return typeof value === 'string' && VALID_NAVIGATION_MARKER_TYPES.has(value);
}

export function normalizeNavigationMarkers(markers) {
  if (!Array.isArray(markers)) return [];

  const seenTypes = new Set();

  return markers.flatMap((marker) => {
    const type = getMarkerType(marker);

    if (!isNavigationMarkerType(type) || seenTypes.has(type)) return [];

    seenTypes.add(type);
    return [{ type }];
  });
}

export function isValidNavigationMarkers(markers, { allowMissing = true } = {}) {
  if (markers === undefined && allowMissing) return true;
  if (!Array.isArray(markers)) return false;

  const normalizedMarkers = normalizeNavigationMarkers(markers);

  return (
    normalizedMarkers.length === markers.length &&
    markers.every(
      (marker, index) =>
        marker !== null &&
        typeof marker === 'object' &&
        !Array.isArray(marker) &&
        Object.keys(marker).length === 1 &&
        marker.type === normalizedMarkers[index].type,
    )
  );
}

export function hasNavigationMarker(measure, type) {
  if (!isNavigationMarkerType(type)) return false;

  return normalizeNavigationMarkers(measure?.navigationMarkers).some(
    (marker) => marker.type === type,
  );
}

export function toggleNavigationMarker(markers, type) {
  const normalizedMarkers = normalizeNavigationMarkers(markers);

  if (!isNavigationMarkerType(type)) return normalizedMarkers;

  return normalizedMarkers.some((marker) => marker.type === type)
    ? normalizedMarkers.filter((marker) => marker.type !== type)
    : [...normalizedMarkers, { type }];
}

export function getNavigationMarkerLabel(type) {
  return (
    NAVIGATION_MARKER_OPTIONS.find((option) => option.type === type)?.shortLabel ||
    type
  );
}

function getMeasureMarkerTypes(measure) {
  return new Set(
    normalizeNavigationMarkers(measure?.navigationMarkers).map(
      (marker) => marker.type,
    ),
  );
}

export function analyzeNavigationMarkers(measures) {
  const safeMeasures = Array.isArray(measures) ? measures : [];
  const issues = [];
  const repeatPairsByEndId = new Map();
  const segnoIndexes = [];
  const dalSegnoIndexes = [];
  let activeRepeatStart = null;
  let repeatRegionIsAmbiguous = false;

  safeMeasures.forEach((measure, measureIndex) => {
    const markerTypes = getMeasureMarkerTypes(measure);
    const measureNumber = measureIndex + 1;

    if (
      markerTypes.has(NAVIGATION_MARKER_TYPES.REPEAT_END) &&
      markerTypes.has(NAVIGATION_MARKER_TYPES.DAL_SEGNO)
    ) {
      issues.push({
        code: 'multiple-jump-actions',
        measureId: measure?.id || '',
        measureIndex,
        message: `${measureNumber}마디에 Repeat End와 D.S.를 함께 사용할 수 없습니다.`,
      });
    }

    if (markerTypes.has(NAVIGATION_MARKER_TYPES.SEGNO)) {
      segnoIndexes.push(measureIndex);
    }
    if (markerTypes.has(NAVIGATION_MARKER_TYPES.DAL_SEGNO)) {
      dalSegnoIndexes.push(measureIndex);
    }

    if (markerTypes.has(NAVIGATION_MARKER_TYPES.REPEAT_START)) {
      if (activeRepeatStart !== null) {
        issues.push({
          code: 'ambiguous-repeat',
          measureId: measure?.id || '',
          measureIndex,
          message: `${measureNumber}마디의 Repeat Start가 앞선 Repeat 구간과 겹칩니다.`,
        });
        repeatRegionIsAmbiguous = true;
      } else {
        activeRepeatStart = measureIndex;
      }
    }

    if (markerTypes.has(NAVIGATION_MARKER_TYPES.REPEAT_END)) {
      if (activeRepeatStart === null || repeatRegionIsAmbiguous) {
        issues.push({
          code:
            activeRepeatStart === null
              ? 'repeat-start-missing'
              : 'ambiguous-repeat',
          measureId: measure?.id || '',
          measureIndex,
          message: `${measureNumber}마디의 Repeat End에 유효한 Repeat Start가 없습니다.`,
        });
      } else if (safeMeasures[activeRepeatStart]?.id && measure?.id) {
        repeatPairsByEndId.set(measure.id, activeRepeatStart);
      }

      activeRepeatStart = null;
      repeatRegionIsAmbiguous = false;
    }
  });

  if (activeRepeatStart !== null) {
    issues.push({
      code: 'repeat-end-missing',
      measureId: safeMeasures[activeRepeatStart]?.id || '',
      measureIndex: activeRepeatStart,
      message: `${activeRepeatStart + 1}마디의 Repeat Start에 Repeat End가 없습니다.`,
    });
  }

  if (segnoIndexes.length > 1) {
    issues.push({
      code: 'multiple-segnos',
      measureId: '',
      measureIndex: -1,
      message: 'MVP에서는 Segno를 하나만 사용할 수 있습니다.',
    });
  }

  dalSegnoIndexes.forEach((measureIndex) => {
    const segnoIndex = segnoIndexes.length === 1 ? segnoIndexes[0] : -1;

    if (segnoIndex < 0) {
      issues.push({
        code: 'segno-missing',
        measureId: safeMeasures[measureIndex]?.id || '',
        measureIndex,
        message: `${measureIndex + 1}마디의 D.S.에 유효한 Segno가 없습니다.`,
      });
    } else if (segnoIndex >= measureIndex) {
      issues.push({
        code: 'segno-not-before-dal-segno',
        measureId: safeMeasures[measureIndex]?.id || '',
        measureIndex,
        message: `${measureIndex + 1}마디의 D.S.보다 앞에 Segno를 지정해주세요.`,
      });
    }
  });

  return {
    dalSegnoIndexes,
    issues,
    repeatPairsByEndId,
    segnoIndex: segnoIndexes.length === 1 ? segnoIndexes[0] : -1,
  };
}

export function getNavigationMarkerValidation(measures) {
  const { issues } = analyzeNavigationMarkers(measures);

  return {
    isValid: issues.length === 0,
    issues,
    message: issues[0]?.message || '',
  };
}
