export const NAVIGATION_WARNING_DELAY_MS = 1000;
export const NAVIGATION_WARNING_MOVE_CANCEL_DISTANCE = 10;
export const NAVIGATION_WARNING_STATES = Object.freeze({
  IDLE: 'idle',
  INSPECTING: 'inspecting',
  PENDING: 'pending',
});
export const NAVIGATION_WARNING_SEVERITIES = Object.freeze({
  ERROR: 'error',
  WARNING: 'warning',
});

export function getNavigationWarningPresentation(issues) {
  const safeIssues = Array.isArray(issues) ? issues : [];
  const severity = safeIssues.some(
    (issue) => issue?.severity === NAVIGATION_WARNING_SEVERITIES.ERROR,
  )
    ? NAVIGATION_WARNING_SEVERITIES.ERROR
    : NAVIGATION_WARNING_SEVERITIES.WARNING;

  return {
    className: `navigation-warning-badge navigation-warning-badge-${severity}`,
    label: severity === NAVIGATION_WARNING_SEVERITIES.ERROR ? '오류' : '주의',
    severity,
  };
}

export function shouldPreventNavigationWarningTouchMove(state) {
  return state === NAVIGATION_WARNING_STATES.INSPECTING;
}

function getPointerDistance(startPoint, currentPoint) {
  return Math.hypot(
    currentPoint.clientX - startPoint.clientX,
    currentPoint.clientY - startPoint.clientY,
  );
}

export function clampNavigationTooltipPosition({
  anchorRect,
  tooltipRect,
  viewportHeight,
  viewportWidth,
}) {
  const maxLeft = Math.max(0, viewportWidth - tooltipRect.width);
  const left = Math.min(Math.max(0, anchorRect.left), maxLeft);
  const belowTop = anchorRect.bottom;
  const aboveTop = anchorRect.top - tooltipRect.height;
  const top = belowTop + tooltipRect.height <= viewportHeight
    ? belowTop
    : Math.max(0, aboveTop);

  return { left, top };
}

export function createNavigationWarningInteraction({
  cancel = clearTimeout,
  delayMs = NAVIGATION_WARNING_DELAY_MS,
  moveCancelDistance = NAVIGATION_WARNING_MOVE_CANCEL_DISTANCE,
  onHide,
  onShow,
  schedule = setTimeout,
}) {
  let activePointer = null;
  let interactionState = NAVIGATION_WARNING_STATES.IDLE;
  let timerId = null;

  function cancelTimer() {
    if (timerId === null) return;

    cancel(timerId);
    timerId = null;
  }

  function hide() {
    cancelTimer();
    activePointer = null;
    interactionState = NAVIGATION_WARNING_STATES.IDLE;
    onHide();
  }

  function scheduleShow() {
    cancelTimer();
    interactionState = NAVIGATION_WARNING_STATES.PENDING;
    timerId = schedule(() => {
      timerId = null;
      interactionState = NAVIGATION_WARNING_STATES.INSPECTING;
      onShow();
    }, delayMs);
  }

  return {
    destroy() {
      cancelTimer();
      activePointer = null;
      interactionState = NAVIGATION_WARNING_STATES.IDLE;
    },
    forceHide: hide,
    getPointerType: () => activePointer?.pointerType || '',
    getState: () => interactionState,
    pointerCancel(event = {}) {
      if (
        event.pointerType === 'touch' &&
        interactionState === NAVIGATION_WARNING_STATES.INSPECTING
      ) {
        return false;
      }

      hide();
      return true;
    },
    pointerDown(event) {
      if (event.pointerType === 'mouse') return false;

      activePointer = {
        clientX: event.clientX,
        clientY: event.clientY,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
      };
      scheduleShow();
      return true;
    },
    pointerEnter(event) {
      if (event.pointerType !== 'mouse') return;

      scheduleShow();
    },
    pointerLeave(event) {
      if (event.pointerType === 'mouse') hide();
    },
    pointerMove(event) {
      if (!activePointer || event.pointerId !== activePointer.pointerId) {
        return false;
      }
      if (interactionState === NAVIGATION_WARNING_STATES.INSPECTING) {
        return false;
      }
      if (
        getPointerDistance(activePointer, event) <= moveCancelDistance
      ) {
        return false;
      }

      hide();
      return true;
    },
    pointerUp(event) {
      if (!activePointer || event.pointerId === activePointer.pointerId) {
        hide();
      }
    },
  };
}
