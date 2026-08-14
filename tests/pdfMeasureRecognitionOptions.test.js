import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPdfMeasureRecognitionDocumentParams,
  PDF_MEASURE_RECOGNITION_DOCUMENT_OPTIONS,
} from '../src/utils/pdfMeasureRecognitionOptions.js';

test('production PDF 마디 인식은 진단 경로와 같은 font-face 비활성 옵션을 사용한다', () => {
  const source = Uint8Array.from([1, 2, 3, 4]);
  const params = createPdfMeasureRecognitionDocumentParams(source.buffer);

  assert.deepEqual(PDF_MEASURE_RECOGNITION_DOCUMENT_OPTIONS, {
    disableFontFace: true,
  });
  assert.equal(params.disableFontFace, true);
  assert.deepEqual([...params.data], [...source]);
});
