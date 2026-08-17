import {
  NAVIGATION_MARKER_TYPES,
  NAVIGATION_REPEAT_POLICIES,
} from './navigationMarkers.js';

export const NAVIGATION_PATH_PLAN_STATUS = Object.freeze({
  AMBIGUOUS: 'ambiguous',
  INVALID: 'invalid',
  RESOLVED: 'resolved',
});

export const NAVIGATION_PATH_PLAN_REASONS = Object.freeze({
  AMBIGUOUS_VALID_PATHS: 'ambiguous-valid-paths',
  EQUIVALENT_PATHS: 'equivalent-paths',
  MANUAL_OVERRIDE: 'manual-override',
  MISSING_CODA: 'missing-coda',
  MISSING_FINE: 'missing-fine',
  MISSING_SEGNO: 'missing-segno',
  MISSING_TO_CODA: 'missing-to-coda',
  NAVIGATION_LOOP: 'navigation-loop',
  RESOLVED_TARGET_REACHABILITY: 'resolved-target-reachability',
  TARGET_UNREACHABLE: 'target-unreachable',
});

function getSectionLastIndex(section) {
  return Math.max(
    section.endIndex,
    ...section.endings.map((ending) => ending.endIndex),
  );
}

export function getRelevantRepeatSections({
  commandMeasureIndex,
  navigationModel,
  segnoIndex,
}) {
  return navigationModel.repeatSections.filter(
    (section) =>
      section.startIndex < commandMeasureIndex &&
      getSectionLastIndex(section) >= segnoIndex,
  );
}

function createDecisionCandidate(repeatDecisions, fallbackPolicy = 'equivalent') {
  const decisions = Object.values(repeatDecisions);
  const uniqueDecisions = new Set(decisions);
  const policy =
    uniqueDecisions.size === 0
      ? fallbackPolicy
      : uniqueDecisions.size === 1
        ? decisions[0]
        : 'mixed';

  return {
    id: `${policy}:${Object.entries(repeatDecisions)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([sectionId, decision]) => `${sectionId}=${decision}`)
      .join('|')}`,
    policy,
    repeatDecisions: { ...repeatDecisions },
  };
}

function evaluateAutoCandidates({ repeatSections, simulateCandidate, target }) {
  const candidatePaths = [];
  const pendingDecisions = [{}];
  const visitedDecisionSets = new Set();
  const repeatSectionIds = repeatSections.map((section) => section.id);

  while (pendingDecisions.length > 0) {
    const repeatDecisions = pendingDecisions.shift();
    const decisionIdentity = JSON.stringify(
      Object.entries(repeatDecisions).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );

    if (visitedDecisionSets.has(decisionIdentity)) continue;
    visitedDecisionSets.add(decisionIdentity);

    const candidate = createDecisionCandidate(repeatDecisions);
    const result = simulateCandidate({
      repeatDecisions,
      repeatSectionIds,
      target,
    });

    if (
      result.result === 'decision-required' &&
      repeatSectionIds.includes(result.repeatSectionId) &&
      !Object.hasOwn(repeatDecisions, result.repeatSectionId)
    ) {
      pendingDecisions.push(
        {
          ...repeatDecisions,
          [result.repeatSectionId]: NAVIGATION_REPEAT_POLICIES.SKIP,
        },
        {
          ...repeatDecisions,
          [result.repeatSectionId]: NAVIGATION_REPEAT_POLICIES.REPLAY,
        },
      );
      continue;
    }

    candidatePaths.push({ ...candidate, ...result });
  }

  return candidatePaths;
}

function getTarget(jumpCommand, navigationModel) {
  if (
    navigationModel.segnoIndex < 0 ||
    navigationModel.segnoIndex >= jumpCommand.measureIndex
  ) {
    return { reason: NAVIGATION_PATH_PLAN_REASONS.MISSING_SEGNO };
  }

  if (jumpCommand.type === NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA) {
    const toCodaIndexes = navigationModel.toCodaIndexes.filter(
      (index) =>
        index >= navigationModel.segnoIndex &&
        index < jumpCommand.measureIndex,
    );

    if (toCodaIndexes.length === 0) {
      return { reason: NAVIGATION_PATH_PLAN_REASONS.MISSING_TO_CODA };
    }
    if (navigationModel.codaIndex < 0) {
      return { reason: NAVIGATION_PATH_PLAN_REASONS.MISSING_CODA };
    }

    return {
      codaIndex: navigationModel.codaIndex,
      kind: 'coda',
      segnoIndex: navigationModel.segnoIndex,
      toCodaIndexes,
    };
  }

  if (jumpCommand.type === NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE) {
    if (navigationModel.fineIndex < 0) {
      return { reason: NAVIGATION_PATH_PLAN_REASONS.MISSING_FINE };
    }

    return {
      fineIndex: navigationModel.fineIndex,
      kind: 'fine',
      segnoIndex: navigationModel.segnoIndex,
    };
  }

  return {
    kind: 'score-end',
    segnoIndex: navigationModel.segnoIndex,
  };
}

