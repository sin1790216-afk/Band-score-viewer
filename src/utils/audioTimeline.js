export const STUDENT_AUDIO_TIMELINE_STORAGE_KEY =
  'band-score-viewer.student-audio-timelines.v1';
export const STUDENT_AUDIO_TIMELINE_VERSION = 1;

const MAX_AUDIO_FILE_NAME_LENGTH = 256;
const MAX_AUDIO_TIME_SECONDS = 172_800;
const MAX_TIMELINE_MARKERS = 10_000;
const MAX_TIMING_VALUE = 10_000;
const DEFAULT_TIMELINE_BPM = 120;
const DEFAULT_TIMELINE_BEATS = 4;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMarker(marker) {
  const measureId = typeof marker?.measureId === 'string' ? marker.measureId.trim() : '';
  const timeSeconds = Number(marker?.timeSeconds);

  if (
    !measureId ||
    !Number.isFinite(timeSeconds) ||
    timeSeconds < 0 ||
    timeSeconds > MAX_AUDIO_TIME_SECONDS
  ) {
    return null;
  }

  return {
    measureId,
    timeSeconds: Number(timeSeconds.toFixed(3)),
  };
}

function normalizeMeasureTiming(timing) {
  const measureId = typeof timing?.measureId === 'string' ? timing.measureId.trim() : '';
  const bpm = Number(timing?.bpm);
  const beats = Number(timing?.beats);

  if (
    !measureId ||
    !Number.isFinite(bpm) ||
    bpm <= 0 ||
    bpm > MAX_TIMING_VALUE ||
    !Number.isFinite(beats) ||
    beats <= 0 ||
    beats > MAX_TIMING_VALUE
  ) {
    return null;
  }

  return {
    beats: Number(beats.toFixed(3)),
    bpm: Number(bpm.toFixed(3)),
    measureId,
  };
}

export function createLocalAudioIdentity(file) {
  if (!file || typeof file.name !== 'string') return '';

  const fileName = file.name.trim().slice(0, MAX_AUDIO_FILE_NAME_LENGTH);
  const size = Number(file.size);
  const lastModified = Number(file.lastModified);

  if (!fileName || !Number.isFinite(size) || size < 0) return '';

  return [
    'local-audio',
    encodeURIComponent(fileName),
    size,
    Number.isFinite(lastModified) && lastModified >= 0 ? lastModified : 0,
  ].join(':');
}

export function createStudentAudioTimelineKey(documentKey, audioIdentity) {
  if (!documentKey || !audioIdentity) return '';

  return `${documentKey}|${audioIdentity}`;
}

export function normalizeStudentAudioTimelineLibrary(value) {
  const sourceTimelines =
    value?.version === STUDENT_AUDIO_TIMELINE_VERSION && isObject(value.timelines)
      ? value.timelines
      : {};
  const timelines = {};

  Object.entries(sourceTimelines).forEach(([timelineKey, timeline]) => {
    if (!timelineKey || !isObject(timeline)) return;

    const markersByMeasureId = new Map();
    const timingsByMeasureId = new Map();

    const sourceMarkers = Array.isArray(timeline.markers) ? timeline.markers : [];
    const sourceTimings = Array.isArray(timeline.timings) ? timeline.timings : [];

    sourceMarkers.slice(0, MAX_TIMELINE_MARKERS).forEach((marker) => {
      const normalizedMarker = normalizeMarker(marker);

      if (normalizedMarker) {
        markersByMeasureId.set(normalizedMarker.measureId, normalizedMarker);
      }
    });

    sourceTimings.slice(0, MAX_TIMELINE_MARKERS).forEach((timing) => {
      const normalizedTiming = normalizeMeasureTiming(timing);

      if (normalizedTiming) {
        timingsByMeasureId.set(normalizedTiming.measureId, normalizedTiming);
      }
    });

    timelines[timelineKey] = {
      markers: Array.from(markersByMeasureId.values()),
      timings: Array.from(timingsByMeasureId.values()),
    };
  });

  return {
    timelines,
    version: STUDENT_AUDIO_TIMELINE_VERSION,
  };
}

