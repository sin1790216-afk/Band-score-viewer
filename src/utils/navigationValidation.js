import {
  NAVIGATION_COMMAND_MARKER_TYPES,
  NAVIGATION_MARKER_TYPES,
  normalizeNavigationMarkers,
} from './navigationMarkers.js';
import { buildNavigationModel } from './navigationModel.js';
import {
  NAVIGATION_PATH_PLAN_REASONS,
  NAVIGATION_PATH_PLAN_STATUS,
} from './navigationPathPlanner.js';
import { getNavigationPathPlansForValidation } from './playbackResolver.js';

export const NAVIGATION_ISSUE_SEVERITIES = Object.freeze({
  ERROR: 'error',
  INFO: 'info',
  WARNING: 'warning',
});

export const NAVIGATION_VOLTA_MARKER_TYPE = 'volta';

const ISSUE_MESSAGES = Object.freeze({
  'missing-coda': 'Coda 목적지가 지정되지 않았습니다.',
  'missing-fine': 'Fine이 지정되지 않았습니다.',
  'missing-segno': 'Segno가 지정되지 않았습니다.',
  'missing-to-coda': 'To Coda가 지정되지 않았습니다.',
  'multiple-coda': 'Coda 목적지가 여러 개 지정되어 있습니다.',
  'multiple-fine': 'Fine이 여러 개 지정되어 있습니다.',
  'multiple-segno': 'Segno가 여러 개 지정되어 이동 위치를 결정할 수 없습니다.',
});

function getMeasureMarkerTypes(measure) {
  return normalizeNavigationMarkers(measure?.navigationMarkers).map(
    (marker) => marker.type,
  );
}

function getCommandMarkerType(measure) {
  const markerTypes = getMeasureMarkerTypes(measure);

  return NAVIGATION_COMMAND_MARKER_TYPES.find((type) =>
    markerTypes.includes(type),
  ) || '';
}

function getStructuralIssueCode(issue, navigationModel) {
  if (issue.code === 'segno-missing') {
    return navigationModel.segnoIndexes.length === 0
      ? 'missing-segno'
      : 'multiple-segno';
  }
  if (issue.code === 'to-coda-missing') return 'missing-to-coda';
  if (issue.code === 'coda-target-invalid') {
    return navigationModel.codaIndexes.length === 0
      ? 'missing-coda'
      : 'multiple-coda';
  }
  if (issue.code === 'fine-target-invalid') {
    return navigationModel.fineIndexes.length === 0
      ? 'missing-fine'
      : 'multiple-fine';
  }
  if (issue.code === 'multiple-segnos') return 'multiple-segno';
  if (issue.code === 'multiple-codas') return 'multiple-coda';
  if (issue.code === 'multiple-fines') return 'multiple-fine';

  return issue.code;
}

function getStructuralIssueMessage(code, fallbackMessage) {
  return ISSUE_MESSAGES[code] || fallbackMessage;
}

function getMarkerTypeForIssue(issue, measure) {
  const markerTypes = getMeasureMarkerTypes(measure);

  switch (issue.code) {
    case 'segno-missing':
    case 'segno-not-before-dal-segno':
      return getCommandMarkerType(measure);
    case 'to-coda-missing':
    case 'coda-not-after-command':
      return NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA;
    case 'coda-target-invalid':
      return markerTypes.includes(NAVIGATION_MARKER_TYPES.TO_CODA)
        ? NAVIGATION_MARKER_TYPES.TO_CODA
        : NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA;
    case 'coda-target-self':
      return NAVIGATION_MARKER_TYPES.TO_CODA;
    case 'fine-target-invalid':
    case 'fine-not-on-return-path':
      return NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE;
    case 'repeat-start-missing':
      return NAVIGATION_MARKER_TYPES.REPEAT_END;
    case 'repeat-end-missing':
      return NAVIGATION_MARKER_TYPES.REPEAT_START;
    case 'ending-anchor-duplicate':
    case 'ending-range-invalid':
    case 'ending-repeat-section-missing':
      return NAVIGATION_VOLTA_MARKER_TYPE;
    default:
      return markerTypes[0] || NAVIGATION_VOLTA_MARKER_TYPE;
  }
}

function getGlobalIssueTargets(issue, measures, navigationModel) {
  const targetConfig = {
    'multiple-codas': {
      indexes: navigationModel.codaIndexes,
      markerType: NAVIGATION_MARKER_TYPES.CODA,
    },
    'multiple-fines': {
      indexes: navigationModel.fineIndexes,
      markerType: NAVIGATION_MARKER_TYPES.FINE,
    },
    'multiple-segnos': {
      indexes: navigationModel.segnoIndexes,
      markerType: NAVIGATION_MARKER_TYPES.SEGNO,
    },
  }[issue.code];

  if (!targetConfig) return null;

  return targetConfig.indexes.map((measureIndex) => ({
    markerType: targetConfig.markerType,
    measureId: measures[measureIndex]?.id || '',
    measureIndex,
  }));
}

function getLocalIssueTargets(issue, measures) {
  const measure = measures[issue.measureIndex];

  if (
    issue.code === 'multiple-jump-actions' ||
    issue.code === 'multiple-navigation-actions'
  ) {
    return getMeasureMarkerTypes(measure).map((markerType) => ({
      markerType,
      measureId: measure?.id || issue.measureId || '',
      measureIndex: issue.measureIndex,
    }));
  }

  return [{
    markerType: getMarkerTypeForIssue(issue, measure),
    measureId: measure?.id || issue.measureId || '',
    measureIndex: issue.measureIndex,
  }];
}

