import { pdfjs } from 'react-pdf';

import { recognizePdfLoadingTaskPages } from './measureRecognition.js';
import { createPdfMeasureRecognitionDocumentParams } from './pdfMeasureRecognitionOptions.js';

pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

export async function recognizeMeasuresInPdf(
  pdfBlob,
  { onPageDiagnostics, onProgress, recognitionOptions } = {},
) {
  if (!(pdfBlob instanceof Blob)) {
    throw new Error('마디를 인식할 PDF가 없습니다.');
  }

  const loadingTask = pdfjs.getDocument(
    createPdfMeasureRecognitionDocumentParams(await pdfBlob.arrayBuffer()),
  );

  return recognizePdfLoadingTaskPages(loadingTask, {
    createCanvas: () => document.createElement('canvas'),
    onPageDiagnostics,
    onProgress,
    recognitionOptions,
  });
}
