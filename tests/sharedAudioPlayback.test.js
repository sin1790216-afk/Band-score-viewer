import assert from 'node:assert/strict';
import test from 'node:test';

import { AUDIO_SOURCE_TYPES } from '../src/utils/sharedAudio.js';
import {
  createSharedAudioPlaybackSnapshot,
  estimateServerClockOffsetMs,
  getSharedAudioPlaybackCorrection,
  getSharedAudioPlaybackPosition,
  isPlaybackSnapshotForMetadata,
  normalizeSharedAudioPlaybackSnapshot,
  shouldAcceptPlaybackSnapshot,
  shouldFollowTeacherSharedAudio,
  SHARED_AUDIO_PLAYBACK_COMMANDS,
  STUDENT_SHARED_AUDIO_MODES,
} from '../src/utils/sharedAudioPlayback.js';

const METADATA = {
  assetId: 'asset-playback-1',
  byteLength: 1024,
  fileName: 'lesson.wav',
  mimeType: 'audio/wav',
  revision: 3,
};

function createSnapshot(command, overrides = {}) {
  return createSharedAudioPlaybackSnapshot({
    command,
    metadata: METADATA,
    payload: {
      anchorPositionSeconds: 12,
      isPlaying: command === SHARED_AUDIO_PLAYBACK_COMMANDS.PLAY,
      playbackRate: 1,
      ...overrides,
    },
    sequence: overrides.sequence || 5,
    serverTimeMs: overrides.serverTimeMs || 10_000,
  });
}

test('Teacher play, pause, seek, and rate commands create complete snapshots', () => {
  const play = createSnapshot(SHARED_AUDIO_PLAYBACK_COMMANDS.PLAY);
  const pause = createSnapshot(SHARED_AUDIO_PLAYBACK_COMMANDS.PAUSE, {
    anchorPositionSeconds: 18,
    isPlaying: false,
  });
  const seek = createSnapshot(SHARED_AUDIO_PLAYBACK_COMMANDS.SEEK, {
    anchorPositionSeconds: 32,
    isPlaying: true,
  });
  const rate = createSnapshot(SHARED_AUDIO_PLAYBACK_COMMANDS.RATE, {
    anchorPositionSeconds: 40,
    isPlaying: true,
    playbackRate: 0.75,
  });

  assert.equal(play.isPlaying, true);
  assert.equal(pause.anchorPositionSeconds, 18);
  assert.equal(seek.command, SHARED_AUDIO_PLAYBACK_COMMANDS.SEEK);
  assert.equal(rate.playbackRate, 0.75);
  assert.equal(rate.assetId, METADATA.assetId);
  assert.equal(rate.revision, METADATA.revision);
});

test('current playback position uses the shared server clock and playback rate', () => {
  const snapshot = createSnapshot(SHARED_AUDIO_PLAYBACK_COMMANDS.PLAY, {
    anchorPositionSeconds: 20,
    playbackRate: 0.8,
    serverTimeMs: 100_000,
  });

  assert.equal(getSharedAudioPlaybackPosition(snapshot, 105_000), 24);
  assert.equal(
    getSharedAudioPlaybackPosition(
      { ...snapshot, isPlaying: false },
      105_000,
    ),
    20,
  );
  assert.equal(
    estimateServerClockOffsetMs({
      requestSentAtMs: 1_000,
      responseReceivedAtMs: 1_100,
      serverTimeMs: 1_075,
    }),
    25,
  );
});

test('small drift is preserved while large drift and explicit seek are corrected', () => {
  const snapshot = createSnapshot(SHARED_AUDIO_PLAYBACK_COMMANDS.PLAY, {
    anchorPositionSeconds: 10,
    serverTimeMs: 20_000,
  });
  const smallDrift = getSharedAudioPlaybackCorrection({
    currentTimeSeconds: 10.2,
    serverTimeMs: 20_000,
    snapshot,
  });
  const largeDrift = getSharedAudioPlaybackCorrection({
    currentTimeSeconds: 8,
    serverTimeMs: 20_000,
    snapshot,
  });
  const forcedSeek = getSharedAudioPlaybackCorrection({
    currentTimeSeconds: 10.2,
    forceSeek: true,
    serverTimeMs: 20_000,
    snapshot,
  });

  assert.equal(smallDrift.shouldSeek, false);
  assert.equal(largeDrift.shouldSeek, true);
  assert.equal(forcedSeek.shouldSeek, true);
});

test('Follow applies only to Teacher Shared Audio and Practice stays local', () => {
  assert.equal(
    shouldFollowTeacherSharedAudio({
      mode: STUDENT_SHARED_AUDIO_MODES.FOLLOW,
      sourceType: AUDIO_SOURCE_TYPES.TEACHER_SHARED_LOCAL,
    }),
    true,
  );
  assert.equal(
    shouldFollowTeacherSharedAudio({
      mode: STUDENT_SHARED_AUDIO_MODES.PRACTICE,
      sourceType: AUDIO_SOURCE_TYPES.TEACHER_SHARED_LOCAL,
    }),
    false,
  );
  assert.equal(
    shouldFollowTeacherSharedAudio({
      mode: STUDENT_SHARED_AUDIO_MODES.FOLLOW,
      sourceType: AUDIO_SOURCE_TYPES.STUDENT_PERSONAL_LOCAL,
    }),
    false,
  );
});

test('replacement identity is validated and stale playback sequences are ignored', () => {
  const current = createSnapshot(SHARED_AUDIO_PLAYBACK_COMMANDS.PLAY, {
    sequence: 8,
  });
  const stale = { ...current, sequence: 7 };
  const reconnectCopy = { ...current };
  const replacementMetadata = {
    ...METADATA,
    assetId: 'asset-playback-2',
    revision: 4,
  };

  assert.equal(isPlaybackSnapshotForMetadata(current, METADATA), true);
  assert.equal(
    isPlaybackSnapshotForMetadata(current, replacementMetadata),
    false,
  );
  assert.equal(shouldAcceptPlaybackSnapshot(stale, current), false);
  assert.equal(shouldAcceptPlaybackSnapshot(reconnectCopy, current), true);
  assert.equal(normalizeSharedAudioPlaybackSnapshot({ ...current, sequence: 0 }), null);
});

test('audio replacement creates a paused zero-position reset snapshot', () => {
  const reset = createSharedAudioPlaybackSnapshot({
    command: SHARED_AUDIO_PLAYBACK_COMMANDS.RESET,
    metadata: METADATA,
    sequence: 1,
    serverTimeMs: 30_000,
  });

  assert.equal(reset.anchorPositionSeconds, 0);
  assert.equal(reset.isPlaying, false);
  assert.equal(reset.playbackRate, 1);
});
