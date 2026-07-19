import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { Server } from 'socket.io';

const PORT = process.env.PORT || 4000;
const distDir = resolve('dist');

let latestSyncState = {
  fileName: '',
  pageNumber: 1,
  measureIndex: 0,
};
let latestPdf = null;
let latestMeasures = [];

const mimeTypes = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const httpServer = createServer((request, response) => {
  const requestPath = request.url === '/' ? '/index.html' : request.url;
  const filePath = join(distDir, requestPath);
  const fallbackPath = join(distDir, 'index.html');
  const staticPath = existsSync(filePath) ? filePath : fallbackPath;

  if (!existsSync(staticPath)) {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Band Score Viewer sync server is running.');
    return;
  }

  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(staticPath)] || 'application/octet-stream',
  });
  createReadStream(staticPath).pipe(response);
});

const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
  maxHttpBufferSize: 100 * 1024 * 1024,
});

function getLogicalSyncState(syncState) {
  return {
    fileName: syncState?.fileName || '',
    pageNumber: syncState?.pageNumber || 1,
    measureIndex: syncState?.measureIndex || 0,
  };
}

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
  socket.emit('sync:state', latestSyncState);
  console.log(`[socket] sent sync:state to ${socket.id}`, latestSyncState);

  socket.on('sync:update', (nextSyncState) => {
    latestSyncState = getLogicalSyncState({
      ...latestSyncState,
      ...nextSyncState,
    });

    socket.broadcast.emit('sync:state', latestSyncState);
  });

  socket.on('pdf:update', (nextPdf) => {
    latestPdf = nextPdf;
    latestSyncState = getLogicalSyncState({
      ...latestSyncState,
      fileName: nextPdf.fileName,
    });

    console.log(`[socket] received pdf:update file=${nextPdf.fileName}`);
    socket.broadcast.emit('pdf:state', latestPdf);
    socket.broadcast.emit('sync:state', latestSyncState);
  });

  socket.on('measures:update', (nextMeasures) => {
    latestMeasures = Array.isArray(nextMeasures) ? nextMeasures : [];
    console.log(`[socket] received measures:update count=${latestMeasures.length}`);
    socket.broadcast.emit('measures:state', latestMeasures);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Band Score Viewer sync server listening on http://0.0.0.0:${PORT}`);
});
