import {
  getNavigationRepeatPolicy,
  hasNavigationMarker,
  NAVIGATION_MARKER_TYPES,
  NAVIGATION_REPEAT_POLICIES,
  normalizeNavigationMarkers,
} from './navigationMarkers.js';
import { buildNavigationModel } from './navigationModel.js';
import {
  NAVIGATION_PATH_PLAN_REASONS,
  NAVIGATION_PATH_PLAN_STATUS,
  planNavigationPath,
} from './navigationPathPlanner.js';

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
  navigationModel,
  repeatPassBySectionId,
  visitCounts,
  visitIndex,
}) {
  const measureId = measure?.id || `measure-index-${measureIndex}`;
  const visitCount = (visitCounts[measureId] || 0) + 1;
  const repeatSection = getRepeatSectionAtMeasure(
    navigationModel,
    measureIndex,
  );

  return {
    measureId,
    measureIndex,
    repeatPass: repeatSection
      ? repeatPassBySectionId[repeatSection.id] || 1
      : null,
    repeatSectionId: repeatSection?.id || null,
    visitCount,
    visitIndex,
    enteredBy,
  };
}

function getTransitionGuard(measures) {
  const jumpMarkerTypes = [
    NAVIGATION_MARKER_TYPES.REPEAT_END,
    NAVIGATION_MARKER_TYPES.DAL_SEGNO,
    NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
    NAVIGATION_MARKER_TYPES.TO_CODA,
    NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE,
  ];
  const jumpMarkerCount = measures.reduce(
    (count, measure) =>
      count +
      jumpMarkerTypes.filter((type) => hasNavigationMarker(measure, type)).length,
    0,
  );
  const repeatPassCount = buildNavigationModel(measures).repeatSections.reduce(
    (count, section) => count + section.maxPass,
    0,
  );

  // 각 jump는 한 cycle에 한 번만 실행되므로 최악의 경우에도 전체 악보를
  // jump marker 수만큼 다시 순회하면 종료되어야 한다.
  return Math.max(
    1,
    measures.length * (jumpMarkerCount + repeatPassCount + 2),
  );
}

function getRepeatSectionAtMeasure(navigationModel, measureIndex) {
  return navigationModel.repeatSections.find((section) => {
    const lastEndingIndex = Math.max(
      section.endIndex,
      ...section.endings.map((ending) => ending.endIndex),
    );

    return measureIndex >= section.startIndex && measureIndex <= lastEndingIndex;
  });
}

function getEndingAtMeasure(section, measureIndex) {
  return section?.endings.find(
    (ending) =>
      measureIndex >= ending.startIndex && measureIndex <= ending.endIndex,
  );
}

function createInitialRepeatPasses(navigationModel, startMeasureIndex) {
  return Object.fromEntries(
    navigationModel.repeatSections.map((section) => {
      const startingEnding = getEndingAtMeasure(section, startMeasureIndex);

      return [section.id, startingEnding?.passes[0] || 1];
    }),
  );
}

export function createPlaybackRunState(measures, startMeasureIndex = 0) {
  const safeMeasures = Array.isArray(measures) ? measures : [];
  const safeStartIndex = getSafeMeasureIndex(safeMeasures, startMeasureIndex);

  if (safeStartIndex < 0) {
    return {
      currentStep: null,
      codaArmed: false,
      cycleIndex: 0,
      ended: true,
      endReason: 'empty-score',
      executedCodaJumpMeasureIds: [],
      executedDalSegnoAlCodaMeasureIds: [],
      executedDalSegnoAlFineMeasureIds: [],
      executedDalSegnoMeasureIds: [],
      executedRepeatEndMeasureIds: [],
      fineArmed: false,
      lastNavigationPlan: null,
      pendingNavigationDecision: null,
      repeatPassBySectionId: {},
      resolvedRepeatDecisionsByCommandId: {},
      transitionCountInCycle: 0,
      visitCounts: {},
    };
  }

  const navigationModel = buildNavigationModel(safeMeasures);
  const repeatPassBySectionId = createInitialRepeatPasses(
    navigationModel,
    safeStartIndex,
  );

  const initialStep = createPlaybackStep({
    enteredBy: 'start',
    measure: safeMeasures[safeStartIndex],
    measureIndex: safeStartIndex,
    navigationModel,
    repeatPassBySectionId,
    visitCounts: {},
    visitIndex: 0,
  });

  return {
    codaArmed: false,
    currentStep: initialStep,
    cycleIndex: 0,
    ended: false,
    endReason: '',
    executedCodaJumpMeasureIds: [],
    executedDalSegnoAlCodaMeasureIds: [],
    executedDalSegnoAlFineMeasureIds: [],
    executedDalSegnoMeasureIds: [],
    executedRepeatEndMeasureIds: [],
    fineArmed: false,
    lastNavigationPlan: null,
    pendingNavigationDecision: null,
    repeatPassBySectionId,
    resolvedRepeatDecisionsByCommandId: {},
    transitionCountInCycle: 0,
    visitCounts: { [initialStep.measureId]: 1 },
  };
}

