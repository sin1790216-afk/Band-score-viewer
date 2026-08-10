import {
  AUDIO_SOURCE_TYPES,
  normalizeSharedAudioMetadata,
} from './sharedAudio.js';

export const SHARED_AUDIO_PLAYBACK_COMMANDS = Object.freeze({
  PAUSE: 'pause',
  PLAY: 'play',
  RATE: 'rate',
  RESET: 'reset',
  SEEK: 'seek',
});

export const STUDENT_SHARED_AUDIO_MODES = Object.freeze({
  FOLLOW: 'follow',
  PRACTICE: 'practice',
});

export const SHARED_AUDIO_DRIFT_THRESHOLD_SECONDS = 0.35;
export const SHARED_AUDIO_DRIFT_CHECK_INTERVAL_MS = 5_000;

const MAX_AUDIO_POSITION_SECONDS = 172_800;
const MIN_PLAYBACK_RATE = 0.25;
const MAX_PLAYBACK_RATE = 4;
const PLAYBACK_COMMAND_VALUES = new Set(
  Object.values(SHARED_AUDIO_PLAYBACK_COMMANDS),
);

function normalizePositionSeconds(value) {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) &&
    numericValue >= 0 &&
    numericValue <= MAX_AUDIO_POSITION_SECONDS
    ? Number(numericValue.toFixed(3))
    : null;
}

export function normalizeSharedAudioPlaybackRate(value) {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) &&
    numericValue >= MIN_PLAYBACK_RATE &&
    numericValue <= MAX_PLAYBACK_RATE
    ? Number(numericValue.toFixed(3))
    : null;
}

export function normalizeSharedAudioPlaybackSnapshot(snapshot) {
  const assetId =
    typeof snapshot?.assetId === 'string' ? snapshot.assetId.trim() : '';
  const revision = Number(snapshot?.revision);
  const sequence = Number(snapshot?.sequence);
  const anchorPositionSeconds = normalizePositionSeconds(
    snapshot?.anchorPositionSeconds,
  );
  const playbackRate = normalizeSharedAudioPlaybackRate(
    snapshot?.playbackRate,
  );
  const anchorServerTimeMs = Number(snapshot?.anchorServerTimeMs);
  const command = PLAYBACK_COMMAND_VALUES.has(snapshot?.command)
    ? snapshot.command
    : '';

  if (
    !assetId ||
    !Number.isInteger(revision) ||
    revision <= 0 ||
    !Number.isSafeInteger(sequence) ||
    sequence <= 0 ||
    anchorPositionSeconds === null ||
    playbackRate === null ||
    !Number.isFinite(anchorServerTimeMs) ||
    anchorServerTimeMs <= 0 ||
    !command
  ) {
    return null;
  }

  return {
    anchorPositionSeconds,
    anchorServerTimeMs,
    assetId,
    command,
    isPlaying: Boolean(snapshot.isPlaying),
    playbackRate,
    revision,
    sequence,
  };
}

export function createSharedAudioPlaybackSnapshot({
  command,
  metadata,
  payload = {},
  sequence,
  serverTimeMs,
}) {
  const normalizedMetadata = normalizeSharedAudioMetadata(metadata);

  if (!normalizedMetadata) {
    throw new Error('재생 상태에 연결할 공용 음원이 없습니다.');
  }

  const normalizedSnapshot = normalizeSharedAudioPlaybackSnapshot({
    anchorPositionSeconds:
      command === SHARED_AUDIO_PLAYBACK_COMMANDS.RESET
        ? 0
        : payload.anchorPositionSeconds,
    anchorServerTimeMs: serverTimeMs,
    assetId: normalizedMetadata.assetId,
    command,
    isPlaying:
      command === SHARED_AUDIO_PLAYBACK_COMMANDS.RESET
        ? false
        : payload.isPlaying,
    playbackRate:
      command === SHARED_AUDIO_PLAYBACK_COMMANDS.RESET
        ? 1
        : payload.playbackRate,
    revision: normalizedMetadata.revision,
    sequence,
  });

  if (!normalizedSnapshot) {
    throw new Error('공용 음원 재생 상태가 올바르지 않습니다.');
  }

  return normalizedSnapshot;
}

export function isPlaybackSnapshotForMetadata(snapshot, metadata) {
  const normalizedSnapshot = normalizeSharedAudioPlaybackSnapshot(snapshot);
  const normalizedMetadata = normalizeSharedAudioMetadata(metadata);

  return Boolean(
    normalizedSnapshot &&
      normalizedMetadata &&
      normalizedSnapshot.assetId === normalizedMetadata.assetId &&
      normalizedSnapshot.revision === normalizedMetadata.revision,
  );
}

export function shouldAcceptPlaybackSnapshot(nextSnapshot, currentSnapshot) {
  const next = normalizeSharedAudioPlaybackSnapshot(nextSnapshot);

  if (!next) return false;

  const current = normalizeSharedAudioPlaybackSnapshot(currentSnapshot);

  if (!current) return true;
  if (next.assetId !== current.assetId || next.revision !== current.revision) {
    return true;
  }

  return next.sequence >= current.sequence;
}

export function getSharedAudioPlaybackPosition(snapshot, serverTimeMs) {
  const normalizedSnapshot = normalizeSharedAudioPlaybackSnapshot(snapshot);

  if (!normalizedSnapshot) return 0;
  if (!normalizedSnapshot.isPlaying) {
    return normalizedSnapshot.anchorPositionSeconds;
  }

  const elapsedSeconds = Math.max(
    0,
    (Number(serverTimeMs) - normalizedSnapshot.anchorServerTimeMs) / 1_000,
  );

  return Math.min(
    MAX_AUDIO_POSITION_SECONDS,
    normalizedSnapshot.anchorPositionSeconds +
      elapsedSeconds * normalizedSnapshot.playbackRate,
  );
}

export function getSharedAudioPlaybackCorrection({
  currentTimeSeconds,
  driftThresholdSeconds = SHARED_AUDIO_DRIFT_THRESHOLD_SECONDS,
  forceSeek = false,
  serverTimeMs,
  snapshot,
}) {
  const targetTimeSeconds = getSharedAudioPlaybackPosition(
    snapshot,
    serverTimeMs,
  );
  const currentTime = Number(currentTimeSeconds);
  const driftSeconds = Number.isFinite(currentTime)
    ? targetTimeSeconds - currentTime
    : targetTimeSeconds;

  return {
    driftSeconds,
    shouldSeek:
      forceSeek || Math.abs(driftSeconds) >= driftThresholdSeconds,
    targetTimeSeconds,
  };
}

export function estimateServerClockOffsetMs({
  requestSentAtMs,
  responseReceivedAtMs,
  serverTimeMs,
}) {
  const requestTime = Number(requestSentAtMs);
  const responseTime = Number(responseReceivedAtMs);
  const serverTime = Number(serverTimeMs);

  if (
    !Number.isFinite(requestTime) ||
    !Number.isFinite(responseTime) ||
    !Number.isFinite(serverTime) ||
    responseTime < requestTime
  ) {
    return 0;
  }

  return serverTime - (requestTime + responseTime) / 2;
}

export function shouldFollowTeacherSharedAudio({ mode, sourceType }) {
  return (
    sourceType === AUDIO_SOURCE_TYPES.TEACHER_SHARED_LOCAL &&
    mode === STUDENT_SHARED_AUDIO_MODES.FOLLOW
  );
}
