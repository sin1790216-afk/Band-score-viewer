export const MEASURE_RESIZE_DIRECTIONS = Object.freeze({
  BOTTOM: 'bottom',
  BOTTOM_LEFT: 'bottom-left',
  BOTTOM_RIGHT: 'bottom-right',
  LEFT: 'left',
  RIGHT: 'right',
  TOP: 'top',
  TOP_LEFT: 'top-left',
  TOP_RIGHT: 'top-right',
});

const VALID_DIRECTIONS = new Set(Object.values(MEASURE_RESIZE_DIRECTIONS));

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function getFiniteNumber(value, fallback = 0) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : fallback;
}

export function resizeCanonicalMeasure({
  deltaX = 0,
  deltaY = 0,
  direction,
  measure,
  minimumHeight = 0,
  minimumWidth = 0,
}) {
  const safeMinimumWidth = clamp(getFiniteNumber(minimumWidth), 0, 1);
  const safeMinimumHeight = clamp(getFiniteNumber(minimumHeight), 0, 1);
  const startWidth = clamp(
    getFiniteNumber(measure?.width, safeMinimumWidth),
    safeMinimumWidth,
    1,
  );
  const startHeight = clamp(
    getFiniteNumber(measure?.height, safeMinimumHeight),
    safeMinimumHeight,
    1,
  );
  let left = clamp(getFiniteNumber(measure?.x), 0, 1 - startWidth);
  let top = clamp(getFiniteNumber(measure?.y), 0, 1 - startHeight);
  let right = left + startWidth;
  let bottom = top + startHeight;

  if (!VALID_DIRECTIONS.has(direction)) {
    return {
      height: bottom - top,
      width: right - left,
      x: left,
      y: top,
    };
  }

  const normalizedDeltaX = getFiniteNumber(deltaX);
  const normalizedDeltaY = getFiniteNumber(deltaY);

  if (direction.includes('left')) {
    left = clamp(left + normalizedDeltaX, 0, right - safeMinimumWidth);
  } else if (direction.includes('right')) {
    right = clamp(right + normalizedDeltaX, left + safeMinimumWidth, 1);
  }

  if (direction.includes('top')) {
    top = clamp(top + normalizedDeltaY, 0, bottom - safeMinimumHeight);
  } else if (direction.includes('bottom')) {
    bottom = clamp(bottom + normalizedDeltaY, top + safeMinimumHeight, 1);
  }

  return {
    height: bottom - top,
    width: right - left,
    x: left,
    y: top,
  };
}
