const CHORD_PATTERN = /^[A-G](?:#|b|♯|♭)?(?:(?:maj|min|dim|aug|sus|add|m|M)?\d*)?(?:\/[A-G](?:#|b|♯|♭)?)?$/i;
const BPM_PATTERN = /^(?:bpm\s*)?=?\s*\d+(?:\.\d+)?$/i;
const LETTER_PATTERN = /\p{L}/u;
const MEASURE_NUMBER_PATTERN = /^\d+[.)]?$/;
const NOTATION_GLYPH_PATTERN = /^[œŒjJqQwW\s]+$/;

function multiplyTransforms(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function normalizeChunk(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isLyricText(value) {
  const text = normalizeChunk(value);

  if (!text || !LETTER_PATTERN.test(text)) return false;
  if (
    MEASURE_NUMBER_PATTERN.test(text) ||
    BPM_PATTERN.test(text) ||
    NOTATION_GLYPH_PATTERN.test(text) ||
    CHORD_PATTERN.test(text)
  ) {
    return false;
  }
  return true;
}

function findSystemForMeasure(measure, systems) {
  const measureCenterY = measure.y + measure.height / 2;

  return systems.find(
    (system) =>
      measureCenterY >= system.contentTop &&
      measureCenterY <= system.contentBottom,
  );
}

function findMeasureForItem(item, measures) {
  const centerX = item.x + item.width / 2;

  return measures.find(
    (measure) => centerX >= measure.x && centerX <= measure.x + measure.width,
  );
}

function groupTextLines(items, staffSpacing) {
  const lines = [];

  [...items]
    .sort((left, right) => left.baselineY - right.baselineY || left.x - right.x)
    .forEach((item) => {
      const tolerance = Math.max(item.height * 0.5, staffSpacing * 0.4);
      const line = lines.find(
        (candidate) => Math.abs(candidate.baselineY - item.baselineY) <= tolerance,
      );

      if (line) {
        line.items.push(item);
        line.baselineY =
          line.items.reduce((sum, lineItem) => sum + lineItem.baselineY, 0) /
          line.items.length;
        return;
      }

      lines.push({ baselineY: item.baselineY, items: [item] });
    });

  return lines.sort((left, right) => left.baselineY - right.baselineY);
}

function joinLineItems(items) {
  return [...items]
    .sort((left, right) => left.x - right.x)
    .reduce((line, item, index, sortedItems) => {
      const text = normalizeChunk(item.text);

      if (index === 0) return text;

      const previous = sortedItems[index - 1];
      const gap = item.x - (previous.x + previous.width);
      const naturalWordGap = Math.max(previous.height, item.height) * 3;
      const separator = gap > naturalWordGap ? ' ' : '';

      return `${line}${separator}${text}`;
    }, '');
}

export function normalizePdfTextItems(textItems, viewport) {
  const viewportWidth = Number(viewport?.width) || 0;
  const viewportHeight = Number(viewport?.height) || 0;
  const viewportTransform = viewport?.transform;

  if (
    !Array.isArray(textItems) ||
    !Array.isArray(viewportTransform) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return [];
  }

  const viewportScale =
    Math.hypot(viewportTransform[0], viewportTransform[1]) || 1;

  return textItems.flatMap((item) => {
    if (!Array.isArray(item?.transform)) return [];

    const text = normalizeChunk(item.str);

    if (!text) return [];

    const transform = multiplyTransforms(viewportTransform, item.transform);
    const height = Math.hypot(transform[2], transform[3]);
    const width = Math.abs(Number(item.width) || 0) * viewportScale;

    if (height <= 0 || width < 0) return [];

    return [{
      baselineY: transform[5] / viewportHeight,
      height: height / viewportHeight,
      text,
      width: width / viewportWidth,
      x: transform[4] / viewportWidth,
      y: (transform[5] - height) / viewportHeight,
    }];
  });
}

export function createLyricCandidates({ measures, systems, textItems }) {
  if (
    !Array.isArray(measures) ||
    !Array.isArray(systems) ||
    !Array.isArray(textItems)
  ) {
    return [];
  }

  const candidates = [];

  systems.forEach((system) => {
    const systemMeasures = measures.filter(
      (measure) => findSystemForMeasure(measure, [system]) === system,
    );
    const lyricItems = textItems.filter((item) => {
      const centerX = item.x + item.width / 2;
      const minimumBaseline = system.staffBottom + system.staffSpacing * 0.35;

      return (
        isLyricText(item.text) &&
        centerX >= system.x &&
        centerX <= system.x + system.width &&
        item.baselineY >= minimumBaseline &&
        item.baselineY <= system.contentBottom
      );
    });

    systemMeasures.forEach((measure) => {
      const measureItems = lyricItems.filter(
        (item) => findMeasureForItem(item, systemMeasures) === measure,
      );
      const lyric = groupTextLines(measureItems, system.staffSpacing)
        .map((line) => joinLineItems(line.items))
        .filter(Boolean)
        .join('\n');

      if (!lyric) return;

      candidates.push({
        lyric,
        measureId: measure.id,
        measureIndex: measure.measureIndex,
        page: measure.page,
      });
    });
  });

  return candidates;
}

export function applyLyricCandidates(measures, candidates) {
  const candidatesById = new Map(
    (Array.isArray(candidates) ? candidates : []).map((candidate) => [
      candidate.measureId,
      candidate.lyric,
    ]),
  );
  let appliedCount = 0;
  let preservedCount = 0;

  const nextMeasures = (Array.isArray(measures) ? measures : []).map((measure) => {
    const candidateLyric = candidatesById.get(measure.id);

    if (!candidateLyric) return measure;

    if (String(measure.lyric || '').trim()) {
      preservedCount += 1;
      return measure;
    }

    appliedCount += 1;
    return { ...measure, lyric: candidateLyric };
  });

  return { appliedCount, measures: nextMeasures, preservedCount };
}
