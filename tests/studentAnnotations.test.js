import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampStudentAnnotationPageNumber,
  createStudentAnnotationDocumentKey,
  getStudentAnnotationStrokes,
  loadStudentAnnotationLibrary,
  normalizeStudentAnnotationStroke,
  removeLastStudentAnnotationStroke,
  removeStudentAnnotationPage,
  saveStudentAnnotationLibrary,
  setStudentAnnotationStrokes,
  STUDENT_ANNOTATIONS_STORAGE_KEY,
  STUDENT_ANNOTATION_PALETTE,
} from '../src/utils/studentAnnotations.js';

function createMemoryStorage(initialValue = null) {
  const values = new Map();

  if (initialValue !== null) {
    values.set(STUDENT_ANNOTATIONS_STORAGE_KEY, initialValue);
  }

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test('annotation document keys separate teacher and local PDF files', () => {
  const teacherKey = createStudentAnnotationDocumentKey({
    byteLength: 100,
    fileName: 'lesson.pdf',
    source: 'teacher',
  });
  const localKey = createStudentAnnotationDocumentKey({
    byteLength: 100,
    fileName: 'lesson.pdf',
    lastModified: 200,
    source: 'local',
  });

  assert.notEqual(teacherKey, localKey);
  assert.equal(
    teacherKey,
    createStudentAnnotationDocumentKey({
      byteLength: 100,
      fileName: 'lesson.pdf',
      lastModified: 999,
      source: 'teacher',
    }),
  );
});

test('annotation tools expose three extensible colors and clamp local pages', () => {
  assert.deepEqual(
    STUDENT_ANNOTATION_PALETTE.map(({ value }) => value),
    ['#d62828', '#111111', '#1769e0'],
  );
  assert.equal(clampStudentAnnotationPageNumber(2, 5), 2);
  assert.equal(clampStudentAnnotationPageNumber(10, 5), 5);
  assert.equal(clampStudentAnnotationPageNumber(0, 5), 1);
  assert.equal(clampStudentAnnotationPageNumber(3, 0), 3);
});

test('annotation strokes keep normalized points and reject invalid pages', () => {
  const stroke = normalizeStudentAnnotationStroke({
    color: '#123abc',
    id: 'stroke-1',
    page: 2,
    points: [
      { x: -1, y: 0.25 },
      { x: 0.75, y: 2 },
    ],
    width: 20,
  });

  assert.deepEqual(stroke, {
    color: '#123abc',
    id: 'stroke-1',
    page: 2,
    points: [
      { x: 0, y: 0.25 },
      { x: 0.75, y: 1 },
    ],
    width: 12,
  });
  assert.equal(
    normalizeStudentAnnotationStroke({ page: 0, points: [{ x: 0, y: 0 }] }),
    null,
  );
});

test('annotation library round-trips through local storage and survives bad data', () => {
  const storage = createMemoryStorage();
  const documentKey = 'teacher:lesson.pdf:100';
  const stroke = {
    color: '#d62828',
    id: 'stroke-1',
    page: 1,
    points: [{ x: 0.1, y: 0.2 }],
    width: 3,
  };
  const library = setStudentAnnotationStrokes(null, documentKey, [stroke]);

  assert.equal(saveStudentAnnotationLibrary(storage, library), true);
  assert.deepEqual(
    getStudentAnnotationStrokes(
      loadStudentAnnotationLibrary(storage),
      documentKey,
    ),
    [stroke],
  );
  assert.deepEqual(
    loadStudentAnnotationLibrary(createMemoryStorage('{bad json')),
    { documents: {}, version: 1 },
  );
});

test('undo and clear affect only strokes on the selected page', () => {
  const strokes = [
    { id: 'page-1-a', page: 1 },
    { id: 'page-2', page: 2 },
    { id: 'page-1-b', page: 1 },
  ];

  assert.deepEqual(
    removeLastStudentAnnotationStroke(strokes, 1).map(({ id }) => id),
    ['page-1-a', 'page-2'],
  );
  assert.deepEqual(
    removeStudentAnnotationPage(strokes, 1).map(({ id }) => id),
    ['page-2'],
  );
});
