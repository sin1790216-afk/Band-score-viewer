import { createElement, forwardRef } from 'react';

import {
  getNavigationWarningPresentation,
} from '../utils/navigationWarningInteraction.js';

const NavigationWarningBadgeButton = forwardRef(
  function NavigationWarningBadgeButton({ issues, ...buttonProps }, ref) {
    const presentation = getNavigationWarningPresentation(issues);

    return createElement(
      'button',
      {
        ...buttonProps,
        className: presentation.className,
        'data-severity': presentation.severity,
        ref,
      },
      '⚠',
    );
  },
);

export default NavigationWarningBadgeButton;
