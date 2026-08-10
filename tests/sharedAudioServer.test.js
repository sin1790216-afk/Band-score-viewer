import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import {
  createSharedAudioSession,
  handleSharedAudioHttpRequest,
  registerSharedAudioSocketHandlers,
  sendSharedAudioState,
} from '../src/server/sharedAudioSession.js';
import { SHARED_AUDIO_EVENTS } from '../src/utils/sharedAudio.js';

const AUDIO_BYTES = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

function registerTestAudio(session, fileName = 'lesson.wav') {
  return session.register({
    data: AUDIO_BYTES,
    fileName,
    mimeType: 'audio/wav',
  });
}

async function startAudioServer(session) {
  const server = createServer((request, response) => {
    if (!handleSharedAudioHttpRequest(request, response, session)) {
      response.writeHead(404);
      response.end();
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    origin: `http://127.0.0.1:${address.port}`,
  };
}

function createFakeSocket(id = 'student') {
  const handlers = new Map();
  const emitted = [];

  return {
    emitted,
    handlers,
    id,
    emit(eventName, payload) {
      emitted.push([eventName, payload]);
    },
    on(eventName, handler) {
      handlers.set(eventName, handler);
    },
  };
}

test('shared audio session registers metadata and replaces the previous asset', () => {
  const session = createSharedAudioSession();
  const firstMetadata = registerTestAudio(session, 'first.wav');
  const secondMetadata = registerTestAudio(session, 'second.wav');

  assert.match(firstMetadata.assetId, /^[A-Za-z0-9-]+$/);
  assert.equal(firstMetadata.byteLength, AUDIO_BYTES.byteLength);
  assert.equal(firstMetadata.mimeType, 'audio/wav');
  assert.equal(firstMetadata.revision, 1);
  assert.notEqual(secondMetadata.assetId, firstMetadata.assetId);
  assert.equal(secondMetadata.revision, 2);
  assert.equal(session.getMetadata().fileName, 'second.wav');
});

test('invalid shared audio does not replace the current asset', () => {
  const session = createSharedAudioSession();
  const currentMetadata = registerTestAudio(session);

  assert.throws(
    () =>
      session.register({
        data: AUDIO_BYTES,
        fileName: 'not-audio.bin',
        mimeType: 'application/octet-stream',
      }),
    /audio MIME/,
  );
  assert.deepEqual(session.getMetadata(), currentMetadata);
});

test('shared audio HTTP endpoint supports full and byte range requests', async () => {
  const session = createSharedAudioSession();
  const metadata = registerTestAudio(session);
  const server = await startAudioServer(session);

  try {
    const fullResponse = await fetch(`${server.origin}${metadata.assetPath}`);
    const fullBody = Buffer.from(await fullResponse.arrayBuffer());

    assert.equal(fullResponse.status, 200);
    assert.equal(fullResponse.headers.get('accept-ranges'), 'bytes');
    assert.equal(fullResponse.headers.get('content-type'), 'audio/wav');
    assert.equal(fullResponse.headers.get('content-length'), '10');
    assert.deepEqual(fullBody, AUDIO_BYTES);

    const rangeResponse = await fetch(`${server.origin}${metadata.assetPath}`, {
      headers: { Range: 'bytes=2-5' },
    });
    const rangeBody = Buffer.from(await rangeResponse.arrayBuffer());

    assert.equal(rangeResponse.status, 206);
    assert.equal(rangeResponse.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(rangeResponse.headers.get('content-length'), '4');
    assert.deepEqual(rangeBody, Buffer.from([2, 3, 4, 5]));
  } finally {
    await server.close();
  }
});

test('shared audio HTTP endpoint rejects invalid ranges and stale assets', async () => {
  const session = createSharedAudioSession();
  const firstMetadata = registerTestAudio(session, 'first.wav');
  const server = await startAudioServer(session);

  try {
    const invalidRangeResponse = await fetch(
      `${server.origin}${firstMetadata.assetPath}`,
      { headers: { Range: 'bytes=20-30' } },
    );

    assert.equal(invalidRangeResponse.status, 416);
    assert.equal(
      invalidRangeResponse.headers.get('content-range'),
      'bytes */10',
    );

    const replacementMetadata = registerTestAudio(session, 'replacement.wav');
    const staleResponse = await fetch(
      `${server.origin}${firstMetadata.assetPath}`,
    );

    assert.equal(staleResponse.status, 404);

    session.clear();
    const removedResponse = await fetch(
      `${server.origin}${replacementMetadata.assetPath}`,
    );

    assert.equal(removedResponse.status, 404);
  } finally {
    await server.close();
  }
});

test('shared audio socket metadata reaches current and late clients', () => {
  const session = createSharedAudioSession();
  const teacherSocket = createFakeSocket('teacher');
  const broadcasts = [];
  const io = {
    emit(eventName, payload) {
      broadcasts.push([eventName, payload]);
    },
  };

  registerSharedAudioSocketHandlers({ io, session, socket: teacherSocket });
  const updateHandler = teacherSocket.handlers.get(SHARED_AUDIO_EVENTS.UPDATE);
  let updateResult;

  updateHandler(
    {
      data: AUDIO_BYTES,
      fileName: 'shared.wav',
      mimeType: 'audio/wav',
    },
    (result) => {
      updateResult = result;
    },
  );

  assert.equal(updateResult.ok, true);
  assert.deepEqual(broadcasts.at(-1), [
    SHARED_AUDIO_EVENTS.STATE,
    updateResult.metadata,
  ]);

  const lateStudentSocket = createFakeSocket('late-student');

  sendSharedAudioState(lateStudentSocket, session);
  assert.deepEqual(lateStudentSocket.emitted, [
    [SHARED_AUDIO_EVENTS.STATE, updateResult.metadata],
  ]);

  updateHandler(
    {
      data: AUDIO_BYTES,
      fileName: 'replacement.wav',
      mimeType: 'audio/wav',
    },
    () => {},
  );
  assert.equal(broadcasts.at(-1)[1].revision, 2);

  const removeHandler = teacherSocket.handlers.get(SHARED_AUDIO_EVENTS.REMOVE);

  removeHandler(() => {});
  assert.deepEqual(broadcasts.at(-1), [SHARED_AUDIO_EVENTS.STATE, null]);
  assert.equal(session.getMetadata(), null);
});
