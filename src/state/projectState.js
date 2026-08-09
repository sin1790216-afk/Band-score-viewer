import { normalizeMeasureCoordinates } from '../utils/measureCoordinates.js';
import {
  ensureUniqueMeasureIds,
  isValidMeasureId,
} from '../utils/measureIdentity.js';

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
  REPLACE_PROJECT: 'project/replace-project',
  REPLACE_MEASURES: 'project/replace-measures',
  RESET_PROJECT: 'project/reset-project',
  RESET_MEASURES: 'project/reset-measures',
  SET_PDF_FILE_NAME: 'project/set-pdf-file-name',
  SET_PDF_METADATA: 'project/set-pdf-metadata',
  SET_PROJECT_METADATA: 'project/set-project-metadata',
  UPDATE_MEASURE: 'project/update-measure',
};

export const INITIAL_PROJECT_STATE = {
  metadata: {
    createdAt: '',
    title: '',
    updatedAt: '',
  },
  measures: [],
  pdfMetadata: {
    fileName: '',
    mimeType: 'application/pdf',
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

export function prepareMeasuresForProject(nextMeasures, options) {
  return ensureUniqueMeasureIds(normalizeMeasures(nextMeasures), options);
}

export function createProjectMeasure(measure, options) {
  return prepareMeasuresForProject([measure], options)[0] || null;
}

export function createInitialProjectState(initialState = {}) {
  return {
    metadata: {
      ...INITIAL_PROJECT_STATE.metadata,
      ...initialState.metadata,
    },
    measures: normalizeMeasures(initialState.measures),
    pdfMetadata: {
      ...INITIAL_PROJECT_STATE.pdfMetadata,
      ...initialState.pdfMetadata,
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
    case PROJECT_ACTIONS.REPLACE_PROJECT:
      return createInitialProjectState(action.projectState);

    case PROJECT_ACTIONS.RESET_PROJECT:
      return createInitialProjectState({
        pdfMetadata: action.pdfMetadata,
      });

    case PROJECT_ACTIONS.SET_PROJECT_METADATA:
      return {
        ...state,
        metadata: {
          ...state.metadata,
          ...action.metadata,
        },
      };

    case PROJECT_ACTIONS.SET_PDF_METADATA:
      return {
        ...state,
        pdfMetadata: {
          ...state.pdfMetadata,
          ...action.pdfMetadata,
        },
      };

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
      if (
        !isValidMeasureId(action.measure?.id) ||
        state.measures.some((measure) => measure.id === action.measure.id)
      ) {
        return state;
      }

      return replaceMeasures(state, [...state.measures, action.measure]);

    case PROJECT_ACTIONS.UPDATE_MEASURE:
      if (!state.measures[action.index]) return state;

      {
        const measureChanges = { ...action.changes };

        delete measureChanges.id;

        return replaceMeasures(
          state,
          state.measures.map((measure, index) =>
            index === action.index
              ? {
                  ...measure,
                  ...measureChanges,
                  id: measure.id,
                }
              : measure,
          ),
        );
      }

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

export function importMeasuresJson(jsonText, options) {
  return prepareMeasuresForProject(JSON.parse(jsonText), options);
}

export function exportMeasuresJson(measures) {
  return JSON.stringify(measures, null, 2);
}
