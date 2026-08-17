import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInitialProjectState,
  PROJECT_ACTIONS,
  projectReducer,
} from '../src/state/projectState.js';
import { getTeacherSyncState } from '../src/state/sessionState.js';
import {
  NAVIGATION_MARKER_TYPES,
  NAVIGATION_REPEAT_POLICIES,
  toggleNavigationMarker,
} from '../src/utils/navigationMarkers.js';
import {
  addNavigationEnding,
  buildNavigationModel,
} from '../src/utils/navigationModel.js';
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
    navigationMarkers: (markersByMeasureNumber[index + 1] || []).map((marker) =>
      typeof marker === 'string' ? { type: marker } : { ...marker },
    ),
    page: index < 4 ? 1 : 2,
  }));
}

function toggleTeacherUiMarker(projectState, measureNumber, markerType) {
  const measureIndex = measureNumber - 1;
  const measure = projectState.measures[measureIndex];

  return projectReducer(projectState, {
    type: PROJECT_ACTIONS.UPDATE_MEASURE,
    changes: {
      navigationMarkers: toggleNavigationMarker(
        measure.navigationMarkers,
        markerType,
      ),
    },
    index: measureIndex,
  });
}

function addTeacherUiEnding(projectState, startMeasureNumber) {
  const navigationModel = buildNavigationModel(projectState.measures);
  const nextMeasures = addNavigationEnding(
    projectState.measures,
    navigationModel.repeatSections[0],
    startMeasureNumber,
  );

  return projectReducer(projectState, {
    type: PROJECT_ACTIONS.REPLACE_MEASURES,
    measures: nextMeasures,
  });
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

function createCodaVoltaMeasures({
  commandPolicy,
  endingPasses = [1, 2],
  toCodaMeasureNumber = 5,
} = {}) {
  const commandMarker = {
    ...(commandPolicy ? { repeatPolicy: commandPolicy } : {}),
    type: NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
  };
  const repeatEndMeasureNumber = endingPasses.length === 1 ? 4 : 6;
  const commandMeasureNumber = endingPasses.length === 1 ? 7 : 9;
  const codaMeasureNumber = endingPasses.length === 1 ? 9 : 11;
  const measureCount = endingPasses.length === 1 ? 10 : 12;
  const markersByMeasureNumber = {
    2: [NAVIGATION_MARKER_TYPES.SEGNO],
    3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    [repeatEndMeasureNumber]: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    [commandMeasureNumber]: [commandMarker],
    [codaMeasureNumber]: [NAVIGATION_MARKER_TYPES.CODA],
  };

  markersByMeasureNumber[toCodaMeasureNumber] = [
    ...(markersByMeasureNumber[toCodaMeasureNumber] || []),
    NAVIGATION_MARKER_TYPES.TO_CODA,
  ];
  const measures = createMeasures(measureCount, markersByMeasureNumber);
  const endingRanges = endingPasses.map((pass, index) => ({
    pass,
    start:
      endingPasses.length === 1
        ? 5
        : index === 0
          ? 5
          : 7 + index - 1,
  }));

  return addEndings(
    measures,
    3,
    repeatEndMeasureNumber,
    endingRanges,
  );
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
  assert.equal(result.runState.lastNavigationPlan.reason, 'equivalent-paths');
});

test('C2: D.S. al Coda arms To Coda only after the Segno jump', () => {
  const measures = createMeasures(11, {
    3: [NAVIGATION_MARKER_TYPES.SEGNO],
    5: [NAVIGATION_MARKER_TYPES.TO_CODA],
    8: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA],
    10: [NAVIGATION_MARKER_TYPES.CODA],
  });
  const result = resolvePlaybackSequence(measures);

  assert.deepEqual(
    getMeasureNumbers(result.steps),
    [1, 2, 3, 4, 5, 6, 7, 8, 3, 4, 5, 10, 11],
  );
  assert.deepEqual(result.runState.executedDalSegnoAlCodaMeasureIds, ['m8']);
  assert.deepEqual(result.runState.executedCodaJumpMeasureIds, ['m5']);
  assert.equal(result.runState.codaArmed, false);
});

