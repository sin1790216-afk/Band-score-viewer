export const NAVIGATION_MARKER_TYPES = Object.freeze({
  CODA: 'coda',
  DAL_SEGNO: 'dal-segno',
  DAL_SEGNO_AL_CODA: 'dal-segno-al-coda',
  DAL_SEGNO_AL_FINE: 'dal-segno-al-fine',
  FINE: 'fine',
  REPEAT_END: 'repeat-end',
  REPEAT_START: 'repeat-start',
  SEGNO: 'segno',
  TO_CODA: 'to-coda',
});

export const NAVIGATION_REPEAT_POLICIES = Object.freeze({
  AUTO: 'auto',
  REPLAY: 'replay',
  SKIP: 'skip',
});

export const NAVIGATION_REPEAT_POLICY_OPTIONS = Object.freeze([
  { label: '자동', value: NAVIGATION_REPEAT_POLICIES.AUTO },
  { label: '다시 연주', value: NAVIGATION_REPEAT_POLICIES.REPLAY },
  { label: '건너뛰기', value: NAVIGATION_REPEAT_POLICIES.SKIP },
]);

export const NAVIGATION_MARKER_OPTIONS = Object.freeze([
  { description: '반복 시작', label: '||:', shortLabel: '||:', type: NAVIGATION_MARKER_TYPES.REPEAT_START },
  { description: '반복 끝', label: ':||', shortLabel: ':||', type: NAVIGATION_MARKER_TYPES.REPEAT_END },
  { displayKind: 'symbol', label: 'Segno', shortLabel: 'Segno', type: NAVIGATION_MARKER_TYPES.SEGNO },
  { label: 'D.S.', shortLabel: 'D.S.', type: NAVIGATION_MARKER_TYPES.DAL_SEGNO },
  { label: 'D.S. al Coda', shortLabel: 'D.S. al Coda', type: NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA },
  { label: 'To Coda', shortLabel: 'To Coda', type: NAVIGATION_MARKER_TYPES.TO_CODA },
  { displayKind: 'symbol', label: 'Coda', shortLabel: 'Coda', type: NAVIGATION_MARKER_TYPES.CODA },
  { label: 'D.S. al Fine', shortLabel: 'D.S. al Fine', type: NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE },
  { label: 'Fine', shortLabel: 'Fine', type: NAVIGATION_MARKER_TYPES.FINE },
]);

export const NAVIGATION_TARGET_MARKER_TYPES = Object.freeze([
  NAVIGATION_MARKER_TYPES.SEGNO,
  NAVIGATION_MARKER_TYPES.CODA,
]);

export const NAVIGATION_COMMAND_MARKER_TYPES = Object.freeze([
  NAVIGATION_MARKER_TYPES.DAL_SEGNO,
  NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
  NAVIGATION_MARKER_TYPES.TO_CODA,
  NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE,
]);

export const NAVIGATION_STOP_MARKER_TYPES = Object.freeze([
  NAVIGATION_MARKER_TYPES.FINE,
]);

const VALID_NAVIGATION_MARKER_TYPES = new Set(
  NAVIGATION_MARKER_OPTIONS.map((option) => option.type),
);
const VALID_NAVIGATION_REPEAT_POLICIES = new Set(
  Object.values(NAVIGATION_REPEAT_POLICIES),
);
const REPEAT_POLICY_MARKER_TYPES = new Set([
  NAVIGATION_MARKER_TYPES.DAL_SEGNO,
  NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
  NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE,
]);

function getMarkerType(marker) {
  return typeof marker === 'string' ? marker : marker?.type;
}

export function isNavigationMarkerType(value) {
  return typeof value === 'string' && VALID_NAVIGATION_MARKER_TYPES.has(value);
}

export function isNavigationRepeatPolicy(value) {
  return VALID_NAVIGATION_REPEAT_POLICIES.has(value);
}

export function supportsNavigationRepeatPolicy(type) {
  return REPEAT_POLICY_MARKER_TYPES.has(type);
}

export function getNavigationRepeatPolicy(marker) {
  return supportsNavigationRepeatPolicy(getMarkerType(marker)) &&
    isNavigationRepeatPolicy(marker?.repeatPolicy)
    ? marker.repeatPolicy
    : NAVIGATION_REPEAT_POLICIES.AUTO;
}

