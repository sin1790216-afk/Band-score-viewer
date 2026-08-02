import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInitialProjectState,
  DEFAULT_MEASURE,
  exportMeasuresJson,
  importMeasuresJson,
  PROJECT_ACTIONS,
  projectReducer,
} from '../src/state/projectState.js';
import {
  NORMALIZED_COORDINATE_SPACE,
  NORMALIZED_COORDINATE_STATUS,
} from '../src/utils/measureCoordinates.js';

const canonicalMeasure = {
  bpm: 120,
  beats: 4,
  coordinateHeight: 1,
  coordinateSpace: NORMALIZED_COORDINATE_SPACE,
  coordinateStatus: NORMALIZED_COORDINATE_STATUS,
  coordinateWidth: 1,
  height: 0.1,
  lyric: '',
  page: 1,
  width: 0.2,
  x: 0.25,
  y: 0.5,
};

test('project state adds, updates, and deletes a canonical measure', () => {
  const initialState = createInitialProjectState();
  const addedState = projectReducer(initialState, {
    type: PROJECT_ACTIONS.ADD_MEASURE,
    measure: canonicalMeasure,
  });
  const updatedState = projectReducer(addedState, {
    type: PROJECT_ACTIONS.UPDATE_MEASURE,
    index: 0,
    changes: {
      height: 0.15,
      width: 0.3,
      x: 0.1,
      y: 0.2,
    },
  });
  const deletedState = projectReducer(updatedState, {
    type: PROJECT_ACTIONS.DELETE_MEASURE,
    index: 0,
  });

  assert.equal(addedState.measures.length, 1);
  assert.equal(updatedState.measures[0].coordinateSpace, NORMALIZED_COORDINATE_SPACE);
  assert.equal(updatedState.measures[0].coordinateWidth, 1);
  assert.deepEqual(
    {
      height: updatedState.measures[0].height,
      width: updatedState.measures[0].width,
      x: updatedState.measures[0].x,
      y: updatedState.measures[0].y,
    },
    { height: 0.15, width: 0.3, x: 0.1, y: 0.2 },
  );
  assert.deepEqual(deletedState.measures, []);
});

test('project state stores BPM, Beats, and multiline lyrics without changing coordinates', () => {
  const addedState = projectReducer(createInitialProjectState(), {
    type: PROJECT_ACTIONS.ADD_MEASURE,
    measure: canonicalMeasure,
  });
  const timingState = projectReducer(addedState, {
    type: PROJECT_ACTIONS.UPDATE_MEASURE,
    index: 0,
    changes: { beats: 3, bpm: 90 },
  });
  const lyricState = projectReducer(timingState, {
    type: PROJECT_ACTIONS.UPDATE_MEASURE,
    index: 0,
    changes: { lyric: '첫 줄\n둘째 줄' },
  });

  assert.equal(lyricState.measures[0].bpm, 90);
  assert.equal(lyricState.measures[0].beats, 3);
  assert.equal(lyricState.measures[0].lyric, '첫 줄\n둘째 줄');
  assert.equal(lyricState.measures[0].x, canonicalMeasure.x);
  assert.equal(lyricState.measures[0].y, canonicalMeasure.y);
});

test('JSON import keeps the legacy array format and applies existing defaults', () => {
  const importedMeasures = importMeasuresJson(
    JSON.stringify([
      {
        coordinateHeight: 600,
        coordinateWidth: 400,
        height: 60,
        page: 2,
        width: 80,
        x: 100,
        y: 300,
      },
    ]),
  );
  const importedState = projectReducer(createInitialProjectState(), {
    type: PROJECT_ACTIONS.IMPORT_MEASURES,
    measures: importedMeasures,
  });
  const [measure] = importedState.measures;

  assert.equal(measure.coordinateSpace, NORMALIZED_COORDINATE_SPACE);
  assert.equal(measure.x, 0.25);
  assert.equal(measure.y, 0.5);
  assert.equal(measure.width, 0.2);
  assert.equal(measure.height, 0.1);
  assert.equal(measure.bpm, DEFAULT_MEASURE.bpm);
  assert.equal(measure.beats, DEFAULT_MEASURE.beats);
  assert.equal(measure.lyric, '');
});

test('JSON export remains a measure array and preserves normalized coordinates', () => {
  const state = projectReducer(createInitialProjectState(), {
    type: PROJECT_ACTIONS.ADD_MEASURE,
    measure: {
      ...canonicalMeasure,
      lyric: '한 마디\n두 줄',
    },
  });
  const serialized = exportMeasuresJson(state.measures);
  const restoredMeasures = importMeasuresJson(serialized);

  assert.ok(Array.isArray(JSON.parse(serialized)));
  assert.deepEqual(restoredMeasures, state.measures);
});

test('project PDF metadata is independent from measure replacement', () => {
  const namedState = projectReducer(createInitialProjectState(), {
    type: PROJECT_ACTIONS.SET_PDF_FILE_NAME,
    fileName: 'lesson.pdf',
  });
  const replacedState = projectReducer(namedState, {
    type: PROJECT_ACTIONS.REPLACE_MEASURES,
    measures: [canonicalMeasure],
  });

  assert.equal(replacedState.pdfMetadata.fileName, 'lesson.pdf');
  assert.equal(replacedState.measures.length, 1);
});
