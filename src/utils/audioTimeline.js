export const STUDENT_AUDIO_TIMELINE_STORAGE_KEY =
  'band-score-viewer.student-audio-timelines.v1';
export const STUDENT_AUDIO_TIMELINE_VERSION = 1;

const MAX_AUDIO_FILE_NAME_LENGTH = 256;
const MAX_AUDIO_TIME_SECONDS = 172_800;
const MAX_TIMELINE_MARKERS = 10_000;

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
    if (!timelineKey || !Array.isArray(timeline?.markers)) return;

    const markersByMeasureId = new Map();

    timeline.markers.slice(0, MAX_TIMELINE_MARKERS).forEach((marker) => {
      const normalizedMarker = normalizeMarker(marker);

      if (normalizedMarker) {
        markersByMeasureId.set(normalizedMarker.measureId, normalizedMarker);
      }
    });

    timelines[timelineKey] = {
      markers: Array.from(markersByMeasureId.values()),
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
      [timelineKey]: { markers },
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
        markers: normalizedLibrary.timelines[timelineKey].markers.filter(
          (marker) => marker.measureId !== measureId,
        ),
      },
    },
  };
}