export function loadStudentAudioTimelineLibrary(storage) {
  if (!storage?.getItem) return normalizeStudentAudioTimelineLibrary(null);

  try {
    const storedValue = storage.getItem(STUDENT_AUDIO_TIMELINE_STORAGE_KEY);

    return normalizeStudentAudioTimelineLibrary(
      storedValue ? JSON.parse(storedValue) : null,
    );
  } catch {
    return normalizeStudentAudioTimelineLibrary(null);
  }
}

export function saveStudentAudioTimelineLibrary(storage, library) {
  if (!storage?.setItem) return false;

  try {
    storage.setItem(
      STUDENT_AUDIO_TIMELINE_STORAGE_KEY,
      JSON.stringify(normalizeStudentAudioTimelineLibrary(library)),
    );
    return true;
  } catch {
    return false;
  }
}

export function getStudentAudioTimelineMarkers(library, timelineKey) {
  if (!timelineKey) return [];

  const normalizedLibrary = normalizeStudentAudioTimelineLibrary(library);

  return normalizedLibrary.timelines[timelineKey]?.markers || [];
}

export function getMeasureTimelineTime(markers, measureId) {
  const marker = Array.isArray(markers)
    ? markers.find((candidate) => candidate.measureId === measureId)
    : null;

  return marker?.timeSeconds ?? null;
}

export function setFirstMeasureTimelineAnchor(
  markers,
  firstMeasureId,
  timeSeconds,
) {
  const normalizedFirstMeasureId =
    typeof firstMeasureId === 'string' ? firstMeasureId.trim() : '';
  const normalizedMarkers = Array.isArray(markers)
    ? markers.map(normalizeMarker).filter(Boolean)
    : [];

  if (!normalizedFirstMeasureId) return normalizedMarkers;

  const markersWithoutFirstMeasure = normalizedMarkers.filter(
    (marker) => marker.measureId !== normalizedFirstMeasureId,
  );
  if (timeSeconds === null || timeSeconds === undefined || timeSeconds === '') {
    return markersWithoutFirstMeasure;
  }

  const firstMeasureMarker = normalizeMarker({
    measureId: normalizedFirstMeasureId,
    timeSeconds,
  });

  return firstMeasureMarker
    ? [firstMeasureMarker, ...markersWithoutFirstMeasure]
    : markersWithoutFirstMeasure;
}

export function getAudioTimelinePlaybackMarkers({
  firstMeasureId,
  markers,
  teacherFirstMeasureAnchorSeconds,
  useTeacherFirstMeasureAnchor,
}) {
  const normalizedMarkers = Array.isArray(markers)
    ? markers.map(normalizeMarker).filter(Boolean)
    : [];

  return useTeacherFirstMeasureAnchor
    ? setFirstMeasureTimelineAnchor(
        normalizedMarkers,
        firstMeasureId,
        teacherFirstMeasureAnchorSeconds,
      )
    : normalizedMarkers;
}

function getTimelineTimingValue(value, fallbackValue) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) &&
    numberValue > 0 &&
    numberValue <= MAX_TIMING_VALUE
    ? numberValue
    : fallbackValue;
}

function getMeasureDurationSeconds(measure, personalTiming) {
  const bpm = getTimelineTimingValue(
    personalTiming?.bpm,
    getTimelineTimingValue(measure?.bpm, DEFAULT_TIMELINE_BPM),
  );
  const beats = getTimelineTimingValue(
    personalTiming?.beats,
    getTimelineTimingValue(measure?.beats, DEFAULT_TIMELINE_BEATS),
  );

  return (60 / bpm) * beats;
}

export function createAudioTimelineAnchor({
  measureNumber,
  measures,
  positionSeconds,
}) {
  const normalizedMeasureNumber = Number(measureNumber);
  const normalizedPositionSeconds = Number(positionSeconds);

  if (
    !Array.isArray(measures) ||
    !Number.isInteger(normalizedMeasureNumber) ||
    normalizedMeasureNumber < 1 ||
    normalizedMeasureNumber > measures.length ||
    !Number.isFinite(normalizedPositionSeconds) ||
    normalizedPositionSeconds < 0 ||
    normalizedPositionSeconds > MAX_AUDIO_TIME_SECONDS
  ) {
    return null;
  }

  const measureIndex = normalizedMeasureNumber - 1;
  const measureId =
    typeof measures[measureIndex]?.id === 'string'
      ? measures[measureIndex].id.trim()
      : '';

  return {
    measureId: measureId || null,
    measureIndex,
    positionSeconds: Number(normalizedPositionSeconds.toFixed(3)),
  };
}

