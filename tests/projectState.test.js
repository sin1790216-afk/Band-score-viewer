import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInitialProjectState,
  createProjectMeasure,
  DEFAULT_MEASURE,
  exportMeasuresJson,
  importMeasuresJson,
  prepareMeasuresForProject,
  PROJECT_ACTIONS,
  projectReducer,
} from '../src/state/projectState.js';
import {
  NORMALIZED_COORDINATE_SPACE,
  NORMALIZED_COORDINATE_STATUS,
} from '../src/utils/measureCoordinates.js';
import { DEFAULT_AUDIO_SETTINGS } from '../src/utils/audioSettings.js';
import { isValidMeasureId } from '../src/utils/measureIdentity.js';

const canonicalMeasure = {
  bpm: 120,
  beats: 4,
  coordinateHeight: 1,
  coordinateSpace: NORMALIZED_COORDINATE_SPACE,
  coordinateStatus: NORMALIZED_COORDINATE_STATUS,
  coordinateWidth: 1,
  height: 0.1,
  id: 'measure-existing',
  lyric: '',
  navigationMarkers: [],
  page: 1,
  width: 0.2,
  x: 0.25,
  y: 0.5,
};

function createSequentialIdFactory(...ids) {
  let index = 0;

  return () => ids[index++];
}

test('a new project measure receives one stable ID at the creation boundary', () => {
  const measure = createProjectMeasure(
    {
      ...canonicalMeasure,
      id: undefined,
    },
    { createId: () => 'measure-created' },
  );
  const addedState = projectReducer(createInitialProjectState(), {
    type: PROJECT_ACTIONS.ADD_MEASURE,
    measure,
  });

  assert.equal(measure.id, 'measure-created');
  assert.equal(addedState.measures[0].id, 'measure-created');
});

test('project ingestion preserves unique IDs and repairs missing or duplicate IDs once', () => {
  const preparedMeasures = prepareMeasuresForProject(
    [
      { ...canonicalMeasure, id: '', x: 0.1 },
      canonicalMeasure,
      { ...canonicalMeasure, id: 'measure-existing', x: 0.6 },
    ],
    {
      createId: createSequentialIdFactory(
        'measure-existing',
        'measure-generated-1',
        'measure-generated-2',
      ),
    },
  );

  assert.deepEqual(
    preparedMeasures.map((measure) => measure.id),
    ['measure-generated-1', 'measure-existing', 'measure-generated-2'],
  );
  assert.deepEqual(
    prepareMeasuresForProject(preparedMeasures, {
      createId: () => {
        throw new Error('stable IDs must not be regenerated');
      },
    }),
    preparedMeasures,
  );
});

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
  assert.equal(updatedState.measures[0].id, canonicalMeasure.id);
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
  assert.equal(lyricState.measures[0].id, canonicalMeasure.id);
  assert.equal(lyricState.measures[0].x, canonicalMeasure.x);
  assert.equal(lyricState.measures[0].y, canonicalMeasure.y);
});

test('global BPM applies to every measure and keeps coordinates and per-measure editing', () => {
  const measures = Array.from({ length: 10 }, (_, index) => ({
    ...canonicalMeasure,
    bpm: 90 + index,
    id: `measure-global-${index + 1}`,
    x: 0.02 * index,
  }));
  const initialState = createInitialProjectState({ measures });
  const globalState = projectReducer(initialState, {
    type: PROJECT_ACTIONS.APPLY_BPM_TO_ALL_MEASURES,
    bpm: 126,
  });
  const overriddenState = projectReducer(globalState, {
    type: PROJECT_ACTIONS.UPDATE_MEASURE,
    changes: { bpm: 140 },
    index: 4,
  });
  const restoredMeasures = importMeasuresJson(
    exportMeasuresJson(overriddenState.measures),
  );

  assert.deepEqual(
    globalState.measures.map((measure) => measure.bpm),
    Array(10).fill(126),
  );
  assert.equal(overriddenState.measures[4].bpm, 140);
  assert.equal(overriddenState.measures[3].bpm, 126);
  assert.deepEqual(
    globalState.measures.map(({ height, width, x, y }) => ({
      height,
      width,
      x,
      y,
    })),
    initialState.measures.map(({ height, width, x, y }) => ({
      height,
      width,
      x,
      y,
    })),
  );
  assert.deepEqual(restoredMeasures, overriddenState.measures);
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
  assert.deepEqual(measure.navigationMarkers, []);
  assert.ok(isValidMeasureId(measure.id));
});

