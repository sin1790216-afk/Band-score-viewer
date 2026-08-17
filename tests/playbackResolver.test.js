import assert from 'node:assert/strict';
import test from 'node:test';

import { getTeacherSyncState } from '../src/state/sessionState.js';
import { NAVIGATION_MARKER_TYPES } from '../src/utils/navigationMarkers.js';
import {
  advancePlaybackProgression,
  advancePlaybackRun,
  createPlaybackProgression,
  createPlaybackRunState,
  resolvePlaybackSequence,
  rewindPlaybackProgression,
} from '../src/utils/playbackResolver.js';

function createMeasures(count, markersByMeasureNumber = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index + 1}`,
    navigationMarkers: (markersByMeasureNumber[index + 1] || []).map((type) => ({
      type,
    })),
    page: index < 4 ? 1 : 2,
  }));
}

function addEndings(measures, repeatStartNumber, repeatEndNumber, ranges) {
  return measures.map((measure, index) => ({
    ...measure,
    navigationEndings:
      index === repeatStartNumber - 1
        ? ranges.map(({ end, pass, start }) => ({
            confidence: 1,
            ...(Number.isInteger(end) ? { endMeasureId: `m${end}` } : {}),
            id: `ending-${repeatStartNumber}-${pass}`,
            passes: [pass],
            repeatEndMeasureId: `m${repeatEndNumber}`,
            repeatStartMeasureId: `m${repeatStartNumber}`,
            source: 'manual',
            startMeasureId: `m${start}`,
            type: 'volta',
          }))
        : [],
  }));
}

function getMeasureNumbers(steps) {
  return steps.map((step) => step.measureIndex + 1);
}

function advanceProgressionToEnd(
  measures,
  { loopAtEnd = false, startMeasureIndex = 0 } = {},
) {
  let progression = createPlaybackProgression(measures, startMeasureIndex);
  const steps = progression.runState.currentStep
    ? [progression.runState.currentStep]
    : [];
  const guard = measures.length * 8;

  while (!progression.runState.ended && steps.length < guard) {
    const result = advancePlaybackProgression(progression, measures, {
      loopAtEnd,
    });

    progression = result.progression;
    if (result.didMove) steps.push(progression.runState.currentStep);
    if (loopAtEnd && progression.runState.cycleIndex > 0) break;
  }

  return { progression, steps };
}

test('A: a score without markers follows physical measure order', () => {
  const result = resolvePlaybackSequence(createMeasures(4));

  assert.deepEqual(getMeasureNumbers(result.steps), [1, 2, 3, 4]);
  assert.equal(result.runState.endReason, 'score-end');
});

test('B: Repeat Start and Repeat End repeat their physical range once', () => {
  const measures = createMeasures(5, {
    3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    4: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  });
  const result = resolvePlaybackSequence(measures);

  assert.deepEqual(getMeasureNumbers(result.steps), [1, 2, 3, 4, 3, 4, 5]);
  assert.deepEqual(result.runState.executedRepeatEndMeasureIds, ['m4']);
  assert.equal(result.steps[4].visitCount, 2);
});

test('C: D.S. returns to Segno once and then continues to the end', () => {
  const measures = createMeasures(8, {
    6: [NAVIGATION_MARKER_TYPES.SEGNO],
    8: [NAVIGATION_MARKER_TYPES.DAL_SEGNO],
  });
  const result = resolvePlaybackSequence(measures);

  assert.deepEqual(
    getMeasureNumbers(result.steps),
    [1, 2, 3, 4, 5, 6, 7, 8, 6, 7, 8],
  );
  assert.deepEqual(result.runState.executedDalSegnoMeasureIds, ['m8']);
});

test('D: repeat and D.S. produce the exact required combined sequence', () => {
  const measures = createMeasures(8, {
    3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    4: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    6: [NAVIGATION_MARKER_TYPES.SEGNO],
    8: [NAVIGATION_MARKER_TYPES.DAL_SEGNO],
  });
  const result = resolvePlaybackSequence(measures);

  assert.deepEqual(
    getMeasureNumbers(result.steps),
    [1, 2, 3, 4, 3, 4, 5, 6, 7, 8, 6, 7, 8],
  );
  assert.deepEqual(
    result.steps.filter((step) => step.measureId === 'm3').map((step) => step.visitCount),
    [1, 2],
  );
  assert.deepEqual(
    result.steps.filter((step) => step.measureId === 'm6').map((step) => step.visitCount),
    [1, 2],
  );
});

test('E: D.S. without Segno falls back to physical order', () => {
  const measures = createMeasures(4, {
    3: [NAVIGATION_MARKER_TYPES.DAL_SEGNO],
  });

  assert.deepEqual(
    getMeasureNumbers(resolvePlaybackSequence(measures).steps),
    [1, 2, 3, 4],
  );
});

test('F: Repeat End without Repeat Start falls back to physical order', () => {
  const measures = createMeasures(4, {
    3: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  });

  assert.deepEqual(
    getMeasureNumbers(resolvePlaybackSequence(measures).steps),
    [1, 2, 3, 4],
  );
});

test('G/H: each jump executes once and cannot create an infinite loop', () => {
  const measures = createMeasures(3, {
    1: [NAVIGATION_MARKER_TYPES.REPEAT_START, NAVIGATION_MARKER_TYPES.SEGNO],
    2: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    3: [NAVIGATION_MARKER_TYPES.DAL_SEGNO],
  });
  const result = resolvePlaybackSequence(measures);

  assert.deepEqual(getMeasureNumbers(result.steps), [1, 2, 1, 2, 3, 1, 2, 3]);
  assert.equal(result.runState.ended, true);
  assert.equal(result.runState.endReason, 'score-end');
  assert.deepEqual(result.runState.executedRepeatEndMeasureIds, ['m2']);
  assert.deepEqual(result.runState.executedDalSegnoMeasureIds, ['m3']);
});

test('K: resolved steps publish the same logical measure and page to followers', () => {
  const measures = createMeasures(6, {
    2: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    3: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  });
  const { steps } = resolvePlaybackSequence(measures);
  const syncPositions = steps.map((step) =>
    getTeacherSyncState(
      { fileName: 'lesson.pdf' },
      measures[step.measureIndex].page,
      step.measureIndex,
    ),
  );

  assert.deepEqual(
    syncPositions.map(({ measureIndex, pageNumber }) => [measureIndex, pageNumber]),
    [
      [0, 1],
      [1, 1],
      [2, 1],
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 2],
      [5, 2],
    ],
  );
});

test('L: a manual target starts a fresh playback run from that measure', () => {
  const measures = createMeasures(5, {
    2: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    3: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  });
  const priorRun = resolvePlaybackSequence(measures).runState;
  const restartedRun = createPlaybackRunState(measures, 1);
  const afterRepeatEnd = advancePlaybackRun(
    advancePlaybackRun(restartedRun, measures),
    measures,
  );

  assert.deepEqual(priorRun.executedRepeatEndMeasureIds, ['m3']);
  assert.deepEqual(restartedRun.executedRepeatEndMeasureIds, []);
  assert.equal(restartedRun.currentStep.measureIndex, 1);
  assert.equal(afterRepeatEnd.currentStep.measureIndex, 1);
  assert.equal(afterRepeatEnd.currentStep.enteredBy, 'repeat');
});

test('M: whole-song loop starts a new cycle and re-enables marker jumps', () => {
  const measures = createMeasures(3, {
    1: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    2: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  });
  let run = createPlaybackRunState(measures);

  for (let index = 0; index < 5; index += 1) {
    run = advancePlaybackRun(run, measures, { loopAtEnd: true });
  }

  assert.equal(run.currentStep.measureIndex, 0);
  assert.equal(run.currentStep.enteredBy, 'loop');
  assert.equal(run.currentStep.visitCount, 1);
  assert.equal(run.currentStep.visitIndex, 0);
  assert.equal(run.cycleIndex, 1);
  assert.equal(run.transitionCountInCycle, 0);
  assert.deepEqual(run.executedRepeatEndMeasureIds, []);

  run = advancePlaybackRun(run, measures, { loopAtEnd: true });
  run = advancePlaybackRun(run, measures, { loopAtEnd: true });

  assert.equal(run.currentStep.measureIndex, 0);
  assert.equal(run.currentStep.enteredBy, 'repeat');
  assert.deepEqual(run.executedRepeatEndMeasureIds, ['m2']);
});

test('N: manual next uses the same resolver sequence as automatic progression', () => {
  const measures = createMeasures(8, {
    3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    4: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    6: [NAVIGATION_MARKER_TYPES.SEGNO],
    8: [NAVIGATION_MARKER_TYPES.DAL_SEGNO],
  });
  const manualResult = advanceProgressionToEnd(measures);
  const automaticResult = advanceProgressionToEnd(measures);
  const expected = [1, 2, 3, 4, 3, 4, 5, 6, 7, 8, 6, 7, 8];

  assert.deepEqual(getMeasureNumbers(manualResult.steps), expected);
  assert.deepEqual(getMeasureNumbers(automaticResult.steps), expected);
});

test('O: manual progress followed by automatic progress keeps jump execution history', () => {
  const measures = createMeasures(8, {
    3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    4: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    6: [NAVIGATION_MARKER_TYPES.SEGNO],
    8: [NAVIGATION_MARKER_TYPES.DAL_SEGNO],
  });
  let progression = createPlaybackProgression(measures);
  const steps = [progression.runState.currentStep];

  for (let index = 0; index < 4; index += 1) {
    const result = advancePlaybackProgression(progression, measures);
    progression = result.progression;
    steps.push(progression.runState.currentStep);
  }

  assert.deepEqual(progression.runState.executedRepeatEndMeasureIds, ['m4']);

  while (!progression.runState.ended) {
    const result = advancePlaybackProgression(progression, measures);
    progression = result.progression;
    if (result.didMove) steps.push(progression.runState.currentStep);
  }

  assert.deepEqual(
    getMeasureNumbers(steps),
    [1, 2, 3, 4, 3, 4, 5, 6, 7, 8, 6, 7, 8],
  );
});

test('P: automatic progress followed by manual next keeps jump execution history', () => {
  const measures = createMeasures(8, {
    3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    4: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    6: [NAVIGATION_MARKER_TYPES.SEGNO],
    8: [NAVIGATION_MARKER_TYPES.DAL_SEGNO],
  });
  let progression = createPlaybackProgression(measures);
  const steps = [progression.runState.currentStep];

  for (let index = 0; index < 10; index += 1) {
    const result = advancePlaybackProgression(progression, measures);
    progression = result.progression;
    steps.push(progression.runState.currentStep);
  }

  assert.deepEqual(progression.runState.executedDalSegnoMeasureIds, ['m8']);

  while (!progression.runState.ended) {
    const result = advancePlaybackProgression(progression, measures);
    progression = result.progression;
    if (result.didMove) steps.push(progression.runState.currentStep);
  }

  assert.deepEqual(
    getMeasureNumbers(steps),
    [1, 2, 3, 4, 3, 4, 5, 6, 7, 8, 6, 7, 8],
  );
});

test('Q: direct navigation starts a new run and evaluates the marker on next', () => {
  const measures = createMeasures(8, {
    6: [NAVIGATION_MARKER_TYPES.SEGNO],
    8: [NAVIGATION_MARKER_TYPES.DAL_SEGNO],
  });
  const directProgression = createPlaybackProgression(measures, 7);

  assert.equal(directProgression.runState.currentStep.measureIndex, 7);
  assert.equal(directProgression.runState.currentStep.enteredBy, 'start');

  const result = advancePlaybackProgression(directProgression, measures);

  assert.equal(result.progression.runState.currentStep.measureIndex, 5);
  assert.equal(result.progression.runState.currentStep.enteredBy, 'dal-segno');
});

test('R: first and stop/start semantics create a fresh navigation run', () => {
  const measures = createMeasures(5, {
    2: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    3: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  });
  let progression = createPlaybackProgression(measures);

  for (let index = 0; index < 3; index += 1) {
    progression = advancePlaybackProgression(progression, measures).progression;
  }

  assert.deepEqual(progression.runState.executedRepeatEndMeasureIds, ['m3']);

  const firstProgression = createPlaybackProgression(measures, 0);
  const restartedAtCurrent = createPlaybackProgression(
    measures,
    progression.runState.currentStep.measureIndex,
  );

  assert.deepEqual(firstProgression.runState.executedRepeatEndMeasureIds, []);
  assert.equal(firstProgression.history.length, 1);
  assert.deepEqual(restartedAtCurrent.runState.executedRepeatEndMeasureIds, []);
  assert.equal(restartedAtCurrent.runState.currentStep.enteredBy, 'start');
});

test('S: previous follows visited PlaybackStep history and forward reuses it', () => {
  const measures = createMeasures(5, {
    3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    4: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  });
  let progression = createPlaybackProgression(measures);

  for (let index = 0; index < 4; index += 1) {
    progression = advancePlaybackProgression(progression, measures).progression;
  }

  assert.equal(progression.runState.currentStep.measureIndex, 2);
  assert.equal(progression.runState.currentStep.visitCount, 2);

  progression = rewindPlaybackProgression(progression).progression;
  assert.equal(progression.runState.currentStep.measureIndex, 3);

  progression = rewindPlaybackProgression(progression).progression;
  assert.equal(progression.runState.currentStep.measureIndex, 2);
  assert.equal(progression.runState.currentStep.visitCount, 1);

  progression = advancePlaybackProgression(progression, measures).progression;
  assert.equal(progression.runState.currentStep.measureIndex, 3);

  progression = advancePlaybackProgression(progression, measures).progression;
  assert.equal(progression.runState.currentStep.measureIndex, 2);
  assert.equal(progression.runState.currentStep.visitCount, 2);
});

test('T: whole-song repeat keeps markers active and resets their cycle history', () => {
  const measures = createMeasures(8, {
    3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    4: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    6: [NAVIGATION_MARKER_TYPES.SEGNO],
    8: [NAVIGATION_MARKER_TYPES.DAL_SEGNO],
  });
  const result = advanceProgressionToEnd(measures, { loopAtEnd: true });

  assert.deepEqual(
    getMeasureNumbers(result.steps),
    [1, 2, 3, 4, 3, 4, 5, 6, 7, 8, 6, 7, 8, 1],
  );
  assert.equal(result.progression.runState.cycleIndex, 1);
  assert.equal(result.progression.runState.currentStep.visitCount, 1);
  assert.equal(result.progression.runState.currentStep.visitIndex, 0);
  assert.deepEqual(result.progression.runState.executedRepeatEndMeasureIds, []);
  assert.deepEqual(result.progression.runState.executedDalSegnoMeasureIds, []);

  let secondCycleProgression = result.progression;
  const secondCycleSteps = [secondCycleProgression.runState.currentStep];

  while (secondCycleProgression.runState.cycleIndex === 1) {
    const nextResult = advancePlaybackProgression(
      secondCycleProgression,
      measures,
      { loopAtEnd: true },
    );
    secondCycleProgression = nextResult.progression;
    if (nextResult.didMove) {
      secondCycleSteps.push(secondCycleProgression.runState.currentStep);
    }
  }

  assert.deepEqual(
    getMeasureNumbers(secondCycleSteps),
    [1, 2, 3, 4, 3, 4, 5, 6, 7, 8, 6, 7, 8, 1],
  );
});

test('U: one-measure endings select pass 1 and pass 2 in playback order', () => {
  const measures = addEndings(
    createMeasures(8, {
      3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
      4: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    }),
    3,
    4,
    [
      { end: 4, pass: 1, start: 4 },
      { end: 5, pass: 2, start: 5 },
    ],
  );
  const result = resolvePlaybackSequence(measures);

  assert.deepEqual(getMeasureNumbers(result.steps), [1, 2, 3, 4, 3, 5, 6, 7, 8]);
  assert.deepEqual(
    result.steps.filter((step) => step.repeatSectionId).map((step) => step.repeatPass),
    [1, 1, 2, 2],
  );
});

test('U2: point anchors derive one-measure volta ranges', () => {
  const measures = addEndings(
    createMeasures(8, {
      3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
      4: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    }),
    3,
    4,
    [
      { pass: 1, start: 4 },
      { pass: 2, start: 5 },
    ],
  );

  assert.deepEqual(
    getMeasureNumbers(resolvePlaybackSequence(measures).steps),
    [1, 2, 3, 4, 3, 5, 6, 7, 8],
  );
});

test('V: multi-measure endings skip the whole non-current pass range', () => {
  const measures = addEndings(
    createMeasures(9, {
      3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
      6: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    }),
    3,
    6,
    [
      { end: 6, pass: 1, start: 5 },
      { end: 8, pass: 2, start: 7 },
    ],
  );

  assert.deepEqual(
    getMeasureNumbers(resolvePlaybackSequence(measures).steps),
    [1, 2, 3, 4, 5, 6, 3, 4, 7, 8, 9],
  );
});

test('V2: point anchors derive the first multi-measure volta through repeat end', () => {
  const measures = addEndings(
    createMeasures(9, {
      3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
      6: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    }),
    3,
    6,
    [
      { pass: 1, start: 5 },
      { pass: 2, start: 7 },
    ],
  );

  assert.deepEqual(
    getMeasureNumbers(resolvePlaybackSequence(measures).steps),
    [1, 2, 3, 4, 5, 6, 3, 4, 7, 8, 9],
  );
});

test('W: maximum ending pass drives three passes without a two-pass constant', () => {
  const measures = addEndings(
    createMeasures(8, {
      3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
      4: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    }),
    3,
    4,
    [
      { end: 4, pass: 1, start: 4 },
      { end: 5, pass: 2, start: 5 },
      { end: 6, pass: 3, start: 6 },
    ],
  );

  assert.deepEqual(
    getMeasureNumbers(resolvePlaybackSequence(measures).steps),
    [1, 2, 3, 4, 3, 5, 3, 6, 7, 8],
  );
});

test('W2: three point anchors keep generic N-pass playback', () => {
  const measures = addEndings(
    createMeasures(8, {
      3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
      4: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    }),
    3,
    4,
    [
      { pass: 1, start: 4 },
      { pass: 2, start: 5 },
      { pass: 3, start: 6 },
    ],
  );

  assert.deepEqual(
    getMeasureNumbers(resolvePlaybackSequence(measures).steps),
    [1, 2, 3, 4, 3, 5, 3, 6, 7, 8],
  );
});

test('X: manual, automatic, and mixed progression preserve the same ending pass', () => {
  const measures = addEndings(
    createMeasures(8, {
      3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
      4: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    }),
    3,
    4,
    [
      { end: 4, pass: 1, start: 4 },
      { end: 5, pass: 2, start: 5 },
    ],
  );
  const expected = [1, 2, 3, 4, 3, 5, 6, 7, 8];
  const manual = advanceProgressionToEnd(measures);
  let mixedProgression = createPlaybackProgression(measures);
  const mixedSteps = [mixedProgression.runState.currentStep];

  for (let index = 0; index < 4; index += 1) {
    const result = advancePlaybackProgression(mixedProgression, measures);
    mixedProgression = result.progression;
    mixedSteps.push(mixedProgression.runState.currentStep);
  }
  while (!mixedProgression.runState.ended) {
    const result = advancePlaybackProgression(mixedProgression, measures);
    mixedProgression = result.progression;
    if (result.didMove) mixedSteps.push(mixedProgression.runState.currentStep);
  }

  assert.deepEqual(getMeasureNumbers(manual.steps), expected);
  assert.deepEqual(getMeasureNumbers(mixedSteps), expected);
});

test('X2: manual and automatic progression share the point-anchor sequence', () => {
  const measures = addEndings(
    createMeasures(8, {
      3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
      4: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    }),
    3,
    4,
    [
      { pass: 1, start: 4 },
      { pass: 2, start: 5 },
    ],
  );
  const resolved = resolvePlaybackSequence(measures);
  const progressed = advanceProgressionToEnd(measures);

  assert.deepEqual(
    getMeasureNumbers(progressed.steps),
    getMeasureNumbers(resolved.steps),
  );
});

test('Y: whole-song loop resets ending pass and history rewinds actual visits', () => {
  const measures = addEndings(
    createMeasures(8, {
      3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
      4: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    }),
    3,
    4,
    [
      { end: 4, pass: 1, start: 4 },
      { end: 5, pass: 2, start: 5 },
    ],
  );
  const looped = advanceProgressionToEnd(measures, { loopAtEnd: true });

  assert.deepEqual(
    getMeasureNumbers(looped.steps),
    [1, 2, 3, 4, 3, 5, 6, 7, 8, 1],
  );
  assert.deepEqual(
    Object.values(looped.progression.runState.repeatPassBySectionId),
    [1],
  );

  let progression = createPlaybackProgression(measures);
  for (let index = 0; index < 5; index += 1) {
    progression = advancePlaybackProgression(progression, measures).progression;
  }
  const history = [progression.runState.currentStep.measureIndex + 1];
  for (let index = 0; index < 3; index += 1) {
    progression = rewindPlaybackProgression(progression).progression;
    history.push(progression.runState.currentStep.measureIndex + 1);
  }

  assert.deepEqual(history, [5, 3, 4, 3]);
});

test('Y2: point anchors reset pass on whole-song loop and keep visited history', () => {
  const measures = addEndings(
    createMeasures(8, {
      3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
      4: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    }),
    3,
    4,
    [
      { pass: 1, start: 4 },
      { pass: 2, start: 5 },
    ],
  );
  const looped = advanceProgressionToEnd(measures, { loopAtEnd: true });

  assert.deepEqual(
    getMeasureNumbers(looped.steps),
    [1, 2, 3, 4, 3, 5, 6, 7, 8, 1],
  );
  assert.deepEqual(Object.values(looped.progression.runState.repeatPassBySectionId), [1]);

  let progression = createPlaybackProgression(measures);
  for (let index = 0; index < 5; index += 1) {
    progression = advancePlaybackProgression(progression, measures).progression;
  }
  progression = rewindPlaybackProgression(progression).progression;
  assert.equal(progression.runState.currentStep.measureIndex + 1, 3);
});

test('Z: direct navigation starts a fresh run and D.S. remains unchanged', () => {
  const endingMeasures = addEndings(
    createMeasures(8, {
      3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
      4: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    }),
    3,
    4,
    [
      { end: 4, pass: 1, start: 4 },
      { end: 5, pass: 2, start: 5 },
    ],
  );
  const direct = createPlaybackProgression(endingMeasures, 4);

  assert.equal(direct.runState.currentStep.measureIndex, 4);
  assert.equal(direct.runState.currentStep.repeatPass, 2);
  assert.equal(
    advancePlaybackProgression(direct, endingMeasures).progression.runState.currentStep
      .measureIndex,
    5,
  );

  const dalSegnoMeasures = createMeasures(8, {
    6: [NAVIGATION_MARKER_TYPES.SEGNO],
    8: [NAVIGATION_MARKER_TYPES.DAL_SEGNO],
  });
  assert.deepEqual(
    getMeasureNumbers(resolvePlaybackSequence(dalSegnoMeasures).steps),
    [1, 2, 3, 4, 5, 6, 7, 8, 6, 7, 8],
  );
});

test('AA: two independent repeat sections keep separate pass state', () => {
  let measures = createMeasures(10, {
    2: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    3: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    6: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    7: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  });

  measures = measures.map((measure, index) => ({
    ...measure,
    navigationEndings:
      index === 1
          ? addEndings(measures, 2, 3, [
            { pass: 1, start: 3 },
            { pass: 2, start: 4 },
          ])[1].navigationEndings
        : index === 5
          ? addEndings(measures, 6, 7, [
              { pass: 1, start: 7 },
              { pass: 2, start: 8 },
            ])[5].navigationEndings
          : [],
  }));

  assert.deepEqual(
    getMeasureNumbers(resolvePlaybackSequence(measures).steps),
    [1, 2, 3, 2, 4, 5, 6, 7, 6, 8, 9, 10],
  );
});
