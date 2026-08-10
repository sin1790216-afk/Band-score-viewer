function getFiniteNumber(value, fallbackValue) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : fallbackValue;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function clampFloatingPanelPosition({
  left,
  panelHeight,
  panelWidth,
  top,
  viewportHeight,
  viewportLeft = 0,
  viewportTop = 0,
  viewportWidth,
}) {
  const safeViewportLeft = getFiniteNumber(viewportLeft, 0);
  const safeViewportTop = getFiniteNumber(viewportTop, 0);
  const safeViewportWidth = Math.max(getFiniteNumber(viewportWidth, 0), 0);
  const safeViewportHeight = Math.max(getFiniteNumber(viewportHeight, 0), 0);
  const safePanelWidth = Math.max(getFiniteNumber(panelWidth, 0), 0);
  const safePanelHeight = Math.max(getFiniteNumber(panelHeight, 0), 0);
  const maximumLeft =
    safeViewportLeft + Math.max(safeViewportWidth - safePanelWidth, 0);
  const maximumTop =
    safeViewportTop + Math.max(safeViewportHeight - safePanelHeight, 0);

  return {
    left: clamp(
      getFiniteNumber(left, safeViewportLeft),
      safeViewportLeft,
      maximumLeft,
    ),
    top: clamp(
      getFiniteNumber(top, safeViewportTop),
      safeViewportTop,
      maximumTop,
    ),
  };
}
