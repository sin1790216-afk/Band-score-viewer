const MEASURE_RANGE_PATTERN = /^\s*(\d+)\s*(?:[-~]\s*(\d+)\s*)?$/;

export function parseMeasureRange(value, measureCount = Number.POSITIVE_INFINITY) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  const match = String(value).match(MEASURE_RANGE_PATTERN);

  if (!match) return null;

  const start = Number(match[1]);
  const end = Number(match[2] || match[1]);

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 1 ||
    end < start ||
    end > measureCount
  ) {
    return null;
  }

  return { end, start };
}

export function formatMeasureRange(start, end = start) {
  return start === end ? String(start) : `${start}-${end}`;
}
