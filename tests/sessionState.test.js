import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInitialSessionState,
  SESSION_ACTIONS,
  sessionReducer,
} from '../src/state/sessionState.js';

test('session state changes the Teacher page and current measure independently', () => {
  const pageState = sessionReducer(createInitialSessionState(), {
    type: SESSION_ACTIONS.SET_PAGE_NUMBER,
    pageNumber: 3,
  });
  const measureState = sessionReducer(pageState, {
    type: SESSION_ACTIONS.SET_MEASURE_INDEX,
    measureIndex: 12,
  });

  assert.equal(measureState.pageNumber, 3);
  assert.equal(measureState.measureIndex, 12);
  assert.deepEqual(measureState.syncState, {
    fileName: '',
    measureIndex: 0,
    pageNumber: 1,
  });
});

test('session state handles play, stop, and Repeat without changing position', () => {
  const playingState = sessionReducer(createInitialSessionState(), {
    type: SESSION_ACTIONS.SET_AUTO_PLAYING,
    isAutoPlaying: true,
  });
  const repeatState = sessionReducer(playingState, {
    type: SESSION_ACTIONS.SET_REPEAT_ENABLED,
    isRepeatEnabled: true,
  });
  const stoppedState = sessionReducer(repeatState, {
    type: SESSION_ACTIONS.SET_AUTO_PLAYING,
    isAutoPlaying: false,
  });

  assert.equal(stoppedState.isAutoPlaying, false);
  assert.equal(stoppedState.isRepeatEnabled, true);
  assert.equal(stoppedState.pageNumber, 1);
  assert.equal(stoppedState.measureIndex, 0);
});

test('session reset stops playback and resets position while keeping Repeat', () => {
  const state = createInitialSessionState({
    isAutoPlaying: true,
    isRepeatEnabled: true,
    measureIndex: 8,
    pageNumber: 2,
  });
  const resetState = sessionReducer(state, {
    type: SESSION_ACTIONS.RESET_POSITION,
  });

  assert.equal(resetState.pageNumber, 1);
  assert.equal(resetState.measureIndex, 0);
  assert.equal(resetState.isAutoPlaying, false);
  assert.equal(resetState.isRepeatEnabled, true);
});

test('received sync state keeps only the existing logical Socket fields', () => {
  const state = sessionReducer(createInitialSessionState(), {
    type: SESSION_ACTIONS.APPLY_SYNC_STATE,
    syncState: {
      fileName: 'lesson.pdf',
      measureIndex: 7,
      pageNumber: 2,
      pageRenderWidth: 72,
    },
  });

  assert.deepEqual(state.syncState, {
    fileName: 'lesson.pdf',
    measureIndex: 7,
    pageNumber: 2,
  });
  assert.equal('pageRenderWidth' in state.syncState, false);
});

test('processing the same session event twice produces the same state values', () => {
  const action = {
    type: SESSION_ACTIONS.APPLY_SYNC_STATE,
    syncState: {
      fileName: 'lesson.pdf',
      measureIndex: 4,
      pageNumber: 2,
    },
  };
  const once = sessionReducer(createInitialSessionState(), action);
  const twice = sessionReducer(once, action);

  assert.deepEqual(twice, once);
});
