const CHORD_PATTERN = /^[A-Ga-g](?:#|b|♯|♭)?(?:(?:maj|min|dim|aug|sus|add|m|M)?\d*(?:sus\d*|add\d*)?(?:\([^)]*\))?)?(?:\/[A-Ga-g](?:#|b|♯|♭)?)?$/;
const CHORD_FRAGMENT_PATTERN = /^(?:(?:m|M|maj|min|dim|aug|sus|add)\d*(?:\([^)]*\))?(?:\/[A-Ga-g](?:#|b|♯|♭)?)?|\d+(?:sus\d*|add\d*)?(?:\([^)]*\))?|\/[A-Ga-g](?:#|b|♯|♭)?|[mM]\/[A-Ga-g](?:#|b|♯|♭)?)$/;
const BPM_PATTERN = /^(?:bpm\s*)?=?\s*\d+(?:\.\d+)?$/i;
const LETTER_PATTERN = /\p{L}/u;
const HANGUL_PATTERN = /[\uAC00-\uD7A3]/u;
const LATIN_WORD_PATTERN = /[A-Za-z]{2,}/u;
const MEASURE_NUMBER_PATTERN = /^\d+[.)]?$/;
const NOTATION_GLYPH_PATTERN = /^[œŒjJqQwW\s]+$/;
const MUSICAL_SYMBOL_PATTERN = /[\u2669-\u266f\u{1D100}-\u{1D1FF}]/u;
const LEGACY_NOTATION_GLYPH_PATTERN = /[œŒ∑Ó‰˙]/u;
const WEB_ADDRESS_PATTERN = /^(?:https?:\/\/|www\.)?[^\s.]+(?:\.[^\s.]+)+(?:\/\S*)?$/i;
const LYRIC_REGION_START_STAFF_SPACES = 0.35;
const NEXT_SYSTEM_CHORD_RESERVE_STAFF_SPACES = 2.5;
const STAFF_FONT_ZONE_MARGIN_STAFF_SPACES = 1.5;
const MAX_LYRIC_TEXT_HEIGHT_STAFF_SPACES = 4;
const MIN_FONT_PROFILE_ITEM_COUNT = 2;
const MIN_LINE_PURITY = 0.58;

function multiplyTransforms(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function normalizeChunk(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function getFontIdentity(item) {
  return item?.fontName || item?.fontFamily || '__unknown-font__';
}

function hasDirectNotationContent(value) {
  const text = normalizeChunk(value);

  if (!text) return false;

  return (
    NOTATION_GLYPH_PATTERN.test(text) ||
    MUSICAL_SYMBOL_PATTERN.test(text) ||
    LEGACY_NOTATION_GLYPH_PATTERN.test(text)
  );
}

function isInsideStaffFontZone(item, system) {
  const margin =
    system.staffSpacing * STAFF_FONT_ZONE_MARGIN_STAFF_SPACES;

  return (
    item.baselineY >= system.staffTop - margin &&
    item.baselineY <= system.staffBottom + margin
  );
}

function buildFontProfiles(textItems, systems) {
  const profiles = new Map();

  textItems.forEach((item) => {
    const fontIdentity = getFontIdentity(item);
    const profile = profiles.get(fontIdentity) || {
      chordLikeCount: 0,
      directNotationCount: 0,
      hangulCount: 0,
      itemCount: 0,
      latinWordCount: 0,
      staffZoneCount: 0,
    };

    profile.itemCount += 1;
    if (isChordSymbolText(item.text)) profile.chordLikeCount += 1;
    if (hasDirectNotationContent(item.text)) profile.directNotationCount += 1;
    if (HANGUL_PATTERN.test(item.text)) profile.hangulCount += 1;
    if (LATIN_WORD_PATTERN.test(item.text)) profile.latinWordCount += 1;
    if (systems.some((system) => isInsideStaffFontZone(item, system))) {
      profile.staffZoneCount += 1;
    }
    profiles.set(fontIdentity, profile);
  });

  profiles.forEach((profile) => {
    const itemCount = profile.itemCount || 1;
    const chordRatio = profile.chordLikeCount / itemCount;
    const directNotationRatio = profile.directNotationCount / itemCount;
    const staffZoneRatio = profile.staffZoneCount / itemCount;
    const hasEnoughSamples = itemCount >= MIN_FONT_PROFILE_ITEM_COUNT;

    profile.chordRatio = chordRatio;
    profile.directNotationRatio = directNotationRatio;
    profile.isChordFont =
      hasEnoughSamples &&
      profile.hangulCount === 0 &&
      chordRatio >= 0.6;
    profile.isNotationFont =
      profile.hangulCount === 0 &&
      (directNotationRatio >= 0.75 ||
        (hasEnoughSamples &&
          staffZoneRatio >= 0.5 &&
          profile.latinWordCount / itemCount <= 0.1));
    profile.staffZoneRatio = staffZoneRatio;
  });

  return profiles;
}

export function isChordSymbolText(value) {
  const text = normalizeChunk(value);

  return Boolean(
    text && (CHORD_PATTERN.test(text) || CHORD_FRAGMENT_PATTERN.test(text)),
  );
}

export function isLyricText(value) {
  const text = normalizeChunk(value);

  if (!text || !LETTER_PATTERN.test(text)) return false;
  if (
    MEASURE_NUMBER_PATTERN.test(text) ||
    BPM_PATTERN.test(text) ||
    NOTATION_GLYPH_PATTERN.test(text) ||
    WEB_ADDRESS_PATTERN.test(text) ||
    isChordSymbolText(text)
  ) {
    return false;
  }
  return true;
}

function findSystemForMeasure(measure, systems) {
  const measureCenterY = measure.y + measure.height / 2;

  return systems.find(
    (system) =>
      measureCenterY >= system.contentTop &&
      measureCenterY <= system.contentBottom,
  );
}

function findMeasureForItem(item, measures) {
  const centerX = item.x + item.width / 2;

  return measures.find(
    (measure) => centerX >= measure.x && centerX <= measure.x + measure.width,
  );
}

function groupTextLines(items, staffSpacing) {
  const lines = [];

  [...items]
    .sort((left, right) => left.baselineY - right.baselineY || left.x - right.x)
    .forEach((item) => {
      const tolerance = Math.max(item.height * 0.5, staffSpacing * 0.4);
      const line = lines.find(
        (candidate) => Math.abs(candidate.baselineY - item.baselineY) <= tolerance,
      );

      if (line) {
        line.items.push(item);
        line.baselineY =
          line.items.reduce((sum, lineItem) => sum + lineItem.baselineY, 0) /
          line.items.length;
        return;
      }

      lines.push({ baselineY: item.baselineY, items: [item] });
    });

  return lines.sort((left, right) => left.baselineY - right.baselineY);
}

function getItemRejectionReason(item, fontProfile, system) {
  const text = normalizeChunk(item.text);

  if (fontProfile?.isNotationFont || hasDirectNotationContent(text)) {
    return 'music-glyph-font';
  }
  if (fontProfile?.isChordFont) return 'chord-like';
  if (
    MEASURE_NUMBER_PATTERN.test(text) ||
    BPM_PATTERN.test(text) ||
    WEB_ADDRESS_PATTERN.test(text)
  ) {
    return 'metadata';
  }
  if (!LETTER_PATTERN.test(text)) return 'isolated-symbol';
  if (
    Number(item.height) >
    system.staffSpacing * MAX_LYRIC_TEXT_HEIGHT_STAFF_SPACES
  ) {
    return 'metadata-size';
  }

  return null;
}

function getLinePurity(line, system) {
  const compactText = line.items
    .map((item) => normalizeChunk(item.text))
    .join('')
    .replace(/\s+/g, '');
  const characters = [...compactText];
  const lyricCharacterCount = characters.filter((character) =>
    LETTER_PATTERN.test(character),
  ).length;
  const lyricCharacterRatio = characters.length
    ? lyricCharacterCount / characters.length
    : 0;
  const baselineSpread = Math.max(
    0,
    ...line.items.map((item) => Math.abs(item.baselineY - line.baselineY)),
  );
  const baselineConsistency = clamp01(
    1 - baselineSpread / Math.max(system.staffSpacing, Number.EPSILON),
  );
  const representativeHeight = getLowerMedian(
    line.items.map((item) => item.height),
  );
  const heightScore = representativeHeight
    ? clamp01(
        1 -
          Math.max(
            0,
            representativeHeight / system.staffSpacing - 2.5,
          ) /
            (MAX_LYRIC_TEXT_HEIGHT_STAFF_SPACES - 2.5),
      )
    : 0;
  const continuityScore =
    line.items.length > 1 || lyricCharacterCount >= 2 ? 1 : 0.55;
  const staffBelowScore = clamp01(
    (line.baselineY - system.staffBottom) /
      Math.max(system.staffSpacing, Number.EPSILON),
  );

  return (
    lyricCharacterRatio * 0.4 +
    baselineConsistency * 0.2 +
    continuityScore * 0.15 +
    heightScore * 0.15 +
    staffBelowScore * 0.1
  );
}

function getLineRejectionReason(line, system) {
  const chordLikeRatio =
    line.items.filter((item) => isChordSymbolText(item.text)).length /
    line.items.length;

  if (
    chordLikeRatio >= 0.75 &&
    !line.items.some((item) => HANGUL_PATTERN.test(item.text))
  ) {
    return 'chord-line';
  }

  return getLinePurity(line, system) >= MIN_LINE_PURITY
    ? null
    : 'low-purity';
}

function toRejectedItem(item, reason) {
  return {
    baselineY: item.baselineY,
    fontFamily: item.fontFamily,
    fontName: item.fontName,
    height: item.height,
    reason,
    text: item.text,
    width: item.width,
    x: item.x,
    y: item.y,
  };
}

export function getSystemLyricRegion({
  fontProfiles,
  nextSystem,
  system,
  textItems,
}) {
  if (
    !system ||
    !Array.isArray(textItems) ||
    !Number.isFinite(system.staffBottom) ||
    !Number.isFinite(system.staffSpacing) ||
    system.staffSpacing <= 0
  ) {
    return {
      bottom: null,
      items: [],
      lines: [],
      rejectedItems: [],
      top: null,
    };
  }

  const top =
    system.staffBottom +
    system.staffSpacing * LYRIC_REGION_START_STAFF_SPACES;
  const bottom = nextSystem
    ? nextSystem.staffTop -
      nextSystem.staffSpacing * NEXT_SYSTEM_CHORD_RESERVE_STAFF_SPACES
    : 1;

  if (!Number.isFinite(bottom) || bottom <= top) {
    return { bottom, items: [], lines: [], rejectedItems: [], top };
  }

  const resolvedFontProfiles =
    fontProfiles ||
    buildFontProfiles(textItems, [system, nextSystem].filter(Boolean));
  const rawRegionItems = textItems.filter((item) => {
    const centerX = item.x + item.width / 2;

    return (
      centerX >= system.x &&
      centerX <= system.x + system.width &&
      item.baselineY >= top &&
      item.baselineY <= bottom
    );
  });
  const rejectedItems = [];
  const eligibleItems = rawRegionItems.filter((item) => {
    const reason = getItemRejectionReason(
      item,
      resolvedFontProfiles.get(getFontIdentity(item)),
      system,
    );

    if (!reason) return true;

    rejectedItems.push(toRejectedItem(item, reason));
    return false;
  });
  const groupedLines = groupTextLines(eligibleItems, system.staffSpacing);
  const boundedLines =
    nextSystem || groupedLines.length > 1
      ? groupedLines
      : groupedLines.filter((line) => line.baselineY <= system.contentBottom);
  const lines = boundedLines.flatMap((line) => {
    const rejectionReason = getLineRejectionReason(line, system);

    if (rejectionReason) {
      rejectedItems.push(
        ...line.items.map((item) => toRejectedItem(item, rejectionReason)),
      );
      return [];
    }

    return [{ ...line, purityScore: getLinePurity(line, system) }];
  });
  const allowedItems = new Set(lines.flatMap((line) => line.items));
  const items = eligibleItems.filter((item) => allowedItems.has(item));

  return {
    bottom,
    items,
    lines,
    rejectedItems,
    top,
  };
}

function getLowerMedian(values) {
  const sortedValues = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);

  if (sortedValues.length === 0) return 0;

  return sortedValues[Math.floor((sortedValues.length - 1) / 2)];
}

function getLowerMedianIncludingZero(values) {
  const sortedValues = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);

  if (sortedValues.length === 0) return 0;

  return sortedValues[Math.floor((sortedValues.length - 1) / 2)];
}

function getLineBoundaryGapStats(items, measures) {
  const sortedItems = [...items].sort((left, right) => left.x - right.x);
  const boundaryGaps = sortedItems.slice(1).flatMap((item, index) => {
    const previous = sortedItems[index];
    const previousMeasure = findMeasureForItem(previous, measures);
    const currentMeasure = findMeasureForItem(item, measures);
    const gap = item.x - (previous.x + previous.width);

    return previousMeasure &&
      currentMeasure &&
      previousMeasure !== currentMeasure &&
      gap > 0
      ? [gap]
      : [];
  });
  const median = getLowerMedian(boundaryGaps);
  const mad = getLowerMedianIncludingZero(
    boundaryGaps.map((gap) => Math.abs(gap - median)),
  );

  return { count: boundaryGaps.length, mad, median };
}

function getLineReferenceGap(items, staffSpacing) {
  const sortedItems = [...items].sort((left, right) => left.x - right.x);
  const positiveGaps = sortedItems.slice(1).flatMap((item, index) => {
    const previous = sortedItems[index];
    const gap = item.x - (previous.x + previous.width);

    return gap > 0 ? [gap] : [];
  });

  if (positiveGaps.length > 1) return getLowerMedian(positiveGaps);

  return (
    getLowerMedian(sortedItems.map((item) => item.width)) ||
    getLowerMedian(sortedItems.map((item) => item.height)) ||
    staffSpacing ||
    0
  );
}

function joinLineItems(items) {
  return [...items]
    .sort((left, right) => left.x - right.x)
    .reduce((line, item, index, sortedItems) => {
      const text = normalizeChunk(item.text);

      if (index === 0) return text;

      const previous = sortedItems[index - 1];
      const gap = item.x - (previous.x + previous.width);
      const naturalWordGap = Math.max(previous.height, item.height) * 3;
      const separator = gap > naturalWordGap ? ' ' : '';

      return `${line}${separator}${text}`;
    }, '');
}

export function normalizePdfTextItems(
  textItems,
  viewport,
  styles = {},
  page = null,
) {
  const viewportWidth = Number(viewport?.width) || 0;
  const viewportHeight = Number(viewport?.height) || 0;
  const viewportTransform = viewport?.transform;

  if (
    !Array.isArray(textItems) ||
    !Array.isArray(viewportTransform) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return [];
  }

  const viewportScale =
    Math.hypot(viewportTransform[0], viewportTransform[1]) || 1;

  return textItems.flatMap((item, sourceIndex) => {
    if (!Array.isArray(item?.transform)) return [];

    const text = normalizeChunk(item.str);

    if (!text) return [];

    const transform = multiplyTransforms(viewportTransform, item.transform);
    const height = Math.hypot(transform[2], transform[3]);
    const width = Math.abs(Number(item.width) || 0) * viewportScale;

    if (height <= 0 || width < 0) return [];

    return [
      {
        baselineY: transform[5] / viewportHeight,
        fontFamily: String(styles?.[item.fontName]?.fontFamily || ''),
        fontName: String(item.fontName || ''),
        height: height / viewportHeight,
        page,
        sourceIndex,
        text,
        transform: item.transform.map((value) => Number(value) || 0),
        width: width / viewportWidth,
        x: transform[4] / viewportWidth,
        y: (transform[5] - height) / viewportHeight,
      },
    ];
  });
}

function getPageItemRejectionReason(item, fontProfile, systems) {
  if (fontProfile?.isNotationFont || hasDirectNotationContent(item.text)) {
    return 'music-glyph-font';
  }
  if (fontProfile?.isChordFont) return 'chord-like';
  if (
    MEASURE_NUMBER_PATTERN.test(item.text) ||
    BPM_PATTERN.test(item.text) ||
    WEB_ADDRESS_PATTERN.test(item.text)
  ) {
    return 'metadata';
  }

  const nearestSystem = systems.reduce((nearest, system) => {
    const distance = Math.abs(item.baselineY - system.staffBottom);

    return !nearest || distance < nearest.distance
      ? { distance, system }
      : nearest;
  }, null)?.system;

  if (
    nearestSystem &&
    item.height >
      nearestSystem.staffSpacing * MAX_LYRIC_TEXT_HEIGHT_STAFF_SPACES
  ) {
    return 'metadata-size';
  }

  return null;
}

function summarizeRejections(rejectedItems) {
  return rejectedItems.reduce((counts, item) => {
    counts[item.reason] = (counts[item.reason] || 0) + 1;
    return counts;
  }, {});
}

function createRejectionSamples(rejectedItems) {
  const samples = {};

  rejectedItems.forEach((item) => {
    const reasonSamples = samples[item.reason] || [];

    if (reasonSamples.length < 8) reasonSamples.push(item);
    samples[item.reason] = reasonSamples;
  });

  return samples;
}

export function analyzeLyricCandidates({ measures, systems, textItems }) {
  if (
    !Array.isArray(measures) ||
    !Array.isArray(systems) ||
    !Array.isArray(textItems)
  ) {
    return {
      candidates: [],
      diagnostics: [],
      rejectedSamples: {},
      stats: {
        detectedLaneCount: 0,
        oneLineMeasureCount: 0,
        purityRejectCount: 0,
        rejectedChordCount: 0,
        rejectedMetadataCount: 0,
        rejectedMusicGlyphCount: 0,
        twoLineMeasureCount: 0,
      },
    };
  }

  const candidates = [];
  const diagnostics = [];
  const fontProfiles = buildFontProfiles(textItems, systems);
  const pageRejectedItems = textItems.flatMap((item) => {
    const reason = getPageItemRejectionReason(
      item,
      fontProfiles.get(getFontIdentity(item)),
      systems,
    );

    return reason ? [toRejectedItem(item, reason)] : [];
  });
  let detectedLaneCount = 0;
  let purityRejectCount = 0;

  systems.forEach((system, systemIndex) => {
    const systemMeasures = measures.filter(
      (measure) => findSystemForMeasure(measure, [system]) === system,
    );
    const lyricRegion = getSystemLyricRegion({
      fontProfiles,
      nextSystem: systems[systemIndex + 1],
      system,
      textItems,
    });
    detectedLaneCount = Math.max(detectedLaneCount, lyricRegion.lines.length);
    purityRejectCount += lyricRegion.rejectedItems.filter(
      (item) => item.reason === 'low-purity',
    ).length;
    const lyricLines = lyricRegion.lines.map(
      (line, lineIndex) => ({
        ...line,
        boundaryGapStats: getLineBoundaryGapStats(line.items, systemMeasures),
        items: [...line.items].sort((left, right) => left.x - right.x),
        lineIndex,
        referenceGap: getLineReferenceGap(line.items, system.staffSpacing),
      }),
    );
    const measureDiagnostics = [];

    systemMeasures.forEach((measure) => {
      const measureLines = lyricLines.map((line) => {
        const items = line.items.filter(
          (item) => findMeasureForItem(item, systemMeasures) === measure,
        );

        if (items.length === 0) return null;

        const startX = Math.min(...items.map((item) => item.x));
        const endX = Math.max(...items.map((item) => item.x + item.width));

        return { ...line, endX, items, startX };
      });
      const lyric = measureLines
        .map((line) => (line ? joinLineItems(line.items) : ''))
        .join('\n');
      const accepted = measureLines.flatMap((line) =>
        line
          ? [
              {
                lane: line.lineIndex,
                purityScore: line.purityScore,
                text: joinLineItems(line.items),
              },
            ]
          : [],
      );
      const rejected = lyricRegion.rejectedItems.filter(
        (item) => findMeasureForItem(item, systemMeasures) === measure,
      );

      if (accepted.length > 0 || rejected.length > 0) {
        measureDiagnostics.push({
          accepted,
          measureId: measure.id,
          measureIndex: measure.measureIndex,
          rejected,
        });
      }

      if (!lyric.trim()) return;

      candidates.push({
        lyricGeometry: {
          lines: measureLines.filter(Boolean).map((line) => ({
            baselineY: line.baselineY,
            boundaryGapCount: line.boundaryGapStats.count,
            boundaryGapMad: line.boundaryGapStats.mad,
            boundaryGapMedian: line.boundaryGapStats.median,
            endX: line.endX,
            lineIndex: line.lineIndex,
            referenceGap: line.referenceGap,
            startX: line.startX,
          })),
          page: measure.page,
          systemEndX: system.x + system.width,
          systemIndex: Number.isInteger(system.index)
            ? system.index
            : systemIndex,
          systemStartX: system.x,
        },
        lyric,
        measureId: measure.id,
        measureIndex: measure.measureIndex,
        page: measure.page,
        purityScore:
          accepted.reduce((sum, line) => sum + line.purityScore, 0) /
          accepted.length,
      });
    });

    diagnostics.push({
      laneCount: lyricLines.length,
      lyricRegion: {
        bottom: lyricRegion.bottom,
        top: lyricRegion.top,
      },
      measures: measureDiagnostics,
      rejectedReasonCounts: summarizeRejections(lyricRegion.rejectedItems),
      systemIndex: Number.isInteger(system.index) ? system.index : systemIndex,
    });
  });

  const pageRejectionCounts = summarizeRejections(pageRejectedItems);

  return {
    candidates,
    diagnostics,
    rejectedSamples: createRejectionSamples(pageRejectedItems),
    stats: {
      detectedLaneCount,
      oneLineMeasureCount: candidates.filter(
        (candidate) => candidate.lyricGeometry.lines.length === 1,
      ).length,
      purityRejectCount,
      rejectedChordCount: pageRejectionCounts['chord-like'] || 0,
      rejectedMetadataCount:
        (pageRejectionCounts.metadata || 0) +
        (pageRejectionCounts['metadata-size'] || 0),
      rejectedMusicGlyphCount:
        pageRejectionCounts['music-glyph-font'] || 0,
      twoLineMeasureCount: candidates.filter(
        (candidate) => candidate.lyricGeometry.lines.length >= 2,
      ).length,
    },
  };
}

export function createLyricCandidates(args) {
  return analyzeLyricCandidates(args).candidates;
}

export function applyLyricCandidates(measures, candidates) {
  const candidatesById = new Map(
    (Array.isArray(candidates) ? candidates : []).map((candidate) => [
      candidate.measureId,
      candidate,
    ]),
  );
  let appliedCount = 0;
  let preservedCount = 0;

  const nextMeasures = (Array.isArray(measures) ? measures : []).map((measure) => {
    const candidate = candidatesById.get(measure.id);
    const candidateLyric = candidate?.lyric;

    if (!candidateLyric) return measure;

    const measureWithGeometry = candidate.lyricGeometry
      ? { ...measure, lyricGeometry: candidate.lyricGeometry }
      : measure;

    if (String(measure.lyric || '').trim()) {
      preservedCount += 1;
      return measureWithGeometry;
    }

    appliedCount += 1;
    return { ...measureWithGeometry, lyric: candidateLyric };
  });

  return { appliedCount, measures: nextMeasures, preservedCount };
}
