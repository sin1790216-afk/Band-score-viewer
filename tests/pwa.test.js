import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canRegisterServiceWorker,
  registerAppServiceWorker,
} from '../src/utils/pwa.js';

test('PWA manifest includes the required install metadata and icon sizes', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'),
  );

  assert.equal(manifest.name, 'Band Score Viewer');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(
    manifest.icons.map((icon) => icon.sizes),
    ['192x192', '512x512'],
  );
});

test('service worker registration bypasses the HTTP cache', async () => {
  const calls = [];
  const navigatorObject = {
    serviceWorker: {
      register(scriptUrl, options) {
        calls.push({ options, scriptUrl, receiver: this });
        return Promise.resolve({ scope: options.scope });
      },
    },
  };

  const registration = await registerAppServiceWorker(navigatorObject);

  assert.equal(canRegisterServiceWorker(navigatorObject), true);
  assert.equal(registration.scope, '/');
  assert.deepEqual(calls[0], {
    options: { scope: '/', updateViaCache: 'none' },
    scriptUrl: '/sw.js',
    receiver: navigatorObject.serviceWorker,
  });
});

test('unsupported browsers skip service worker registration safely', async () => {
  assert.equal(canRegisterServiceWorker({}), false);
  assert.equal(await registerAppServiceWorker({}), null);
});
