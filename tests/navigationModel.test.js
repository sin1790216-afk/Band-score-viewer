import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addNavigationEnding,
  addRepeatSection,
  buildNavigationModel,
  setPointNavigationMarker,
  updateNavigationEndingRange,
  updateRepeatSectionRange,
} from '../src/utils/navigationModel.js';
import {
  collectNavigationEndings,
  NAVIGATION_SOURCE_TYPES,
} from '../src/utils/navigationEndings.js';
import {
  hasNavigationMarker,
  NAVIGATION_MARKER_TYPES,
} from '../src/utils/navigationMarkers.js';

function createMeasures(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index + 1}`,
    navigationEndings: [],
    navigationMarkers: [],
  }));
}

test('numeric repeat editing and selected-marker state share the same measure source', () => {
  let measures = addRepeatSection(createMeasures(8), 3, 4);
  let model = buildNavigationModel(measures);

  assert.equal(model.repeatSections[0].startIndex, 2);
  assert.equal(model.repeatSections[0].endIndex, 3);
  assert.equal(
    hasNavigationMarker(measures[2], NAVIGATION_MARKER_TYPES.REPEAT_START),
    true,
  );

  measures = updateRepeatSectionRange(measures, model.repeatSections[0], 2, 5);
  model = buildNavigationModel(measures);

  assert.equal(model.repeatSections[0].startIndex, 1);
  assert.equal(model.repeatSections[0].endIndex, 4);
  assert.equal(
    hasNavigationMarker(measures[2], NAVIGATION_MARKER_TYPES.REPEAT_START),
    false,
  );
});

test('generic endings use stable IDs, range endpoints, pass arrays, and provenance', () => {
  let measures = addRepeatSection(createMeasures(8), 3, 4);
  let section = buildNavigationModel(measures).repeatSections[0];

  measures = addNavigationEnding(measures, section);
  section = buildNavigationModel(measures).repeatSections[0];
  measures = addNavigationEnding(measures, section);
  const endings = collectNavigationEndings(measures);

  assert.deepEqual(endings.map((ending) => ending.passes), [[1], [2]]);
  assert.deepEqual(
    endings.map(({ confidence, source }) => ({ confidence, source })),
    [
      { confidence: 1, source: NAVIGATION_SOURCE_TYPES.MANUAL },
      { confidence: 1, source: NAVIGATION_SOURCE_TYPES.MANUAL },
    ],
  );
  assert.equal(endings[0].repeatStartMeasureId, 'm3');
  assert.equal(endings[0].repeatEndMeasureId, 'm4');

  measures = updateNavigationEndingRange(measures, endings[0].id, 4, 6);
  const [updatedEnding] = collectNavigationEndings(measures);

  assert.equal(updatedEnding.startMeasureId, 'm4');
  assert.equal(updatedEnding.endMeasureId, 'm6');
});

test('multiple repeat sections keep their endings associated independently', () => {
  let measures = addRepeatSection(createMeasures(12), 2, 3);

  measures = addRepeatSection(measures, 7, 8);
  let model = buildNavigationModel(measures);

  measures = addNavigationEnding(measures, model.repeatSections[0]);
  model = buildNavigationModel(measures);
  measures = addNavigationEnding(measures, model.repeatSections[1]);
  model = buildNavigationModel(measures);

  assert.equal(model.repeatSections.length, 2);
  assert.equal(model.repeatSections[0].endings.length, 1);
  assert.equal(model.repeatSections[1].endings.length, 1);
  assert.notEqual(
    model.repeatSections[0].endings[0].repeatStartMeasureId,
    model.repeatSections[1].endings[0].repeatStartMeasureId,
  );
});

test('Segno and D.S. numeric inputs replace only their own point marker', () => {
  let measures = createMeasures(8);

  measures = setPointNavigationMarker(
    measures,
    NAVIGATION_MARKER_TYPES.SEGNO,
    6,
  );
  measures = setPointNavigationMarker(
    measures,
    NAVIGATION_MARKER_TYPES.DAL_SEGNO,
    8,
  );

  assert.equal(hasNavigationMarker(measures[5], NAVIGATION_MARKER_TYPES.SEGNO), true);
  assert.equal(
    hasNavigationMarker(measures[7], NAVIGATION_MARKER_TYPES.DAL_SEGNO),
    true,
  );
});
