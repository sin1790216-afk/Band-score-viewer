import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_AUDIO_SETTINGS,
  getStudentAudioSettings,
  getOpenableAudioUrl,
  isValidAudioSettings,
  loadStudentAudioSettingsLibrary,
  MAX_AUDIO_URL_LENGTH,
  normalizeAudioSettings,
  saveStudentAudioSettingsLibrary,
  setStudentAudioSettings,
  STUDENT_AUDIO_SETTINGS_STORAGE_KEY,
} from '../src/utils/audioSettings.js';

test('audio settings normalize missing and invalid values to safe defaults', () => {
  assert.deepEqual(normalizeAudioSettings(null), DEFAULT_AUDIO_SETTINGS);
  assert.deepEqual(
    normalizeAudioSettings({ startOffsetSeconds: -3, url: 12 }),
    DEFAULT_AUDIO_SETTINGS,
  );
});

test('audio settings preserve a bounded link and non-negative start offset', () => {
  assert.deepEqual(
    normalizeAudioSettings({
      startOffsetSeconds: '12.5',
      url: `  https://example.com/audio ${'x'.repeat(MAX_AUDIO_URL_LENGTH)}  `,
    }),
    {
      startOffsetSeconds: 12.5,
      url: `https://example.com/audio ${'x'.repeat(MAX_AUDIO_URL_LENGTH)}`.slice(
        0,
        MAX_AUDIO_URL_LENGTH,
      ),
    },
  );
});

test('only HTTP and HTTPS audio links can be opened', () => {
  assert.equal(getOpenableAudioUrl('https://example.com/song'), 'https://example.com/song');
  assert.equal(getOpenableAudioUrl('http://example.com/song'), 'http://example.com/song');
  assert.equal(getOpenableAudioUrl('javascript:alert(1)'), '');
  assert.equal(getOpenableAudioUrl('not a URL'), '');
});

test('shared audio settings require bounded strings and non-negative numbers', () => {
  assert.equal(
    isValidAudioSettings({ startOffsetSeconds: 3.5, url: 'https://example.com' }),
    true,
  );
  assert.equal(
    isValidAudioSettings({ startOffsetSeconds: '3.5', url: 'https://example.com' }),
    false,
  );
  assert.equal(
    isValidAudioSettings({ startOffsetSeconds: -1, url: 'https://example.com' }),
    false,
  );
});

test('student audio settings stay local and are separated by PDF document key', () => {
  const firstLibrary = setStudentAudioSettings(null, 'teacher:first.pdf', {
    startOffsetSeconds: 4,
    url: 'https://example.com/first',
  });
  const secondLibrary = setStudentAudioSettings(firstLibrary, 'local:second.pdf', {
    startOffsetSeconds: 8,
    url: 'https://example.com/second',
  });

  assert.deepEqual(getStudentAudioSettings(secondLibrary, 'teacher:first.pdf'), {
    startOffsetSeconds: 4,
    url: 'https://example.com/first',
  });
  assert.deepEqual(getStudentAudioSettings(secondLibrary, 'local:second.pdf'), {
    startOffsetSeconds: 8,
    url: 'https://example.com/second',
  });
  assert.deepEqual(
    getStudentAudioSettings(secondLibrary, 'teacher:unknown.pdf'),
    DEFAULT_AUDIO_SETTINGS,
  );
});

test('student audio settings round-trip through local storage and survive bad data', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const library = setStudentAudioSettings(null, 'teacher:lesson.pdf', {
    startOffsetSeconds: 2.5,
    url: 'https://example.com/lesson',
  });

  assert.equal(saveStudentAudioSettingsLibrary(storage, library), true);
  assert.deepEqual(loadStudentAudioSettingsLibrary(storage), library);

  values.set(STUDENT_AUDIO_SETTINGS_STORAGE_KEY, '{broken json');
  assert.deepEqual(loadStudentAudioSettingsLibrary(storage), {
    documents: {},
    version: 1,
  });
});
