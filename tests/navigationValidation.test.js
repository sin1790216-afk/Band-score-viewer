import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NAVIGATION_MARKER_TYPES,
} from '../src/utils/navigationMarkers.js';
import {
  getNavigationIssueMarkerKey,
  getNavigationIssuesByMarker,
  NAVIGATION_ISSUE_SEVERITIES,
  validateNavigationModel,
} from '../src/utils/navigationValidation.js';

function createMeasures(count, markersByMeasureNumber = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index + 1}`,
    navigationEndings: [],
    navigationMarkers: (markersByMeasureNumber[index + 1] || []).map((type) => ({
      type,
    })),
    page: 1,
  }));
}

function addEndings(measures, repeatStartNumber, repeatEndNumber, starts) {
  return measures.map((measure, index) => ({
    ...measure,
    navigationEndings: index === repeatStartNumber - 1
      ? starts.map((start, endingIndex) => ({
          confidence: 1,
          id: `ending-${endingIndex + 1}`,
          passes: [endingIndex + 1],
          repeatEndMeasureId: `m${repeatEndNumber}`,
          repeatStartMeasureId: `m${repeatStartNumber}`,
          source: 'manual',
          startMeasureId: `m${start}`,
          type: 'volta',
        }))
      : [],
  }));
}

function getIssueCodes(result, measureId, markerType) {
  return (
    getNavigationIssuesByMarker(result.issues).get(
      getNavigationIssueMarkerKey(measureId, markerType),
    ) || []
  ).map((issue) => issue.code);
}

test('D.S. 계열 command는 Segno 누락을 해당 marker error로 연결한다', () => {
  const cases = [
    NAVIGATION_MARKER_TYPES.DAL_SEGNO,
    NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
  ];

  cases.forEach((commandType) => {
    const result = validateNavigationModel(createMeasures(4, {
      3: [commandType],
    }));

    assert.ok(getIssueCodes(result, 'm3', commandType).includes('missing-segno'));
  });
});

test('D.S. al Coda는 To Coda와 Coda 누락을 각각 보고한다', () => {
  const measures = createMeasures(6, {
    2: [NAVIGATION_MARKER_TYPES.SEGNO],
    4: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA],
  });
  const result = validateNavigationModel(measures);
  const codes = getIssueCodes(
    result,
    'm4',
    NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
  );

  assert.ok(codes.includes('missing-to-coda'));
  assert.ok(codes.includes('missing-coda'));
});

test('To Coda만 있고 Coda가 없으면 To Coda marker에 missing-coda를 연결한다', () => {
  const result = validateNavigationModel(createMeasures(3, {
    2: [NAVIGATION_MARKER_TYPES.TO_CODA],
  }));

  assert.ok(
    getIssueCodes(result, 'm2', NAVIGATION_MARKER_TYPES.TO_CODA).includes(
      'missing-coda',
    ),
  );
});

test('D.S. al Fine은 Fine 누락을 해당 command에 연결한다', () => {
  const result = validateNavigationModel(createMeasures(6, {
    2: [NAVIGATION_MARKER_TYPES.SEGNO],
    5: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE],
  }));

  assert.ok(
    getIssueCodes(
      result,
      'm5',
      NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE,
    ).includes('missing-fine'),
  );
});

test('대응 Repeat Start가 없는 Repeat End를 표시한다', () => {
  const result = validateNavigationModel(createMeasures(3, {
    2: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  }));

  assert.ok(
    getIssueCodes(result, 'm2', NAVIGATION_MARKER_TYPES.REPEAT_END).includes(
      'repeat-start-missing',
    ),
  );
});

test('Repeat section에 연결되지 않은 Volta anchor를 표시한다', () => {
  const measures = createMeasures(3);

  measures[0].navigationEndings = [{
    confidence: 1,
    id: 'orphan-ending',
    passes: [1],
    repeatEndMeasureId: 'missing-end',
    repeatStartMeasureId: 'missing-start',
    source: 'manual',
    startMeasureId: 'm1',
    type: 'volta',
  }];
  const result = validateNavigationModel(measures);

  assert.ok(getIssueCodes(result, 'm1', 'volta').includes(
    'ending-repeat-section-missing',
  ));
});

test('정상 D.S. al Coda와 D.S. al Fine 구조에는 missing error가 없다', () => {
  const coda = validateNavigationModel(createMeasures(8, {
    2: [NAVIGATION_MARKER_TYPES.SEGNO],
    4: [NAVIGATION_MARKER_TYPES.TO_CODA],
    6: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA],
    7: [NAVIGATION_MARKER_TYPES.CODA],
  }));
  const fine = validateNavigationModel(createMeasures(7, {
    2: [NAVIGATION_MARKER_TYPES.SEGNO],
    4: [NAVIGATION_MARKER_TYPES.FINE],
    6: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE],
  }));
  const missingCodes = new Set([
    'missing-coda',
    'missing-fine',
    'missing-segno',
    'missing-to-coda',
  ]);

  assert.equal(coda.issues.some((issue) => missingCodes.has(issue.code)), false);
  assert.equal(fine.issues.some((issue) => missingCodes.has(issue.code)), false);
});

test('Repeat End와 To Coda가 같은 유효한 마디는 false positive가 없다', () => {
  let measures = createMeasures(12, {
    2: [NAVIGATION_MARKER_TYPES.SEGNO],
    3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    6: [
      NAVIGATION_MARKER_TYPES.REPEAT_END,
      NAVIGATION_MARKER_TYPES.TO_CODA,
    ],
    9: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA],
    11: [NAVIGATION_MARKER_TYPES.CODA],
  });

  measures = addEndings(measures, 3, 6, [5, 7]);
  const result = validateNavigationModel(measures);
  const visibleIssues = result.issues.filter(
    (issue) => issue.severity !== NAVIGATION_ISSUE_SEVERITIES.INFO,
  );

  assert.deepEqual(visibleIssues, []);
});

test('AUTO resolved는 warning 없이 derived info만 만든다', () => {
  let measures = createMeasures(12, {
    2: [NAVIGATION_MARKER_TYPES.SEGNO],
    3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    5: [NAVIGATION_MARKER_TYPES.TO_CODA],
    6: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    9: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA],
    11: [NAVIGATION_MARKER_TYPES.CODA],
  });

  measures = addEndings(measures, 3, 6, [5, 7]);
  const result = validateNavigationModel(measures);

  assert.equal(
    result.issues.some((issue) => issue.code === 'ambiguous-navigation-path'),
    false,
  );
  assert.ok(result.issues.some((issue) =>
    issue.code === 'navigation-path-resolved' &&
    issue.severity === NAVIGATION_ISSUE_SEVERITIES.INFO,
  ));
});

test('AUTO의 서로 다른 유효 경로는 ambiguous warning을 만든다', () => {
  const result = validateNavigationModel(createMeasures(10, {
    2: [NAVIGATION_MARKER_TYPES.SEGNO],
    3: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    4: [NAVIGATION_MARKER_TYPES.REPEAT_END],
    6: [NAVIGATION_MARKER_TYPES.TO_CODA],
    8: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA],
    10: [NAVIGATION_MARKER_TYPES.CODA],
  }));
  const issues = getNavigationIssuesByMarker(result.issues).get(
    getNavigationIssueMarkerKey(
      'm8',
      NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
    ),
  );

  assert.ok(issues.some((issue) =>
    issue.code === 'ambiguous-navigation-path' &&
    issue.severity === NAVIGATION_ISSUE_SEVERITIES.WARNING,
  ));
});

test('어떤 AUTO 정책으로도 To Coda에 닿지 못하면 unreachable error다', () => {
  const measures = createMeasures(12, {
    2: [NAVIGATION_MARKER_TYPES.SEGNO],
    5: [
      NAVIGATION_MARKER_TYPES.TO_CODA,
      NAVIGATION_MARKER_TYPES.DAL_SEGNO,
    ],
    8: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA],
    10: [NAVIGATION_MARKER_TYPES.CODA],
  });

  const result = validateNavigationModel(measures);

  assert.ok(
    getIssueCodes(
      result,
      'm8',
      NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
    ).includes('navigation-target-unreachable'),
  );
});

test('하나의 D.S. al Coda marker에 여러 missing issue를 함께 연결한다', () => {
  const result = validateNavigationModel(createMeasures(3, {
    2: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA],
  }));
  const codes = getIssueCodes(
    result,
    'm2',
    NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
  );

  assert.deepEqual(
    new Set(codes),
    new Set(['missing-coda', 'missing-segno', 'missing-to-coda']),
  );
});

test('Navigation 필드가 없는 legacy project도 validation에서 실패하지 않는다', () => {
  const legacyMeasures = [{ id: 'm1', page: 1 }, { id: 'm2', page: 1 }];

  assert.doesNotThrow(() => validateNavigationModel(legacyMeasures));
  assert.deepEqual(validateNavigationModel(legacyMeasures).issues, []);
});