export function getAudioTimelineAnchorMeasureIndex(anchor, measures) {
  if (!anchor || !Array.isArray(measures) || measures.length === 0) return -1;

  const measureId =
    typeof anchor.measureId === 'string' ? anchor.measureId.trim() : '';
  const measureIdIndex = measureId
    ? measures.findIndex((measure) => measure?.id === measureId)
    : -1;

  if (measureId) return measureIdIndex;

  const measureIndex = Number(anchor.measureIndex);

  return Number.isInteger(measureIndex) &&
    measureIndex >= 0 &&
    measureIndex < measures.length
    ? measureIndex
    : -1;
}

function calculateAudioTimelineStartTimes({
  anchor,
  measures,
  timings,
}) {
  const anchorMeasureIndex = getAudioTimelineAnchorMeasureIndex(
    anchor,
    measures,
  );
  const anchorPositionSeconds = Number(anchor?.positionSeconds);

  if (
    anchorMeasureIndex < 0 ||
    !Number.isFinite(anchorPositionSeconds) ||
    anchorPositionSeconds < 0 ||
    anchorPositionSeconds > MAX_AUDIO_TIME_SECONDS
  ) {
    return null;
  }

  const timingsByMeasureId = new Map();

  if (Array.isArray(timings)) {
    timings.forEach((timing) => {
      const normalizedTiming = normalizeMeasureTiming(timing);

      if (normalizedTiming) {
        timingsByMeasureId.set(normalizedTiming.measureId, normalizedTiming);
      }
    });
  }

  const startTimes = new Array(
    Math.min(measures.length, MAX_TIMELINE_MARKERS),
  );

  if (anchorMeasureIndex >= startTimes.length) return null;

  startTimes[anchorMeasureIndex] = anchorPositionSeconds;

  for (let index = anchorMeasureIndex - 1; index >= 0; index -= 1) {
    const measure = measures[index];

    startTimes[index] =
      startTimes[index + 1] -
      getMeasureDurationSeconds(
        measure,
        timingsByMeasureId.get(measure?.id),
      );
  }

  for (
    let index = anchorMeasureIndex + 1;
    index < startTimes.length;
    index += 1
  ) {
    const previousMeasure = measures[index - 1];

    startTimes[index] =
      startTimes[index - 1] +
      getMeasureDurationSeconds(
        previousMeasure,
        timingsByMeasureId.get(previousMeasure?.id),
      );
  }

  return { anchorMeasureIndex, startTimes };
}

export function getAudioTimelineFirstMeasureStartSeconds(options) {
  const calculation = calculateAudioTimelineStartTimes(options);
  const firstMeasureStartSeconds = calculation?.startTimes[0];

  return Number.isFinite(firstMeasureStartSeconds)
    ? Number(firstMeasureStartSeconds.toFixed(3))
    : null;
}

export function getAudioTimelineMarkersFromAnchor(options) {
  const calculation = calculateAudioTimelineStartTimes(options);

  if (!calculation) return [];

  const { anchorMeasureIndex, startTimes } = calculation;
  const { measures } = options;

  return startTimes
    .map((timeSeconds, index) => {
      const measureId =
        typeof measures[index]?.id === 'string' ? measures[index].id.trim() : '';

      return measureId &&
        Number.isFinite(timeSeconds) &&
        timeSeconds >= 0 &&
        timeSeconds <= MAX_AUDIO_TIME_SECONDS
        ? {
            measureId,
            source: index === anchorMeasureIndex ? 'anchor' : 'calculated',
            timeSeconds: Number(timeSeconds.toFixed(3)),
          }
        : null;
    })
    .filter(Boolean);
}

