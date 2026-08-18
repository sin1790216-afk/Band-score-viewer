import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { Server } from 'socket.io';

if (existsSync('.env.local')) {
  process.loadEnvFile?.('.env.local');
}

import {
  createEmptySharedSessionState,
} from './src/state/sessionState.js';
import {
  createSharedAudioSession,
  handleSharedAudioHttpRequest,
  registerSharedAudioSocketHandlers,
  sendSharedAudioState,
} from './src/server/sharedAudioSession.js';
import {
  createLanguagePhraseSession,
  registerLanguagePhraseSocketHandlers,
  sendLanguagePhraseState,
} from './src/server/languagePhraseSession.js';
import { createOpenAiLanguagePhraseProvider } from './src/server/openAiLanguagePhraseProvider.js';
import { createSyncStateSession } from './src/server/syncStateSession.js';
import {
  isValidAudioSettings,
  normalizeAudioSettings,
} from './src/utils/audioSettings.js';
import {
  MAX_SHARED_AUDIO_BYTES,
  SHARED_AUDIO_EVENTS,
} from './src/utils/sharedAudio.js';
import { LANGUAGE_PHRASE_EVENTS } from './src/utils/languagePhrases.js';
import {
  isValidMeasuresState,
  MAX_PDF_BYTES,
  resolveStaticRequest,
  validatePdfState,
} from './src/utils/serverSecurity.js';

const PORT = process.env.PORT || 4000;
const distDir = resolve('dist');
const isLanguagePhraseDebugEnabled =
  process.env.BSV_LANGUAGE_PHRASE_DEBUG === '1';

const initialSharedSessionState = createEmptySharedSessionState();
const syncStateSession = createSyncStateSession(initialSharedSessionState.syncState);
let latestPdf = initialSharedSessionState.pdf;
let latestMeasures = initialSharedSessionState.measures;
let latestAudioSettings = initialSharedSessionState.audioSettings;
const sharedAudioSession = createSharedAudioSession();
const languagePhraseSession = createLanguagePhraseSession({
  provider: createOpenAiLanguagePhraseProvider(),
});

const mimeTypes = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mjs': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

const httpServer = createServer((request, response) => {
  if (handleSharedAudioHttpRequest(request, response, sharedAudioSession)) {
    return;
  }

  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, {
      Allow: 'GET, HEAD',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    response.end('Method not allowed.');
    return;
  }

  const staticRequest = resolveStaticRequest(distDir, request.url);

  if (!staticRequest) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Invalid request path.');
    return;
  }

  const { filePath, requestPath } = staticRequest;
  const fallbackPath = join(distDir, 'index.html');
  const isFile = (path) => existsSync(path) && statSync(path).isFile();
  const staticPath = isFile(filePath) ? filePath : fallbackPath;

  if (!existsSync(staticPath)) {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Band Score Viewer sync server is running.');
    return;
  }

  const isHashedBuildAsset = requestPath.startsWith('/assets/');

  response.writeHead(200, {
    'Cache-Control': isHashedBuildAsset
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
    'Content-Type': mimeTypes[extname(staticPath)] || 'application/octet-stream',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const stream = createReadStream(staticPath);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
});

const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
  maxHttpBufferSize:
    Math.max(MAX_PDF_BYTES, MAX_SHARED_AUDIO_BYTES) + 1024 * 1024,
});

