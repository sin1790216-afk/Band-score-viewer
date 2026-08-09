const MEASURE_ID_PREFIX = 'measure-';
const MAX_ID_GENERATION_ATTEMPTS = 100;

let fallbackMeasureIdCounter = 0;

export function isValidMeasureId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function createMeasureId() {
  const cryptoObject = globalThis.crypto;

  if (typeof cryptoObject?.randomUUID === 'function') {
    return `${MEASURE_ID_PREFIX}${cryptoObject.randomUUID()}`;
  }

  if (typeof cryptoObject?.getRandomValues === 'function') {
    const values = new Uint32Array(4);

    cryptoObject.getRandomValues(values);
    return `${MEASURE_ID_PREFIX}${Array.from(values, (value) => value.toString(36)).join('-')}`;
  }

  fallbackMeasureIdCounter += 1;
  return `${MEASURE_ID_PREFIX}${Date.now().toString(36)}-${fallbackMeasureIdCounter.toString(36)}`;
}

function createUnusedMeasureId(createId, usedIds) {
  for (let attempt = 0; attempt < MAX_ID_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = createId();

    if (isValidMeasureId(candidate) && !usedIds.has(candidate)) {
      return candidate;
    }
  }

  throw new Error('고유한 measure ID를 생성할 수 없습니다.');
}

export function ensureUniqueMeasureIds(
  measures,
  { createId = createMeasureId } = {},
) {
  if (!Array.isArray(measures)) return [];

  const firstIndexById = new Map();

  measures.forEach((measure, index) => {
    if (isValidMeasureId(measure?.id) && !firstIndexById.has(measure.id)) {
      firstIndexById.set(measure.id, index);
    }
  });

  const usedIds = new Set(firstIndexById.keys());

  return measures.map((measure, index) => {
    const currentId = measure?.id;
    const nextId =
      isValidMeasureId(currentId) && firstIndexById.get(currentId) === index
        ? currentId
        : createUnusedMeasureId(createId, usedIds);

    usedIds.add(nextId);

    return currentId === nextId
      ? measure
      : {
          ...measure,
          id: nextId,
        };
  });
}
