import {
  getNavigationMarkerLabel,
  NAVIGATION_MARKER_TYPES,
} from '../utils/navigationMarkers.js';

function SegnoSymbol() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M17.7 4.8C15.8 2.9 11.9 3 9.8 5c-2.5 2.3-1.4 5.2 2.4 6.8 3.5 1.5 4.4 3.2 2.6 5-1.6 1.6-4.5 1.5-6.1-.1" />
      <path d="M5.2 18.8 18.8 5.2" />
      <circle cx="6" cy="8" r="1.25" />
      <circle cx="18" cy="16" r="1.25" />
    </svg>
  );
}

function CodaSymbol() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="6" />
      <path d="M12 2v20M2 12h20" />
    </svg>
  );
}

export default function NavigationMarkerLabel({ type }) {
  const label = getNavigationMarkerLabel(type);

  if (
    type !== NAVIGATION_MARKER_TYPES.SEGNO &&
    type !== NAVIGATION_MARKER_TYPES.CODA
  ) {
    return label;
  }

  return (
    <span
      aria-label={label}
      className="navigation-symbol"
      role="img"
      title={label}
    >
      {type === NAVIGATION_MARKER_TYPES.SEGNO
        ? <SegnoSymbol />
        : <CodaSymbol />}
    </span>
  );
}
