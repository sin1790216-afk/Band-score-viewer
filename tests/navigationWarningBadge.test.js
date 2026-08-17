import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import NavigationWarningBadgeButton from '../src/components/NavigationWarningBadgeButton.js';

function renderBadge(issues) {
  return renderToStaticMarkup(
    createElement(NavigationWarningBadgeButton, {
      'aria-label': 'Navigation 문제 설명',
      issues,
      type: 'button',
    }),
  );
}

test('error severity가 실제 badge DOM class와 data-severity에 연결된다', () => {
  const markup = renderBadge([{ severity: 'error' }]);

  assert.match(markup, /navigation-warning-badge-error/);
  assert.match(markup, /data-severity="error"/);
});

test('warning severity가 실제 badge DOM class와 data-severity에 연결된다', () => {
  const markup = renderBadge([{ severity: 'warning' }]);

  assert.match(markup, /navigation-warning-badge-warning/);
  assert.match(markup, /data-severity="warning"/);
});

test('error와 warning이 함께 있으면 badge DOM은 error를 우선한다', () => {
  const markup = renderBadge([
    { severity: 'warning' },
    { severity: 'error' },
  ]);

  assert.match(markup, /navigation-warning-badge-error/);
  assert.match(markup, /data-severity="error"/);
  assert.doesNotMatch(markup, /navigation-warning-badge-warning/);
});