test('C3: Coda jump 후 만나는 To Coda는 다시 jump하지 않는다', () => {
  const measures = createMeasures(12, {
    3: [NAVIGATION_MARKER_TYPES.SEGNO],
    5: [NAVIGATION_MARKER_TYPES.TO_CODA],
    8: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA],
    10: [NAVIGATION_MARKER_TYPES.CODA],
    11: [NAVIGATION_MARKER_TYPES.TO_CODA],
  });

  assert.deepEqual(
    getMeasureNumbers(resolvePlaybackSequence(measures).steps),
    [1, 2, 3, 4, 5, 6, 7, 8, 3, 4, 5, 10, 11, 12],
  );
});

test('C4: D.S. al Fine 이후에만 Fine에서 종료한다', () => {
  const measures = createMeasures(8, {
    3: [NAVIGATION_MARKER_TYPES.SEGNO],
    6: [NAVIGATION_MARKER_TYPES.FINE],
    8: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE],
  });
  const result = resolvePlaybackSequence(measures);

  assert.deepEqual(
    getMeasureNumbers(result.steps),
    [1, 2, 3, 4, 5, 6, 7, 8, 3, 4, 5, 6],
  );
  assert.equal(result.runState.endReason, 'fine');
  assert.deepEqual(result.runState.executedDalSegnoAlFineMeasureIds, ['m8']);
});

test('C5: invalid Coda/Fine target은 physical-next로 안전하게 진행한다', () => {
  const noCoda = createMeasures(5, {
    2: [NAVIGATION_MARKER_TYPES.SEGNO],
    3: [NAVIGATION_MARKER_TYPES.TO_CODA],
    4: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA],
  });
  const noFine = createMeasures(5, {
    2: [NAVIGATION_MARKER_TYPES.SEGNO],
    4: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE],
  });

  assert.deepEqual(
    getMeasureNumbers(resolvePlaybackSequence(noCoda).steps),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    getMeasureNumbers(resolvePlaybackSequence(noFine).steps),
    [1, 2, 3, 4, 5],
  );
});

test('C6: manual/automatic과 history는 동일한 Coda 방문 순서를 사용한다', () => {
  const measures = createMeasures(11, {
    3: [NAVIGATION_MARKER_TYPES.SEGNO],
    5: [NAVIGATION_MARKER_TYPES.TO_CODA],
    8: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA],
    10: [NAVIGATION_MARKER_TYPES.CODA],
  });
  const resolved = resolvePlaybackSequence(measures);
  const progressed = advanceProgressionToEnd(measures);
  let progression = progressed.progression;

  progression = rewindPlaybackProgression(progression).progression;
  progression = rewindPlaybackProgression(progression).progression;

  assert.deepEqual(
    getMeasureNumbers(progressed.steps),
    getMeasureNumbers(resolved.steps),
  );
  assert.equal(progression.runState.currentStep.measureIndex + 1, 5);
  assert.equal(progression.runState.currentStep.enteredBy, 'next');
});

test('C7: whole-song repeat는 Coda/Fine 실행 상태를 새 cycle에서 초기화한다', () => {
  const measures = createMeasures(11, {
    3: [NAVIGATION_MARKER_TYPES.SEGNO],
    5: [NAVIGATION_MARKER_TYPES.TO_CODA],
    8: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA],
    10: [NAVIGATION_MARKER_TYPES.CODA],
  });
  const result = advanceProgressionToEnd(measures, { loopAtEnd: true });

  assert.equal(result.progression.runState.cycleIndex, 1);
  assert.equal(result.progression.runState.codaArmed, false);
  assert.equal(result.progression.runState.fineArmed, false);
  assert.deepEqual(result.progression.runState.executedCodaJumpMeasureIds, []);
  assert.deepEqual(
    result.progression.runState.executedDalSegnoAlCodaMeasureIds,
    [],
  );
});

