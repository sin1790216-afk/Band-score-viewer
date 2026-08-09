import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getFullscreenElement,
  isFullscreenSupported,
  toggleDocumentFullscreen,
} from '../src/utils/fullscreen.js';

test('fullscreen helpers use the standard browser API', async () => {
  const calls = [];
  const documentObject = {
    documentElement: {
      requestFullscreen() {
        calls.push(['enter', this]);
      },
    },
    exitFullscreen() {
      calls.push(['exit', this]);
    },
    fullscreenElement: null,
  };

  assert.equal(isFullscreenSupported(documentObject), true);
  assert.equal(await toggleDocumentFullscreen(documentObject), 'enter');
  assert.equal(calls[0][0], 'enter');
  assert.equal(calls[0][1], documentObject.documentElement);

  documentObject.fullscreenElement = documentObject.documentElement;

  assert.equal(getFullscreenElement(documentObject), documentObject.documentElement);
  assert.equal(await toggleDocumentFullscreen(documentObject), 'exit');
  assert.equal(calls[1][0], 'exit');
  assert.equal(calls[1][1], documentObject);
});

test('fullscreen helpers support webkit-prefixed APIs', async () => {
  const calls = [];
  const documentObject = {
    documentElement: {
      webkitRequestFullscreen() {
        calls.push('enter');
      },
    },
    webkitExitFullscreen() {
      calls.push('exit');
    },
    webkitFullscreenElement: null,
  };

  assert.equal(isFullscreenSupported(documentObject), true);
  assert.equal(await toggleDocumentFullscreen(documentObject), 'enter');

  documentObject.webkitFullscreenElement = documentObject.documentElement;

  assert.equal(await toggleDocumentFullscreen(documentObject), 'exit');
  assert.deepEqual(calls, ['enter', 'exit']);
});

test('fullscreen helpers safely report unsupported environments', async () => {
  assert.equal(getFullscreenElement(null), null);
  assert.equal(isFullscreenSupported({ documentElement: {} }), false);
  assert.equal(await toggleDocumentFullscreen({ documentElement: {} }), 'unsupported');
});
