import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NAVIGATION_MARKER_TYPES,
  NAVIGATION_REPEAT_POLICIES,
} from '../src/utils/navigationMarkers.js';
import {
  NAVIGATION_PATH_PLAN_REASONS,
  NAVIGATION_PATH_PLAN_STATUS,
  planNavigationPath,
} from '../src/utils/navigationPathPlanner.js';

function createNavigationModel(repeatSections = []) {
  return {
    codaIndex: 10,
    fineIndex: 5,
    repeatSections,
    segnoIndex: 1,
    toCodaIndexes: [4],
  };
}

function createJumpCommand(type = NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA) {
  return {
    measureId: 'm9',
    measureIndex: 8,
    repeatPolicy: NAVIGATION_REPEAT_POLICIES.AUTO,
    type,
  };
}

function createRepeatSection(id, startIndex, endIndex) {
  return {
    endIndex,
    endings: [],
    id,
    maxPass: 3,
    startIndex,
  };
}

function getRequiredDecision(repeatDecisions, repeatSectionIds) {
  const repeatSectionId = repeatSectionIds.find(
    (sectionId) => !Object.hasOwn(repeatDecisions, sectionId),
  );

  return repeatSectionId
    ? { repeatSectionId, result: 'decision-required' }
    : null;
}

test('AUTO는 목표에 도달하는 section별 replay/skip 조합을 선택한다', () => {
  const navigationModel = createNavigationModel([
    createRepeatSection('repeat-a', 2, 3),
    createRepeatSection('repeat-b', 5, 6),
  ]);
  const plan = planNavigationPath({
    jumpCommand: createJumpCommand(),
    navigationModel,
    simulateCandidate: ({ repeatDecisions, repeatSectionIds }) => {
      const required = getRequiredDecision(repeatDecisions, repeatSectionIds);

      if (required) return { path: [2], ...required };

      return repeatDecisions['repeat-a'] === NAVIGATION_REPEAT_POLICIES.REPLAY &&
        repeatDecisions['repeat-b'] === NAVIGATION_REPEAT_POLICIES.SKIP
        ? { path: [2, 3, 4, 5, 11], result: 'valid' }
        : { path: [2, 3, 7, 8, 9], result: 'target-unreachable' };
    },
  });

  assert.equal(plan.status, NAVIGATION_PATH_PLAN_STATUS.RESOLVED);
  assert.deepEqual(plan.repeatDecisions, {
    'repeat-a': NAVIGATION_REPEAT_POLICIES.REPLAY,
    'repeat-b': NAVIGATION_REPEAT_POLICIES.SKIP,
  });
});

test('동일한 유효 경로는 equivalent이고 서로 다른 경로는 ambiguous다', () => {
  const navigationModel = createNavigationModel([
    createRepeatSection('repeat-a', 2, 3),
  ]);
  const equivalent = planNavigationPath({
    jumpCommand: createJumpCommand(),
    navigationModel,
    simulateCandidate: ({ repeatDecisions, repeatSectionIds }) => {
      const required = getRequiredDecision(repeatDecisions, repeatSectionIds);

      return required
        ? { path: [2], ...required }
        : { path: [2, 3, 4, 5, 11], result: 'valid' };
    },
  });
  const ambiguous = planNavigationPath({
    jumpCommand: createJumpCommand(),
    navigationModel,
    simulateCandidate: ({ repeatDecisions, repeatSectionIds }) => {
      const required = getRequiredDecision(repeatDecisions, repeatSectionIds);

      return required
        ? { path: [2], ...required }
        : {
            path:
              repeatDecisions['repeat-a'] === NAVIGATION_REPEAT_POLICIES.REPLAY
                ? [2, 3, 4, 3, 4, 5, 11]
                : [2, 3, 4, 5, 11],
            result: 'valid',
          };
    },
  });

  assert.equal(equivalent.status, NAVIGATION_PATH_PLAN_STATUS.RESOLVED);
  assert.equal(equivalent.reason, NAVIGATION_PATH_PLAN_REASONS.EQUIVALENT_PATHS);
  assert.equal(ambiguous.status, NAVIGATION_PATH_PLAN_STATUS.AMBIGUOUS);
  assert.equal(
    ambiguous.reason,
    NAVIGATION_PATH_PLAN_REASONS.AMBIGUOUS_VALID_PATHS,
  );
});

test('목표에 도달하는 후보가 없으면 invalid로 판정한다', () => {
  const plan = planNavigationPath({
    jumpCommand: createJumpCommand(),
    navigationModel: createNavigationModel([
      createRepeatSection('repeat-a', 2, 3),
    ]),
    simulateCandidate: ({ repeatDecisions, repeatSectionIds }) => {
      const required = getRequiredDecision(repeatDecisions, repeatSectionIds);

      return required
        ? { path: [2], ...required }
        : {
            path: [2, 3, 7, 8, 9],
            result: 'target-unreachable',
          };
    },
  });

  assert.equal(plan.status, NAVIGATION_PATH_PLAN_STATUS.INVALID);
  assert.equal(plan.reason, NAVIGATION_PATH_PLAN_REASONS.TARGET_UNREACHABLE);
});
