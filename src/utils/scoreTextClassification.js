export const SCORE_TEXT_CATEGORIES = Object.freeze({
  CHORD: 'chord',
  LYRIC_CANDIDATE: 'lyric-candidate',
  METADATA: 'metadata',
  NAVIGATION: 'navigation',
  PERFORMANCE_INSTRUCTION: 'performance-instruction',
});

const CHORD_PATTERN = /^[A-Ga-g](?:#|b|♯|♭)?(?:(?:maj|min|dim|aug|sus|add|m|M)?\d*(?:sus\d*|add\d*)?(?:\([^)]*\))?)?(?:\/[A-Ga-g](?:#|b|♯|♭)?)?$/;
const CHORD_FRAGMENT_PATTERN = /^(?:(?:m|M|maj|min|dim|aug|sus|add)\d*(?:\([^)]*\))?(?:\/[A-Ga-g](?:#|b|♯|♭)?)?|\d+(?:sus\d*|add\d*)?(?:\([^)]*\))?|\/[A-Ga-g](?:#|b|♯|♭)?|[mM]\/[A-Ga-g](?:#|b|♯|♭)?)$/;
const LETTER_PATTERN = /\p{L}/u;
const MEASURE_NUMBER_PATTERN = /^\d+[.)]?$/;
const BPM_PATTERN = /^(?:bpm\s*)?=?\s*\d+(?:\.\d+)?$/i;
const WEB_ADDRESS_PATTERN = /^(?:https?:\/\/|www\.)?[^\s.]+(?:\.[^\s.]+)+(?:\/\S*)?$/i;
const DAL_SEGNO_PATTERN = /^d\.?\s*s\.?(?:\s+al\s+(?:coda|fine))?\.?$/i;
const DAL_CAPO_PATTERN = /^d\.?\s*c\.?(?:\s+al\s+(?:coda|fine))?\.?$/i;
const TO_CODA_PATTERN = /^to\s+coda\.?$/i;
const PERFORMANCE_INSTRUCTION_PATTERN = /^(?:\(?\s*(?:\d+x|\d+(?:st|nd|rd|th)\s+time)\s+only\s*\)?|rit\.?|ritard\.?|simile\.?|ad\s+lib\.?|etc\.?)$/i;
const LYRIC_CONTINUATION_SEPARATOR_PATTERN = /^[-\u2010-\u2015\uFE63\uFF0D]$/u;

export function normalizeScoreText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function isChordSymbolText(value) {
  const text = normalizeScoreText(value);

  return Boolean(
    text && (CHORD_PATTERN.test(text) || CHORD_FRAGMENT_PATTERN.test(text)),
  );
}

export function isNavigationInstructionText(
  value,
  { instructionContext = false } = {},
) {
  const text = normalizeScoreText(value);

  if (!text) return false;
  if (
    DAL_SEGNO_PATTERN.test(text) ||
    DAL_CAPO_PATTERN.test(text) ||
    TO_CODA_PATTERN.test(text)
  ) {
    return true;
  }

  return instructionContext && /^(?:segno|coda|fine)\.?$/i.test(text);
}

export function isPerformanceInstructionText(value) {
  return PERFORMANCE_INSTRUCTION_PATTERN.test(normalizeScoreText(value));
}

function isInstructionContext(item, system) {
  if (!system || !Number.isFinite(Number(item?.baselineY))) return false;

  const staffSpacing = Number(system.staffSpacing) || 0;

  return Number(item.baselineY) <= Number(system.staffBottom) + staffSpacing * 1.5;
}

export function classifyScoreTextItem(
  item,
  {
    allowLyricContinuationSeparator = false,
    fontRole = '',
    isMetadata = false,
    isNotation = false,
    system = null,
  } = {},
) {
  const text = normalizeScoreText(item?.text ?? item);
  const instructionContext = isInstructionContext(item, system);

  if (!text) {
    return {
      category: SCORE_TEXT_CATEGORIES.METADATA,
      reason: 'isolated-symbol',
      text,
    };
  }
  if (isNavigationInstructionText(text, { instructionContext })) {
    return { category: SCORE_TEXT_CATEGORIES.NAVIGATION, text };
  }
  if (isPerformanceInstructionText(text)) {
    return {
      category: SCORE_TEXT_CATEGORIES.PERFORMANCE_INSTRUCTION,
      text,
    };
  }
  if (isNotation) {
    return {
      category: SCORE_TEXT_CATEGORIES.METADATA,
      reason: 'music-glyph-font',
      text,
    };
  }
  if (
    allowLyricContinuationSeparator &&
    LYRIC_CONTINUATION_SEPARATOR_PATTERN.test(text)
  ) {
    return { category: SCORE_TEXT_CATEGORIES.LYRIC_CANDIDATE, text };
  }
  if (
    isMetadata ||
    MEASURE_NUMBER_PATTERN.test(text) ||
    BPM_PATTERN.test(text) ||
    WEB_ADDRESS_PATTERN.test(text)
  ) {
    return {
      category: SCORE_TEXT_CATEGORIES.METADATA,
      reason: 'metadata',
      text,
    };
  }
  if (fontRole === 'chord' || isChordSymbolText(text)) {
    return { category: SCORE_TEXT_CATEGORIES.CHORD, text };
  }
  if (!LETTER_PATTERN.test(text)) {
    return {
      category: SCORE_TEXT_CATEGORIES.METADATA,
      reason: 'isolated-symbol',
      text,
    };
  }

  return { category: SCORE_TEXT_CATEGORIES.LYRIC_CANDIDATE, text };
}
