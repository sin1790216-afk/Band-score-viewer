export const STUDENT_ANNOTATIONS_STORAGE_KEY =
  'band-score-viewer.student-annotations.v1';
export const STUDENT_ANNOTATIONS_VERSION = 1;
export const MAX_ANNOTATION_STROKES = 2_000;
export const MAX_ANNOTATION_POINTS = 2_000;
export const STUDENT_ANNOTATION_PALETTE = [
  { label: '빨강', value: '#d62828' },
  { label: '검정', value: '#111111' },
  { label: '파랑', value: '#1769e0' },
];

const DEFAULT_STROKE_COLOR = '#d62828';
const DEFAULT_STROKE_WIDTH = 3;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function clampStudentAnnotationPageNumber(pageNumber, totalPages) {
  const safePageNumber = Math.max(Math.trunc(Number(pageNumber)) || 1, 1);
  const safeTotalPages = Math.max(Math.trunc(Number(totalPages)) || 0, 0);

  return safeTotalPages > 0
    ? Math.min(safePageNumber, safeTotalPages)
    : safePageNumber;
}

function normalizePoint(point) {
  const x = Number(point?.x);
  const y = Number(point?.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
  };
}

export function normalizeStudentAnnotationStroke(stroke) {
  const page = Number(stroke?.page);
  const points = Array.isArray(stroke?.points)
    ? stroke.points
        .slice(0, MAX_ANNOTATION_POINTS)
        .map(normalizePoint)
        .filter(Boolean)
    : [];

  if (!Number.isSafeInteger(page) || page < 1 || points.length === 0) {
    return null;
  }

  const color = /^#[0-9a-f]{6}$/i.test(stroke?.color)
    ? stroke.color
    : DEFAULT_STROKE_COLOR;
  const width = Number(stroke?.width);

  return {
    color,
    id:
      typeof stroke?.id === 'string' && stroke.id
        ? stroke.id.slice(0, 100)
        : createStudentAnnotationId(),
    page,
    points,
    width: Number.isFinite(width) ? clamp(width, 1, 12) : DEFAULT_STROKE_WIDTH,
  };
}

export function createStudentAnnotationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `annotation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createStudentAnnotationDocumentKey({
  byteLength,
  fileName,
  lastModified,
  source,
}) {
  if (!fileName || !source) return '';

  const parts = [source, fileName, Number(byteLength) || 0];

  if (source === 'local') {
    parts.push(Number(lastModified) || 0);
  }

  return parts.map((part) => encodeURIComponent(String(part))).join(':');
}

export function normalizeStudentAnnotationLibrary(value) {
  const sourceDocuments =
    value?.version === STUDENT_ANNOTATIONS_VERSION &&
    value.documents &&
    typeof value.documents === 'object' &&
    !Array.isArray(value.documents)
      ? value.documents
      : {};
  const documents = {};

  Object.entries(sourceDocuments).forEach(([documentKey, strokes]) => {
    if (!documentKey || !Array.isArray(strokes)) return;

    documents[documentKey] = strokes
      .slice(-MAX_ANNOTATION_STROKES)
      .map(normalizeStudentAnnotationStroke)
      .filter(Boolean);
  });

  return {
    documents,
    version: STUDENT_ANNOTATIONS_VERSION,
  };
}

export function loadStudentAnnotationLibrary(storage) {
  if (!storage?.getItem) return normalizeStudentAnnotationLibrary(null);

  try {
    const storedValue = storage.getItem(STUDENT_ANNOTATIONS_STORAGE_KEY);

    return normalizeStudentAnnotationLibrary(
      storedValue ? JSON.parse(storedValue) : null,
    );
  } catch {
    return normalizeStudentAnnotationLibrary(null);
  }
}

export function saveStudentAnnotationLibrary(storage, library) {
  if (!storage?.setItem) return false;

  try {
    storage.setItem(
      STUDENT_ANNOTATIONS_STORAGE_KEY,
      JSON.stringify(normalizeStudentAnnotationLibrary(library)),
    );
    return true;
  } catch {
    return false;
  }
}

export function getStudentAnnotationStrokes(library, documentKey) {
  if (!documentKey) return [];

  return Array.isArray(library?.documents?.[documentKey])
    ? library.documents[documentKey]
    : [];
}

export function setStudentAnnotationStrokes(library, documentKey, strokes) {
  if (!documentKey) return normalizeStudentAnnotationLibrary(library);

  const normalizedLibrary = normalizeStudentAnnotationLibrary(library);
  const nextStrokes = Array.isArray(strokes)
    ? strokes
        .slice(-MAX_ANNOTATION_STROKES)
        .map(normalizeStudentAnnotationStroke)
        .filter(Boolean)
    : [];
  const documents = {
    ...normalizedLibrary.documents,
  };

  if (nextStrokes.length === 0) {
    delete documents[documentKey];
  } else {
    documents[documentKey] = nextStrokes;
  }

  return {
    documents,
    version: STUDENT_ANNOTATIONS_VERSION,
  };
}

export function removeLastStudentAnnotationStroke(strokes, pageNumber) {
  let lastPageStrokeIndex = -1;

  for (let index = strokes.length - 1; index >= 0; index -= 1) {
    if (strokes[index].page === pageNumber) {
      lastPageStrokeIndex = index;
      break;
    }
  }

  if (lastPageStrokeIndex < 0) return strokes;

  return strokes.filter((_, index) => index !== lastPageStrokeIndex);
}

export function removeStudentAnnotationPage(strokes, pageNumber) {
  return strokes.filter((stroke) => stroke.page !== pageNumber);
}
