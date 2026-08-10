export const MAX_SHARED_AUDIO_BYTES = 100 * 1024 * 1024;
export const MAX_SHARED_AUDIO_FILE_NAME_LENGTH = 256;

export const SHARED_AUDIO_EVENTS = Object.freeze({
  REMOVE: 'shared-audio:remove',
  STATE: 'shared-audio:state',
  UPDATE: 'shared-audio:update',
});

export const AUDIO_SOURCE_TYPES = Object.freeze({
  STUDENT_PERSONAL_LOCAL: 'student-personal-local',
  TEACHER_SHARED_LOCAL: 'teacher-shared-local',
});

const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const AUDIO_MIME_TYPE_PATTERN = /^audio\/[A-Za-z0-9][A-Za-z0-9.+-]*$/i;

export function isAudioMimeType(mimeType) {
  return (
    typeof mimeType === 'string' &&
    mimeType.length <= 128 &&
    AUDIO_MIME_TYPE_PATTERN.test(mimeType)
  );
}

export function isSupportedSharedAudioFile(file) {
  return Boolean(
    file &&
      typeof file.name === 'string' &&
      file.name.trim().length > 0 &&
      file.name.trim().length <= MAX_SHARED_AUDIO_FILE_NAME_LENGTH &&
      isAudioMimeType(file.type) &&
      Number.isFinite(file.size) &&
      file.size > 0 &&
      file.size <= MAX_SHARED_AUDIO_BYTES,
  );
}

export function getSharedAudioAssetPath(assetId) {
  return ASSET_ID_PATTERN.test(assetId || '')
    ? `/shared-audio/${encodeURIComponent(assetId)}`
    : '';
}

export function normalizeSharedAudioMetadata(metadata) {
  const assetId =
    typeof metadata?.assetId === 'string' ? metadata.assetId.trim() : '';
  const fileName =
    typeof metadata?.fileName === 'string' ? metadata.fileName.trim() : '';
  const byteLength = Number(metadata?.byteLength);
  const revision = Number(metadata?.revision);

  if (
    !ASSET_ID_PATTERN.test(assetId) ||
    !fileName ||
    fileName.length > MAX_SHARED_AUDIO_FILE_NAME_LENGTH ||
    !isAudioMimeType(metadata?.mimeType) ||
    !Number.isInteger(byteLength) ||
    byteLength <= 0 ||
    byteLength > MAX_SHARED_AUDIO_BYTES ||
    !Number.isInteger(revision) ||
    revision <= 0
  ) {
    return null;
  }

  return {
    assetId,
    assetPath: getSharedAudioAssetPath(assetId),
    byteLength,
    fileName,
    mimeType: metadata.mimeType,
    revision,
  };
}

export function createSharedAudioIdentity(metadata) {
  const normalizedMetadata = normalizeSharedAudioMetadata(metadata);

  if (!normalizedMetadata) return '';

  return [
    AUDIO_SOURCE_TYPES.TEACHER_SHARED_LOCAL,
    normalizedMetadata.assetId,
    normalizedMetadata.revision,
  ].join(':');
}

export function getSharedAudioAssetUrl(metadata, serverUrl) {
  const normalizedMetadata = normalizeSharedAudioMetadata(metadata);

  if (!normalizedMetadata || !serverUrl) return '';

  try {
    return new URL(normalizedMetadata.assetPath, serverUrl).href;
  } catch {
    return '';
  }
}

export function getSelectedAudioAsset({
  personalAudioFile,
  personalAudioFileName,
  personalAudioIdentity,
  personalAudioUrl,
  selectedSource,
  sharedAudioFile,
  sharedAudioMetadata,
  sharedAudioUrl,
}) {
  if (selectedSource === AUDIO_SOURCE_TYPES.TEACHER_SHARED_LOCAL) {
    const normalizedMetadata = normalizeSharedAudioMetadata(sharedAudioMetadata);

    return normalizedMetadata && sharedAudioUrl
      ? {
          audioFile: sharedAudioFile || null,
          fileName: normalizedMetadata.fileName,
          identity: createSharedAudioIdentity(normalizedMetadata),
          sourceUrl: sharedAudioUrl,
          type: AUDIO_SOURCE_TYPES.TEACHER_SHARED_LOCAL,
        }
      : null;
  }

  return personalAudioUrl
    ? {
        audioFile: personalAudioFile || null,
        fileName: personalAudioFileName || '',
        identity: personalAudioIdentity || '',
        sourceUrl: personalAudioUrl,
        type: AUDIO_SOURCE_TYPES.STUDENT_PERSONAL_LOCAL,
      }
    : null;
}