export function getEffectiveAudioTimelineMarkers({
  markers,
  measures,
  timings,
}) {
  if (!Array.isArray(measures) || measures.length === 0) return [];

  const explicitMarkersByMeasureId = new Map();
  const personalTimingsByMeasureId = new Map();

  if (Array.isArray(markers)) {
    markers.forEach((marker) => {
      const normalizedMarker = normalizeMarker(marker);

      if (normalizedMarker) {
        explicitMarkersByMeasureId.set(
          normalizedMarker.measureId,
          normalizedMarker,
        );
      }
    });
  }

  if (Array.isArray(timings)) {
    timings.forEach((timing) => {
      const normalizedTiming = normalizeMeasureTiming(timing);

      if (normalizedTiming) {
        personalTimingsByMeasureId.set(
          normalizedTiming.measureId,
          normalizedTiming,
        );
      }
    });
  }

  const effectiveMarkers = [];
  let previousMeasure = null;
  let previousTimeSeconds = null;

  measures.slice(0, MAX_TIMELINE_MARKERS).forEach((measure) => {
    const measureId =
      typeof measure?.id === 'string' ? measure.id.trim() : '';

    if (!measureId) {
      previousMeasure = null;
      previousTimeSeconds = null;
      return;
    }

    const explicitMarker = explicitMarkersByMeasureId.get(measureId);
    let timeSeconds = explicitMarker?.timeSeconds ?? null;
    let source = 'explicit';

    if (timeSeconds === null && previousMeasure && previousTimeSeconds !== null) {
      timeSeconds =
        previousTimeSeconds +
        getMeasureDurationSeconds(
          previousMeasure,
          personalTimingsByMeasureId.get(previousMeasure.id),
        );
      source = 'calculated';
    }

    if (
      timeSeconds === null ||
      !Number.isFinite(timeSeconds) ||
      timeSeconds > MAX_AUDIO_TIME_SECONDS
    ) {
      previousMeasure = null;
      previousTimeSeconds = null;
      return;
    }

    const roundedTimeSeconds = Number(timeSeconds.toFixed(3));

    effectiveMarkers.push({
      measureId,
      source,
      timeSeconds: roundedTimeSeconds,
    });
    previousMeasure = measure;
    previousTimeSeconds = roundedTimeSeconds;
  });

  return effectiveMarkers;
}

export function getAudioTimelineMarkerAtTime(markers, timeSeconds) {
  const safeTime = Number(timeSeconds);

  if (!Number.isFinite(safeTime) || safeTime < 0 || !Array.isArray(markers)) {
    return null;
  }

  return markers.reduce((activeMarker, candidate) => {
    const marker = normalizeMarker(candidate);

    if (
      !marker ||
      marker.timeSeconds > safeTime ||
      (activeMarker && marker.timeSeconds < activeMarker.timeSeconds)
    ) {
      return activeMarker;
    }

    return marker;
  }, null);
}

export function getStudentAudioTimelineTimings(library, timelineKey) {
  if (!timelineKey) return [];

  const normalizedLibrary = normalizeStudentAudioTimelineLibrary(library);

  return normalizedLibrary.timelines[timelineKey]?.timings || [];
}

export function getAudioTimelinePlaybackTimings(
  personalTimings,
  useTeacherTempo,
) {
  if (useTeacherTempo) return [];

  return Array.isArray(personalTimings)
    ? personalTimings.map(normalizeMeasureTiming).filter(Boolean)
    : [];
}

export function getMeasureTimelineTiming(timings, measureId) {
  const timing = Array.isArray(timings)
    ? timings.find((candidate) => candidate.measureId === measureId)
    : null;

  return timing || null;
}

export function setStudentAudioTimelineMarker(
  library,
  timelineKey,
  nextMarker,
) {
  const normalizedLibrary = normalizeStudentAudioTimelineLibrary(library);
  const normalizedMarker = normalizeMarker(nextMarker);

  if (!timelineKey || !normalizedMarker) return normalizedLibrary;

  const previousMarkers = normalizedLibrary.timelines[timelineKey]?.markers || [];
  const markerIndex = previousMarkers.findIndex(
    (marker) => marker.measureId === normalizedMarker.measureId,
  );
  const markers =
    markerIndex >= 0
      ? previousMarkers.map((marker, index) =>
          index === markerIndex ? normalizedMarker : marker,
        )
      : [...previousMarkers, normalizedMarker].slice(-MAX_TIMELINE_MARKERS);

  return {
    ...normalizedLibrary,
    timelines: {
      ...normalizedLibrary.timelines,
      [timelineKey]: {
        ...normalizedLibrary.timelines[timelineKey],
        markers,
        timings: normalizedLibrary.timelines[timelineKey]?.timings || [],
      },
    },
  };
}

