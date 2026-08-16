import {
  analyzeNavigationMarkers,
  hasNavigationMarker,
  NAVIGATION_MARKER_TYPES,
} from './navigationMarkers.js';

function getSafeMeasureIndex(measures, measureIndex) {
  if (!Array.isArray(measures) || measures.length === 0) return -1;

  return Number.isInteger(measureIndex) && measureIndex >= 0
    ? Math.min(measureIndex, measures.length - 1)
    : 0;
}

function createPlaybackStep({
  enteredBy,
  measure,
  measureIndex,
  visitCounts,
  visitIndex,
}) {
  const measureId = measure?.id || `measure-index-${measureIndex}`;
  const visitCount = (visitCounts[measureId] || 0) + 1;

  return {
    measureId,
    measureIndex,
    visitCount,
    visitIndex,
    enteredBy,
  };
}

function getTransitionGuard(measures) {
  const jumpMarkerCount = measures.reduce(
    (count, measure) =>
      count +
      Number(hasNavigationMarker(measure, NAVIGATION_MARKER_TYPES.REPEAT_END)) +
      Number(hasNavigationMarker(measure, NAVIGATION_MARKER_TYPES.DAL_SEGNO)),
    0,
  );

  // 각 jump는 한 cycle에 한 번만 실행되므로 최악의 경우에도 전체 악보를
  // jump marker 수만큼 다시 순회하면 종료되어야 한다.
  return Math.max(1, measures.length * (jumpMarkerCount + 2));
}

export function createPlaybackRunState(measures, startMeasureIndex = 0) {
  const safeMeasures = Array.isArray(measures) ? measures : [];
  const safeStartIndex = getSafeMeasureIndex(safeMeasures, startMeasureIndex);

  if (safeStartIndex < 0) {
    return {
      currentStep: null,
      cycleIndex: 0,
      ended: true,
      endReason: 'empty-score',
      executedDalSegnoMeasureIds: [],
      executedRepeatEndMeasureIds: [],
      transitionCountInCycle: 0,
      visitCounts: {},
    };
  }

  const initialStep = createPlaybackStep({
    enteredBy: 'start',
    measure: safeMeasures[safeStartIndex],
    measureIndex: safeStartIndex,
    visitCounts: {},
    visitIndex: 0,
  });

  return {
    currentStep: initialStep,
    cycleIndex: 0,
    ended: false,
    endReason: '',
    executedDalSegnoMeasureIds: [],
    executedRepeatEndMeasureIds: [],
    transitionCountInCycle: 0,
    visitCounts: { [initialStep.measureId]: 1 },
  };
}

function enterMeasure(runState, measures, measureIndex, enteredBy, overrides = {}) {
  const nextStep = createPlaybackStep({
    enteredBy,
    measure: measures[measureIndex],
    measureIndex,
    visitCounts: runState.visitCounts,
    visitIndex: runState.currentStep.visitIndex + 1,
  });

  return {
    ...runState,
    ...overrides,
    currentStep: nextStep,
    ended: false,
    endReason: '',
    transitionCountInCycle:
      overrides.transitionCountInCycle ?? runState.transitionCountInCycle + 1,
    visitCounts: {
      ...runState.visitCounts,
      [nextStep.measureId]: nextStep.visitCount,
    },
  };
}

