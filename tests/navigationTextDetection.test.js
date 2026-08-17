import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NAVIGATION_MARKER_TYPES,
} from '../src/utils/navigationMarkers.js';
import {
  createNavigationTextMeasureIdentity,
  detectNavigationTextCandidates,
  isNavigationTextCandidateStateCurrent,
  NAVIGATION_TEXT_CONFIDENCE,
  NAVIGATION_TEXT_MATCH_STATUS,
  reconcileNavigationTextCandidates,
} from '../src/utils/navigationTextDetection.js';
import { validateNavigationModel } from '../src/utils/navigationValidation.js';
import { resolvePlaybackSequence } from '../src/utils/playbackResolver.js';

const SYSTEM = {
  contentBottom: 0.46,
  contentTop: 0.08,
  index: 0,
  staffBottom: 0.28,
  staffSpacing: 0.02,
  staffTop: 0.2,
  width: 0.8,
  x: 0.1,
};

const NEXT_SYSTEM = {
  contentBottom: 0.92,
  contentTop: 0.48,
  index: 1,
  staffBottom: 0.7,
  staffSpacing: 0.02,
  staffTop: 0.62,
  width: 0.8,
  x: 0.1,
};

const MEASURES = [
  {
    height: 0.38,
    id: 'm1',
    navigationMarkers: [],
    page: 1,
    width: 0.4,
    x: 0.1,
    y: 0.08,
  },
  {
    height: 0.38,
    id: 'm2',
    navigationMarkers: [],
    page: 1,
    width: 0.4,
    x: 0.5,
    y: 0.08,
  },
];

function text(
  value,
  x,
  baselineY,
  width = 0.06,
  height = 0.02,
  sourceIndex = 0,
) {
  return {
    baselineY,
    height,
    page: 1,
    sourceIndex,
    text: value,
    width,
    x,
    y: baselineY - height,
  };
}

function detect(textItems, options = {}) {
  return detectNavigationTextCandidates({
    measures: options.measures || MEASURES,
    pageNumber: 1,
    systems: options.systems || [SYSTEM],
    textItems,
  }).candidates;
}

test('D.S. text를 canonical dal-segno 후보로 탐지한다', () => {
  const [candidate] = detect([text('D.S.', 0.2, 0.16)]);

  assert.equal(candidate.type, NAVIGATION_MARKER_TYPES.DAL_SEGNO);
  assert.equal(candidate.measureId, 'm1');
  assert.equal(candidate.confidence, NAVIGATION_TEXT_CONFIDENCE.HIGH);
});

test('D.S. al Coda와 To Coda를 각각 탐지한다', () => {
  const candidates = detect([
    text('D.S. al Coda', 0.2, 0.16, 0.12, 0.02, 0),
    text('To Coda', 0.64, 0.16, 0.1, 0.02, 1),
  ]);

  assert.deepEqual(
    candidates.map((candidate) => candidate.type),
    [
      NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
      NAVIGATION_MARKER_TYPES.TO_CODA,
    ],
  );
});

test('D.S. al Fine을 canonical 후보로 탐지한다', () => {
  const [candidate] = detect([text('D.S. al Fine', 0.6, 0.16, 0.12)]);

  assert.equal(candidate.type, NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE);
  assert.equal(candidate.measureId, 'm2');
});

test('staff instruction context의 Fine만 탐지한다', () => {
  const [candidate] = detect([text('Fine', 0.2, 0.18)]);
  const lyricFine = detect([text('fine', 0.2, 0.38)]);

  assert.equal(candidate.type, NAVIGATION_MARKER_TYPES.FINE);
  assert.deepEqual(lyricFine, []);
});

test('영어 가사와 2x only는 Navigation 후보가 아니다', () => {
  const candidates = detect([
    text('This is our page', 0.2, 0.35, 0.15, 0.02, 0),
    text('(2x only)', 0.62, 0.16, 0.1, 0.02, 1),
  ]);

  assert.deepEqual(candidates, []);
});

test('이번 STEP 범위 밖인 D.C. 계열은 후보로 만들지 않는다', () => {
  const candidates = detect([
    text('D.C.', 0.2, 0.16, 0.05, 0.02, 0),
    text('D.C. al Fine', 0.6, 0.16, 0.12, 0.02, 1),
  ]);

  assert.deepEqual(candidates, []);
});

test('longest match를 우선하여 D.S. al Coda 후보 하나만 만든다', () => {
  const candidates = detect([text('D.S. al Coda', 0.2, 0.16, 0.12)]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].type, NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA);
});

test('분리된 D.S. al Coda, D.S. al Fine, To Coda Text Item을 복원한다', () => {
  const fixtures = [
    {
      expected: NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
      items: [
        text('D.S.', 0.18, 0.16, 0.04, 0.02, 0),
        text('al', 0.225, 0.16, 0.02, 0.02, 1),
        text('Coda', 0.25, 0.16, 0.05, 0.02, 2),
      ],
    },
    {
      expected: NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE,
      items: [
        text('D.S.', 0.18, 0.16, 0.04, 0.02, 0),
        text('al', 0.225, 0.16, 0.02, 0.02, 1),
        text('Fine', 0.25, 0.16, 0.05, 0.02, 2),
      ],
    },
    {
      expected: NAVIGATION_MARKER_TYPES.TO_CODA,
      items: [
        text('To', 0.18, 0.16, 0.025, 0.02, 0),
        text('Coda', 0.21, 0.16, 0.05, 0.02, 1),
      ],
    },
  ];

  fixtures.forEach(({ expected, items }) => {
    const candidates = detect(items);

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].type, expected);
    assert.equal(candidates[0].confidence, NAVIGATION_TEXT_CONFIDENCE.MEDIUM);
  });
});