function getPathIdentity(candidate) {
  return candidate.path.join(',');
}

function getPreferredEquivalentCandidate(candidates) {
  return (
    candidates.find(
      (candidate) => candidate.policy === NAVIGATION_REPEAT_POLICIES.SKIP,
    ) || candidates[0]
  );
}

function createPlanResult({
  candidatePaths,
  jumpCommand,
  reason,
  repeatSections,
  selectedCandidate = null,
  status,
  target,
}) {
  return {
    candidatePaths,
    command: {
      measureId: jumpCommand.measureId,
      measureIndex: jumpCommand.measureIndex,
      repeatPolicy: jumpCommand.repeatPolicy,
      type: jumpCommand.type,
    },
    reason,
    repeatDecisions: selectedCandidate?.repeatDecisions || {},
    repeatSections: repeatSections.map((section) => ({
      endIndex: section.endIndex,
      id: section.id,
      maxPass: section.maxPass,
      startIndex: section.startIndex,
    })),
    selectedCandidateId: selectedCandidate?.id || '',
    selectedPolicy: selectedCandidate?.policy || '',
    status,
    target,
  };
}

export function planNavigationPath({
  jumpCommand,
  navigationModel,
  simulateCandidate,
}) {
  const target = getTarget(jumpCommand, navigationModel);
  const repeatSections = getRelevantRepeatSections({
    commandMeasureIndex: jumpCommand.measureIndex,
    navigationModel,
    segnoIndex: navigationModel.segnoIndex,
  });

  if (target.reason) {
    return createPlanResult({
      candidatePaths: [],
      jumpCommand,
      reason: target.reason,
      repeatSections,
      status: NAVIGATION_PATH_PLAN_STATUS.INVALID,
      target,
    });
  }

  const candidatePaths =
    jumpCommand.repeatPolicy === NAVIGATION_REPEAT_POLICIES.AUTO
      ? evaluateAutoCandidates({ repeatSections, simulateCandidate, target })
      : [
          createDecisionCandidate(
            Object.fromEntries(
              repeatSections.map((section) => [
                section.id,
                jumpCommand.repeatPolicy,
              ]),
            ),
            jumpCommand.repeatPolicy,
          ),
        ].map((candidate) => ({
          ...candidate,
          ...simulateCandidate({
            repeatDecisions: candidate.repeatDecisions,
            repeatSectionIds: repeatSections.map((section) => section.id),
            target,
          }),
        }));

  if (jumpCommand.repeatPolicy !== NAVIGATION_REPEAT_POLICIES.AUTO) {
    return createPlanResult({
      candidatePaths,
      jumpCommand,
      reason: NAVIGATION_PATH_PLAN_REASONS.MANUAL_OVERRIDE,
      repeatSections,
      selectedCandidate: candidatePaths[0],
      status: NAVIGATION_PATH_PLAN_STATUS.RESOLVED,
      target,
    });
  }

  const validCandidates = candidatePaths.filter(
    (candidate) => candidate.result === 'valid',
  );

  if (validCandidates.length === 0) {
    const reason = candidatePaths.some(
      (candidate) => candidate.result === NAVIGATION_PATH_PLAN_REASONS.NAVIGATION_LOOP,
    )
      ? NAVIGATION_PATH_PLAN_REASONS.NAVIGATION_LOOP
      : NAVIGATION_PATH_PLAN_REASONS.TARGET_UNREACHABLE;

    return createPlanResult({
      candidatePaths,
      jumpCommand,
      reason,
      repeatSections,
      status: NAVIGATION_PATH_PLAN_STATUS.INVALID,
      target,
    });
  }

  const candidatesByPath = new Map();

  validCandidates.forEach((candidate) => {
    const pathIdentity = getPathIdentity(candidate);
    const pathCandidates = candidatesByPath.get(pathIdentity) || [];

    pathCandidates.push(candidate);
    candidatesByPath.set(pathIdentity, pathCandidates);
  });

  if (candidatesByPath.size === 1) {
    const selectedCandidate = getPreferredEquivalentCandidate(validCandidates);

    return createPlanResult({
      candidatePaths,
      jumpCommand,
      reason:
        validCandidates.length > 1 ||
        Object.keys(selectedCandidate.repeatDecisions).length === 0
          ? NAVIGATION_PATH_PLAN_REASONS.EQUIVALENT_PATHS
          : NAVIGATION_PATH_PLAN_REASONS.RESOLVED_TARGET_REACHABILITY,
      repeatSections,
      selectedCandidate,
      status: NAVIGATION_PATH_PLAN_STATUS.RESOLVED,
      target,
    });
  }

  return createPlanResult({
    candidatePaths,
    jumpCommand,
    reason: NAVIGATION_PATH_PLAN_REASONS.AMBIGUOUS_VALID_PATHS,
    repeatSections,
    status: NAVIGATION_PATH_PLAN_STATUS.AMBIGUOUS,
    target,
  });
}