function enterMeasure(runState, measures, measureIndex, enteredBy, overrides = {}) {
  const repeatPassBySectionId =
    overrides.repeatPassBySectionId || runState.repeatPassBySectionId;
  const nextStep = createPlaybackStep({
    enteredBy,
    measure: measures[measureIndex],
    measureIndex,
    navigationModel: buildNavigationModel(measures),
    repeatPassBySectionId,
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
    repeatPassBySectionId,
    visitCounts: {
      ...runState.visitCounts,
      [nextStep.measureId]: nextStep.visitCount,
    },
  };
}

function getNavigationMarker(measure, type) {
  return measure?.navigationMarkers?.find((marker) => marker?.type === type) || {
    type,
  };
}

function logNavigationRuntimeMarkers(measures) {
  if (!import.meta.env?.DEV) return;

  const runtimeTypes = new Set([
    NAVIGATION_MARKER_TYPES.SEGNO,
    NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
    NAVIGATION_MARKER_TYPES.TO_CODA,
    NAVIGATION_MARKER_TYPES.CODA,
  ]);

  measures.forEach((measure, measureIndex) => {
    const navigationMarkers = normalizeNavigationMarkers(
      measure.navigationMarkers,
    ).filter((marker) => runtimeTypes.has(marker.type));

    if (navigationMarkers.length === 0) return;

    console.info(
      '[NavigationRuntimeMarker]',
      JSON.stringify({
        measureId: measure.id,
        measureIndex,
        navigationMarkers,
      }),
    );
  });
}

function logPlaybackTransition(details) {
  if (!import.meta.env?.DEV) return;

  console.info('[PlaybackTransition]', JSON.stringify(details));
}

function getTransitionDiagnosticBase({
  commandDetected,
  currentMeasure,
  currentMeasureIndex,
  navigationModel,
  repeatPolicy,
  runState,
}) {
  return {
    codaArmedBefore: runState.codaArmed,
    commandDetected,
    codaTargets: navigationModel.codaIndexes.map((index) => index + 1),
    fromMeasure: currentMeasureIndex + 1,
    markersAtCurrent: normalizeNavigationMarkers(
      currentMeasure.navigationMarkers,
    ).map((marker) => marker.type),
    repeatPolicy,
    segnoTargets: navigationModel.segnoIndexes.map((index) => index + 1),
    toCodaTargets: navigationModel.toCodaIndexes.map((index) => index + 1),
  };
}

function applyRepeatDecisions(runState, navigationModel, repeatDecisions) {
  const repeatPassBySectionId = { ...runState.repeatPassBySectionId };
  const executedRepeatEndMeasureIds = new Set(
    runState.executedRepeatEndMeasureIds,
  );

  navigationModel.repeatSections.forEach((section) => {
    const decision = repeatDecisions[section.id];

    if (decision === NAVIGATION_REPEAT_POLICIES.REPLAY) {
      repeatPassBySectionId[section.id] = 1;
      executedRepeatEndMeasureIds.delete(section.endMeasureId);
    } else if (decision === NAVIGATION_REPEAT_POLICIES.SKIP) {
      repeatPassBySectionId[section.id] = section.maxPass;
      executedRepeatEndMeasureIds.add(section.endMeasureId);
    }
  });

  return {
    executedRepeatEndMeasureIds: [...executedRepeatEndMeasureIds],
    repeatPassBySectionId,
  };
}

function enterDalSegnoTarget({
  commandMeasure,
  enteredBy,
  executedCommandField,
  measures,
  navigationModel,
  repeatDecisions,
  runState,
  stateOverrides,
}) {
  const commandMeasureId = commandMeasure.id;
  const repeatState = applyRepeatDecisions(
    runState,
    navigationModel,
    repeatDecisions,
  );
  const executedCommandMeasureIds = runState[executedCommandField];

  return enterMeasure(
    runState,
    measures,
    navigationModel.segnoIndex,
    enteredBy,
    {
      ...repeatState,
      ...stateOverrides,
      [executedCommandField]: executedCommandMeasureIds.includes(commandMeasureId)
        ? executedCommandMeasureIds
        : [...executedCommandMeasureIds, commandMeasureId],
      pendingNavigationDecision: null,
      resolvedRepeatDecisionsByCommandId: {
        ...runState.resolvedRepeatDecisionsByCommandId,
        [commandMeasureId]: { ...repeatDecisions },
      },
    },
  );
}

function getSimulationStateIdentity(runState) {
  const sorted = (values) => [...values].sort();
  const sortedObject = (value) =>
    Object.fromEntries(Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    ));

  return JSON.stringify({
    codaArmed: runState.codaArmed,
    currentMeasureId: runState.currentStep?.measureId || '',
    ended: runState.ended,
    endReason: runState.endReason,
    executedCodaJumpMeasureIds: sorted(runState.executedCodaJumpMeasureIds),
    executedDalSegnoAlCodaMeasureIds: sorted(
      runState.executedDalSegnoAlCodaMeasureIds,
    ),
    executedDalSegnoAlFineMeasureIds: sorted(
      runState.executedDalSegnoAlFineMeasureIds,
    ),
    executedDalSegnoMeasureIds: sorted(runState.executedDalSegnoMeasureIds),
    executedRepeatEndMeasureIds: sorted(runState.executedRepeatEndMeasureIds),
    fineArmed: runState.fineArmed,
    repeatPassBySectionId: sortedObject(runState.repeatPassBySectionId),
  });
}