test('서로 다른 staff/system의 Text Item은 하나의 command로 합치지 않는다', () => {
  const candidates = detect(
    [
      text('D.S.', 0.2, 0.16, 0.04, 0.02, 0),
      text('al', 0.2, 0.58, 0.02, 0.02, 1),
      text('Coda', 0.225, 0.58, 0.05, 0.02, 2),
    ],
    {
      measures: [
        ...MEASURES,
        {
          height: 0.44,
          id: 'm3',
          navigationMarkers: [],
          page: 1,
          width: 0.8,
          x: 0.1,
          y: 0.48,
        },
      ],
      systems: [SYSTEM, NEXT_SYSTEM],
    },
  );

  assert.equal(
    candidates.some(
      (candidate) =>
        candidate.type === NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
    ),
    false,
  );
  assert.equal(candidates[0].type, NAVIGATION_MARKER_TYPES.DAL_SEGNO);
});

test('같은 line이어도 비정상적으로 멀리 떨어진 Text Item은 합치지 않는다', () => {
  const candidates = detect([
    text('D.S.', 0.18, 0.16, 0.04, 0.02, 0),
    text('al', 0.62, 0.16, 0.02, 0.02, 1),
    text('Coda', 0.65, 0.16, 0.05, 0.02, 2),
  ]);

  assert.equal(
    candidates.some(
      (candidate) =>
        candidate.type === NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
    ),
    false,
  );
});

test('staff 위와 아래의 command를 같은 system의 올바른 Measure에 연결한다', () => {
  const candidates = detect([
    text('D.S.', 0.2, 0.14, 0.05, 0.02, 0),
    text('To Coda', 0.62, 0.32, 0.1, 0.02, 1),
  ]);

  assert.deepEqual(
    candidates.map((candidate) => candidate.measureId),
    ['m1', 'm2'],
  );
});

test('Measure 경계에서 association이 동률이면 억지로 연결하지 않는다', () => {
  const [candidate] = detect([text('D.S.', 0.45, 0.16, 0.1)]);

  assert.equal(candidate.measureId, null);
  assert.equal(candidate.measureIndex, -1);
  assert.equal(candidate.confidence, NAVIGATION_TEXT_CONFIDENCE.LOW);
});

test('같은 Measure와 type의 기존 marker는 이미 지정됨 상태로 조정한다', () => {
  const [candidate] = detect([text('D.S.', 0.2, 0.16)]);
  const measures = MEASURES.map((measure, index) =>
    index === 0
      ? {
          ...measure,
          navigationMarkers: [{ type: NAVIGATION_MARKER_TYPES.DAL_SEGNO }],
        }
      : measure,
  );
  const [reconciled] = reconcileNavigationTextCandidates(
    [candidate],
    measures,
  );

  assert.equal(
    reconciled.matchStatus,
    NAVIGATION_TEXT_MATCH_STATUS.MATCHED_EXISTING_MARKER,
  );
});

test('candidate model은 source, confidence, bounds와 deterministic evidence를 가진다', () => {
  const [candidate] = detect([text('D.S.', 0.2, 0.16)]);

  assert.equal(candidate.source, 'pdf-text');
  assert.equal(candidate.confidence, NAVIGATION_TEXT_CONFIDENCE.HIGH);
  assert.equal(candidate.bounds.coordinateSpace, 'normalized-page-v1');
  assert.equal(candidate.evidence.classification.category, 'navigation');
  assert.equal(candidate.evidence.textItems.length, 1);
  assert.equal(
    candidate.evidence.measureAssociation.reason,
    'clear-horizontal-association',
  );
});

test('candidate 탐지는 Measure, Playback sequence, Validator 결과를 바꾸지 않는다', () => {
  const measures = MEASURES.map((measure) => ({ ...measure }));
  const beforeMeasures = structuredClone(measures);
  const beforeSequence = resolvePlaybackSequence(measures);
  const beforeValidation = validateNavigationModel(measures);

  detect([text('D.S. al Coda', 0.2, 0.16, 0.12)], { measures });

  assert.deepEqual(measures, beforeMeasures);
  assert.deepEqual(resolvePlaybackSequence(measures), beforeSequence);
  assert.deepEqual(validateNavigationModel(measures), beforeValidation);
});

test('PDF 또는 Measure identity가 바뀌면 기존 candidate state를 stale로 판정한다', () => {
  const measureIdentity = createNavigationTextMeasureIdentity(MEASURES);
  const state = { measureIdentity, pdfIdentity: 'pdf-a' };

  assert.equal(
    isNavigationTextCandidateStateCurrent(state, {
      measureIdentity,
      pdfIdentity: 'pdf-a',
    }),
    true,
  );
  assert.equal(
    isNavigationTextCandidateStateCurrent(state, {
      measureIdentity,
      pdfIdentity: 'pdf-b',
    }),
    false,
  );
  assert.equal(
    isNavigationTextCandidateStateCurrent(state, {
      measureIdentity: createNavigationTextMeasureIdentity([
        { ...MEASURES[0], x: 0.2 },
        MEASURES[1],
      ]),
      pdfIdentity: 'pdf-a',
    }),
    false,
  );
});
