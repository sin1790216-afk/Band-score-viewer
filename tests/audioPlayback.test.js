import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampAudioTime,
  clearStudentAudioPickerRecovery,
  consumeStudentAudioPickerRecovery,
  createWaveformPeaks,
  formatAudioTime,
  getCountInFrequency,
  getCountInTiming,
  getLocalAudioStartTime,
  getPinchWaveformState,
  getWaveformDraggedTime,
  getWaveformPointerTime,
  getWaveformVisibleDuration,
  isSupportedLocalAudioFile,
  markStudentAudioPickerRecovery,
  normalizeLocalAudioPlaybackRate,
  normalizeWaveformZoom,
  STUDENT_AUDIO_PICKER_RECOVERY_KEY,
} from '../src/utils/audioPlayback.js';

test('local audio accepts browser audio MIME types and supported file extensions', () => {
  assert.equal(
    isSupportedLocalAudioFile({ name: 'lesson.bin', type: 'audio/mpeg' }),
    true,
  );
  assert.equal(
    isSupportedLocalAudioFile({ name: 'lesson.M4A', type: '' }),
    true,
  );
  assert.equal(
    isSupportedLocalAudioFile({ name: 'lesson.pdf', type: 'application/pdf' }),
    false,
  );
});

test('waveform zoom and pointer calculations stay inside the audio duration', () => {
  assert.equal(normalizeWaveformZoom(0), 1);
  assert.equal(normalizeWaveformZoom(100), 32);
  assert.equal(getWaveformVisibleDuration(120, 4), 30);
  assert.equal(
    getWaveformPointerTime({
      clientX: 75,
      currentTime: 30,
      duration: 120,
      rectLeft: 0,
      rectWidth: 100,
      visibleDuration: 20,
    }),
    35,
  );
  assert.equal(
    getWaveformDraggedTime({
      currentClientX: 75,
      duration: 120,
      rectWidth: 100,
      startClientX: 50,
      startTime: 30,
      visibleDuration: 20,
    }),
    25,
  );
  assert.equal(clampAudioTime(200, 120), 120);
});

test('pinch zoom keeps the time below the gesture center anchored', () => {
  assert.deepEqual(
    getPinchWaveformState({
      anchorClientX: 75,
      anchorTime: 65,
      currentDistance: 200,
      duration: 120,
      rectLeft: 0,
      rectWidth: 100,
      startDistance: 100,
      startZoom: 2,
    }),
    {
      currentTime: 57.5,
      zoom: 4,
    },
  );
});

test('count-in uses one measure and accents only the first beat', () => {
  assert.deepEqual(getCountInTiming(120, 4), {
    beatDurationSeconds: 0.5,
    beats: 4,
    bpm: 120,
    totalDurationSeconds: 2,
  });
  assert.deepEqual(getCountInTiming('invalid', 0), {
    beatDurationSeconds: 0.5,
    beats: 4,
    bpm: 120,
    totalDurationSeconds: 2,
  });
  assert.equal(getCountInFrequency(0), 1_200);
  assert.equal(getCountInFrequency(1), 800);
  assert.equal(getCountInFrequency(3), 800);
});

test('waveform peaks are normalized and audio times include milliseconds', () => {
  const peaks = createWaveformPeaks(
    [new Float32Array([0, 0.25, -0.5, 1, -0.25, 0])],
    3,
  );

  assert.equal(peaks.length, 3);
  assert.equal(Math.max(...peaks), 1);
  assert.equal(formatAudioTime(62.345), '01:02.345');
});

test('local audio start offset stays inside the playable duration', () => {
  assert.equal(getLocalAudioStartTime(12.5, 60), 12.5);
  assert.equal(getLocalAudioStartTime(80, 60), 60);
  assert.equal(getLocalAudioStartTime(-1, 60), 0);
  assert.equal(getLocalAudioStartTime('invalid', Number.NaN), 0);
});

test('local audio playback rate accepts only supported choices', () => {
  assert.equal(normalizeLocalAudioPlaybackRate('0.75'), 0.75);
  assert.equal(normalizeLocalAudioPlaybackRate(1.5), 1.5);
  assert.equal(normalizeLocalAudioPlaybackRate(3), 1);
  assert.equal(normalizeLocalAudioPlaybackRate('invalid'), 1);
});

test('student audio picker recovery is one-time and stays inside session storage', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };

  assert.equal(markStudentAudioPickerRecovery(storage), true);
  assert.equal(values.get(STUDENT_AUDIO_PICKER_RECOVERY_KEY), 'pending');
  assert.equal(consumeStudentAudioPickerRecovery(storage), true);
  assert.equal(consumeStudentAudioPickerRecovery(storage), false);

  assert.equal(markStudentAudioPickerRecovery(storage), true);
  assert.equal(clearStudentAudioPickerRecovery(storage), true);
  assert.equal(consumeStudentAudioPickerRecovery(storage), false);
});
