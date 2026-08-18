import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachNavigationEndings,
  createManualNavigationEnding,
} from '../src/utils/navigationEndings.js';
import { NAVIGATION_MARKER_TYPES } from '../src/utils/navigationMarkers.js';
import {
  advancePlaybackProgression,
  createPlaybackProgression,
  resolvePlaybackSequence,
} from '../src/utils/playbackResolver.js';
import { createPlaybackLyricProjection } from '../src/utils/playbackLyrics.js';
import { getLogicalSyncState } from '../src/state/sessionState.js';
import { getLanguagePhrasesForMeasures } from '../src/utils/languagePhrases.js';
import { createVocalViewModel } from '../src/utils/vocalPhrases.js';

function lyricGeometry(lineCount = 2, systemIndex = 0) {
  return {
    lines: Array.from({ length: lineCount }, (_, lineIndex) => ({
      baselineY: 0.7 + lineIndex * 0.03,
      endX: 0.4,
      lineIndex,
      referenceGap: 0.02,
      startX: 0.2,
    })),
    page: 1,
    systemIndex,
  };
}

function createMeasures(count, markerTypesByNumber = {}, laneCount = 2) {
  return Array.from({ length: count }, (_, index) => ({
    beats: 4,
    bpm: 120,
    height: 0.2,
    id: `m${index + 1}`,
    lyric: Array.from(
      { length: laneCount },
      (_, laneIndex) => `${laneIndex + 1}절-${index + 1}`,
    ).join('\n'),
    lyricGeometry: lyricGeometry(laneCount, index),
    navigationEndings: [],
    navigationMarkers: (markerTypesByNumber[index + 1] || []).map((type) => ({
      type,
    })),
    page: 1,
    width: 0.1,
    x: index * 0.1,
    y: 0.2,
  }));
}

function advanceUntil(progression, measures, predicate) {
  let current = progression;

  for (let count = 0; count < 100; count += 1) {
    if (predicate(current.runState.currentStep, current.runState)) return current;

    const result = advancePlaybackProgression(current, measures);

    current = result.progression;
    if (!result.didMove) break;
  }

  return current;
}

function currentLyric(measures, progression) {
  const step = progression?.runState?.currentStep || null;
  const projection = createPlaybackLyricProjection(measures, step);
  const index = step?.measureIndex || 0;

  return {
    lyric: projection.measures[index].lyric,
    projection,
  };
}

test('한 개 lyric lane은 모든 Repeat pass에서 같은 가사를 표시한다', () => {
  const measures = createMeasures(4, {
    1: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    2: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  }, 1);
  const secondPass = advanceUntil(
    createPlaybackProgression(measures),
    measures,
    (step) => step.measureIndex === 0 && step.repeatPass === 2,
  );

  assert.equal(currentLyric(measures, secondPass).lyric, '1절-1');
});

test('두 lyric lane은 Repeat pass 1과 2에서 각각 첫째와 둘째 lane을 선택한다', () => {
  const measures = createMeasures(4, {
    1: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    2: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  });
  const firstPass = createPlaybackProgression(measures);
  const secondPass = advanceUntil(
    firstPass,
    measures,
    (step) => step.measureIndex === 0 && step.repeatPass === 2,
  );

  assert.equal(currentLyric(measures, firstPass).lyric, '1절-1');
  assert.equal(currentLyric(measures, secondPass).lyric, '2절-1');
  assert.equal(secondPass.runState.currentStep.enteredBy, 'repeat');
});

test('Generic 3-pass Repeat는 세 번째 lyric lane을 선택한다', () => {
  let measures = createMeasures(5, {
    1: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    3: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  }, 3);
  const endings = [1, 2, 3].map((pass, index) =>
    createManualNavigationEnding({
      pass,
      repeatEndMeasureId: 'm3',
      repeatStartMeasureId: 'm1',
      startMeasureId: `m${index + 3}`,
    })
  );

  measures = attachNavigationEndings(measures, endings);
  const thirdPass = advanceUntil(
    createPlaybackProgression(measures),
    measures,
    (step) => step.measureIndex === 0 && step.repeatPass === 3,
  );

  assert.equal(currentLyric(measures, thirdPass).lyric, '3절-1');
});

test('Repeat pass가 lane 수를 넘으면 마지막 유효 lane을 유지한다', () => {
  const measures = createMeasures(3, {
    1: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    2: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  });
  const sectionId = 'repeat:m1:m2';
  const projection = createPlaybackLyricProjection(measures, {
    enteredBy: 'repeat',
    measureId: 'm1',
    repeatPass: 3,
    repeatSectionId: sectionId,
  });

  assert.equal(projection.measures[0].lyric, '2절-1');
  assert.equal(projection.selectedLaneIndexes[0], 1);
});

test('존재하는 빈 lane은 다른 절로 대체하지 않는다', () => {
  const measures = createMeasures(2, {
    1: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    2: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  });

  measures[0].lyric = '첫 절\n';
  const projection = createPlaybackLyricProjection(measures, {
    enteredBy: 'repeat',
    measureId: 'm1',
    repeatPass: 2,
    repeatSectionId: 'repeat:m1:m2',
  });

  assert.equal(projection.measures[0].lyric, '');
});