test('C8: To Coda가 1번 괄호 안이면 AUTO가 replay를 선택한다', () => {
  const measures = createCodaVoltaMeasures();
  const result = resolvePlaybackSequence(measures);

  assert.deepEqual(
    getMeasureNumbers(result.steps),
    [1, 2, 3, 4, 5, 6, 3, 4, 7, 8, 9, 2, 3, 4, 5, 11, 12],
  );
  assert.equal(result.runState.lastNavigationPlan.status, 'resolved');
  assert.equal(result.runState.lastNavigationPlan.selectedPolicy, 'replay');
  assert.equal(
    result.runState.lastNavigationPlan.candidatePaths.find(
      (candidate) => candidate.policy === 'skip',
    ).result,
    'target-unreachable',
  );
  assert.deepEqual(result.runState.executedDalSegnoAlCodaMeasureIds, ['m9']);
  assert.deepEqual(result.runState.executedCodaJumpMeasureIds, ['m5']);
});

test('C8.1: Repeat End와 같은 마디의 To Coda는 D.S. 이후 Coda로 우선 이동한다', () => {
  const measures = createCodaVoltaMeasures({ toCodaMeasureNumber: 6 });
  const result = resolvePlaybackSequence(measures);

  assert.deepEqual(
    getMeasureNumbers(result.steps),
    [1, 2, 3, 4, 5, 6, 3, 4, 7, 8, 9, 2, 3, 4, 5, 6, 11, 12],
  );
  assert.equal(result.runState.lastNavigationPlan.status, 'resolved');
  assert.equal(result.runState.lastNavigationPlan.selectedPolicy, 'replay');
  assert.deepEqual(result.runState.executedRepeatEndMeasureIds, []);
  assert.deepEqual(result.runState.executedCodaJumpMeasureIds, ['m6']);
});

test('C8.2: Teacher UI 상태 경로로 만든 실제 위치의 D.S. al Coda가 동작한다', () => {
  let projectState = createInitialProjectState({ measures: createMeasures(82) });
  const markerPlacements = [
    [12, NAVIGATION_MARKER_TYPES.REPEAT_START],
    [47, NAVIGATION_MARKER_TYPES.SEGNO],
    [63, NAVIGATION_MARKER_TYPES.REPEAT_END],
    [63, NAVIGATION_MARKER_TYPES.TO_CODA],
    [80, NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA],
    [81, NAVIGATION_MARKER_TYPES.CODA],
  ];

  markerPlacements.forEach(([measureNumber, markerType]) => {
    projectState = toggleTeacherUiMarker(
      projectState,
      measureNumber,
      markerType,
    );
  });
  projectState = addTeacherUiEnding(projectState, 57);
  projectState = addTeacherUiEnding(projectState, 64);

  const navigationModel = buildNavigationModel(projectState.measures);
  const result = resolvePlaybackSequence(projectState.measures);
  const steps = getMeasureNumbers(result.steps);

  assert.deepEqual(projectState.measures[46].navigationMarkers, [
    { type: NAVIGATION_MARKER_TYPES.SEGNO },
  ]);
  assert.deepEqual(projectState.measures[62].navigationMarkers, [
    { type: NAVIGATION_MARKER_TYPES.REPEAT_END },
    { type: NAVIGATION_MARKER_TYPES.TO_CODA },
  ]);
  assert.deepEqual(projectState.measures[79].navigationMarkers, [
    { type: NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA },
  ]);
  assert.deepEqual(projectState.measures[80].navigationMarkers, [
    { type: NAVIGATION_MARKER_TYPES.CODA },
  ]);
  assert.deepEqual(navigationModel.issues, []);
  assert.equal(steps[steps.indexOf(80) + 1], 47);
  assert.equal(steps[steps.lastIndexOf(63) + 1], 81);
  assert.equal(result.runState.lastNavigationPlan.status, 'resolved');
  assert.equal(result.runState.lastNavigationPlan.selectedPolicy, 'replay');
  assert.deepEqual(result.runState.executedDalSegnoAlCodaMeasureIds, ['m80']);
  assert.deepEqual(result.runState.executedCodaJumpMeasureIds, ['m63']);
});

