import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import {
  clampNavigationTooltipPosition,
  createNavigationWarningInteraction,
  NAVIGATION_WARNING_STATES,
  shouldPreventNavigationWarningTouchMove,
} from '../utils/navigationWarningInteraction.js';
import NavigationWarningBadgeButton from './NavigationWarningBadgeButton.js';

function logNavigationWarningPointer(event, details) {
  if (!import.meta.env.DEV) return;

  console.info('[NavigationWarningPointer]', {
    event,
    ...details,
  });
}

function getPlainRect(element) {
  const rect = element?.getBoundingClientRect();

  return rect
    ? {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        top: rect.top,
        width: rect.width,
      }
    : null;
}

export default function NavigationWarningBadge({ issues }) {
  const badgeRef = useRef(null);
  const tooltipRef = useRef(null);
  const interactionRef = useRef(null);
  const hasIssues = Array.isArray(issues) && issues.length > 0;
  const [anchorRect, setAnchorRect] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState(null);
  const tooltipId = useId();

  const hideTooltip = useCallback(() => {
    setIsVisible(false);
    setTooltipPosition(null);
  }, []);
  const showTooltip = useCallback(() => {
    const nextAnchorRect = getPlainRect(badgeRef.current);

    if (!nextAnchorRect) return;

    const pointerType = interactionRef.current?.getPointerType() || 'mouse';

    logNavigationWarningPointer(
      pointerType === 'touch'
        ? 'long-press-complete'
        : 'hover-delay-complete',
      {
        pointerType,
        state: NAVIGATION_WARNING_STATES.INSPECTING,
      },
    );
    setAnchorRect(nextAnchorRect);
    setIsVisible(true);
  }, []);

  if (!interactionRef.current) {
    interactionRef.current = createNavigationWarningInteraction({
      onHide: hideTooltip,
      onShow: showTooltip,
    });
  }

  useEffect(() => {
    const interaction = interactionRef.current;

    return () => interaction.destroy();
  }, []);

  useEffect(() => {
    interactionRef.current.forceHide();
  }, [issues]);

  useEffect(() => {
    const badge = badgeRef.current;
    const interaction = interactionRef.current;

    if (!badge || !hasIssues) return undefined;

    function getTouch(event) {
      return event.touches[0] || event.changedTouches[0] || null;
    }

    function handleTouchStart(event) {
      if (event.touches.length !== 1) {
        interaction.forceHide();
        return;
      }

      const touch = getTouch(event);

      if (!touch) return;

      interaction.pointerDown({
        clientX: touch.clientX,
        clientY: touch.clientY,
        pointerId: touch.identifier,
        pointerType: 'touch',
      });
      logNavigationWarningPointer('touchstart', {
        defaultPrevented: event.defaultPrevented,
        pointerType: 'touch',
        state: interaction.getState(),
        touchCount: event.touches.length,
      });
    }

    function handleTouchMove(event) {
      const touch = getTouch(event);
      const stateBefore = interaction.getState();

      if (!touch) return;

      if (shouldPreventNavigationWarningTouchMove(stateBefore)) {
        event.preventDefault();
      }

      const cancelledPending = interaction.pointerMove({
        clientX: touch.clientX,
        clientY: touch.clientY,
        pointerId: touch.identifier,
        pointerType: 'touch',
      });

      logNavigationWarningPointer('touchmove', {
        cancelledPending,
        defaultPrevented: event.defaultPrevented,
        pointerType: 'touch',
        stateBefore,
        stateAfter: interaction.getState(),
      });
    }

    function handleTouchEnd(event) {
      const touch = getTouch(event);

      interaction.pointerUp({
        pointerId: touch?.identifier,
        pointerType: 'touch',
      });
      logNavigationWarningPointer('touchend', {
        pointerType: 'touch',
        state: interaction.getState(),
      });
    }

    function handleTouchCancel() {
      const stateBefore = interaction.getState();

      interaction.forceHide();
      logNavigationWarningPointer('touchcancel', {
        pointerType: 'touch',
        stateBefore,
        stateAfter: interaction.getState(),
      });
    }

    const listenerOptions = { passive: false };

    badge.addEventListener('touchstart', handleTouchStart, listenerOptions);
    badge.addEventListener('touchmove', handleTouchMove, listenerOptions);
    badge.addEventListener('touchend', handleTouchEnd, listenerOptions);
    badge.addEventListener('touchcancel', handleTouchCancel, listenerOptions);

    return () => {
      badge.removeEventListener('touchstart', handleTouchStart);
      badge.removeEventListener('touchmove', handleTouchMove);
      badge.removeEventListener('touchend', handleTouchEnd);
      badge.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [hasIssues]);

  useLayoutEffect(() => {
    if (!isVisible || !anchorRect || !tooltipRef.current) return undefined;

    function updatePosition() {
      const currentAnchorRect = getPlainRect(badgeRef.current) || anchorRect;
      const tooltipRect = getPlainRect(tooltipRef.current);

      if (!tooltipRect) return;

      setTooltipPosition(
        clampNavigationTooltipPosition({
          anchorRect: currentAnchorRect,
          tooltipRect,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
        }),
      );
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);

    return () => window.removeEventListener('resize', updatePosition);
  }, [anchorRect, isVisible]);

  function releasePointerCapture(event) {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handlePointerDown(event) {
    event.stopPropagation();

    if (event.pointerType === 'touch') {
      logNavigationWarningPointer('pointerdown', {
        handledBy: 'native-touch-events',
        hasPointerCapture: event.currentTarget.hasPointerCapture?.(
          event.pointerId,
        ) || false,
        pointerType: event.pointerType,
        state: interactionRef.current.getState(),
      });
      return;
    }

    if (interactionRef.current.pointerDown(event)) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
  }

  function handlePointerMove(event) {
    event.stopPropagation();
    const interaction = interactionRef.current;

    if (event.pointerType === 'touch') {
      logNavigationWarningPointer('pointermove', {
        handledBy: 'native-touch-events',
        pointerType: event.pointerType,
        state: interaction.getState(),
      });
      return;
    }

    if (interaction.getState() === NAVIGATION_WARNING_STATES.INSPECTING) {
      event.preventDefault();
    }

    if (interaction.pointerMove(event)) {
      releasePointerCapture(event);
    }
  }

  function handlePointerEnd(event, method) {
    event.stopPropagation();

    if (event.pointerType === 'touch') {
      logNavigationWarningPointer(method, {
        handledBy: 'native-touch-events',
        hasPointerCapture: event.currentTarget.hasPointerCapture?.(
          event.pointerId,
        ) || false,
        pointerType: event.pointerType,
        state: interactionRef.current.getState(),
      });
      return;
    }

    interactionRef.current[method](event);
    releasePointerCapture(event);
  }

  function handlePointerLeave(event) {
    if (event.pointerType === 'touch') {
      logNavigationWarningPointer('pointerleave', {
        pointerType: event.pointerType,
        state: interactionRef.current.getState(),
      });
    }

    interactionRef.current.pointerLeave(event);
  }

  if (!hasIssues) return null;

  const tooltip = isVisible && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="navigation-warning-tooltip"
          id={tooltipId}
          ref={tooltipRef}
          role="tooltip"
          style={
            tooltipPosition
              ? tooltipPosition
              : {
                  left: anchorRect?.left || 0,
                  top: anchorRect?.bottom || 0,
                  visibility: 'hidden',
                }
          }
        >
          {issues.length > 1 && (
            <strong>Navigation 설정을 확인해주세요.</strong>
          )}
          <ul>
            {issues.map((issue) => (
              <li key={issue.id}>
                <span
                  className={`navigation-warning-severity navigation-warning-severity-${issue.severity}`}
                >
                  {issue.severity === 'error' ? '오류' : '주의'}
                </span>
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <NavigationWarningBadgeButton
        aria-describedby={isVisible ? tooltipId : undefined}
        aria-label="Navigation 문제 설명"
        issues={issues}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onContextMenu={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
        onPointerCancel={(event) => handlePointerEnd(event, 'pointerCancel')}
        onPointerDown={handlePointerDown}
        onPointerEnter={(event) =>
          interactionRef.current.pointerEnter(event)
        }
        onPointerLeave={handlePointerLeave}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => handlePointerEnd(event, 'pointerUp')}
        ref={badgeRef}
        type="button"
      />
      {tooltip}
    </>
  );
}