function hasReachedNavigationTarget(runState, target) {
  if (target.kind === 'coda') {
    return (
      runState.currentStep?.measureIndex === target.codaIndex &&
      runState.currentStep?.enteredBy === 'to-coda'
    );
  }

  if (target.kind === 'fine') {
    return runState.ended && runState.endReason === 'fine';
  }

  return runState.ended && runState.endReason === 'score-end';
}

function simulateDalSegnoCandidate({
  commandMeasure,
  enteredBy,
  executedCommandField,
  measures,
  navigationModel,
  repeatDecisions,
  repeatSectionIds,
  runState,
  stateOverrides,
  target,
}) {
  let simulationState = enterDalSegnoTarget({
    commandMeasure,
    enteredBy,
    executedCommandField,
    measures,
    navigationModel,
    repeatDecisions,
    runState,
    stateOverrides,
  });
  const path = [simulationState.currentStep.measureIndex + 1];
  const visitedStates = new Set();

  while (true) {
    if (hasReachedNavigationTarget(simulationState, target)) {
      return { path, result: 'valid' };
    }
    const currentRepeatSection = getRepeatSectionAtMeasure(
      navigationModel,
      simulationState.currentStep?.measureIndex,
    );

    if (
      currentRepeatSection &&
      repeatSectionIds.includes(currentRepeatSection.id) &&
      !Object.hasOwn(repeatDecisions, currentRepeatSection.id)
    ) {
      return {
        path,
        repeatSectionId: currentRepeatSection.id,
        result: 'decision-required',
      };
    }
    if (
      target.kind !== 'score-end' &&
      simulationState.currentStep?.measureId === commandMeasure.id
    ) {
      return {
        path,
        result: NAVIGATION_PATH_PLAN_REASONS.TARGET_UNREACHABLE,
      };
    }
    if (simulationState.ended) {
      return {
        path,
        result: NAVIGATION_PATH_PLAN_REASONS.TARGET_UNREACHABLE,
      };
    }

    const stateIdentity = getSimulationStateIdentity(simulationState);

    if (visitedStates.has(stateIdentity)) {
      return { path, result: NAVIGATION_PATH_PLAN_REASONS.NAVIGATION_LOOP };
    }

    visitedStates.add(stateIdentity);
    const previousMeasureId = simulationState.currentStep?.measureId;

    simulationState = advancePlaybackRun(simulationState, measures, {
      disablePathPlanning: true,
      ignoreTransitionGuard: true,
      suppressDiagnostics: true,
    });

    if (
      simulationState.currentStep &&
      simulationState.currentStep.measureId !== previousMeasureId
    ) {
      path.push(simulationState.currentStep.measureIndex + 1);
    }
  }
}

