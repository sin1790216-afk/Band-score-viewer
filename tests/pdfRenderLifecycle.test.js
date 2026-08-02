import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPageLoadIdentity,
  getSurfaceIdentity,
  getTargetPageNumber,
  isReadySurface,
} from '../src/utils/pdfRenderLifecycle.js';

const baseSurfaceRequest = {
  pageNumber: 2,
  pdfIdentity: 'blob:score-a',
  renderResetVersion: 1,
  renderWidth: 600,
  studentPdfSource: 'teacher',
  studentViewMode: 'zoom',
  viewerMode: 'student',
};

test('the requested page is preserved until the document page count is known', () => {
  assert.equal(getTargetPageNumber(3, 0), 3);
  assert.equal(getTargetPageNumber(3, 2), 2);
  assert.equal(getTargetPageNumber(0, 4), 1);
});

test('page load identity changes with the PDF or target page', () => {
  assert.notEqual(
    getPageLoadIdentity('blob:score-a', 1),
    getPageLoadIdentity('blob:score-a', 2),
  );
  assert.notEqual(
    getPageLoadIdentity('blob:score-a', 1),
    getPageLoadIdentity('blob:score-b', 1),
  );
});

test('surface identity changes for every render-cycle input', () => {
  const baseIdentity = getSurfaceIdentity(baseSurfaceRequest);

  for (const override of [
    { pageNumber: 1 },
    { pdfIdentity: 'blob:score-b' },
    { renderResetVersion: 2 },
    { renderWidth: 601 },
    { studentPdfSource: 'local' },
    { studentViewMode: 'page' },
    { viewerMode: 'teacher' },
  ]) {
    assert.notEqual(
      getSurfaceIdentity({ ...baseSurfaceRequest, ...override }),
      baseIdentity,
    );
  }
});

test('only the exact current render surface is ready for overlays', () => {
  const identity = getSurfaceIdentity(baseSurfaceRequest);
  const readySurface = {
    height: 900,
    identity,
    pageNumber: 2,
    width: 600,
  };

  assert.equal(isReadySurface(readySurface, identity, 2), true);
  assert.equal(isReadySurface(readySurface, `${identity}-stale`, 2), false);
  assert.equal(isReadySurface(readySurface, identity, 1), false);
  assert.equal(isReadySurface({ ...readySurface, width: 0 }, identity, 2), false);
});
