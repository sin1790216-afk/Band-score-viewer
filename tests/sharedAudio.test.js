import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUDIO_SOURCE_TYPES,
  createSharedAudioIdentity,
  getSelectedAudioAsset,
  getSharedAudioAssetUrl,
  isSupportedSharedAudioFile,
  normalizeSharedAudioMetadata,
} from '../src/utils/sharedAudio.js';

const SHARED_METADATA = {
  assetId: 'asset-123',
  byteLength: 1024,
  fileName: 'class.m4a',
  mimeType: 'audio/mp4',
  revision: 3,
};

test('shared audio metadata is bounded and creates a server asset URL', () => {
  const metadata = normalizeSharedAudioMetadata(SHARED_METADATA);

  assert.deepEqual(metadata, {
    ...SHARED_METADATA,
    assetPath: '/shared-audio/asset-123',
  });
  assert.equal(
    getSharedAudioAssetUrl(metadata, 'http://192.168.0.10:4000'),
    'http://192.168.0.10:4000/shared-audio/asset-123',
  );
  assert.equal(
    createSharedAudioIdentity(metadata),
    'teacher-shared-local:asset-123:3',
  );
  assert.equal(normalizeSharedAudioMetadata({ ...metadata, byteLength: 0 }), null);
});

test('teacher shared upload requires an audio MIME type and a non-empty file', () => {
  assert.equal(
    isSupportedSharedAudioFile({
      name: 'lesson.mp3',
      size: 100,
      type: 'audio/mpeg',
    }),
    true,
  );
  assert.equal(
    isSupportedSharedAudioFile({
      name: 'renamed.mp3',
      size: 100,
      type: 'application/octet-stream',
    }),
    false,
  );
});

test('shared and personal audio selection keeps both source states independent', () => {
  const personalFile = { name: 'personal.wav' };
  const sharedFile = { name: 'shared-blob' };
  const sourceState = {
    personalAudioFile: personalFile,
    personalAudioFileName: 'personal.wav',
    personalAudioIdentity: 'local-audio:personal.wav:10:1',
    personalAudioUrl: 'blob:personal',
    sharedAudioFile: sharedFile,
    sharedAudioMetadata: SHARED_METADATA,
    sharedAudioUrl: 'http://localhost:4000/shared-audio/asset-123',
  };
  const sharedSelection = getSelectedAudioAsset({
    ...sourceState,
    selectedSource: AUDIO_SOURCE_TYPES.TEACHER_SHARED_LOCAL,
  });
  const personalSelection = getSelectedAudioAsset({
    ...sourceState,
    selectedSource: AUDIO_SOURCE_TYPES.STUDENT_PERSONAL_LOCAL,
  });

  assert.equal(sharedSelection.audioFile, sharedFile);
  assert.equal(sharedSelection.fileName, 'class.m4a');
  assert.equal(personalSelection.audioFile, personalFile);
  assert.equal(personalSelection.sourceUrl, 'blob:personal');
  assert.equal(
    personalSelection.identity,
    'local-audio:personal.wav:10:1',
  );
  assert.deepEqual(SHARED_METADATA, {
    assetId: 'asset-123',
    byteLength: 1024,
    fileName: 'class.m4a',
    mimeType: 'audio/mp4',
    revision: 3,
  });
});
