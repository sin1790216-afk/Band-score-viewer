import { randomUUID } from 'node:crypto';

import {
  getSharedAudioAssetPath,
  isAudioMimeType,
  MAX_SHARED_AUDIO_BYTES,
  MAX_SHARED_AUDIO_FILE_NAME_LENGTH,
  normalizeSharedAudioTimelineAnchor,
  SHARED_AUDIO_EVENTS,
} from '../utils/sharedAudio.js';
import {
  createSharedAudioPlaybackSnapshot,
  SHARED_AUDIO_PLAYBACK_COMMANDS,
} from '../utils/sharedAudioPlayback.js';

function toAudioBuffer(data) {
  if (Buffer.isBuffer(data)) return Buffer.from(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data?.type === 'Buffer' && Array.isArray(data.data)) {
    return Buffer.from(data.data);
  }

  return null;
}

function prepareSharedAudioUpload(payload) {
  const fileName =
    typeof payload?.fileName === 'string' ? payload.fileName.trim() : '';
  const mimeType = typeof payload?.mimeType === 'string' ? payload.mimeType : '';
  const data = toAudioBuffer(payload?.data);

  if (!fileName || fileName.length > MAX_SHARED_AUDIO_FILE_NAME_LENGTH) {
    throw new Error('공용 음원 파일명이 올바르지 않습니다.');
  }
  if (!isAudioMimeType(mimeType)) {
    throw new Error('audio MIME 형식의 파일만 공용 음원으로 사용할 수 있습니다.');
  }
  if (!data || data.byteLength <= 0) {
    throw new Error('공용 음원 데이터가 비어 있습니다.');
  }
  if (data.byteLength > MAX_SHARED_AUDIO_BYTES) {
    throw new Error('공용 음원은 100MB 이하만 사용할 수 있습니다.');
  }

  return { data, fileName, mimeType };
}

function createMetadata(assetId, revision, upload) {
  return {
    assetId,
    assetPath: getSharedAudioAssetPath(assetId),
    byteLength: upload.data.byteLength,
    fileName: upload.fileName,
    mimeType: upload.mimeType,
    revision,
    timelineAnchor: null,
  };
}

export function createSharedAudioSession() {
  let asset = null;
  let playbackSequence = 0;
  let playbackState = null;
  let revision = 0;

  return {
    clear() {
      const hadAsset = Boolean(asset);

      if (hadAsset) revision += 1;
      asset = null;
      playbackState = null;
      return hadAsset;
    },
    getAsset() {
      return asset;
    },
    getMetadata() {
      return asset?.metadata || null;
    },
    getPlaybackState() {
      return playbackState;
    },
    register(payload) {
      const upload = prepareSharedAudioUpload(payload);
      const assetId = randomUUID();

      revision += 1;
      asset = {
        data: upload.data,
        metadata: createMetadata(assetId, revision, upload),
      };
      playbackSequence += 1;
      playbackState = createSharedAudioPlaybackSnapshot({
        command: SHARED_AUDIO_PLAYBACK_COMMANDS.RESET,
        metadata: asset.metadata,
        sequence: playbackSequence,
        serverTimeMs: Date.now(),
      });

      return asset.metadata;
    },
    updatePlayback(payload, serverTimeMs = Date.now()) {
      if (
        !asset ||
        payload?.assetId !== asset.metadata.assetId ||
        Number(payload?.revision) !== asset.metadata.revision
      ) {
        throw new Error('현재 공용 음원과 일치하지 않는 재생 명령입니다.');
      }

      playbackSequence += 1;
      playbackState = createSharedAudioPlaybackSnapshot({
        command: payload.command,
        metadata: asset.metadata,
        payload,
        sequence: playbackSequence,
        serverTimeMs,
      });

      return playbackState;
    },
    updateTimelineAnchor(payload) {
      if (
        !asset ||
        payload?.assetId !== asset.metadata.assetId ||
        Number(payload?.revision) !== asset.metadata.revision
      ) {
        throw new Error('현재 공용 음원과 일치하지 않는 마디 기준입니다.');
      }

      const hasTimelineAnchor = Object.hasOwn(payload || {}, 'timelineAnchor');
      const hasLegacyFirstMeasureAnchor = Object.hasOwn(
        payload || {},
        'firstMeasureAnchorSeconds',
      );
      const sourceAnchor = hasTimelineAnchor
        ? payload.timelineAnchor
        : hasLegacyFirstMeasureAnchor
          ? payload.firstMeasureAnchorSeconds === null
            ? null
            : {
                measureIndex: 0,
                positionSeconds: payload.firstMeasureAnchorSeconds,
              }
          : undefined;
      const timelineAnchor = normalizeSharedAudioTimelineAnchor(sourceAnchor);

      if (sourceAnchor !== null && timelineAnchor === null) {
        throw new Error('마디 시작 위치 기준이 올바르지 않습니다.');
      }

      asset = {
        ...asset,
        metadata: {
          ...asset.metadata,
          timelineAnchor,
        },
      };

      return asset.metadata;
    },
  };
}