function createPendingNavigationDecision(plan, wasAutoPlaying = false) {
  const candidatesByPath = new Map();

  plan.candidatePaths
    .filter((candidate) => candidate.result === 'valid')
    .forEach((candidate) => {
      const pathIdentity = candidate.path.join(',');

      if (!candidatesByPath.has(pathIdentity)) {
        candidatesByPath.set(pathIdentity, candidate);
      }
    });

  return {
    command: plan.command,
    options: [...candidatesByPath.values()].map((candidate, index) => ({
      id: candidate.id,
      label:
        candidate.policy === NAVIGATION_REPEAT_POLICIES.REPLAY
          ? '다시 연주'
          : candidate.policy === NAVIGATION_REPEAT_POLICIES.SKIP
            ? '건너뛰기'
            : `구간별 경로 ${index + 1}`,
      path: candidate.path,
      policy: candidate.policy,
      repeatDecisions: candidate.repeatDecisions,
    })),
    reason: plan.reason,
    wasAutoPlaying,
  };
}

function logNavigationPlan(plan) {
  if (!import.meta.env?.DEV) return;

  console.info('[NavigationPathPlanner]', {
    candidatePaths: plan.candidatePaths.map((candidate) => ({
      path: candidate.path,
      policy: candidate.policy,
      repeatDecisions: candidate.repeatDecisions,
      result: candidate.result,
    })),
    command: plan.command,
    reason: plan.reason,
    repeatDecisions: plan.repeatDecisions,
    selectedPolicy: plan.selectedPolicy,
    status: plan.status,
    target: plan.target,
  });
}

function getNextPlayableMeasureIndex(navigationModel, runState, startIndex) {
  let nextIndex = startIndex;

  while (nextIndex >= 0) {
    const section = getRepeatSectionAtMeasure(navigationModel, nextIndex);
    const ending = getEndingAtMeasure(section, nextIndex);

    if (!ending) return nextIndex;

    const repeatPass = runState.repeatPassBySectionId[section.id] || 1;

    if (ending.passes.includes(repeatPass)) return nextIndex;

    nextIndex = ending.endIndex + 1;
  }

  return nextIndex;
}