export function removeStudentAudioTimelineMarker(
  library,
  timelineKey,
  measureId,
) {
  const normalizedLibrary = normalizeStudentAudioTimelineLibrary(library);

  if (!timelineKey || !measureId || !normalizedLibrary.timelines[timelineKey]) {
    return normalizedLibrary;
  }

  return {
    ...normalizedLibrary,
    timelines: {
      ...normalizedLibrary.timelines,
      [timelineKey]: {
        ...normalizedLibrary.timelines[timelineKey],
        markers: normalizedLibrary.timelines[timelineKey].markers.filter(
          (marker) => marker.measureId !== measureId,
        ),
      },
    },
  };
}

export function setStudentAudioTimelineTiming(
  library,
  timelineKey,
  nextTiming,
) {
  const normalizedLibrary = normalizeStudentAudioTimelineLibrary(library);
  const normalizedTiming = normalizeMeasureTiming(nextTiming);

  if (!timelineKey || !normalizedTiming) return normalizedLibrary;

  const previousTimings = normalizedLibrary.timelines[timelineKey]?.timings || [];
  const timingIndex = previousTimings.findIndex(
    (timing) => timing.measureId === normalizedTiming.measureId,
  );
  const timings =
    timingIndex >= 0
      ? previousTimings.map((timing, index) =>
          index === timingIndex ? normalizedTiming : timing,
        )
      : [...previousTimings, normalizedTiming].slice(-MAX_TIMELINE_MARKERS);

  return {
    ...normalizedLibrary,
    timelines: {
      ...normalizedLibrary.timelines,
      [timelineKey]: {
        ...normalizedLibrary.timelines[timelineKey],
        markers: normalizedLibrary.timelines[timelineKey]?.markers || [],
        timings,
      },
    },
  };
}

export function applyStudentAudioTimelineBpm(
  library,
  timelineKey,
  measures,
  nextBpm,
) {
  const normalizedLibrary = normalizeStudentAudioTimelineLibrary(library);
  const bpm = getTimelineTimingValue(nextBpm, 0);

  if (!timelineKey || !bpm || !Array.isArray(measures)) {
    return normalizedLibrary;
  }

  const previousTimings = new Map(
    (normalizedLibrary.timelines[timelineKey]?.timings || []).map((timing) => [
      timing.measureId,
      timing,
    ]),
  );
  const timings = measures
    .slice(0, MAX_TIMELINE_MARKERS)
    .map((measure) => {
      const measureId =
        typeof measure?.id === 'string' ? measure.id.trim() : '';

      if (!measureId) return null;

      return {
        beats: getTimelineTimingValue(
          previousTimings.get(measureId)?.beats,
          getTimelineTimingValue(measure.beats, DEFAULT_TIMELINE_BEATS),
        ),
        bpm,
        measureId,
      };
    })
    .filter(Boolean);

  return {
    ...normalizedLibrary,
    timelines: {
      ...normalizedLibrary.timelines,
      [timelineKey]: {
        ...normalizedLibrary.timelines[timelineKey],
        markers: normalizedLibrary.timelines[timelineKey]?.markers || [],
        timings,
      },
    },
  };
}

export function removeStudentAudioTimelineTiming(
  library,
  timelineKey,
  measureId,
) {
  const normalizedLibrary = normalizeStudentAudioTimelineLibrary(library);

  if (!timelineKey || !measureId || !normalizedLibrary.timelines[timelineKey]) {
    return normalizedLibrary;
  }

  return {
    ...normalizedLibrary,
    timelines: {
      ...normalizedLibrary.timelines,
      [timelineKey]: {
        ...normalizedLibrary.timelines[timelineKey],
        timings: normalizedLibrary.timelines[timelineKey].timings.filter(
          (timing) => timing.measureId !== measureId,
        ),
      },
    },
  };
}
