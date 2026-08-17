import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';

import {
  isValidMeasuresState,
  MAX_MEASURES,
  resolveStaticRequest,
  validatePdfState,
} from '../src/utils/serverSecurity.js';

test('static requests stay inside the dist directory and ignore query strings', () => {
  const distDirectory = resolve('/tmp/band-score-viewer-dist');
  const asset = resolveStaticRequest(distDirectory, '/assets/app.js?v=1');

  assert.equal(asset.filePath, resolve(distDirectory, 'assets/app.js'));
  assert.equal(asset.requestPath, '/assets/app.js');
  assert.equal(
    resolveStaticRequest(distDirectory, '/..%2Fserver.js'),
    null,
  );
  assert.equal(resolveStaticRequest(distDirectory, '/%E0%A4%A'), null);
});

test('PDF socket state accepts valid PDF bytes and rejects malformed payloads', () => {
  const validPdf = validatePdfState({
    data: Buffer.from('%PDF-1.4\n%%EOF'),
    fileName: 'lesson.pdf',
    type: 'application/pdf',
  });

  assert.equal(validPdf.fileName, 'lesson.pdf');
  assert.equal(validPdf.type, 'application/pdf');
  assert.equal(validatePdfState(null), null);
  assert.equal(
    validatePdfState({
      data: Buffer.from('not a PDF'),
      fileName: 'lesson.pdf',
      type: 'application/pdf',
    }),
    null,
  );
});

test('measures socket state accepts only bounded arrays of measure objects', () => {
  assert.equal(isValidMeasuresState([]), true);
  assert.equal(isValidMeasuresState([{ page: 1, x: 0, y: 0 }]), true);
  assert.equal(
    isValidMeasuresState([
      { navigationMarkers: [{ type: 'repeat-start' }], page: 1, x: 0, y: 0 },
    ]),
    true,
  );
  assert.equal(
    isValidMeasuresState([
      {
        navigationEndings: [
          {
            confidence: 1,
            id: 'e-point',
            passes: [1],
            repeatEndMeasureId: 'm2',
            repeatStartMeasureId: 'm1',
            source: 'manual',
            startMeasureId: 'm2',
            type: 'volta',
          },
        ],
        page: 1,
        x: 0,
        y: 0,
      },
    ]),
    true,
  );
  assert.equal(
    isValidMeasuresState([
      { navigationMarkers: [{ type: 'invalid' }], page: 1, x: 0, y: 0 },
    ]),
    false,
  );
  assert.equal(
    isValidMeasuresState([
      {
        navigationEndings: [
          {
            confidence: 1,
            endMeasureId: 'm2',
            id: 'e1',
            passes: [1],
            repeatEndMeasureId: 'm2',
            repeatStartMeasureId: 'm1',
            source: 'manual',
            startMeasureId: 'm2',
            type: 'volta',
          },
        ],
        page: 1,
        x: 0,
        y: 0,
      },
    ]),
    true,
  );
  assert.equal(isValidMeasuresState(null), false);
  assert.equal(isValidMeasuresState([null]), false);
  assert.equal(isValidMeasuresState(new Array(MAX_MEASURES + 1).fill({})), false);
});