function createIssue({
  code,
  details = {},
  markerType,
  measureId,
  measureIndex,
  message,
  relatedMeasureIds = [],
  severity,
}) {
  return {
    code,
    details,
    id: `${severity}:${code}:${measureId}:${markerType}`,
    markerType,
    measureId,
    measureIndex,
    message,
    relatedMeasureIds,
    severity,
  };
}

function addUniqueIssue(issueMap, issue) {
  if (!issue.measureId || !issue.markerType) return;

  if (!issueMap.has(issue.id)) issueMap.set(issue.id, issue);
}

function addStructuralIssues(issueMap, measures, navigationModel) {
  navigationModel.issues.forEach((sourceIssue) => {
    const code = getStructuralIssueCode(sourceIssue, navigationModel);
    const targets =
      getGlobalIssueTargets(sourceIssue, measures, navigationModel) ||
      getLocalIssueTargets(sourceIssue, measures);
    const relatedMeasureIds = targets
      .map((target) => target.measureId)
      .filter(Boolean);

    targets.forEach((target) => {
      addUniqueIssue(issueMap, createIssue({
        code,
        details: { sourceCode: sourceIssue.code },
        markerType: target.markerType,
        measureId: target.measureId,
        measureIndex: target.measureIndex,
        message: getStructuralIssueMessage(code, sourceIssue.message),
        relatedMeasureIds,
        severity: NAVIGATION_ISSUE_SEVERITIES.ERROR,
      }));
    });
  });
}

function addPlannerIssues(issueMap, plans) {
  plans.forEach((plan) => {
    const baseIssue = {
      details: {
        candidatePaths: plan.candidatePaths,
        plannerReason: plan.reason,
        repeatDecisions: plan.repeatDecisions,
      },
      markerType: plan.command.type,
      measureId: plan.command.measureId,
      measureIndex: plan.command.measureIndex,
    };

    if (plan.status === NAVIGATION_PATH_PLAN_STATUS.AMBIGUOUS) {
      addUniqueIssue(issueMap, createIssue({
        ...baseIssue,
        code: 'ambiguous-navigation-path',
        message: 'AUTO 경로가 둘 이상입니다. 재생 시 경로를 선택해야 합니다.',
        severity: NAVIGATION_ISSUE_SEVERITIES.WARNING,
      }));
      return;
    }

    if (
      plan.status === NAVIGATION_PATH_PLAN_STATUS.INVALID &&
      [
        NAVIGATION_PATH_PLAN_REASONS.NAVIGATION_LOOP,
        NAVIGATION_PATH_PLAN_REASONS.TARGET_UNREACHABLE,
      ].includes(plan.reason)
    ) {
      addUniqueIssue(issueMap, createIssue({
        ...baseIssue,
        code: 'navigation-target-unreachable',
        message: '현재 반복 경로로 Navigation 목적지에 도달할 수 없습니다.',
        severity: NAVIGATION_ISSUE_SEVERITIES.ERROR,
      }));
      return;
    }

    if (
      plan.status === NAVIGATION_PATH_PLAN_STATUS.RESOLVED &&
      Object.keys(plan.repeatDecisions).length > 0
    ) {
      addUniqueIssue(issueMap, createIssue({
        ...baseIssue,
        code: 'navigation-path-resolved',
        message: 'AUTO가 목적지에 도달하는 반복 경로를 결정했습니다.',
        severity: NAVIGATION_ISSUE_SEVERITIES.INFO,
      }));
    }
  });
}

export function getNavigationIssueMarkerKey(measureId, markerType) {
  return `${measureId}:${markerType}`;
}

export function getNavigationIssuesByMarker(issues) {
  const issuesByMarker = new Map();

  (Array.isArray(issues) ? issues : []).forEach((issue) => {
    if (
      ![
        NAVIGATION_ISSUE_SEVERITIES.ERROR,
        NAVIGATION_ISSUE_SEVERITIES.WARNING,
      ].includes(issue.severity)
    ) {
      return;
    }

    const key = getNavigationIssueMarkerKey(issue.measureId, issue.markerType);
    const markerIssues = issuesByMarker.get(key) || [];

    markerIssues.push(issue);
    issuesByMarker.set(key, markerIssues);
  });

  return issuesByMarker;
}

export function validateNavigationModel(measures) {
  const safeMeasures = Array.isArray(measures) ? measures : [];
  const navigationModel = buildNavigationModel(safeMeasures);
  const issueMap = new Map();

  addStructuralIssues(issueMap, safeMeasures, navigationModel);
  addPlannerIssues(
    issueMap,
    getNavigationPathPlansForValidation(safeMeasures),
  );

  const issues = [...issueMap.values()];
  const visibleIssues = issues.filter(
    (issue) => issue.severity !== NAVIGATION_ISSUE_SEVERITIES.INFO,
  );

  return {
    isValid: !issues.some(
      (issue) => issue.severity === NAVIGATION_ISSUE_SEVERITIES.ERROR,
    ),
    issues,
    message: visibleIssues[0]?.message || '',
    navigationModel,
  };
}