test('JSON round-trip preserves navigation markers without changing the array format', () => {
  const state = createInitialProjectState({
    measures: [
      {
        ...canonicalMeasure,
        navigationMarkers: [{ type: 'repeat-start' }, { type: 'segno' }],
      },
    ],
  });
  const serialized = exportMeasuresJson(state.measures);
  const restoredMeasures = importMeasuresJson(serialized);

  assert.ok(Array.isArray(JSON.parse(serialized)));
  assert.deepEqual(restoredMeasures, state.measures);
  assert.deepEqual(restoredMeasures[0].navigationMarkers, [
    { type: 'repeat-start' },
    { type: 'segno' },
  ]);
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

test('measure updates cannot replace a stable ID', () => {
  const addedState = projectReducer(createInitialProjectState(), {
    type: PROJECT_ACTIONS.ADD_MEASURE,
    measure: canonicalMeasure,
  });
  const updatedState = projectReducer(addedState, {
    type: PROJECT_ACTIONS.UPDATE_MEASURE,
    index: 0,
    changes: {
      id: 'measure-replacement',
      lyric: '수정된 가사',
    },
  });

  assert.equal(updatedState.measures[0].id, canonicalMeasure.id);
  assert.equal(updatedState.measures[0].lyric, '수정된 가사');
});

test('adding a duplicate stable ID leaves Project State unchanged', () => {
  const addedState = projectReducer(createInitialProjectState(), {
    type: PROJECT_ACTIONS.ADD_MEASURE,
    measure: canonicalMeasure,
  });
  const duplicateState = projectReducer(addedState, {
    type: PROJECT_ACTIONS.ADD_MEASURE,
    measure: { ...canonicalMeasure, x: 0.4 },
  });

  assert.equal(duplicateState, addedState);
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
  assert.equal(replacedState.pdfMetadata.mimeType, 'application/pdf');
  assert.equal(replacedState.measures.length, 1);
});

test('project state stores audio settings without changing score data', () => {
  const initialState = createInitialProjectState({ measures: [canonicalMeasure] });
  const nextState = projectReducer(initialState, {
    type: PROJECT_ACTIONS.SET_AUDIO_SETTINGS,
    audioSettings: {
      startOffsetSeconds: 8.5,
      url: 'https://example.com/lesson-track',
    },
  });

  assert.deepEqual(nextState.audioSettings, {
    startOffsetSeconds: 8.5,
    url: 'https://example.com/lesson-track',
  });
  assert.deepEqual(nextState.measures, initialState.measures);
  assert.deepEqual(initialState.audioSettings, DEFAULT_AUDIO_SETTINGS);
});

test('starting a new PDF resets prior project metadata and measures together', () => {
  const previousState = createInitialProjectState({
    audioSettings: {
      startOffsetSeconds: 20,
      url: 'https://example.com/previous-track',
    },
    measures: [canonicalMeasure],
    metadata: {
      createdAt: '2026-08-01T00:00:00.000Z',
      title: '이전 프로젝트',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    pdfMetadata: {
      fileName: 'previous.pdf',
      mimeType: 'application/pdf',
    },
  });
  const nextState = projectReducer(previousState, {
    type: PROJECT_ACTIONS.RESET_PROJECT,
    pdfMetadata: {
      fileName: 'next.pdf',
      mimeType: 'application/pdf',
    },
  });

  assert.deepEqual(nextState, createInitialProjectState({
    pdfMetadata: {
      fileName: 'next.pdf',
      mimeType: 'application/pdf',
    },
  }));
});