test('1./2. Volta는 Resolver가 선택한 pass의 lyric lane을 사용한다', () => {
  let measures = createMeasures(5, {
    1: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    3: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  });
  const endings = [
    createManualNavigationEnding({
      pass: 1,
      repeatEndMeasureId: 'm3',
      repeatStartMeasureId: 'm1',
      startMeasureId: 'm3',
    }),
    createManualNavigationEnding({
      pass: 2,
      repeatEndMeasureId: 'm3',
      repeatStartMeasureId: 'm1',
      startMeasureId: 'm4',
    }),
  ];

  measures = attachNavigationEndings(measures, endings);
  const firstEnding = advanceUntil(
    createPlaybackProgression(measures),
    measures,
    (step) => step.measureIndex === 2,
  );
  const secondEnding = advanceUntil(
    firstEnding,
    measures,
    (step) => step.measureIndex === 3 && step.repeatPass === 2,
  );

  assert.equal(currentLyric(measures, firstEnding).lyric, '1절-3');
  assert.equal(currentLyric(measures, secondEnding).lyric, '2절-4');
});

for (const fixture of [
  {
    label: 'D.S.',
    markers: {
      1: [NAVIGATION_MARKER_TYPES.SEGNO],
      3: [NAVIGATION_MARKER_TYPES.DAL_SEGNO],
    },
    targetEnteredBy: 'dal-segno',
  },
  {
    label: 'D.S. al Coda / To Coda / Coda',
    markers: {
      1: [NAVIGATION_MARKER_TYPES.SEGNO],
      2: [NAVIGATION_MARKER_TYPES.TO_CODA],
      3: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA],
      4: [NAVIGATION_MARKER_TYPES.CODA],
    },
    targetEnteredBy: 'to-coda',
  },
  {
    label: 'D.S. al Fine / Fine',
    markers: {
      1: [NAVIGATION_MARKER_TYPES.SEGNO],
      2: [NAVIGATION_MARKER_TYPES.FINE],
      3: [NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE],
    },
    targetEnteredBy: 'dal-segno-al-fine',
  },
]) {
  test(`${fixture.label} Navigation jump만으로 lyric lane이 증가하지 않는다`, () => {
    const measures = createMeasures(5, fixture.markers);
    const { steps } = resolvePlaybackSequence(measures);
    const targetStep = steps.find((step) => step.enteredBy === fixture.targetEnteredBy);
    const projection = createPlaybackLyricProjection(measures, targetStep);

    assert.ok(targetStep);
    assert.equal(projection.repeatPass, 1);
    assert.equal(projection.activeLaneIndex, 0);
    assert.equal(
      projection.measures[targetStep.measureIndex].lyric,
      `1절-${targetStep.measureIndex + 1}`,
    );
  });
}

test('playback run과 stop 상태는 모두 첫 lyric lane을 기본으로 사용한다', () => {
  const measures = createMeasures(4, {
    1: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    3: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  });
  const manual = createPlaybackProgression(measures, 1);
  const reset = createPlaybackProgression(measures, 0);

  assert.equal(currentLyric(measures, manual).lyric, '1절-2');
  assert.equal(currentLyric(measures, reset).lyric, '1절-1');
  assert.equal(
    createPlaybackLyricProjection(measures, null).measures[0].lyric,
    '1절-1',
  );
});

test('수동 direct navigation은 Repeat 구간의 물리 위치만으로 pass를 만들지 않는다', () => {
  const measures = createMeasures(4, {
    1: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    3: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  });

  assert.equal(
    createPlaybackLyricProjection(measures, null).measures[2].lyric,
    '1절-3',
  );
});

test('진행 정보가 없으면 system의 첫 실제 lane을 선택해 Vocal이 사라지지 않는다', () => {
  const measures = createMeasures(2, {}, 3);

  measures[0].lyric = '\n첫 절\n둘째 절';
  measures[0].lyricGeometry.lines = measures[0].lyricGeometry.lines.slice(1);
  const projection = createPlaybackLyricProjection(measures, null);
  const viewModel = createVocalViewModel(projection.measures, 0);

  assert.notEqual(projection.measures, measures);
  assert.equal(measures[0].lyric, '\n첫 절\n둘째 절');
  assert.equal(viewModel.phraseCount > 0, true);
  assert.equal(viewModel.currentText, '첫 절');
  assert.equal(viewModel.currentText.includes('둘째 절'), false);
});

test('0이 아닌 PDF lineIndex도 system lane 순서대로 Repeat pass에 매핑한다', () => {
  const measures = createMeasures(2, {
    1: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    2: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  }, 3).map((measure) => ({
    ...measure,
    lyric: `\n첫 절-${measure.id}\n둘째 절-${measure.id}`,
    lyricGeometry: {
      ...measure.lyricGeometry,
      lines: measure.lyricGeometry.lines.slice(1),
      systemIndex: 0,
    },
  }));
  const firstPass = createPlaybackProgression(measures);
  const secondPass = advanceUntil(
    firstPass,
    measures,
    (step) => step.measureIndex === 0 && step.repeatPass === 2,
  );

  assert.equal(currentLyric(measures, firstPass).lyric, '첫 절-m1');
  assert.equal(currentLyric(measures, secondPass).lyric, '둘째 절-m1');
  assert.equal(
    currentLyric(measures, secondPass).projection.selectedLaneIndexes[0],
    2,
  );
});

