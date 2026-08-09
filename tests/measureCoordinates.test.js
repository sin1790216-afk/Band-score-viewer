import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canonicalToRenderRect,
  isCanonicalMeasure,
  LEGACY_COORDINATE_STATUS,
  NORMALIZED_COORDINATE_SPACE,
  NORMALIZED_COORDINATE_STATUS,
  normalizeMeasureCoordinates,
  renderPointToCanonical,
} from '../src/utils/measureCoordinates.js';

async function readFixture(fileName) {
  const fixtureUrl = new URL(`./fixtures/${fileName}`, import.meta.url);

  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

function assertClose(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
}

test('explicit coordinate metadata converts to normalized page coordinates once', async () => {
  const measures = await readFixture('measures-explicit-basis.json');
  const [firstMeasure] = normalizeMeasureCoordinates(measures);

  assert.equal(firstMeasure.coordinateSpace, NORMALIZED_COORDINATE_SPACE);
  assert.equal(firstMeasure.coordinateStatus, NORMALIZED_COORDINATE_STATUS);
  assert.equal(firstMeasure.coordinateWidth, 1);
  assert.equal(firstMeasure.coordinateHeight, 1);
  assertClose(firstMeasure.x, 0.1);
  assertClose(firstMeasure.y, 0.1);
  assertClose(firstMeasure.width, 0.3);
  assertClose(firstMeasure.height, 80 / 600);
  assert.equal(firstMeasure.lyric, '첫 번째 마디');
});

test('normalizing an already canonical measure is idempotent', async () => {
  const measures = await readFixture('measures-explicit-basis.json');
  const normalizedMeasures = normalizeMeasureCoordinates(measures);

  assert.deepEqual(normalizeMeasureCoordinates(normalizedMeasures), normalizedMeasures);
  assert.ok(normalizedMeasures.every(isCanonicalMeasure));
});

test('coordinate normalization preserves an existing stable measure ID', () => {
  const [measure] = normalizeMeasureCoordinates([
    {
      coordinateHeight: 600,
      coordinateWidth: 400,
      height: 80,
      id: 'measure-coordinate-1',
      page: 1,
      width: 120,
      x: 40,
      y: 60,
    },
  ]);

  assert.equal(measure.id, 'measure-coordinate-1');
});

test('legacy measures use a deterministic data-only basis and stay explicitly unverified', async () => {
  const measures = await readFixture('measures-legacy-no-basis.json');
  const normalizedMeasures = normalizeMeasureCoordinates(measures);
  const firstMeasure = normalizedMeasures[0];

  assert.equal(firstMeasure.coordinateStatus, LEGACY_COORDINATE_STATUS);
  assert.equal(firstMeasure.legacyCoordinateWidth, 340);
  assert.equal(firstMeasure.legacyCoordinateHeight, 390);
  assert.equal(firstMeasure.legacyCoordinateSource, 'legacy-bounds');
  assertClose(firstMeasure.x, 40 / 340);
  assertClose(firstMeasure.y, 60 / 390);
  assertClose(firstMeasure.width, 120 / 340);
  assertClose(firstMeasure.height, 80 / 390);
});

test('a consistent explicit page basis is reused for metadata-free measures', () => {
  const [explicitMeasure, legacyMeasure] = normalizeMeasureCoordinates([
    {
      coordinateHeight: 600,
      coordinateWidth: 400,
      height: 80,
      page: 1,
      width: 120,
      x: 40,
      y: 60,
    },
    {
      height: 90,
      page: 1,
      width: 140,
      x: 200,
      y: 300,
    },
  ]);

  assert.equal(explicitMeasure.coordinateStatus, NORMALIZED_COORDINATE_STATUS);
  assert.equal(legacyMeasure.coordinateStatus, LEGACY_COORDINATE_STATUS);
  assert.equal(legacyMeasure.legacyCoordinateSource, 'page-explicit-basis');
  assertClose(legacyMeasure.x, 0.5);
  assertClose(legacyMeasure.y, 0.5);
});

test('canonical coordinates render proportionally on different local surfaces', async () => {
  const measures = await readFixture('measures-explicit-basis.json');
  const [firstMeasure] = normalizeMeasureCoordinates(measures);
  const largeRect = canonicalToRenderRect(firstMeasure, { width: 800, height: 1200 });
  const smallRect = canonicalToRenderRect(firstMeasure, { width: 200, height: 300 });

  assert.deepEqual(
    {
      height: largeRect.height,
      left: largeRect.left,
      top: largeRect.top,
      width: largeRect.width,
    },
    { height: 160, left: 80, top: 120, width: 240 },
  );
  assert.deepEqual(
    {
      height: smallRect.height,
      left: smallRect.left,
      top: smallRect.top,
      width: smallRect.width,
    },
    { height: 40, left: 20, top: 30, width: 60 },
  );
});

test('pointer pixels convert to canonical coordinates using only the local surface', () => {
  assert.deepEqual(
    renderPointToCanonical(250, 350, {
      height: 600,
      left: 50,
      top: 50,
      width: 400,
    }),
    { x: 0.5, y: 0.5 },
  );
});
