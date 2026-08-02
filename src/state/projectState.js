import { normalizeMeasureCoordinates } from '../utils/measureCoordinates.js';

export const DEFAULT_MEASURE = {
  width: 140,
  height: 90,
  bpm: 120,
  beats: 4,
  lyric: '',
};

export const PROJECT_ACTIONS = {
  ADD_MEASURE: 'project/add-measure',
  DELETE_MEASURE: 'project/delete-measure',
  IMPORT_MEASURES: 'project/import-measures',
  REPLACE_MEASURES: 'project/replace-measures',
  RESET_MEASURES: 'project/reset-measures',
  SET_PDF_FILE_NAME: 'project/set-pdf-file-name',
  UPDATE_MEASURE: 'project/update-measure',
};

export const INITIAL_PROJECT_STATE = {
  measures: [],
  pdfMetadata: {
    fileName: '',
  },
};

export function getPositiveNumber(value, fallbackValue) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallbackValue;
}

export function normalizeMeasure(measure) {
  const nextMeasure = measure && typeof measure === 'object' ? measure : {};

  return {
    ...DEFAULT_MEASURE,
    ...nextMeasure,
    bpm: getPositiveNumber(nextMeasure.bpm, DEFAULT_MEASURE.bpm),
    beats: getPositiveNumber(nextMeasure.beats, DEFAULT_MEASURE.beats),
    lyric: typeof nextMeasure.lyric === 'string' ? nextMeasure.lyric : '',
  };
}

export function normalizeMeasures(nextMeasures) {
  const normalizedMeasures = Array.isArray(nextMeasures)
    ? nextMeasures.map(normalizeMeasure)
    : [];

  return normalizeMeasureCoordinates(normalizedMeasures);
}

export function createInitialProjectState(initialState = {}) {
  return {
    measures: normalizeMeasures(initialState.measures),
    pdfMetadata: {
      fileName: initialState.pdfMetadata?.fileName || '',
    },
  };
}

function replaceMeasures(state, nextMeasures) {
  return {
    ...state,
    measures: normalizeMeasures(nextMeasures),
  };
}

export function projectReducer(state, action) {
  switch (action.type) {
    case PROJECT_ACTIONS.SET_PDF_FILE_NAME:
      return {
        ...state,
        pdfMetadata: {
          ...state.pdfMetadata,
          fileName: action.fileName || '',
        },
      };

    case PROJECT_ACTIONS.RESET_MEASURES:
      return replaceMeasures(state, []);

    case PROJECT_ACTIONS.REPLACE_MEASURES:
    case PROJECT_ACTIONS.IMPORT_MEASURES:
      return replaceMeasures(state, action.measures);

    case PROJECT_ACTIONS.ADD_MEASURE:
      return replaceMeasures(state, [...state.measures, action.measure]);

    case PROJECT_ACTIONS.UPDATE_MEASURE:
      if (!state.measures[action.index]) return state;

      return replaceMeasures(
        state,
        state.measures.map((measure, index) =>
          index === action.index
            ? {
                ...measure,
                ...action.changes,
              }
            : measure,
        ),
      );

    case PROJECT_ACTIONS.DELETE_MEASURE:
      if (!state.measures[action.index]) return state;

      return replaceMeasures(
        state,
        state.measures.filter((_, index) => index !== action.index),
      );

    default:
      return state;
  }
}

export function importMeasuresJson(jsonText) {
  return normalizeMeasures(JSON.parse(jsonText));
}

export function exportMeasuresJson(measures) {
  return JSON.stringify(measures, null, 2);
}
