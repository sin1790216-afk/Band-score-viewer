import assert from 'node:assert/strict';
import test from 'node:test';

import { clampFloatingPanelPosition } from '../src/utils/floatingPanel.js';

test('floating panel keeps a position that is already inside the viewport', () => {
  assert.deepEqual(
    clampFloatingPanelPosition({
      left: 300,
      panelHeight: 360,
      panelWidth: 440,
      top: 120,
      viewportHeight: 900,
      viewportWidth: 1200,
    }),
    { left: 300, top: 120 },
  );
});

test('floating panel clamps every edge using current panel and viewport geometry', () => {
  assert.deepEqual(
    clampFloatingPanelPosition({
      left: -50,
      panelHeight: 360,
      panelWidth: 440,
      top: -80,
      viewportHeight: 900,
      viewportWidth: 1200,
    }),
    { left: 0, top: 0 },
  );
  assert.deepEqual(
    clampFloatingPanelPosition({
      left: 1000,
      panelHeight: 360,
      panelWidth: 440,
      top: 800,
      viewportHeight: 900,
      viewportWidth: 1200,
    }),
    { left: 760, top: 540 },
  );
});

test('oversized floating panel keeps its header origin accessible', () => {
  assert.deepEqual(
    clampFloatingPanelPosition({
      left: 200,
      panelHeight: 900,
      panelWidth: 700,
      top: 200,
      viewportHeight: 600,
      viewportLeft: 12,
      viewportTop: 8,
      viewportWidth: 500,
    }),
    { left: 12, top: 8 },
  );
});
