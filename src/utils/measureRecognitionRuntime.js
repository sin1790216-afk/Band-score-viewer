import {
  DEFAULT_MEASURE,
  prepareMeasuresForProject,
} from '../state/projectState.js';
import {
  NORMALIZED_COORDINATE_SPACE,
  NORMALIZED_COORDINATE_STATUS,
} from './measureCoordinates.js';

export function countMeasuresByPage(measures) {
  return (Array.isArray(measures) ? measures : []).reduce((counts, measure) => {
    const page = Number(measure?.page) || 1;

    counts[page] = (counts[page] || 0) + 1;
    return counts;
  }, {});
}

export function prepareRecognizedMeasures(candidates, bpm) {
  return prepareMeasuresForProject(
    (Array.isArray(candidates) ? candidates : []).map((candidate) => ({
      ...DEFAULT_MEASURE,
      bpm,
      ...candidate,
      coordinateHeight: 1,
      coordinateSpace: NORMALIZED_COORDINATE_SPACE,
      coordinateStatus: NORMALIZED_COORDINATE_STATUS,
      coordinateWidth: 1,
    })),
  );
}

export function isCurrentMeasureRecognitionResult({
  currentPdfBlob,
  currentVersion,
  requestedPdfBlob,
  requestedVersion,
}) {
  return (
    currentVersion === requestedVersion && currentPdfBlob === requestedPdfBlob
  );
}

export function createMeasureRecognitionRuntimeDiagnostics({
  appliedMeasures,
  fileName,
  pageDiagnostics,
  recognizedMeasures,
}) {
  return {
    appliedByPage: countMeasuresByPage(appliedMeasures),
    appliedTotal: appliedMeasures.length,
    fileName,
    pages: pageDiagnostics,
    recognizedByPage: countMeasuresByPage(recognizedMeasures),
    recognizedTotal: recognizedMeasures.length,
  };
}