test('C9: final N-pass 괄호에만 To Coda가 있으면 AUTO가 skip을 선택한다', () => {
  const measures = createCodaVoltaMeasures({
    endingPasses: [3],
    toCodaMeasureNumber: 5,
  });
  const result = resolvePlaybackSequence(measures);

  assert.deepEqual(
    getMeasureNumbers(result.steps),
    [1, 2, 3, 4, 6, 7, 2, 3, 4, 5, 9, 10],
  );
  assert.equal(result.runState.lastNavigationPlan.selectedPolicy, 'skip');
  assert.equal(result.runState.lastNavigationPlan.repeatSections[0].maxPass, 3);
  assert.equal(
    Object.values(result.runState.lastNavigationPlan.repeatDecisions)[0],
    'skip',
  );
});

test('C10: replay와 skip이 다른 유효 경로면 현재 마디에서 결정을 기다린다', () => {
  const measures = createMeasures(10, {
    2: [NAVIGATION_MARKER_TYPES.SEGNO],
    3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    4: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    6: [NAVIGATION_MARKER_TYPES.TO_CODA],
    8: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA],
    10: [NAVIGATION_MARKER_TYPES.CODA],
  });
  const result = resolvePlaybackSequence(measures);

  assert.deepEqual(
    getMeasureNumbers(result.steps),
    [1, 2, 3, 4, 3, 4, 5, 6, 7, 8],
  );
  assert.equal(result.runState.pendingNavigationDecision.command.measureId, 'm8');
  assert.deepEqual(
    result.runState.pendingNavigationDecision.options.map((option) => option.policy),
    ['skip', 'replay'],
  );
});

test('C11: D.S. al Fine도 Fine 도달성으로 replay를 선택한다', () => {
  let measures = createMeasures(10, {
    2: [NAVIGATION_MARKER_TYPES.SEGNO],
    3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    5: [NAVIGATION_MARKER_TYPES.FINE],
    6: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    9: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE],
  });

  measures = addEndings(measures, 3, 6, [
    { pass: 1, start: 5 },
    { pass: 2, start: 7 },
  ]);
  const result = resolvePlaybackSequence(measures);

  assert.deepEqual(
    getMeasureNumbers(result.steps),
    [1, 2, 3, 4, 5, 6, 3, 4, 7, 8, 9, 2, 3, 4, 5],
  );
  assert.equal(result.runState.endReason, 'fine');
  assert.equal(result.runState.lastNavigationPlan.selectedPolicy, 'replay');
});

test('C12: 명시 repeatPolicy는 AUTO 질문 없이 해당 정책을 실행한다', () => {
  const replayMeasures = createCodaVoltaMeasures({
    commandPolicy: NAVIGATION_REPEAT_POLICIES.REPLAY,
  });
  const skipMeasures = createCodaVoltaMeasures({
    commandPolicy: NAVIGATION_REPEAT_POLICIES.SKIP,
  });
  const replay = resolvePlaybackSequence(replayMeasures);
  const skip = resolvePlaybackSequence(skipMeasures);

  assert.equal(replay.runState.pendingNavigationDecision, null);
  assert.equal(replay.runState.lastNavigationPlan.reason, 'manual-override');
  assert.deepEqual(getMeasureNumbers(replay.steps).slice(-6), [2, 3, 4, 5, 11, 12]);
  assert.equal(skip.runState.pendingNavigationDecision, null);
  assert.deepEqual(
    getMeasureNumbers(skip.steps).slice(-9),
    [2, 3, 4, 7, 8, 9, 10, 11, 12],
  );
});