export function normalizeNavigationMarkers(markers) {
  if (!Array.isArray(markers)) return [];

  const seenTypes = new Set();

  return markers.flatMap((marker) => {
    const type = getMarkerType(marker);

    if (!isNavigationMarkerType(type) || seenTypes.has(type)) return [];

    const repeatPolicy = getNavigationRepeatPolicy(marker);
    const normalizedMarker = {
      type,
      ...(supportsNavigationRepeatPolicy(type) &&
      marker?.repeatPolicy !== undefined
        ? { repeatPolicy }
        : {}),
    };

    seenTypes.add(type);
    return [normalizedMarker];
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
        Object.keys(marker).every((key) =>
          ['repeatPolicy', 'type'].includes(key),
        ) &&
        marker.type === normalizedMarkers[index].type &&
        (marker.repeatPolicy === undefined ||
          (supportsNavigationRepeatPolicy(marker.type) &&
            isNavigationRepeatPolicy(marker.repeatPolicy))) &&
        Object.keys(marker).length === Object.keys(normalizedMarkers[index]).length &&
        marker.repeatPolicy === normalizedMarkers[index].repeatPolicy,
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

export function setNavigationMarkerRepeatPolicy(markers, type, repeatPolicy) {
  const normalizedMarkers = normalizeNavigationMarkers(markers);

  if (
    !supportsNavigationRepeatPolicy(type) ||
    !isNavigationRepeatPolicy(repeatPolicy)
  ) {
    return normalizedMarkers;
  }

  return normalizedMarkers.map((marker) =>
    marker.type === type ? { ...marker, repeatPolicy } : marker,
  );
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
  const codaIndexes = [];
  const dalSegnoAlCodaIndexes = [];
  const dalSegnoAlFineIndexes = [];
  const segnoIndexes = [];
  const dalSegnoIndexes = [];
  const fineIndexes = [];
  const toCodaIndexes = [];
  let activeRepeatStart = null;
  let repeatRegionIsAmbiguous = false;

  safeMeasures.forEach((measure, measureIndex) => {
    const markerTypes = getMeasureMarkerTypes(measure);
    const measureNumber = measureIndex + 1;

    const jumpActionTypes = [
      NAVIGATION_MARKER_TYPES.REPEAT_END,
      ...NAVIGATION_COMMAND_MARKER_TYPES,
    ].filter((type) => markerTypes.has(type));
    const isRepeatEndToCodaPair =
      jumpActionTypes.length === 2 &&
      jumpActionTypes.includes(NAVIGATION_MARKER_TYPES.REPEAT_END) &&
      jumpActionTypes.includes(NAVIGATION_MARKER_TYPES.TO_CODA);

    if (jumpActionTypes.length > 1 && !isRepeatEndToCodaPair) {
      issues.push({
        code: 'multiple-jump-actions',
        measureId: measure?.id || '',
        measureIndex,
        message: `${measureNumber}마디에 여러 Navigation 명령을 함께 사용할 수 없습니다.`,
      });
    }

    if (
      markerTypes.has(NAVIGATION_MARKER_TYPES.FINE) &&
      jumpActionTypes.length > 0
    ) {
      issues.push({
        code: 'multiple-navigation-actions',
        measureId: measure?.id || '',
        measureIndex,
        message: `${measureNumber}마디에 Fine과 다른 Navigation 명령을 함께 사용할 수 없습니다.`,
      });
    }

    if (markerTypes.has(NAVIGATION_MARKER_TYPES.SEGNO)) {
      segnoIndexes.push(measureIndex);
    }
    if (markerTypes.has(NAVIGATION_MARKER_TYPES.CODA)) {
      codaIndexes.push(measureIndex);
    }
    if (markerTypes.has(NAVIGATION_MARKER_TYPES.DAL_SEGNO)) {
      dalSegnoIndexes.push(measureIndex);
    }
    if (markerTypes.has(NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA)) {
      dalSegnoAlCodaIndexes.push(measureIndex);
    }
    if (markerTypes.has(NAVIGATION_MARKER_TYPES.TO_CODA)) {
      toCodaIndexes.push(measureIndex);
    }
    if (markerTypes.has(NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE)) {
      dalSegnoAlFineIndexes.push(measureIndex);
    }
    if (markerTypes.has(NAVIGATION_MARKER_TYPES.FINE)) {
      fineIndexes.push(measureIndex);
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

  if (codaIndexes.length > 1) {
    issues.push({
      code: 'multiple-codas',
      measureId: '',
      measureIndex: -1,
      message: 'MVP에서는 Coda 목적지를 하나만 사용할 수 있습니다.',
    });
  }

  if (fineIndexes.length > 1) {
    issues.push({
      code: 'multiple-fines',
      measureId: '',
      measureIndex: -1,
      message: 'MVP에서는 Fine을 하나만 사용할 수 있습니다.',
    });
  }

  const segnoCommandIndexes = [
    ...dalSegnoIndexes,
    ...dalSegnoAlCodaIndexes,
    ...dalSegnoAlFineIndexes,
  ];

  segnoCommandIndexes.forEach((measureIndex) => {
    const segnoIndex = segnoIndexes.length === 1 ? segnoIndexes[0] : -1;
    const markerTypes = getMeasureMarkerTypes(safeMeasures[measureIndex]);
    const commandLabel = markerTypes.has(
      NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
    )
      ? 'D.S. al Coda'
      : markerTypes.has(NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE)
        ? 'D.S. al Fine'
        : 'D.S.';

    if (segnoIndex < 0) {
      issues.push({
        code: 'segno-missing',
        measureId: safeMeasures[measureIndex]?.id || '',
        measureIndex,
        message: `${measureIndex + 1}마디의 ${commandLabel}에 유효한 Segno가 없습니다.`,
      });
    } else if (segnoIndex >= measureIndex) {
      issues.push({
        code: 'segno-not-before-dal-segno',
        measureId: safeMeasures[measureIndex]?.id || '',
        measureIndex,
        message: `${measureIndex + 1}마디의 ${commandLabel}보다 앞에 Segno를 지정해주세요.`,
      });
    }
  });

  dalSegnoAlCodaIndexes.forEach((measureIndex) => {
    if (codaIndexes.length !== 1) {
      issues.push({
        code: 'coda-target-invalid',
        measureId: safeMeasures[measureIndex]?.id || '',
        measureIndex,
        message: `${measureIndex + 1}마디의 D.S. al Coda에 유효한 Coda 목적지가 없습니다.`,
      });
    } else if (codaIndexes[0] <= measureIndex) {
      issues.push({
        code: 'coda-not-after-command',
        measureId: safeMeasures[measureIndex]?.id || '',
        measureIndex,
        message: `${measureIndex + 1}마디의 D.S. al Coda보다 뒤에 Coda를 지정해주세요.`,
      });
    }
    if (!toCodaIndexes.some((index) => index < measureIndex)) {
      issues.push({
        code: 'to-coda-missing',
        measureId: safeMeasures[measureIndex]?.id || '',
        measureIndex,
        message: `${measureIndex + 1}마디의 D.S. al Coda보다 앞에 To Coda를 지정해주세요.`,
      });
    }
  });

  toCodaIndexes.forEach((measureIndex) => {
    if (codaIndexes.length !== 1) {
      issues.push({
        code: 'coda-target-invalid',
        measureId: safeMeasures[measureIndex]?.id || '',
        measureIndex,
        message: `${measureIndex + 1}마디의 To Coda에 유효한 Coda 목적지가 없습니다.`,
      });
    } else if (codaIndexes[0] === measureIndex) {
      issues.push({
        code: 'coda-target-self',
        measureId: safeMeasures[measureIndex]?.id || '',
        measureIndex,
        message: `${measureIndex + 1}마디의 To Coda와 Coda 목적지를 같은 마디에 지정할 수 없습니다.`,
      });
    }
  });

  dalSegnoAlFineIndexes.forEach((measureIndex) => {
    if (fineIndexes.length !== 1) {
      issues.push({
        code: 'fine-target-invalid',
        measureId: safeMeasures[measureIndex]?.id || '',
        measureIndex,
        message: `${measureIndex + 1}마디의 D.S. al Fine에 유효한 Fine이 없습니다.`,
      });
    } else if (
      segnoIndexes.length === 1 &&
      (fineIndexes[0] < segnoIndexes[0] || fineIndexes[0] >= measureIndex)
    ) {
      issues.push({
        code: 'fine-not-on-return-path',
        measureId: safeMeasures[measureIndex]?.id || '',
        measureIndex,
        message: `${measureIndex + 1}마디의 D.S. al Fine 반환 경로에 Fine을 지정해주세요.`,
      });
    }
  });

  return {
    codaIndex: codaIndexes.length === 1 ? codaIndexes[0] : -1,
    codaIndexes,
    dalSegnoAlCodaIndexes,
    dalSegnoAlFineIndexes,
    dalSegnoIndexes,
    fineIndex: fineIndexes.length === 1 ? fineIndexes[0] : -1,
    fineIndexes,
    issues,
    repeatPairsByEndId,
    segnoIndex: segnoIndexes.length === 1 ? segnoIndexes[0] : -1,
    segnoIndexes,
    toCodaIndexes,
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