function advancePhysicalPlayback(
  runState,
  measures,
  navigationModel,
  currentMeasureIndex,
  loopAtEnd,
) {
  const nextMeasureIndex = getNextPlayableMeasureIndex(
    navigationModel,
    runState,
    currentMeasureIndex + 1,
  );

  if (nextMeasureIndex < measures.length) {
    return enterMeasure(runState, measures, nextMeasureIndex, 'next');
  }

  if (loopAtEnd) {
    const loopedState = createPlaybackRunState(measures, 0);

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

function resolveDalSegnoJump({
  commandMeasure,
  commandMeasureIndex,
  commandType,
  disablePathPlanning,
  enteredBy,
  executedCommandField,
  loopAtEnd,
  measures,
  navigationDecisionOverride,
  navigationModel,
  runState,
  suppressDiagnostics,
  stateOverrides,
  wasAutoPlaying,
}) {
  if (!suppressDiagnostics) {
    logNavigationRuntimeMarkers(measures);
  }

  if (
    navigationDecisionOverride?.commandMeasureId === commandMeasure.id &&
    navigationDecisionOverride.repeatDecisions
  ) {
    return enterDalSegnoTarget({
      commandMeasure,
      enteredBy,
      executedCommandField,
      measures,
      navigationModel,
      repeatDecisions: navigationDecisionOverride.repeatDecisions,
      runState,
      stateOverrides,
    });
  }

  if (disablePathPlanning) {
    return enterDalSegnoTarget({
      commandMeasure,
      enteredBy,
      executedCommandField,
      measures,
      navigationModel,
      repeatDecisions: {},
      runState,
      stateOverrides,
    });
  }

  const marker = getNavigationMarker(commandMeasure, commandType);
  const jumpCommand = {
    measureId: commandMeasure.id,
    measureIndex: commandMeasureIndex,
    repeatPolicy: getNavigationRepeatPolicy(marker),
    type: commandType,
  };
  const plan = planNavigationPath({
    jumpCommand,
    navigationModel,
    simulateCandidate: ({ repeatDecisions, repeatSectionIds, target }) =>
      simulateDalSegnoCandidate({
        commandMeasure,
        enteredBy,
        executedCommandField,
        measures,
        navigationModel,
        repeatDecisions,
        repeatSectionIds,
        runState,
        suppressDiagnostics: true,
        stateOverrides,
        target,
      }),
  });

  if (!suppressDiagnostics) {
    logNavigationPlan(plan);
  }
  const diagnosticBase = getTransitionDiagnosticBase({
    commandDetected: commandType,
    currentMeasure: commandMeasure,
    currentMeasureIndex: commandMeasureIndex,
    navigationModel,
    repeatPolicy: jumpCommand.repeatPolicy,
    runState,
  });

  if (plan.status === NAVIGATION_PATH_PLAN_STATUS.RESOLVED) {
    const nextRunState = enterDalSegnoTarget({
      commandMeasure,
      enteredBy,
      executedCommandField,
      measures,
      navigationModel,
      repeatDecisions: plan.repeatDecisions,
      runState,
      stateOverrides: {
        ...stateOverrides,
        lastNavigationPlan: plan,
      },
    });

    if (!suppressDiagnostics) {
      logPlaybackTransition({
        ...diagnosticBase,
        codaArmedAfter: nextRunState.codaArmed,
        decision: `${commandType}-jump`,
        plannerDecision: plan.repeatDecisions,
        plannerStatus: plan.status,
        toMeasure: nextRunState.currentStep.measureIndex + 1,
      });
    }
    return nextRunState;
  }

  if (plan.status === NAVIGATION_PATH_PLAN_STATUS.AMBIGUOUS) {
    if (!suppressDiagnostics) {
      logPlaybackTransition({
        ...diagnosticBase,
        codaArmedAfter: runState.codaArmed,
        decision: 'await-teacher',
        plannerDecision: null,
        plannerStatus: plan.status,
        toMeasure: commandMeasureIndex + 1,
      });
    }
    return {
      ...runState,
      lastNavigationPlan: plan,
      pendingNavigationDecision: createPendingNavigationDecision(
        plan,
        wasAutoPlaying,
      ),
    };
  }

  const nextRunState = advancePhysicalPlayback(
    {
      ...runState,
      lastNavigationPlan: plan,
      pendingNavigationDecision: null,
    },
    measures,
    navigationModel,
    commandMeasureIndex,
    loopAtEnd,
  );

  if (!suppressDiagnostics) {
    logPlaybackTransition({
      ...diagnosticBase,
      codaArmedAfter: nextRunState.codaArmed,
      decision: 'physical-next-fallback',
      plannerDecision: null,
      plannerStatus: plan.status,
      toMeasure: nextRunState.currentStep?.measureIndex + 1 || null,
    });
  }
  return nextRunState;
}

export function advancePlaybackRun(
  runState,
  measures,
  {
    disablePathPlanning = false,
    ignoreTransitionGuard = false,
    loopAtEnd = false,
    navigationDecisionOverride = null,
    suppressDiagnostics = false,
    wasAutoPlaying = false,
  } = {},
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

  if (
    runState.pendingNavigationDecision &&
    !navigationDecisionOverride
  ) {
    return runState;
  }

  if (
    !ignoreTransitionGuard &&
    runState.transitionCountInCycle >= getTransitionGuard(safeMeasures)
  ) {
    return { ...runState, ended: true, endReason: 'navigation-guard' };
  }

  const currentMeasure = safeMeasures[currentMeasureIndex];
  const navigationModel = buildNavigationModel(safeMeasures);
  const currentRepeatSection = getRepeatSectionAtMeasure(
    navigationModel,
    currentMeasureIndex,
  );
  const currentEnding = getEndingAtMeasure(
    currentRepeatSection,
    currentMeasureIndex,
  );
  const currentRepeatPass = currentRepeatSection
    ? runState.repeatPassBySectionId[currentRepeatSection.id] || 1
    : 1;
  const hasRepeatEnd = hasNavigationMarker(
    currentMeasure,
    NAVIGATION_MARKER_TYPES.REPEAT_END,
  );
  const hasDalSegno = hasNavigationMarker(
    currentMeasure,
    NAVIGATION_MARKER_TYPES.DAL_SEGNO,
  );
  const hasDalSegnoAlCoda = hasNavigationMarker(
    currentMeasure,
    NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
  );
  const hasToCoda = hasNavigationMarker(
    currentMeasure,
    NAVIGATION_MARKER_TYPES.TO_CODA,
  );
  const hasDalSegnoAlFine = hasNavigationMarker(
    currentMeasure,
    NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE,
  );
  const hasFine = hasNavigationMarker(
    currentMeasure,
    NAVIGATION_MARKER_TYPES.FINE,
  );
  const jumpActionCount = [
    hasRepeatEnd,
    hasDalSegno,
    hasDalSegnoAlCoda,
    hasToCoda,
    hasDalSegnoAlFine,
  ].filter(Boolean).length;
  const isRepeatEndToCodaPair =
    jumpActionCount === 2 && hasRepeatEnd && hasToCoda;
  const hasAmbiguousJumpActions =
    jumpActionCount > 1 && !isRepeatEndToCodaPair;

  if (hasFine && runState.fineArmed) {
    return {
      ...runState,
      ended: true,
      endReason: 'fine',
      fineArmed: false,
    };
  }

  if (
    hasToCoda &&
    !hasAmbiguousJumpActions &&
    runState.codaArmed &&
    !runState.executedCodaJumpMeasureIds.includes(currentMeasure.id) &&
    navigationModel.codaIndex >= 0 &&
    navigationModel.codaIndex !== currentMeasureIndex
  ) {
    const nextRunState = enterMeasure(
      runState,
      safeMeasures,
      navigationModel.codaIndex,
      'to-coda',
      {
        codaArmed: false,
        executedCodaJumpMeasureIds: [
          ...runState.executedCodaJumpMeasureIds,
          currentMeasure.id,
        ],
      },
    );

    if (!disablePathPlanning && !suppressDiagnostics) {
      logPlaybackTransition({
        ...getTransitionDiagnosticBase({
          commandDetected: NAVIGATION_MARKER_TYPES.TO_CODA,
          currentMeasure,
          currentMeasureIndex,
          navigationModel,
          repeatPolicy: null,
          runState,
        }),
        codaArmedAfter: nextRunState.codaArmed,
        decision: 'to-coda-jump',
        plannerDecision: null,
        plannerStatus: 'runtime',
        toMeasure: nextRunState.currentStep.measureIndex + 1,
      });
    }
    return nextRunState;
  }

  if (
    currentRepeatSection?.endings.length > 0 &&
    currentEnding?.endIndex === currentMeasureIndex &&
    currentEnding.passes.includes(currentRepeatPass) &&
    currentRepeatPass < currentRepeatSection.maxPass
  ) {
    return enterMeasure(
      runState,
      safeMeasures,
      currentRepeatSection.startIndex,
      'repeat',
      {
        executedRepeatEndMeasureIds: runState.executedRepeatEndMeasureIds.includes(
          currentRepeatSection.endMeasureId,
        )
          ? runState.executedRepeatEndMeasureIds
          : [
              ...runState.executedRepeatEndMeasureIds,
              currentRepeatSection.endMeasureId,
            ],
        repeatPassBySectionId: {
          ...runState.repeatPassBySectionId,
          [currentRepeatSection.id]: currentRepeatPass + 1,
        },
      },
    );
  }

  if (
    hasRepeatEnd &&
    currentRepeatSection?.endings.length === 0 &&
    !hasAmbiguousJumpActions &&
    !runState.executedRepeatEndMeasureIds.includes(currentMeasure.id)
  ) {
    const repeatStartIndex = navigationModel.repeatPairsByEndId.get(
      currentMeasure.id,
    );

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
    hasDalSegnoAlCoda &&
    !hasAmbiguousJumpActions &&
    !runState.executedDalSegnoAlCodaMeasureIds.includes(currentMeasure.id)
  ) {
    return resolveDalSegnoJump({
      commandMeasure: currentMeasure,
      commandMeasureIndex: currentMeasureIndex,
      commandType: NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
      disablePathPlanning,
      enteredBy: 'dal-segno-al-coda',
      executedCommandField: 'executedDalSegnoAlCodaMeasureIds',
      loopAtEnd,
      measures: safeMeasures,
      navigationDecisionOverride,
      navigationModel,
      runState,
      suppressDiagnostics,
      stateOverrides: { codaArmed: true },
      wasAutoPlaying,
    });
  }

  if (
    hasDalSegnoAlFine &&
    !hasAmbiguousJumpActions &&
    !runState.executedDalSegnoAlFineMeasureIds.includes(currentMeasure.id)
  ) {
    return resolveDalSegnoJump({
      commandMeasure: currentMeasure,
      commandMeasureIndex: currentMeasureIndex,
      commandType: NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE,
      disablePathPlanning,
      enteredBy: 'dal-segno-al-fine',
      executedCommandField: 'executedDalSegnoAlFineMeasureIds',
      loopAtEnd,
      measures: safeMeasures,
      navigationDecisionOverride,
      navigationModel,
      runState,
      suppressDiagnostics,
      stateOverrides: { fineArmed: true },
      wasAutoPlaying,
    });
  }

  if (
    hasDalSegno &&
    !hasAmbiguousJumpActions &&
    !runState.executedDalSegnoMeasureIds.includes(currentMeasure.id)
  ) {
    return resolveDalSegnoJump({
      commandMeasure: currentMeasure,
      commandMeasureIndex: currentMeasureIndex,
      commandType: NAVIGATION_MARKER_TYPES.DAL_SEGNO,
      disablePathPlanning,
      enteredBy: 'dal-segno',
      executedCommandField: 'executedDalSegnoMeasureIds',
      loopAtEnd,
      measures: safeMeasures,
      navigationDecisionOverride,
      navigationModel,
      runState,
      suppressDiagnostics,
      stateOverrides: {},
      wasAutoPlaying,
    });
  }

  return advancePhysicalPlayback(
    runState,
    safeMeasures,
    navigationModel,
    currentMeasureIndex,
    loopAtEnd,
  );
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

  if (nextRunState.pendingNavigationDecision) {
    return {
      blocked: true,
      didMove: false,
      progression: {
        ...progression,
        runState: nextRunState,
      },
    };
  }

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

export function getNavigationPathPlansForValidation(measures) {
  const safeMeasures = Array.isArray(measures) ? measures : [];
  const plans = [];
  const seenCommandMeasureIds = new Set();
  let runState = createPlaybackRunState(safeMeasures);
  const guard = getTransitionGuard(safeMeasures) + 1;
  let transitionCount = 0;

  while (
    runState.currentStep &&
    !runState.ended &&
    !runState.pendingNavigationDecision &&
    transitionCount <= guard
  ) {
    runState = advancePlaybackRun(runState, safeMeasures, {
      suppressDiagnostics: true,
    });
    const plan = runState.lastNavigationPlan;

    if (plan && !seenCommandMeasureIds.has(plan.command.measureId)) {
      plans.push(plan);
      seenCommandMeasureIds.add(plan.command.measureId);
    }

    transitionCount += 1;
  }

  return plans;
}

export function resolvePlaybackSequence(measures, { startMeasureIndex = 0 } = {}) {
  const safeMeasures = Array.isArray(measures) ? measures : [];
  let runState = createPlaybackRunState(safeMeasures, startMeasureIndex);
  const steps = runState.currentStep ? [runState.currentStep] : [];
  const guard = getTransitionGuard(safeMeasures) + 1;

  while (!runState.ended && steps.length <= guard) {
    runState = advancePlaybackRun(runState, safeMeasures);
    if (runState.pendingNavigationDecision) break;
    if (!runState.ended && runState.currentStep) steps.push(runState.currentStep);
  }

  if (!runState.ended && !runState.pendingNavigationDecision) {
    runState = { ...runState, ended: true, endReason: 'sequence-guard' };
  }

  return { runState, steps };
}