test('C13: replay는 repeat state만 초기화하고 D.S./Coda 상태를 유지한다', () => {
  const measures = createCodaVoltaMeasures();
  let progression = createPlaybackProgression(measures);

  while (progression.runState.currentStep.measureId !== 'm9') {
    progression = advancePlaybackProgression(progression, measures).progression;
  }

  progression = advancePlaybackProgression(progression, measures).progression;
  const repeatSectionId = Object.keys(
    progression.runState.repeatPassBySectionId,
  )[0];

  assert.equal(progression.runState.currentStep.measureId, 'm2');
  assert.equal(progression.runState.codaArmed, true);
  assert.equal(progression.runState.repeatPassBySectionId[repeatSectionId], 1);
  assert.equal(
    progression.runState.executedRepeatEndMeasureIds.includes('m6'),
    false,
  );
  assert.deepEqual(
    progression.runState.executedDalSegnoAlCodaMeasureIds,
    ['m9'],
  );
});

test('C14: AUTO 경로는 수동/자동 progression과 history에서 동일하다', () => {
  const measures = createCodaVoltaMeasures();
  const resolved = resolvePlaybackSequence(measures);
  const progressed = advanceProgressionToEnd(measures);
  let historyProgression = progressed.progression;
  const history = [historyProgression.runState.currentStep.measureIndex + 1];

  for (let index = 0; index < 6; index += 1) {
    historyProgression = rewindPlaybackProgression(historyProgression).progression;
    history.push(historyProgression.runState.currentStep.measureIndex + 1);
  }

  assert.deepEqual(
    getMeasureNumbers(progressed.steps),
    getMeasureNumbers(resolved.steps),
  );
  assert.deepEqual(history, [12, 11, 5, 4, 3, 2, 9]);
});

test('C15: whole-song repeat는 AUTO runtime 결정만 새 cycle로 초기화한다', () => {
  const measures = createCodaVoltaMeasures();
  const looped = advanceProgressionToEnd(measures, { loopAtEnd: true });

  assert.equal(looped.progression.runState.cycleIndex, 1);
  assert.equal(looped.progression.runState.currentStep.measureIndex, 0);
  assert.equal(looped.progression.runState.lastNavigationPlan, null);
  assert.equal(looped.progression.runState.pendingNavigationDecision, null);
  assert.deepEqual(
    looped.progression.runState.resolvedRepeatDecisionsByCommandId,
    {},
  );
  assert.deepEqual(
    looped.progression.runState.executedDalSegnoAlCodaMeasureIds,
    [],
  );
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

test('G/H: 일반 D.S.의 다른 유효 경로는 질문하고 명시 선택 후 무한 반복하지 않는다', () => {
  const measures = createMeasures(3, {
    1: [NAVIGATION_MARKER_TYPES.REPEAT_START, NAVIGATION_MARKER_TYPES.SEGNO],
    2: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    3: [NAVIGATION_MARKER_TYPES.DAL_SEGNO],
  });
  const result = resolvePlaybackSequence(measures);
  const skipOption = result.runState.pendingNavigationDecision.options.find(
    (option) => option.policy === NAVIGATION_REPEAT_POLICIES.SKIP,
  );
  let runState = advancePlaybackRun(result.runState, measures, {
    navigationDecisionOverride: {
      commandMeasureId: 'm3',
      repeatDecisions: skipOption.repeatDecisions,
    },
  });
  const steps = [...result.steps, runState.currentStep];

  while (!runState.ended) {
    const previousMeasureId = runState.currentStep.measureId;

    runState = advancePlaybackRun(runState, measures);
    if (!runState.ended && runState.currentStep.measureId !== previousMeasureId) {
      steps.push(runState.currentStep);
    }
  }

  assert.deepEqual(getMeasureNumbers(result.steps), [1, 2, 1, 2, 3]);
  assert.equal(result.runState.lastNavigationPlan.status, 'ambiguous');
  assert.deepEqual(getMeasureNumbers(steps), [1, 2, 1, 2, 3, 1, 2, 3]);
  assert.equal(runState.ended, true);
  assert.equal(runState.endReason, 'score-end');
  assert.deepEqual(runState.executedRepeatEndMeasureIds, ['m2']);
  assert.deepEqual(runState.executedDalSegnoMeasureIds, ['m3']);
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
