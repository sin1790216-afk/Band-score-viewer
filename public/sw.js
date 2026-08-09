const APP_CACHE_PREFIX = 'band-score-viewer-';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith(APP_CACHE_PREFIX))
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// 수업 중 오래된 앱/PDF/Socket 상태가 남지 않도록 fetch 캐시는 사용하지 않는다.
