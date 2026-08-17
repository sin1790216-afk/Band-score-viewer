import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampNavigationTooltipPosition,
  createNavigationWarningInteraction,
  getNavigationWarningPresentation,
  NAVIGATION_WARNING_DELAY_MS,
  NAVIGATION_WARNING_STATES,
  shouldPreventNavigationWarningTouchMove,
} from '../src/utils/navigationWarningInteraction.js';

function createFakeScheduler() {
  let currentTime = 0;
  let nextId = 1;
  const tasks = new Map();

  return {
    advance(milliseconds) {
      currentTime += milliseconds;
      [...tasks.entries()].forEach(([id, task]) => {
        if (task.time > currentTime) return;

        tasks.delete(id);
        task.callback();
      });
    },
    cancel(id) {
      tasks.delete(id);
    },
    schedule(callback, delay) {
      const id = nextId;

      nextId += 1;
      tasks.set(id, { callback, time: currentTime + delay });
      return id;
    },
  };
}

function createInteraction() {
  const scheduler = createFakeScheduler();
  const state = { visible: false };
  const interaction = createNavigationWarningInteraction({
    cancel: scheduler.cancel,
    onHide: () => {
      state.visible = false;
    },
    onShow: () => {
      state.visible = true;
    },
    schedule: scheduler.schedule,
  });

  return { interaction, scheduler, state };
}

test('mouse hover는 1초 후 열리고 pointerleave에서 즉시 닫힌다', () => {
  const { interaction, scheduler, state } = createInteraction();

  interaction.pointerEnter({ pointerType: 'mouse' });
  scheduler.advance(NAVIGATION_WARNING_DELAY_MS - 1);
  assert.equal(state.visible, false);
  scheduler.advance(1);
  assert.equal(state.visible, true);
  interaction.pointerLeave({ pointerType: 'mouse' });
  assert.equal(state.visible, false);
});

test('touch long press는 1초 후 열리고 pointerup에서 즉시 닫힌다', () => {
  const { interaction, scheduler, state } = createInteraction();
  const pointer = { clientX: 10, clientY: 20, pointerId: 3, pointerType: 'touch' };

  interaction.pointerDown(pointer);
  assert.equal(interaction.getState(), NAVIGATION_WARNING_STATES.PENDING);
  scheduler.advance(NAVIGATION_WARNING_DELAY_MS - 1);
  assert.equal(state.visible, false);
  scheduler.advance(1);
  assert.equal(state.visible, true);
  assert.equal(interaction.getState(), NAVIGATION_WARNING_STATES.INSPECTING);
  interaction.pointerUp(pointer);
  assert.equal(state.visible, false);
  assert.equal(interaction.getState(), NAVIGATION_WARNING_STATES.IDLE);
});

test('PENDING 중 touch 이동과 pointercancel은 long press를 취소한다', () => {
  const movement = createInteraction();
  const pointer = { clientX: 10, clientY: 20, pointerId: 3, pointerType: 'touch' };

  movement.interaction.pointerDown(pointer);
  assert.equal(
    movement.interaction.pointerMove({ ...pointer, clientX: 30 }),
    true,
  );
  movement.scheduler.advance(NAVIGATION_WARNING_DELAY_MS);
  assert.equal(movement.state.visible, false);

  const cancellation = createInteraction();

  cancellation.interaction.pointerDown(pointer);
  cancellation.interaction.pointerCancel(pointer);
  cancellation.scheduler.advance(NAVIGATION_WARNING_DELAY_MS);
  assert.equal(cancellation.state.visible, false);
});

test('INSPECTING touch의 pointercancel과 pointerleave는 tooltip을 닫지 않는다', () => {
  const { interaction, scheduler, state } = createInteraction();
  const pointer = { clientX: 10, clientY: 20, pointerId: 3, pointerType: 'touch' };

  interaction.pointerDown(pointer);
  scheduler.advance(NAVIGATION_WARNING_DELAY_MS);
  assert.equal(state.visible, true);
  interaction.pointerLeave(pointer);
  assert.equal(state.visible, true);
  assert.equal(interaction.pointerCancel(pointer), false);
  assert.equal(interaction.getState(), NAVIGATION_WARNING_STATES.INSPECTING);
  assert.equal(state.visible, true);
  interaction.pointerUp(pointer);
  assert.equal(state.visible, false);
});

test('INSPECTING 중에는 손가락을 움직여도 유지하고 pointerup에서 닫힌다', () => {
  const { interaction, scheduler, state } = createInteraction();
  const pointer = { clientX: 10, clientY: 20, pointerId: 3, pointerType: 'touch' };

  interaction.pointerDown(pointer);
  scheduler.advance(NAVIGATION_WARNING_DELAY_MS);
  assert.equal(state.visible, true);
  assert.equal(
    interaction.pointerMove({ ...pointer, clientX: 80, clientY: 90 }),
    false,
  );
  assert.equal(interaction.getState(), NAVIGATION_WARNING_STATES.INSPECTING);
  assert.equal(state.visible, true);
  interaction.pointerUp({ ...pointer, clientX: 80, clientY: 90 });
  assert.equal(interaction.getState(), NAVIGATION_WARNING_STATES.IDLE);
  assert.equal(state.visible, false);
});

test('touchmove는 INSPECTING 상태에서만 native pan을 막는다', () => {
  assert.equal(
    shouldPreventNavigationWarningTouchMove(NAVIGATION_WARNING_STATES.IDLE),
    false,
  );
  assert.equal(
    shouldPreventNavigationWarningTouchMove(NAVIGATION_WARNING_STATES.PENDING),
    false,
  );
  assert.equal(
    shouldPreventNavigationWarningTouchMove(
      NAVIGATION_WARNING_STATES.INSPECTING,
    ),
    true,
  );
});

test('badge presentation은 severity를 DOM class와 data 값으로 전달한다', () => {
  const warning = getNavigationWarningPresentation([{ severity: 'warning' }]);
  const error = getNavigationWarningPresentation([{ severity: 'error' }]);
  const mixed = getNavigationWarningPresentation([
    { severity: 'warning' },
    { severity: 'error' },
  ]);

  assert.deepEqual(warning, {
    className: 'navigation-warning-badge navigation-warning-badge-warning',
    label: '주의',
    severity: 'warning',
  });
  assert.deepEqual(error, {
    className: 'navigation-warning-badge navigation-warning-badge-error',
    label: '오류',
    severity: 'error',
  });
  assert.equal(mixed.severity, 'error');
});

test('tooltip 위치는 현재 anchor와 viewport geometry 안에서 clamp된다', () => {
  assert.deepEqual(
    clampNavigationTooltipPosition({
      anchorRect: { bottom: 190, left: 280, top: 170 },
      tooltipRect: { height: 80, width: 120 },
      viewportHeight: 200,
      viewportWidth: 300,
    }),
    { left: 180, top: 90 },
  );
});
