import assert from 'node:assert/strict';
import test from 'node:test';

import { createSyncStateSession } from '../src/server/syncStateSession.js';

function createPlaybackStep(repeatPass) {
  return {
    enteredBy: repeatPass > 1 ? 'repeat' : 'start',
    measureId: 'measure-11',
    repeatPass,
    repeatSectionId: 'repeat:measure-11:measure-15',
  };
}

test('sync session은 초기 playbackStep을 null로 유지한다', () => {
  assert.equal(createSyncStateSession().getState().playbackStep, null);
});

test('sync session은 Repeat pass update를 late join state에 보존한다', () => {
  const session = createSyncStateSession({
    fileName: 'lesson.pdf',
    measureIndex: 10,
    pageNumber: 2,
  });

  session.update({ playbackStep: createPlaybackStep(1) });
  const secondPassState = session.update({
    measureIndex: 10,
    pageNumber: 2,
    playbackStep: createPlaybackStep(2),
  });

  assert.equal(secondPassState.playbackStep.repeatPass, 2);
  assert.deepEqual(session.getState(), secondPassState);
});

test('sync session은 잘못된 playbackStep을 제거하고 reset 시 stale pass를 지운다', () => {
  const session = createSyncStateSession();

  session.update({ playbackStep: createPlaybackStep(2) });
  assert.equal(
    session.update({
      playbackStep: {
        enteredBy: 'invalid-entry',
        measureId: 'measure-11',
        repeatPass: 3,
        repeatSectionId: 'repeat:measure-11:measure-15',
      },
    }).playbackStep,
    null,
  );

  session.update({ playbackStep: createPlaybackStep(2) });
  assert.equal(session.reset().playbackStep, null);
});