export function parseSharedAudioRange(rangeHeader, byteLength) {
  if (!rangeHeader) {
    return { end: byteLength - 1, start: 0, type: 'full' };
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());

  if (!match || (!match[1] && !match[2])) return null;

  let start;
  let end;

  if (!match[1]) {
    const suffixLength = Number(match[2]);

    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(byteLength - suffixLength, 0);
    end = byteLength - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : byteLength - 1;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start >= byteLength ||
    end < start
  ) {
    return null;
  }

  return {
    end: Math.min(end, byteLength - 1),
    start,
    type: 'partial',
  };
}

function writeAudioResponseHeaders(response, headers) {
  response.writeHead(headers.status, {
    'Access-Control-Allow-Origin': '*',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Length': headers.contentLength,
    'Content-Type': headers.contentType,
    ...(headers.contentRange ? { 'Content-Range': headers.contentRange } : {}),
    'X-Content-Type-Options': 'nosniff',
  });
}

export function handleSharedAudioHttpRequest(request, response, session) {
  let pathname;

  try {
    pathname = new URL(request.url, 'http://localhost').pathname;
  } catch {
    return false;
  }

  const match = /^\/shared-audio\/([A-Za-z0-9_-]{1,128})$/.exec(pathname);

  if (!match) return false;

  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, {
      Allow: 'GET, HEAD',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    response.end('Method not allowed.');
    return true;
  }

  const asset = session.getAsset();

  if (!asset || asset.metadata.assetId !== match[1]) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Shared audio not found.');
    return true;
  }

  const range = parseSharedAudioRange(
    request.headers.range,
    asset.data.byteLength,
  );

  if (!range) {
    response.writeHead(416, {
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes */${asset.data.byteLength}`,
    });
    response.end();
    return true;
  }

  const contentLength = range.end - range.start + 1;

  writeAudioResponseHeaders(response, {
    contentLength,
    contentRange:
      range.type === 'partial'
        ? `bytes ${range.start}-${range.end}/${asset.data.byteLength}`
        : '',
    contentType: asset.metadata.mimeType,
    status: range.type === 'partial' ? 206 : 200,
  });

  if (request.method === 'HEAD') {
    response.end();
  } else {
    response.end(asset.data.subarray(range.start, range.end + 1));
  }

  return true;
}

export function sendSharedAudioState(socket, session) {
  socket.emit(SHARED_AUDIO_EVENTS.STATE, session.getMetadata());
  socket.emit(SHARED_AUDIO_EVENTS.PLAYBACK_STATE, session.getPlaybackState());
}

export function registerSharedAudioSocketHandlers({ io, session, socket }) {
  socket.on(SHARED_AUDIO_EVENTS.UPDATE, (payload, acknowledge) => {
    const respond = typeof acknowledge === 'function' ? acknowledge : () => {};

    try {
      const metadata = session.register(payload);

      io.emit(SHARED_AUDIO_EVENTS.STATE, metadata);
      io.emit(
        SHARED_AUDIO_EVENTS.PLAYBACK_STATE,
        session.getPlaybackState(),
      );
      respond({ metadata, ok: true });
      console.log(
        `[socket] registered shared audio asset=${metadata.assetId} revision=${metadata.revision}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '공용 음원을 등록하지 못했습니다.';

      respond({ message, ok: false });
      console.warn(`[socket] rejected shared audio from ${socket.id}: ${message}`);
    }
  });

  socket.on(SHARED_AUDIO_EVENTS.PLAYBACK_UPDATE, (payload, acknowledge) => {
    const respond = typeof acknowledge === 'function' ? acknowledge : () => {};

    try {
      const playbackState = session.updatePlayback(payload);

      io.emit(SHARED_AUDIO_EVENTS.PLAYBACK_STATE, playbackState);
      respond({ ok: true, playbackState });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '공용 음원 재생 상태를 갱신하지 못했습니다.';

      respond({ message, ok: false });
      console.warn(
        `[socket] rejected shared audio playback from ${socket.id}: ${message}`,
      );
    }
  });

  socket.on(SHARED_AUDIO_EVENTS.CLOCK, (acknowledge) => {
    if (typeof acknowledge === 'function') {
      acknowledge({ serverTimeMs: Date.now() });
    }
  });

  function updateTimelineAnchor(payload, acknowledge) {
    const respond = typeof acknowledge === 'function' ? acknowledge : () => {};

    try {
      const metadata = session.updateTimelineAnchor(payload);

      io.emit(SHARED_AUDIO_EVENTS.STATE, metadata);
      respond({ metadata, ok: true });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '공용 음원의 마디 시작 위치를 저장하지 못했습니다.';

      respond({ message, ok: false });
      console.warn(
        `[socket] rejected shared audio timeline anchor from ${socket.id}: ${message}`,
      );
    }
  }

  socket.on(
    SHARED_AUDIO_EVENTS.TIMELINE_ANCHOR_UPDATE,
    updateTimelineAnchor,
  );
  socket.on(
    SHARED_AUDIO_EVENTS.FIRST_MEASURE_ANCHOR_UPDATE,
    updateTimelineAnchor,
  );

  socket.on(SHARED_AUDIO_EVENTS.REMOVE, (acknowledge) => {
    const respond = typeof acknowledge === 'function' ? acknowledge : () => {};

    session.clear();
    io.emit(SHARED_AUDIO_EVENTS.STATE, null);
    io.emit(SHARED_AUDIO_EVENTS.PLAYBACK_STATE, null);
    respond({ ok: true });
    console.log(`[socket] removed shared audio by ${socket.id}`);
  });
}
