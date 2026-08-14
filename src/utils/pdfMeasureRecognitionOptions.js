export const PDF_MEASURE_RECOGNITION_DOCUMENT_OPTIONS = Object.freeze({
  disableFontFace: true,
});

export function createPdfMeasureRecognitionDocumentParams(arrayBuffer) {
  return {
    ...PDF_MEASURE_RECOGNITION_DOCUMENT_OPTIONS,
    data: new Uint8Array(arrayBuffer),
  };
}
