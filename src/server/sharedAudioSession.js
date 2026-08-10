import { randomUUID } from 'node:crypto';

import {
  getSharedAudioAssetPath,
  isAudioMimeType,
  MAX_SHARED_AUDIO_BYTES,
  MAX_SHARED_AUDIO_FILE_NAME_LENGTH,
  SHARED_AUDIO_EVENTS,
} from '../utils/sharedAudio.js';

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
  };
}

export function createSharedAudioSession() {
  let asset = null;
  let revision = 0;

  return {
    clear() {
      const hadAsset = Boolean(asset);

      if (hadAsset) revision += 1;
      asset = null;
      return hadAsset;
    },
    getAsset() {
      return asset;
    },
    getMetadata() {
      return asset?.metadata || null;
    },
    register(payload) {
      const upload = prepareSharedAudioUpload(payload);
      const assetId = randomUUID();

      revision += 1;
      asset = {
        data: upload.data,
        metadata: createMetadata(assetId, revision, upload),
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
}

export function registerSharedAudioSocketHandlers({ io, session, socket }) {
  socket.on(SHARED_AUDIO_EVENTS.UPDATE, (payload, acknowledge) => {
    const respond = typeof acknowledge === 'function' ? acknowledge : () => {};

    try {
      const metadata = session.register(payload);

      io.emit(SHARED_AUDIO_EVENTS.STATE, metadata);
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

  socket.on(SHARED_AUDIO_EVENTS.REMOVE, (acknowledge) => {
    const respond = typeof acknowledge === 'function' ? acknowledge : () => {};

    session.clear();
    io.emit(SHARED_AUDIO_EVENTS.STATE, null);
    respond({ ok: true });
    console.log(`[socket] removed shared audio by ${socket.id}`);
  });
}