export function advancePlaybackRun(
  runState,
  measures,
  { loopAtEnd = false } = {},
) {
  const safeMeasures = Array.isArray(measures) ? measures : [];

  if (!runState?.currentStep || runState.ended || safeMeasures.length === 0) {
    return {
      ...(runState || createPlaybackRunState(safeMeasures)),
      ended: true,
      endReason: runState?.endReason || 'invalid-run',
    };
  }

  const currentMeasureIndex = safeMeasures.findIndex(
    (measure) => measure.id === runState.currentStep.measureId,
  );

  if (currentMeasureIndex < 0) {
    return { ...runState, ended: true, endReason: 'measure-missing' };
  }

  if (runState.transitionCountInCycle >= getTransitionGuard(safeMeasures)) {
    return { ...runState, ended: true, endReason: 'navigation-guard' };
  }

  const currentMeasure = safeMeasures[currentMeasureIndex];
  const analysis = analyzeNavigationMarkers(safeMeasures);
  const hasRepeatEnd = hasNavigationMarker(
    currentMeasure,
    NAVIGATION_MARKER_TYPES.REPEAT_END,
  );
  const hasDalSegno = hasNavigationMarker(
    currentMeasure,
    NAVIGATION_MARKER_TYPES.DAL_SEGNO,
  );
  const hasAmbiguousJumpActions = hasRepeatEnd && hasDalSegno;

  if (
    hasRepeatEnd &&
    !hasAmbiguousJumpActions &&
    !runState.executedRepeatEndMeasureIds.includes(currentMeasure.id)
  ) {
    const repeatStartIndex = analysis.repeatPairsByEndId.get(currentMeasure.id);

    if (Number.isInteger(repeatStartIndex) && repeatStartIndex < currentMeasureIndex) {
      return enterMeasure(runState, safeMeasures, repeatStartIndex, 'repeat', {
        executedRepeatEndMeasureIds: [
          ...runState.executedRepeatEndMeasureIds,
          currentMeasure.id,
        ],
      });
    }
  }

  if (
    hasDalSegno &&
    !hasAmbiguousJumpActions &&
    !runState.executedDalSegnoMeasureIds.includes(currentMeasure.id) &&
    analysis.segnoIndex >= 0 &&
    analysis.segnoIndex < currentMeasureIndex
  ) {
    return enterMeasure(runState, safeMeasures, analysis.segnoIndex, 'dal-segno', {
      executedDalSegnoMeasureIds: [
        ...runState.executedDalSegnoMeasureIds,
        currentMeasure.id,
      ],
    });
  }

  const nextMeasureIndex = currentMeasureIndex + 1;

  if (nextMeasureIndex < safeMeasures.length) {
    return enterMeasure(runState, safeMeasures, nextMeasureIndex, 'next');
  }

  if (loopAtEnd) {
    const loopedState = createPlaybackRunState(safeMeasures, 0);

    return {
      ...loopedState,
      currentStep: {
        ...loopedState.currentStep,
        enteredBy: 'loop',
      },
      cycleIndex: runState.cycleIndex + 1,
    };
  }

  return { ...runState, ended: true, endReason: 'score-end' };
}

export function createPlaybackProgression(measures, startMeasureIndex = 0) {
  const runState = createPlaybackRunState(measures, startMeasureIndex);
  const history = runState.currentStep ? [runState] : [];

  return {
    history,
    historyIndex: history.length - 1,
    runState,
  };
}

export function isPlaybackProgressionAtMeasure(progression, measure) {
  return Boolean(
    progression?.runState?.currentStep &&
      measure &&
      progression.runState.currentStep.measureId === measure.id,
  );
}

export function advancePlaybackProgression(
  progression,
  measures,
  options = {},
) {
  if (!progression?.runState) {
    return {
      didMove: false,
      progression: createPlaybackProgression(measures),
    };
  }

  const nextHistoryIndex = progression.historyIndex + 1;

  if (nextHistoryIndex < progression.history.length) {
    const nextRunState = progression.history[nextHistoryIndex];

    return {
      didMove: true,
      progression: {
        ...progression,
        historyIndex: nextHistoryIndex,
        runState: nextRunState,
      },
    };
  }

  const nextRunState = advancePlaybackRun(
    progression.runState,
    measures,
    options,
  );

  if (nextRunState.ended || !nextRunState.currentStep) {
    return {
      didMove: false,
      progression: {
        ...progression,
        runState: nextRunState,
      },
    };
  }

  const nextHistory = [
    ...progression.history.slice(0, progression.historyIndex + 1),
    nextRunState,
  ];

  return {
    didMove: true,
    progression: {
      history: nextHistory,
      historyIndex: nextHistory.length - 1,
      runState: nextRunState,
    },
  };
}

export function rewindPlaybackProgression(progression) {
  if (!progression?.runState || progression.historyIndex <= 0) {
    return { didMove: false, progression };
  }

  const previousHistoryIndex = progression.historyIndex - 1;
  const previousRunState = progression.history[previousHistoryIndex];

  return {
    didMove: true,
    progression: {
      ...progression,
      historyIndex: previousHistoryIndex,
      runState: previousRunState,
    },
  };
}

export function resolvePlaybackSequence(measures, { startMeasureIndex = 0 } = {}) {
  const safeMeasures = Array.isArray(measures) ? measures : [];
  let runState = createPlaybackRunState(safeMeasures, startMeasureIndex);
  const steps = runState.currentStep ? [runState.currentStep] : [];
  const guard = getTransitionGuard(safeMeasures) + 1;

  while (!runState.ended && steps.length <= guard) {
    runState = advancePlaybackRun(runState, safeMeasures);
    if (!runState.ended && runState.currentStep) steps.push(runState.currentStep);
  }

  if (!runState.ended) {
    runState = { ...runState, ended: true, endReason: 'sequence-guard' };
  }

  return { runState, steps };
}
