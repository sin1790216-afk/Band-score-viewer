const HANGUL_SYLLABLE_PATTERN = /^[\uAC00-\uD7A3]$/u;
const HANGUL_PATTERN = /[\uAC00-\uD7A3]/u;
const HORIZONTAL_WHITESPACE_PATTERN = /^[\t ]+$/u;
const ISOLATED_LYRIC_SEPARATOR_PATTERN =
  /^[-\u2010-\u2015\uFE63\uFF0D]$/u;
const STRONG_EXTRACTION_SEPARATOR_PATTERN = /^[\uFE63\uFF0D]$/u;
const HANGUL_TRAILING_EXTRACTION_SEPARATOR_PATTERN =
  /([\uAC00-\uD7A3])[\uFE63\uFF0D]/gu;
const HANGUL_LEADING_EXTRACTION_SEPARATOR_PATTERN =
  /[\uFE63\uFF0D](?=[\uAC00-\uD7A3])/gu;
const MIN_ISOLATED_SYLLABLE_RUN = 5;
const LATIN_WORD_PATTERN = /[A-Za-z]/u;
const LATIN_CONTINUATION_PATTERN = /([A-Za-z]+)\s+[-\u2010-\u2015\uFE63\uFF0D]\s+([A-Za-z]+)/gu;
const TRAILING_LATIN_MELISMA_PATTERN = /\s+[-\u2010-\u2015\uFE63\uFF0D]\s*$/u;

function normalizeUnicode(value) {
  return value.normalize('NFC');
}

function collapseIsolatedHangulSyllables(line) {
  const parts = line.match(/[^\t ]+|[\t ]+/gu) || [];
  let result = '';

  for (let index = 0; index < parts.length; index += 1) {
    if (!HANGUL_SYLLABLE_PATTERN.test(parts[index])) {
      result += parts[index];
      continue;
    }

    const syllables = [parts[index]];
    let runEndIndex = index;

    while (
      HORIZONTAL_WHITESPACE_PATTERN.test(parts[runEndIndex + 1] || '') &&
      HANGUL_SYLLABLE_PATTERN.test(parts[runEndIndex + 2] || '')
    ) {
      syllables.push(parts[runEndIndex + 2]);
      runEndIndex += 2;
    }

    if (syllables.length >= MIN_ISOLATED_SYLLABLE_RUN) {
      result += syllables.join('');
      index = runEndIndex;
      continue;
    }

    result += parts[index];
  }

  return result;
}

function removeIsolatedLyricSeparators(line) {
  const parts = line.match(/[^\t ]+|[\t ]+/gu) || [];

  return parts
    .filter((part, index) => {
      if (!ISOLATED_LYRIC_SEPARATOR_PATTERN.test(part)) return true;

      const previousToken = [...parts.slice(0, index)]
        .reverse()
        .find((candidate) => !HORIZONTAL_WHITESPACE_PATTERN.test(candidate));
      const nextToken = parts
        .slice(index + 1)
        .find((candidate) => !HORIZONTAL_WHITESPACE_PATTERN.test(candidate));
      const hasAdjacentHangul =
        HANGUL_PATTERN.test(previousToken || '') ||
        HANGUL_PATTERN.test(nextToken || '');
      const isAtLyricEdge = !previousToken || !nextToken;
      const isStrongExtractionSeparator =
        STRONG_EXTRACTION_SEPARATOR_PATTERN.test(part);

      // ASCII/dash punctuation inside a line is ambiguous and remains intact.
      // PDF fullwidth/small hyphens next to Hangul are a strong melisma signal.
      return !(
        hasAdjacentHangul &&
        (isAtLyricEdge || isStrongExtractionSeparator)
      );
    })
    .join('')
    .replace(/[\t ]{2,}/gu, ' ')
    .trim();
}

function removeEmbeddedHangulExtractionSeparators(line) {
  return line
    .replace(HANGUL_TRAILING_EXTRACTION_SEPARATOR_PATTERN, '$1')
    .replace(HANGUL_LEADING_EXTRACTION_SEPARATOR_PATTERN, '');
}

function normalizeLatinLyricSeparators(line) {
  const joinedContinuations = line.replace(
    LATIN_CONTINUATION_PATTERN,
    (match, previous, next) => {
      const isSeparatedInitials =
        previous.length === 1 &&
        next.length === 1 &&
        previous === previous.toUpperCase() &&
        next === next.toUpperCase();

      return isSeparatedInitials ? match : `${previous}${next}`;
    },
  );

  return LATIN_WORD_PATTERN.test(joinedContinuations)
    ? joinedContinuations.replace(TRAILING_LATIN_MELISMA_PATTERN, '').trimEnd()
    : joinedContinuations;
}

export function normalizeVocalExtractionArtifacts(text) {
  if (typeof text !== 'string') return '';

  return normalizeUnicode(text)
    .split('\n')
    .map((line) =>
      normalizeLatinLyricSeparators(
        removeIsolatedLyricSeparators(
          removeEmbeddedHangulExtractionSeparators(
            collapseIsolatedHangulSyllables(line),
          ),
        ),
      ),
    )
    .join('\n');
}

function hasSameNonWhitespaceContent(source, candidate) {
  return (
    normalizeUnicode(source).replace(/\s/gu, '') ===
    normalizeUnicode(candidate).replace(/\s/gu, '')
  );
}

export function createVocalDisplayText(text, { spacingProvider } = {}) {
  const normalizedText = normalizeVocalExtractionArtifacts(text);

  if (
    !HANGUL_PATTERN.test(normalizedText) ||
    typeof spacingProvider !== 'function'
  ) {
    return normalizedText;
  }

  try {
    const candidate = spacingProvider(normalizedText);

    // 외부 NLP/AI를 연결하더라도 이 단계에서는 공백만 바꿀 수 있다.
    return typeof candidate === 'string' &&
      hasSameNonWhitespaceContent(normalizedText, candidate)
      ? candidate
      : normalizedText;
  } catch {
    return normalizedText;
  }
}
