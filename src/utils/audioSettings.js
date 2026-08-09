export const MAX_AUDIO_URL_LENGTH = 2_048;
export const STUDENT_AUDIO_SETTINGS_STORAGE_KEY =
  'band-score-viewer.student-audio-settings.v1';
export const STUDENT_AUDIO_SETTINGS_VERSION = 1;
export const TEACHER_AUDIO_SOURCE = 'teacher';
export const LOCAL_AUDIO_SOURCE = 'local';

export const DEFAULT_AUDIO_SETTINGS = {
  startOffsetSeconds: 0,
  url: '',
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isValidAudioSettings(audioSettings) {
  return (
    isObject(audioSettings) &&
    typeof audioSettings.url === 'string' &&
    audioSettings.url.length <= MAX_AUDIO_URL_LENGTH &&
    Number.isFinite(audioSettings.startOffsetSeconds) &&
    audioSettings.startOffsetSeconds >= 0
  );
}

export function normalizeAudioSettings(audioSettings) {
  const rawStartOffsetSeconds = Number(audioSettings?.startOffsetSeconds);
  const startOffsetSeconds =
    Number.isFinite(rawStartOffsetSeconds) && rawStartOffsetSeconds >= 0
      ? rawStartOffsetSeconds
      : DEFAULT_AUDIO_SETTINGS.startOffsetSeconds;
  const url =
    typeof audioSettings?.url === 'string'
      ? audioSettings.url.trim().slice(0, MAX_AUDIO_URL_LENGTH)
      : DEFAULT_AUDIO_SETTINGS.url;

  return {
    startOffsetSeconds,
    url,
  };
}

export function getOpenableAudioUrl(url) {
  try {
    const parsedUrl = new URL(url);

    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:'
      ? parsedUrl.href
      : '';
  } catch {
    return '';
  }
}

export function normalizeStudentAudioSettingsLibrary(value) {
  const sourceDocuments =
    value?.version === STUDENT_AUDIO_SETTINGS_VERSION &&
    isObject(value.documents)
      ? value.documents
      : {};
  const documents = {};

  Object.entries(sourceDocuments).forEach(([documentKey, audioSettings]) => {
    if (!documentKey || !isObject(audioSettings)) return;

    documents[documentKey] = normalizeAudioSettings(audioSettings);
  });

  return {
    documents,
    version: STUDENT_AUDIO_SETTINGS_VERSION,
  };
}

export function loadStudentAudioSettingsLibrary(storage) {
  if (!storage?.getItem) return normalizeStudentAudioSettingsLibrary(null);

  try {
    const storedValue = storage.getItem(STUDENT_AUDIO_SETTINGS_STORAGE_KEY);

    return normalizeStudentAudioSettingsLibrary(
      storedValue ? JSON.parse(storedValue) : null,
    );
  } catch {
    return normalizeStudentAudioSettingsLibrary(null);
  }
}

export function saveStudentAudioSettingsLibrary(storage, library) {
  if (!storage?.setItem) return false;

  try {
    storage.setItem(
      STUDENT_AUDIO_SETTINGS_STORAGE_KEY,
      JSON.stringify(normalizeStudentAudioSettingsLibrary(library)),
    );
    return true;
  } catch {
    return false;
  }
}

export function getStudentAudioSettings(library, documentKey) {
  if (!documentKey) return { ...DEFAULT_AUDIO_SETTINGS };

  return normalizeAudioSettings(library?.documents?.[documentKey]);
}

export function setStudentAudioSettings(library, documentKey, audioSettings) {
  const normalizedLibrary = normalizeStudentAudioSettingsLibrary(library);

  if (!documentKey) return normalizedLibrary;

  return {
    documents: {
      ...normalizedLibrary.documents,
      [documentKey]: normalizeAudioSettings(audioSettings),
    },
    version: STUDENT_AUDIO_SETTINGS_VERSION,
  };
}
