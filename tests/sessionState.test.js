import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createEmptySharedSessionState,
  createInitialSessionState,
  getLogicalPlaybackStep,
  getLogicalSyncState,
  getTeacherSyncState,
  SESSION_ACTIONS,
  sessionReducer,
} from '../src/state/sessionState.js';

test('empty shared session clears the PDF, measures, and logical position', () => {
  assert.deepEqual(createEmptySharedSessionState(), {
    audioSettings: {
      startOffsetSeconds: 0,
      url: '',
    },
    measures: [],
    pdf: null,
    syncState: {
      fileName: '',
      measureIndex: 0,
      pageNumber: 1,
      playbackStep: null,
    },
  });
});

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
    playbackStep: null,
  });
});

test('session state handles playback options without changing position', () => {
  const playingState = sessionReducer(createInitialSessionState(), {
    type: SESSION_ACTIONS.SET_AUTO_PLAYING,
    isAutoPlaying: true,
  });
  const repeatState = sessionReducer(playingState, {
    type: SESSION_ACTIONS.SET_REPEAT_ENABLED,
    isRepeatEnabled: true,
  });
  const returnState = sessionReducer(repeatState, {
    type: SESSION_ACTIONS.SET_RETURN_TO_START_ON_END,
    returnToStartOnEnd: true,
  });
  const stoppedState = sessionReducer(returnState, {
    type: SESSION_ACTIONS.SET_AUTO_PLAYING,
    isAutoPlaying: false,
  });

  assert.equal(stoppedState.isAutoPlaying, false);
  assert.equal(stoppedState.isRepeatEnabled, true);
  assert.equal(stoppedState.returnToStartOnEnd, true);
  assert.equal(stoppedState.pageNumber, 1);
  assert.equal(stoppedState.measureIndex, 0);
});

test('session reset stops playback and resets position while keeping playback options', () => {
  const state = createInitialSessionState({
    isAutoPlaying: true,
    isRepeatEnabled: true,
    measureIndex: 8,
    pageNumber: 2,
    returnToStartOnEnd: true,
  });
  const resetState = sessionReducer(state, {
    type: SESSION_ACTIONS.RESET_POSITION,
  });

  assert.equal(resetState.pageNumber, 1);
  assert.equal(resetState.measureIndex, 0);
  assert.equal(resetState.isAutoPlaying, false);
  assert.equal(resetState.isRepeatEnabled, true);
  assert.equal(resetState.returnToStartOnEnd, true);
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
    playbackStep: null,
  });
  assert.equal('pageRenderWidth' in state.syncState, false);
});

test('Teacher entry replaces a stale server position with the local position', () => {
  assert.deepEqual(
    getTeacherSyncState(
      {
        fileName: 'lesson.pdf',
        measureIndex: 8,
        pageNumber: 3,
      },
      1,
      0,
    ),
    {
      fileName: 'lesson.pdf',
      measureIndex: 0,
      pageNumber: 1,
      playbackStep: null,
    },
  );
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

test('logical sync state rejects unsafe page, measure, and filename values', () => {
  assert.deepEqual(
    getLogicalSyncState({
      fileName: { value: 'lesson.pdf' },
      measureIndex: -1,
      pageNumber: '2',
    }),
    {
      fileName: '',
      measureIndex: 0,
      pageNumber: 1,
      playbackStep: null,
    },
  );

  assert.equal(
    getLogicalSyncState({
      fileName: 'a'.repeat(300),
      measureIndex: 0,
      pageNumber: 1,
    }).fileName.length,
    255,
  );
});

test('playback step은 현재 Repeat pass와 Navigation 진입 경로만 보존한다', () => {
  const playbackStep = getLogicalPlaybackStep({
    enteredBy: 'repeat',
    measureId: 'measure-2',
    repeatPass: 2,
    repeatSectionId: 'repeat:measure-2:measure-4',
    visitCount: 99,
    visitIndex: 98,
  });

  assert.deepEqual(playbackStep, {
    enteredBy: 'repeat',
    measureId: 'measure-2',
    repeatPass: 2,
    repeatSectionId: 'repeat:measure-2:measure-4',
  });
});

test('잘못된 playback step은 Socket logical state에서 제거한다', () => {
  assert.equal(
    getLogicalPlaybackStep({
      enteredBy: 'unknown-jump',
      measureId: 'measure-2',
      repeatPass: 2,
      repeatSectionId: null,
    }),
    null,
  );
  assert.equal(
    getLogicalPlaybackStep({
      enteredBy: 'repeat',
      measureId: 'measure-2',
      repeatPass: 0,
      repeatSectionId: 'repeat:m1:m2',
    }),
    null,
  );
});

test('Teacher sync는 late join Vocal용 current PlaybackStep을 전달한다', () => {
  const syncState = getTeacherSyncState(
    { fileName: 'lesson.pdf' },
    2,
    4,
    {
      enteredBy: 'dal-segno',
      measureId: 'measure-5',
      repeatPass: null,
      repeatSectionId: null,
    },
  );

  assert.deepEqual(syncState.playbackStep, {
    enteredBy: 'dal-segno',
    measureId: 'measure-5',
    repeatPass: null,
    repeatSectionId: null,
  });
});
