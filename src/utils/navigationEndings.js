import { isValidMeasureId } from './measureIdentity.js';

export const NAVIGATION_ENDING_TYPE = 'volta';
export const NAVIGATION_SOURCE_TYPES = Object.freeze({
  DETECTED: 'detected',
  IMPORTED: 'imported',
  MANUAL: 'manual',
});

const VALID_NAVIGATION_SOURCES = new Set(Object.values(NAVIGATION_SOURCE_TYPES));
const NAVIGATION_ENDING_ID_PREFIX = 'ending-';
let fallbackEndingIdCounter = 0;

function normalizePasses(passes) {
  if (!Array.isArray(passes)) return [];

  return [...new Set(
    passes
      .map(Number)
      .filter((pass) => Number.isSafeInteger(pass) && pass > 0),
  )].sort((left, right) => left - right);
}

export function createNavigationEndingId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${NAVIGATION_ENDING_ID_PREFIX}${globalThis.crypto.randomUUID()}`;
  }

  fallbackEndingIdCounter += 1;
  return `${NAVIGATION_ENDING_ID_PREFIX}${Date.now().toString(36)}-${fallbackEndingIdCounter.toString(36)}`;
}

export function normalizeNavigationEndings(endings) {
  if (!Array.isArray(endings)) return [];

  const seenIds = new Set();

  return endings.flatMap((ending) => {
    if (!ending || typeof ending !== 'object' || Array.isArray(ending)) return [];

    const passes = normalizePasses(ending.passes);

    const explicitEndMeasureId = isValidMeasureId(ending.explicitEndMeasureId)
      ? ending.explicitEndMeasureId
      : isValidMeasureId(ending.endMeasureId)
        ? ending.endMeasureId
        : null;

    if (
      typeof ending.id !== 'string' ||
      ending.id.trim().length === 0 ||
      seenIds.has(ending.id) ||
      ending.type !== NAVIGATION_ENDING_TYPE ||
      !isValidMeasureId(ending.startMeasureId) ||
      !isValidMeasureId(ending.repeatStartMeasureId) ||
      !isValidMeasureId(ending.repeatEndMeasureId) ||
      passes.length === 0
    ) {
      return [];
    }

    const source = VALID_NAVIGATION_SOURCES.has(ending.source)
      ? ending.source
      : NAVIGATION_SOURCE_TYPES.MANUAL;
    const confidence = Number(ending.confidence);
    const normalizedEnding = {
      id: ending.id,
      type: NAVIGATION_ENDING_TYPE,
      startMeasureId: ending.startMeasureId,
      passes,
      repeatStartMeasureId: ending.repeatStartMeasureId,
      repeatEndMeasureId: ending.repeatEndMeasureId,
      source,
      confidence:
        Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
          ? confidence
          : 1,
      ...(explicitEndMeasureId ? { explicitEndMeasureId } : {}),
    };

    seenIds.add(normalizedEnding.id);
    return [normalizedEnding];
  });
}

export function isValidNavigationEndings(endings, { allowMissing = true } = {}) {
  if (endings === undefined && allowMissing) return true;
  if (!Array.isArray(endings)) return false;

  const normalizedEndings = normalizeNavigationEndings(endings);

  return (
    normalizedEndings.length === endings.length &&
    endings.every((ending) =>
      (
        ending !== null &&
        typeof ending === 'object' &&
        !Array.isArray(ending) &&
        Object.keys(ending).every((key) =>
          [
            'confidence',
            'endMeasureId',
            'explicitEndMeasureId',
            'id',
            'passes',
            'repeatEndMeasureId',
            'repeatStartMeasureId',
            'source',
            'startMeasureId',
            'type',
          ].includes(key),
        ) &&
        (ending.endMeasureId === undefined || isValidMeasureId(ending.endMeasureId)) &&
        (ending.explicitEndMeasureId === undefined ||
          isValidMeasureId(ending.explicitEndMeasureId)) &&
        (ending.endMeasureId === undefined ||
          ending.explicitEndMeasureId === undefined ||
          ending.endMeasureId === ending.explicitEndMeasureId) &&
        (ending.source === undefined || VALID_NAVIGATION_SOURCES.has(ending.source)) &&
        (ending.confidence === undefined ||
          (Number.isFinite(Number(ending.confidence)) &&
            Number(ending.confidence) >= 0 &&
            Number(ending.confidence) <= 1)) &&
        JSON.stringify(ending.passes) === JSON.stringify(normalizePasses(ending.passes))
      )
    )
  );
}

export function collectNavigationEndings(measures) {
  const endings = (Array.isArray(measures) ? measures : []).flatMap((measure) =>
    normalizeNavigationEndings(measure?.navigationEndings),
  );

  return normalizeNavigationEndings(endings);
}

export function attachNavigationEndings(measures, endings) {
  const normalizedEndings = normalizeNavigationEndings(endings);
  const endingsByOwnerId = new Map();

  normalizedEndings.forEach((ending) => {
    const ownerEndings = endingsByOwnerId.get(ending.repeatStartMeasureId) || [];

    ownerEndings.push(ending);
    endingsByOwnerId.set(ending.repeatStartMeasureId, ownerEndings);
  });

  return (Array.isArray(measures) ? measures : []).map((measure) => ({
    ...measure,
    navigationEndings: endingsByOwnerId.get(measure.id) || [],
  }));
}

export function createManualNavigationEnding({
  explicitEndMeasureId,
  id = createNavigationEndingId(),
  pass,
  passes,
  repeatEndMeasureId,
  repeatStartMeasureId,
  startMeasureId,
}) {
  return normalizeNavigationEndings([
    {
      confidence: 1,
      ...(explicitEndMeasureId ? { explicitEndMeasureId } : {}),
      id,
      passes: Array.isArray(passes) ? passes : [pass],
      repeatEndMeasureId,
      repeatStartMeasureId,
      source: NAVIGATION_SOURCE_TYPES.MANUAL,
      startMeasureId,
      type: NAVIGATION_ENDING_TYPE,
    },
  ])[0] || null;
}

export function deriveNavigationEndingRanges({
  endings,
  measureIndexById,
  repeatEndIndex,
}) {
  const anchors = normalizeNavigationEndings(endings)
    .map((ending) => ({
      ending,
      explicitEndIndex: ending.explicitEndMeasureId
        ? measureIndexById.get(ending.explicitEndMeasureId)
        : null,
      startIndex: measureIndexById.get(ending.startMeasureId),
    }))
    .sort((left, right) => {
      if (!Number.isInteger(left.startIndex)) return 1;
      if (!Number.isInteger(right.startIndex)) return -1;
      return left.startIndex - right.startIndex;
    });

  return anchors.map((anchor, index) => {
    const nextStartIndex = anchors[index + 1]?.startIndex;
    let endIndex = anchor.startIndex;
    let rangeSource = 'point';

    if (Number.isInteger(anchor.explicitEndIndex)) {
      endIndex = anchor.explicitEndIndex;
      rangeSource = 'explicit';
    } else if (
      Number.isInteger(anchor.startIndex) &&
      anchor.startIndex <= repeatEndIndex
    ) {
      endIndex = repeatEndIndex;
      rangeSource = 'repeat-end';
    } else if (
      Number.isInteger(anchor.startIndex) &&
      Number.isInteger(nextStartIndex) &&
      nextStartIndex > anchor.startIndex
    ) {
      endIndex = nextStartIndex - 1;
      rangeSource = 'next-anchor';
    }

    return {
      ...anchor.ending,
      endIndex,
      rangeSource,
      startIndex: anchor.startIndex,
    };
  });
}

export function getNavigationEndingLabel(ending) {
  return `${normalizePasses(ending?.passes).join(',')}.`;
}