test('lyricGeometry가 없는 legacy JSON은 multiline lyric 원문을 유지한다', () => {
  const measures = [{ id: 'm1', lyric: '첫 줄\n둘째 줄', page: 1 }];
  const projection = createPlaybackLyricProjection(measures, null);

  assert.equal(projection.measures, measures);
  assert.equal(projection.measures[0].lyric, '첫 줄\n둘째 줄');
});

test('기존 single-line lyric 프로젝트는 projection 전후가 동일하다', () => {
  const measures = createMeasures(2, {}, 1);
  const projection = createPlaybackLyricProjection(measures, null);

  assert.equal(projection.measures, measures);
  assert.equal(projection.measures[0].lyric, '1절-1');
});

test('선택된 lane만 기존 Vocal phrase UI 모델에 전달된다', () => {
  const measures = createMeasures(3, {
    1: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    2: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  });
  const secondPass = advanceUntil(
    createPlaybackProgression(measures),
    measures,
    (step) => step.measureIndex === 0 && step.repeatPass === 2,
  );
  const projection = createPlaybackLyricProjection(
    measures,
    secondPass.runState.currentStep,
  );
  const viewModel = createVocalViewModel(projection.measures, 0);

  assert.equal(viewModel.currentText.includes('2절-1'), true);
  assert.equal(viewModel.currentText.includes('1절-1'), false);
});

test('선택된 playback lane으로 currentText와 nextText를 함께 계산한다', () => {
  const measures = createMeasures(3, {
    1: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    2: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  });
  const secondPass = advanceUntil(
    createPlaybackProgression(measures),
    measures,
    (step) => step.measureIndex === 0 && step.repeatPass === 2,
  );
  const projection = createPlaybackLyricProjection(
    measures,
    secondPass.runState.currentStep,
  );
  const viewModel = createVocalViewModel(projection.measures, 0, {
    languagePhrases: null,
  });

  assert.equal(viewModel.currentText, '2절-1');
  assert.equal(viewModel.nextText, '2절-2');
});

test('stale AI Phrase는 선택 lane의 raw Vocal fallback을 막지 않는다', () => {
  const measures = createMeasures(2);
  const projection = createPlaybackLyricProjection(measures, null);
  const staleLanguagePhrases = getLanguagePhrasesForMeasures(
    {
      phraseCount: 1,
      phrases: [{ text: '이전 전체 가사' }],
      sourceKey: 'language-phrases-v3-stale-00000000',
      version: 3,
    },
    projection.measures,
  );
  const viewModel = createVocalViewModel(projection.measures, 0, {
    languagePhrases: staleLanguagePhrases,
  });

  assert.equal(staleLanguagePhrases, null);
  assert.equal(viewModel.currentText, '1절-1');
  assert.equal(viewModel.nextText, '1절-2');
});

test('빈 lyric은 projection 중 Navigation 문구로 다시 채워지지 않는다', () => {
  const measures = createMeasures(2);

  measures[0].lyric = '\n';
  const projection = createPlaybackLyricProjection(measures, null);

  assert.equal(measures[0].lyric, '\n');
  assert.equal(projection.measures[0].lyric, '');
  assert.equal(createVocalViewModel(projection.measures, 0).currentText, '');
  assert.equal(projection.measures[0].lyric.includes('D.S.'), false);
});

test('derived projection은 원본 multi-lane lyric과 geometry를 변경하지 않는다', () => {
  const measures = createMeasures(3, {
    1: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    2: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  });
  const original = structuredClone(measures);

  createPlaybackLyricProjection(measures, {
    enteredBy: 'repeat',
    measureId: 'm1',
    repeatPass: 2,
    repeatSectionId: 'repeat:m1:m2',
  });

  assert.deepEqual(measures, original);
});

test('Socket 직렬화와 late join sync state 뒤에도 같은 Repeat lane을 선택한다', () => {
  const measures = createMeasures(3, {
    1: [NAVIGATION_MARKER_TYPES.REPEAT_START],
    2: [NAVIGATION_MARKER_TYPES.REPEAT_END],
  });
  const secondPass = advanceUntil(
    createPlaybackProgression(measures),
    measures,
    (step) => step.measureIndex === 0 && step.repeatPass === 2,
  );
  const receivedSyncState = getLogicalSyncState(JSON.parse(JSON.stringify({
    fileName: 'score.pdf',
    measureIndex: 0,
    pageNumber: 1,
    playbackStep: secondPass.runState.currentStep,
  })));

  assert.equal(
    createPlaybackLyricProjection(
      JSON.parse(JSON.stringify(measures)),
      receivedSyncState.playbackStep,
    ).measures[0].lyric,
    '2절-1',
  );
});