io.on('connection', (socket) => {
  console.log(
    `[socket] connected ${socket.id} from ${socket.handshake.address} origin=${
      socket.handshake.headers.origin || 'none'
    }`,
  );
  if (latestPdf) {
    socket.emit('pdf:state', latestPdf);
    console.log(`[socket] sent pdf:state file=${latestPdf.fileName} to ${socket.id}`);
  }

  socket.emit('measures:state', latestMeasures);
  console.log(`[socket] sent measures:state count=${latestMeasures.length} to ${socket.id}`);
  socket.emit('audio:state', latestAudioSettings);
  console.log(`[socket] sent audio:state to ${socket.id}`, latestAudioSettings);
  sendSharedAudioState(socket, sharedAudioSession);
  sendLanguagePhraseState(socket, languagePhraseSession);
  console.log(
    `[socket] sent ${SHARED_AUDIO_EVENTS.STATE} to ${socket.id}`,
    sharedAudioSession.getMetadata(),
  );
  console.log(
    `[socket] sent ${SHARED_AUDIO_EVENTS.PLAYBACK_STATE} to ${socket.id}`,
    sharedAudioSession.getPlaybackState(),
  );
  socket.emit('sync:state', syncStateSession.getState());
  console.log(
    `[socket] sent sync:state to ${socket.id}`,
    syncStateSession.getState(),
  );

  registerSharedAudioSocketHandlers({
    io,
    session: sharedAudioSession,
    socket,
  });
  registerLanguagePhraseSocketHandlers({
    getMeasures: () => latestMeasures,
    io,
    session: languagePhraseSession,
    socket,
  });

  socket.on('sync:update', (nextSyncState) => {
    const latestSyncState = syncStateSession.update(nextSyncState);

    socket.broadcast.emit('sync:state', latestSyncState);
  });

  socket.on('pdf:update', (nextPdf) => {
    const validatedPdf = validatePdfState(nextPdf);

    if (!validatedPdf) {
      console.warn(`[socket] rejected invalid pdf:update from ${socket.id}`);
      return;
    }

    latestPdf = validatedPdf;
    const latestSyncState = syncStateSession.update({
      fileName: validatedPdf.fileName,
    });

    console.log(`[socket] received pdf:update file=${validatedPdf.fileName}`);
    socket.broadcast.emit('pdf:state', latestPdf);
    socket.broadcast.emit('sync:state', latestSyncState);
  });

  socket.on('measures:update', (nextMeasures) => {
    if (!isValidMeasuresState(nextMeasures)) {
      console.warn(`[socket] rejected invalid measures:update from ${socket.id}`);
      return;
    }

    latestMeasures = nextMeasures;
    const didInvalidateLanguagePhrases =
      languagePhraseSession.syncMeasures(latestMeasures);
    console.log(`[socket] received measures:update count=${latestMeasures.length}`);
    socket.broadcast.emit('measures:state', latestMeasures);
    if (didInvalidateLanguagePhrases) {
      io.emit(LANGUAGE_PHRASE_EVENTS.STATE, null);
    }
  });

  socket.on('audio:update', (nextAudioSettings) => {
    if (!isValidAudioSettings(nextAudioSettings)) {
      console.warn(`[socket] rejected invalid audio:update from ${socket.id}`);
      return;
    }

    latestAudioSettings = normalizeAudioSettings(nextAudioSettings);
    console.log(`[socket] received audio:update from ${socket.id}`, latestAudioSettings);
    socket.broadcast.emit('audio:state', latestAudioSettings);
  });

  socket.on('session:reset', () => {
    const emptySessionState = createEmptySharedSessionState();

    latestPdf = emptySessionState.pdf;
    latestMeasures = emptySessionState.measures;
    syncStateSession.reset(emptySessionState.syncState);
    latestAudioSettings = emptySessionState.audioSettings;
    sharedAudioSession.clear();
    languagePhraseSession.clear();
    console.log(`[socket] session reset requested by ${socket.id}`);
    io.emit(SHARED_AUDIO_EVENTS.STATE, null);
    io.emit(SHARED_AUDIO_EVENTS.PLAYBACK_STATE, null);
    io.emit(LANGUAGE_PHRASE_EVENTS.STATE, null);
    socket.broadcast.emit('session:reset', emptySessionState);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Band Score Viewer sync server listening on http://0.0.0.0:${PORT}`);
  console.log(
    `[LanguagePhraseDebug] ${isLanguagePhraseDebugEnabled ? 'enabled' : 'disabled'}`,
  );
});
