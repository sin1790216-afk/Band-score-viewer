import { NAVIGATION_ENDING_TYPE } from './navigationEndings.js';
import { NORMALIZED_COORDINATE_SPACE } from './measureCoordinates.js';
import { NAVIGATION_MARKER_TYPES } from './navigationMarkers.js';
import {
  associateNavigationTextWithMeasure,
  NAVIGATION_TEXT_CONFIDENCE,
} from './navigationTextDetection.js';

export const NAVIGATION_GRAPHIC_CANDIDATE_SOURCES = Object.freeze({
  GRAPHICS: 'pdf-graphics',
  HYBRID: 'pdf-hybrid',
});

export const NAVIGATION_VOLTA_ANCHOR_TYPE = 'volta-anchor';

const INK_THRESHOLD = 190;
const VERTICAL_STROKE_CONTINUITY = 0.72;
const MAXIMUM_BAR_PAIR_GAP_IN_STAFF_SPACES = 1.45;
const MINIMUM_BAR_PAIR_GAP_IN_STAFF_SPACES = 0.08;
const BOUNDARY_SEARCH_RADIUS_IN_STAFF_SPACES = 1.8;
const DOT_SIDE_REACH_IN_STAFF_SPACES = 2.1;
const VOLTA_ABOVE_STAFF_REACH_IN_STAFF_SPACES = 5.5;
const VOLTA_MINIMUM_BRACKET_LENGTH_IN_STAFF_SPACES = 2.5;
const VOLTA_LABEL_LINE_REACH_IN_STAFF_SPACES = 0.8;
const VOLTA_MAXIMUM_LINE_THICKNESS_IN_STAFF_SPACES = 0.45;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function getDistanceToRange(value, start, end) {
  if (value < start) return start - value;
  if (value > end) return value - end;
  return 0;
}

function createInkMask(imageData) {
  const { data, height, width } = imageData;
  const mask = new Uint8Array(width * height);

  for (let pixelIndex = 0; pixelIndex < mask.length; pixelIndex += 1) {
    const dataIndex = pixelIndex * 4;
    const alpha = data[dataIndex + 3] / 255;
    const red = data[dataIndex] * alpha + 255 * (1 - alpha);
    const green = data[dataIndex + 1] * alpha + 255 * (1 - alpha);
    const blue = data[dataIndex + 2] * alpha + 255 * (1 - alpha);
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;

    mask[pixelIndex] = luminance <= INK_THRESHOLD ? 1 : 0;
  }

  return mask;
}

function mergeConsecutiveValues(values, maximumGap = 0) {
  if (values.length === 0) return [];

  const groups = [];
  let start = values[0];
  let end = values[0];

  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];

    if (value - end <= maximumGap + 1) {
      end = value;
    } else {
      groups.push({ end, start });
      start = value;
      end = value;
    }
  }

  groups.push({ end, start });
  return groups;
}

function findMeasureSystemIndex(measure, systems) {
  const centerY = Number(measure.y) + Number(measure.height) / 2;

  return systems
    .map((system, index) => ({
      distance: getDistanceToRange(
        centerY,
        Number(system.contentTop),
        Number(system.contentBottom),
      ),
      index,
    }))
    .sort((left, right) => left.distance - right.distance)[0]?.index ?? -1;
}

function getPageMeasures(measures, pageNumber, systems) {
  return (Array.isArray(measures) ? measures : [])
    .map((measure, measureIndex) => ({
      ...measure,
      measureIndex,
      systemIndex: findMeasureSystemIndex(measure, systems),
    }))
    .filter((measure) => Number(measure.page) === Number(pageNumber));
}

function hasInkNear(mask, width, height, x, y, radiusX = 0) {
  const minimumX = clamp(Math.floor(x - radiusX), 0, width - 1);
  const maximumX = clamp(Math.ceil(x + radiusX), 0, width - 1);
  const sampleY = clamp(Math.round(y), 0, height - 1);

  for (let sampleX = minimumX; sampleX <= maximumX; sampleX += 1) {
    if (mask[sampleY * width + sampleX]) return true;
  }

  return false;
}

function getVerticalContinuity(mask, width, height, x, top, bottom) {
  const minimumY = clamp(Math.ceil(top), 0, height - 1);
  const maximumY = clamp(Math.floor(bottom), 0, height - 1);
  const sampleCount = Math.max(1, maximumY - minimumY + 1);
  let hits = 0;

  for (let y = minimumY; y <= maximumY; y += 1) {
    hits += Number(hasInkNear(mask, width, height, x, y));
  }

  return hits / sampleCount;
}

function findVerticalStrokesInRange({
  height,
  mask,
  searchEndX,
  searchStartX,
  staffBottom,
  staffTop,
  width,
}) {
  const minimumX = clamp(Math.floor(searchStartX * width), 0, width - 1);
  const maximumX = clamp(Math.ceil(searchEndX * width), 0, width - 1);
  const qualifyingColumns = [];

  for (let x = minimumX; x <= maximumX; x += 1) {
    if (
      getVerticalContinuity(
        mask,
        width,
        height,
        x,
        staffTop * height,
        staffBottom * height,
      ) >= VERTICAL_STROKE_CONTINUITY
    ) {
      qualifyingColumns.push(x);
    }
  }

  return mergeConsecutiveValues(qualifyingColumns, 1).map((stroke) => ({
    ...stroke,
    center: (stroke.start + stroke.end) / 2,
    continuity: getVerticalContinuity(
      mask,
      width,
      height,
      (stroke.start + stroke.end) / 2,
      staffTop * height,
      staffBottom * height,
    ),
  }));
}

function findBarPairs(strokes, boundaryXPixels, staffSpacingPixels) {
  const pairs = [];

  for (let leftIndex = 0; leftIndex < strokes.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < strokes.length; rightIndex += 1) {
      const left = strokes[leftIndex];
      const right = strokes[rightIndex];
      const gap = right.center - left.center;
      const gapInStaffSpaces = gap / staffSpacingPixels;

      if (
        gapInStaffSpaces < MINIMUM_BAR_PAIR_GAP_IN_STAFF_SPACES ||
        gapInStaffSpaces > MAXIMUM_BAR_PAIR_GAP_IN_STAFF_SPACES
      ) {
        continue;
      }

      const center = (left.center + right.center) / 2;
      const boundaryDistanceInStaffSpaces =
        Math.abs(center - boundaryXPixels) / staffSpacingPixels;

      pairs.push({
        boundaryDistanceInStaffSpaces,
        center,
        gapInStaffSpaces,
        left,
        right,
        score:
          left.continuity +
          right.continuity -
          boundaryDistanceInStaffSpaces * 0.45,
      });
    }
  }

  return pairs.sort(
    (left, right) =>
      right.score - left.score ||
      left.boundaryDistanceInStaffSpaces - right.boundaryDistanceInStaffSpaces,
  );
}

function isNearStaffLine(y, staffTopPixels, staffSpacingPixels) {
  const lineIndex = Math.round((y - staffTopPixels) / staffSpacingPixels);
  const nearestLine = staffTopPixels + lineIndex * staffSpacingPixels;

  return lineIndex >= 0 && lineIndex <= 4 &&
    Math.abs(y - nearestLine) <= staffSpacingPixels * 0.18;
}

function findConnectedInkComponents({
  bottom,
  height,
  left,
  mask,
  right,
  staffSpacingPixels,
  staffTopPixels,
  top,
  width,
}) {
  const minimumX = clamp(Math.floor(left), 0, width - 1);
  const maximumX = clamp(Math.ceil(right), 0, width - 1);
  const minimumY = clamp(Math.floor(top), 0, height - 1);
  const maximumY = clamp(Math.ceil(bottom), 0, height - 1);
  const visited = new Uint8Array(
    Math.max(1, maximumX - minimumX + 1) *
      Math.max(1, maximumY - minimumY + 1),
  );
  const regionWidth = maximumX - minimumX + 1;
  const components = [];

  function getVisitedIndex(x, y) {
    return (y - minimumY) * regionWidth + (x - minimumX);
  }

  for (let y = minimumY; y <= maximumY; y += 1) {
    if (isNearStaffLine(y, staffTopPixels, staffSpacingPixels)) continue;

    for (let x = minimumX; x <= maximumX; x += 1) {
      const visitedIndex = getVisitedIndex(x, y);

      if (visited[visitedIndex] || !mask[y * width + x]) continue;

      const queue = [[x, y]];
      let cursor = 0;
      let componentLeft = x;
      let componentRight = x;
      let componentTop = y;
      let componentBottom = y;
      let area = 0;
      let touchesStaffLineInk = false;

      visited[visitedIndex] = 1;
      while (cursor < queue.length) {
        const [currentX, currentY] = queue[cursor];
        cursor += 1;
        area += 1;
        componentLeft = Math.min(componentLeft, currentX);
        componentRight = Math.max(componentRight, currentX);
        componentTop = Math.min(componentTop, currentY);
        componentBottom = Math.max(componentBottom, currentY);

        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) continue;

            const nextX = currentX + offsetX;
            const nextY = currentY + offsetY;

            if (
              nextX < minimumX ||
              nextX > maximumX ||
              nextY < minimumY ||
              nextY > maximumY
            ) {
              continue;
            }

            if (isNearStaffLine(nextY, staffTopPixels, staffSpacingPixels)) {
              if (mask[nextY * width + nextX]) touchesStaffLineInk = true;
              continue;
            }

            const nextVisitedIndex = getVisitedIndex(nextX, nextY);

            if (visited[nextVisitedIndex] || !mask[nextY * width + nextX]) {
              continue;
            }

            visited[nextVisitedIndex] = 1;
            queue.push([nextX, nextY]);
          }
        }
      }

      components.push({
        area,
        bottom: componentBottom,
        centerX: (componentLeft + componentRight) / 2,
        centerY: (componentTop + componentBottom) / 2,
        height: componentBottom - componentTop + 1,
        left: componentLeft,
        right: componentRight,
        touchesStaffLineInk,
        top: componentTop,
        width: componentRight - componentLeft + 1,
      });
    }
  }

  return components;
}

function findRepeatDotPair({
  barPair,
  direction,
  height,
  mask,
  staffBottom,
  staffSpacing,
  staffTop,
  width,
}) {
  const spacingPixels = staffSpacing * height;
  const staffTopPixels = staffTop * height;
  const staffBottomPixels = staffBottom * height;
  const sideStart = direction === 'right'
    ? barPair.right.end + spacingPixels * 0.25
    : barPair.left.start - spacingPixels * 0.25;
  const sideEnd = direction === 'right'
    ? barPair.right.end + spacingPixels * DOT_SIDE_REACH_IN_STAFF_SPACES
    : barPair.left.start - spacingPixels * DOT_SIDE_REACH_IN_STAFF_SPACES;
  const components = findConnectedInkComponents({
    bottom: staffBottomPixels - spacingPixels * 0.55,
    height,
    left: Math.min(sideStart, sideEnd),
    mask,
    right: Math.max(sideStart, sideEnd),
    staffSpacingPixels: spacingPixels,
    staffTopPixels,
    top: staffTopPixels + spacingPixels * 0.55,
    width,
  }).filter((component) => {
    const widthInStaffSpaces = component.width / spacingPixels;
    const heightInStaffSpaces = component.height / spacingPixels;
    const aspectRatio = widthInStaffSpaces / heightInStaffSpaces;
    const centerPosition =
      (component.centerY - staffTopPixels) / spacingPixels;

    return (
      !component.touchesStaffLineInk &&
      widthInStaffSpaces >= 0.16 &&
      widthInStaffSpaces <= 0.8 &&
      heightInStaffSpaces >= 0.16 &&
      heightInStaffSpaces <= 0.8 &&
      aspectRatio >= 0.5 &&
      aspectRatio <= 2 &&
      centerPosition >= 0.8 &&
      centerPosition <= 3.2 &&
      component.area >= Math.max(1, spacingPixels * spacingPixels * 0.015)
    );
  });
  const pairs = [];

  for (let firstIndex = 0; firstIndex < components.length - 1; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < components.length; secondIndex += 1) {
      const first = components[firstIndex];
      const second = components[secondIndex];
      const upper = first.centerY <= second.centerY ? first : second;
      const lower = upper === first ? second : first;
      const verticalGap = (lower.centerY - upper.centerY) / spacingPixels;
      const horizontalOffset = Math.abs(lower.centerX - upper.centerX) / spacingPixels;
      const upperPosition = (upper.centerY - staffTopPixels) / spacingPixels;
      const lowerPosition = (lower.centerY - staffTopPixels) / spacingPixels;
      const upperPositionOffset = Math.abs(upperPosition - 1.5);
      const lowerPositionOffset = Math.abs(lowerPosition - 2.5);
      const sizeRatio = Math.max(upper.area, lower.area) /
        Math.max(1, Math.min(upper.area, lower.area));
      const nearestDotX = direction === 'right'
        ? Math.min(upper.left, lower.left)
        : Math.max(upper.right, lower.right);
      const dotDistance = direction === 'right'
        ? nearestDotX - barPair.right.end
        : barPair.left.start - nearestDotX;
      const dotDistanceInStaffSpaces = dotDistance / spacingPixels;

      if (
        verticalGap < 0.55 ||
        verticalGap > 1.55 ||
        horizontalOffset > 0.4 ||
        upperPositionOffset > 0.45 ||
        lowerPositionOffset > 0.45 ||
        sizeRatio > 1.8 ||
        dotDistanceInStaffSpaces < 0.15 ||
        dotDistanceInStaffSpaces > DOT_SIDE_REACH_IN_STAFF_SPACES
      ) {
        continue;
      }

      pairs.push({
        dotDistanceInStaffSpaces,
        horizontalOffset,
        lower,
        lowerPosition,
        score:
          4 -
          horizontalOffset -
          upperPositionOffset -
          lowerPositionOffset -
          Math.abs(1 - sizeRatio),
        sizeRatio,
        upper,
        upperPosition,
        verticalGap,
      });
    }
  }

  return pairs.sort((left, right) => right.score - left.score)[0] || null;
}

function createRepeatBounds({ barPair, dotPair, height, staffBottom, staffTop, width }) {
  const left = Math.min(barPair.left.start, dotPair.upper.left, dotPair.lower.left);
  const right = Math.max(barPair.right.end, dotPair.upper.right, dotPair.lower.right);
  const top = Math.min(staffTop * height, dotPair.upper.top);
  const bottom = Math.max(staffBottom * height, dotPair.lower.bottom);

  return {
    coordinateSpace: NORMALIZED_COORDINATE_SPACE,
    height: (bottom - top) / height,
    width: (right - left) / width,
    x: left / width,
    y: top / height,
  };
}

function createRepeatCandidate({
  barPair,
  boundary,
  dotPair,
  height,
  measure,
  pageNumber,
  system,
  width,
}) {
  const spacingPixels = Number(system.staffSpacing) * height;
  const direction = boundary.direction;
  const type = direction === 'right'
    ? NAVIGATION_MARKER_TYPES.REPEAT_START
    : NAVIGATION_MARKER_TYPES.REPEAT_END;
  const hasClearBoundaryAssociation =
    boundary.kind === 'system-start' ||
    barPair.boundaryDistanceInStaffSpaces <= 0.75;
  const confidence = hasClearBoundaryAssociation &&
    dotPair.horizontalOffset <= 0.3 &&
    dotPair.sizeRatio <= 1.35
    ? NAVIGATION_TEXT_CONFIDENCE.HIGH
    : NAVIGATION_TEXT_CONFIDENCE.MEDIUM;

  return {
    bounds: createRepeatBounds({
      barPair,
      dotPair,
      height,
      staffBottom: system.staffBottom,
      staffTop: system.staffTop,
      width,
    }),
    confidence,
    evidence: {
      barEvidence: {
        boundaryDistanceInStaffSpaces: barPair.boundaryDistanceInStaffSpaces,
        centerX: barPair.center / width,
        gapInStaffSpaces: barPair.gapInStaffSpaces,
        leftBounds: {
          end: barPair.left.end / width,
          start: barPair.left.start / width,
        },
        leftContinuity: barPair.left.continuity,
        rightBounds: {
          end: barPair.right.end / width,
          start: barPair.right.start / width,
        },
        rightContinuity: barPair.right.continuity,
      },
      dotEvidence: {
        lowerComponent: {
          area: dotPair.lower.area,
          bottom: dotPair.lower.bottom / height,
          heightInStaffSpaces: dotPair.lower.height / spacingPixels,
          left: dotPair.lower.left / width,
          right: dotPair.lower.right / width,
          top: dotPair.lower.top / height,
          touchesStaffLineInk: dotPair.lower.touchesStaffLineInk,
          widthInStaffSpaces: dotPair.lower.width / spacingPixels,
        },
        distanceFromBarsInStaffSpaces: dotPair.dotDistanceInStaffSpaces,
        horizontalOffsetInStaffSpaces: dotPair.horizontalOffset,
        lowerPositionInStaffSpaces: dotPair.lowerPosition,
        sizeRatio: dotPair.sizeRatio,
        upperComponent: {
          area: dotPair.upper.area,
          bottom: dotPair.upper.bottom / height,
          heightInStaffSpaces: dotPair.upper.height / spacingPixels,
          left: dotPair.upper.left / width,
          right: dotPair.upper.right / width,
          top: dotPair.upper.top / height,
          touchesStaffLineInk: dotPair.upper.touchesStaffLineInk,
          widthInStaffSpaces: dotPair.upper.width / spacingPixels,
        },
        upperPositionInStaffSpaces: dotPair.upperPosition,
        verticalGapInStaffSpaces: dotPair.verticalGap,
      },
      measureAssociation: {
        boundary: direction === 'right' ? 'start' : 'end',
        boundaryKind: boundary.kind,
        boundaryX: boundary.x,
        observedBarX: barPair.center / width,
      },
      rasterEvidence: true,
      staffAssociation: {
        staffBottom: system.staffBottom,
        staffSpacing: system.staffSpacing,
        staffTop: system.staffTop,
        systemIndex: measure.systemIndex,
      },
    },
    id: [
      NAVIGATION_GRAPHIC_CANDIDATE_SOURCES.GRAPHICS,
      pageNumber,
      type,
      measure.measureIndex,
    ].join(':'),
    measureId: measure.id || null,
    measureIndex: measure.measureIndex,
    normalizedText: type,
    pageNumber: Number(pageNumber),
    rawText: direction === 'right' ? '||:' : ':||',
    source: NAVIGATION_GRAPHIC_CANDIDATE_SOURCES.GRAPHICS,
    type,
  };
}

function getRepeatBoundarySearchRange(boundary, height, system, width) {
  const searchRadius = Number(system.staffSpacing) * height /
    width * BOUNDARY_SEARCH_RADIUS_IN_STAFF_SPACES;

  if (boundary.kind === 'system-start' && boundary.rightMeasure) {
    return {
      end: Number(boundary.rightMeasure.x) + Number(boundary.rightMeasure.width),
      start: boundary.x - searchRadius,
    };
  }

  return {
    end: boundary.x + searchRadius,
    start: boundary.x - searchRadius,
  };
}

function detectRepeatAtBoundary({
  boundary,
  height,
  mask,
  pageNumber,
  system,
  width,
}) {
  const spacingPixels = Number(system.staffSpacing) * height;

  if (spacingPixels <= 0) return [];

  const searchRange = getRepeatBoundarySearchRange(
    boundary,
    height,
    system,
    width,
  );
  const strokes = findVerticalStrokesInRange({
    height,
    mask,
    searchEndX: searchRange.end,
    searchStartX: searchRange.start,
    staffBottom: system.staffBottom,
    staffTop: system.staffTop,
    width,
  });
  const barPairs = findBarPairs(
    strokes,
    boundary.x * width,
    spacingPixels,
  );
  const candidates = [];

  [
    { direction: 'left', measure: boundary.leftMeasure },
    { direction: 'right', measure: boundary.rightMeasure },
  ].forEach(({ direction, measure }) => {
    if (!measure) return;

    const matches = barPairs.flatMap((barPair) => {
      const dotPair = findRepeatDotPair({
        barPair,
        direction,
        height,
        mask,
        staffBottom: system.staffBottom,
        staffSpacing: system.staffSpacing,
        staffTop: system.staffTop,
        width,
      });

      if (!dotPair) return [];

      return [{
        barPair,
        dotPair,
        score:
          dotPair.score +
          barPair.left.continuity +
          barPair.right.continuity -
          (boundary.kind === 'system-start'
            ? 0
            : barPair.boundaryDistanceInStaffSpaces * 0.45),
      }];
    });
    const bestMatch = matches.sort((left, right) => right.score - left.score)[0];

    if (!bestMatch) return;

    candidates.push(createRepeatCandidate({
      barPair: bestMatch.barPair,
      boundary: { ...boundary, direction },
      dotPair: bestMatch.dotPair,
      height,
      measure,
      pageNumber,
      system,
      width,
    }));
  });

  return candidates;
}

function createRepeatBoundaries(pageMeasures) {
  const measuresBySystem = new Map();

  pageMeasures.forEach((measure) => {
    const systemMeasures = measuresBySystem.get(measure.systemIndex) || [];
    systemMeasures.push(measure);
    measuresBySystem.set(measure.systemIndex, systemMeasures);
  });

  return [...measuresBySystem.entries()].flatMap(([systemIndex, measures]) => {
    const sorted = [...measures].sort((left, right) => Number(left.x) - Number(right.x));

    if (sorted.length === 0) return [];

    const boundaries = [{
      kind: 'system-start',
      leftMeasure: null,
      rightMeasure: sorted[0],
      systemIndex,
      x: Number(sorted[0].x),
    }];

    for (let index = 1; index < sorted.length; index += 1) {
      const leftMeasure = sorted[index - 1];
      const rightMeasure = sorted[index];
      const leftEnd = Number(leftMeasure.x) + Number(leftMeasure.width);

      boundaries.push({
        kind: 'shared',
        leftMeasure,
        rightMeasure,
        systemIndex,
        x: (leftEnd + Number(rightMeasure.x)) / 2,
      });
    }

    const lastMeasure = sorted.at(-1);
    boundaries.push({
      kind: 'system-end',
      leftMeasure: lastMeasure,
      rightMeasure: null,
      systemIndex,
      x: Number(lastMeasure.x) + Number(lastMeasure.width),
    });

    return boundaries;
  });
}

function parseVoltaPasses(value) {
  const normalized = String(value || '').trim().replace(/\s+/gu, '');
  const singleMatch = /^(\d+)\.$/u.exec(normalized);

  if (singleMatch) {
    const pass = Number(singleMatch[1]);
    return Number.isSafeInteger(pass) && pass > 0 ? [pass] : null;
  }

  const listMatch = /^(\d+(?:[,.]\d+)+)\.$/u.exec(normalized);

  if (!listMatch) return null;

  const passes = [...new Set(listMatch[1].split(/[,.]/u).map(Number))]
    .filter((pass) => Number.isSafeInteger(pass) && pass > 0)
    .sort((left, right) => left - right);

  return passes.length > 1 ? passes : null;
}

function findSystemForVoltaText(item, systems) {
  const baselineY = Number(item.baselineY);

  if (!Number.isFinite(baselineY)) return null;

  return systems
    .map((system, systemIndex) => {
      const staffSpacing = Number(system.staffSpacing) || 0;
      const distanceAbove = Number(system.staffTop) - baselineY;

      return { distanceAbove, staffSpacing, system, systemIndex };
    })
    .filter(
      ({ distanceAbove, staffSpacing }) =>
        staffSpacing > 0 &&
        distanceAbove >= staffSpacing * 0.15 &&
        distanceAbove <= staffSpacing * VOLTA_ABOVE_STAFF_REACH_IN_STAFF_SPACES,
    )
    .sort((left, right) => left.distanceAbove - right.distanceAbove)[0] || null;
}

function getHorizontalRun(mask, width, y, startX, endX, gapTolerance) {
  let best = null;
  let runStart = null;
  let lastInkX = null;

  for (let x = startX; x <= endX; x += 1) {
    const hasInk = Boolean(mask[y * width + x]);

    if (hasInk) {
      if (runStart === null) runStart = x;
      lastInkX = x;
      continue;
    }

    if (runStart !== null && x - lastInkX > gapTolerance) {
      const run = { end: lastInkX, start: runStart };

      if (!best || run.end - run.start > best.end - best.start) best = run;
      runStart = null;
      lastInkX = null;
    }
  }

  if (runStart !== null) {
    const run = { end: lastInkX, start: runStart };
    if (!best || run.end - run.start > best.end - best.start) best = run;
  }

  return best;
}

function getVerticalInkThickness(mask, width, height, x, y) {
  let start = y;
  let end = y;

  while (start > 0 && mask[(start - 1) * width + x]) start -= 1;
  while (end < height - 1 && mask[(end + 1) * width + x]) end += 1;

  return end - start + 1;
}

function findHorizontalBracketEvidence({
  height,
  item,
  mask,
  measure,
  system,
  width,
}) {
  const spacingPixels = Number(system.staffSpacing) * height;
  const labelTop = Number(item.y) * height;
  const labelHeight = Math.max(Number(item.height) * height, spacingPixels * 0.8);
  const minimumY = clamp(
    Math.floor(labelTop - labelHeight - spacingPixels * VOLTA_LABEL_LINE_REACH_IN_STAFF_SPACES),
    0,
    height - 1,
  );
  const maximumY = clamp(
    Math.ceil(
      Math.min(
        labelTop + spacingPixels * 0.25,
        (Number(system.staffTop) - Number(system.staffSpacing) * 0.2) * height,
      ),
    ),
    0,
    height - 1,
  );
  const boundaryX = Number(measure.x) * width;
  const itemLeft = Number(item.x) * width;
  const itemRight = (Number(item.x) + Number(item.width)) * width;
  const searchStartX = clamp(
    Math.floor(Math.min(boundaryX, Number(item.x) * width) - spacingPixels * 0.5),
    0,
    width - 1,
  );
  const searchEndX = clamp(
    Math.ceil(
      Math.max(
        itemRight + spacingPixels * 3,
        (Number(measure.x) + Number(measure.width)) * width,
      ),
    ),
    0,
    width - 1,
  );
  const minimumLength = spacingPixels * VOLTA_MINIMUM_BRACKET_LENGTH_IN_STAFF_SPACES;
  const gapTolerance = Math.max(1, Math.round(spacingPixels * 0.08));
  const runs = [];

  for (let y = minimumY; y <= maximumY; y += 1) {
    const run = getHorizontalRun(
      mask,
      width,
      y,
      searchStartX,
      searchEndX,
      gapTolerance,
    );

    if (!run || run.end - run.start < minimumLength) continue;

    const startsNearBoundary =
      Math.abs(run.start - boundaryX) <= spacingPixels * 2.2 ||
      Math.abs(run.start - itemLeft) <= spacingPixels * 2.2 ||
      Math.abs(run.start - itemRight) <= spacingPixels * 2.2;

    if (!startsNearBoundary) continue;

    const sampleXs = [0.25, 0.5, 0.75].map((ratio) =>
      Math.round(run.start + (run.end - run.start) * ratio)
    );
    const minimumThickness = Math.min(
      ...sampleXs.map((x) => getVerticalInkThickness(mask, width, height, x, y)),
    );

    if (
      minimumThickness >
      spacingPixels * VOLTA_MAXIMUM_LINE_THICKNESS_IN_STAFF_SPACES
    ) {
      continue;
    }

    runs.push({
      ...run,
      anchor: 'label-relative',
      lengthInStaffSpaces: (run.end - run.start) / spacingPixels,
      thicknessInStaffSpaces: minimumThickness / spacingPixels,
      y,
    });
  }

  return runs.sort(
    (left, right) =>
      right.lengthInStaffSpaces - left.lengthInStaffSpaces || left.y - right.y,
  )[0] || null;
}

function findNearbyRepeatEvidence(measure, repeatCandidates) {
  const measureSystemIndex = Number(measure.systemIndex);

  return repeatCandidates
    .filter((candidate) =>
      candidate.type === NAVIGATION_MARKER_TYPES.REPEAT_START ||
      candidate.type === NAVIGATION_MARKER_TYPES.REPEAT_END
    )
    .map((candidate) => ({
      candidate,
      distance: Math.abs(candidate.measureIndex - measure.measureIndex),
      sameSystem:
        Number(candidate.evidence.staffAssociation?.systemIndex) === measureSystemIndex,
    }))
    .filter(({ distance, sameSystem }) => sameSystem && distance <= 1)
    .sort((left, right) => left.distance - right.distance)[0] || null;
}

function findExistingEndingEvidence(measure, measures, passes) {
  const serializedPasses = JSON.stringify(passes);

  return measures
    .flatMap((candidate) => candidate.navigationEndings || [])
    .find((ending) =>
      ending?.type === NAVIGATION_ENDING_TYPE &&
      ending.startMeasureId === measure.id &&
      JSON.stringify(ending.passes) === serializedPasses
    ) || null;
}

function createVoltaBounds(item, bracket, width, height) {
  const left = Math.min(
    Number(item.x) * width,
    bracket?.start ?? Number.POSITIVE_INFINITY,
  );
  const top = Math.min(
    Number(item.y) * height,
    bracket?.y ?? Number.POSITIVE_INFINITY,
  );
  const right = Math.max(
    (Number(item.x) + Number(item.width)) * width,
    bracket?.end ?? Number.NEGATIVE_INFINITY,
  );
  const bottom = (Number(item.y) + Number(item.height)) * height;

  return {
    coordinateSpace: NORMALIZED_COORDINATE_SPACE,
    height: Math.max(0, bottom - top) / height,
    width: Math.max(0, right - left) / width,
    x: left / width,
    y: top / height,
  };
}

function detectVoltaCandidates({
  height,
  mask,
  measures,
  pageNumber,
  repeatCandidates,
  systems,
  textItems,
  width,
}) {
  return textItems.flatMap((item) => {
    const passes = parseVoltaPasses(item.text);

    if (!passes) return [];

    const systemAssociation = findSystemForVoltaText(item, systems);

    if (!systemAssociation) return [];

    const { system, systemIndex } = systemAssociation;
    const measureAssociation = associateNavigationTextWithMeasure({
      bounds: {
        height: Number(item.height) || 0,
        width: Number(item.width) || 0,
        x: Number(item.x) || 0,
        y: Number(item.y) || 0,
      },
      measures,
      system,
      systemIndex,
      systems,
    });

    if (!measureAssociation.measureId) return [];

    const measure = measures.find(
      (candidate) => candidate.measureIndex === measureAssociation.measureIndex,
    );

    if (!measure) return [];

    const distanceToStart = Math.abs(Number(item.x) - Number(measure.x));
    const maximumStartDistance = Math.max(
      Number(system.staffSpacing) * 3,
      Number(measure.width) * 0.25,
    );
    const nearMeasureStart = distanceToStart <= maximumStartDistance;
    const bracket = findHorizontalBracketEvidence({
      height,
      item,
      mask,
      measure,
      system,
      width,
    });
    const nearbyRepeat = findNearbyRepeatEvidence(measure, repeatCandidates);
    const existingEnding = findExistingEndingEvidence(measure, measures, passes);
    const detectionPath = bracket ? 'graphic-bracket' : 'text-structure';

    if (!bracket && !nearMeasureStart) {
      if (import.meta.env?.DEV) {
        console.debug('[VoltaGraphicDetection]', {
          accepted: false,
          bracketFound: false,
          labelBounds: {
            height: item.height,
            width: item.width,
            x: item.x,
            y: item.y,
          },
          measure: `M${measure.measureIndex + 1}`,
          nearMeasureStart,
          reason: 'not-near-measure-start',
          text: item.text,
        });
      }

      return [];
    }

    if (!bracket && !nearbyRepeat && !existingEnding) return [];

    const confidence = bracket || (
      measureAssociation.associationConfidence === NAVIGATION_TEXT_CONFIDENCE.HIGH &&
      (existingEnding || nearbyRepeat?.distance === 0)
    )
      ? NAVIGATION_TEXT_CONFIDENCE.HIGH
      : NAVIGATION_TEXT_CONFIDENCE.MEDIUM;
    const sourceIndex = Number.isInteger(item.sourceIndex) ? item.sourceIndex : 0;

    if (import.meta.env?.DEV) {
      console.debug('[VoltaGraphicDetection]', {
        accepted: true,
        bracketAnchor: bracket?.anchor || null,
        bracketFound: Boolean(bracket),
        graphicConfidence: confidence,
        labelBounds: {
          height: item.height,
          width: item.width,
          x: item.x,
          y: item.y,
        },
        measure: `M${measure.measureIndex + 1}`,
        nearMeasureStart,
        text: item.text,
      });
    }

    return [{
      bounds: createVoltaBounds(item, bracket, width, height),
      confidence,
      evidence: {
        detectionPath,
        endingStructure: existingEnding
          ? {
              id: existingEnding.id,
              passes: existingEnding.passes,
              repeatEndMeasureId: existingEnding.repeatEndMeasureId,
              repeatStartMeasureId: existingEnding.repeatStartMeasureId,
            }
          : null,
        horizontalBracket: bracket
          ? {
              anchor: bracket.anchor,
              endX: bracket.end / width,
              lengthInStaffSpaces: bracket.lengthInStaffSpaces,
              startX: bracket.start / width,
              thicknessInStaffSpaces: bracket.thicknessInStaffSpaces,
              y: bracket.y / height,
            }
          : null,
        measureAssociation: measureAssociation.evidence,
        nearMeasureStart,
        repeatStructure: nearbyRepeat
          ? {
              distance: nearbyRepeat.distance,
              measureId: nearbyRepeat.candidate.measureId,
              measureIndex: nearbyRepeat.candidate.measureIndex,
              type: nearbyRepeat.candidate.type,
            }
          : null,
        staffAssociation: {
          distanceAboveInStaffSpaces:
            systemAssociation.distanceAbove / systemAssociation.staffSpacing,
          staffBottom: system.staffBottom,
          staffSpacing: system.staffSpacing,
          staffTop: system.staffTop,
          systemIndex,
        },
        textEvidence: {
          baselineY: item.baselineY,
          sourceIndex,
          text: item.text,
        },
      },
      id: [
        NAVIGATION_GRAPHIC_CANDIDATE_SOURCES.HYBRID,
        pageNumber,
        NAVIGATION_VOLTA_ANCHOR_TYPE,
        passes.join('-'),
        sourceIndex,
      ].join(':'),
      measureId: measureAssociation.measureId,
      measureIndex: measureAssociation.measureIndex,
      normalizedText: `${passes.join(',')}.`,
      pageNumber: Number(pageNumber),
      passes,
      rawText: item.text,
      source: NAVIGATION_GRAPHIC_CANDIDATE_SOURCES.HYBRID,
      type: NAVIGATION_VOLTA_ANCHOR_TYPE,
    }];
  });
}

function deduplicateCandidates(candidates) {
  const unique = new Map();

  candidates.forEach((candidate) => {
    const key = [
      candidate.type,
      candidate.measureIndex,
      ...(candidate.passes || []),
    ].join(':');
    const existing = unique.get(key);
    const confidenceRank = {
      [NAVIGATION_TEXT_CONFIDENCE.HIGH]: 3,
      [NAVIGATION_TEXT_CONFIDENCE.MEDIUM]: 2,
      [NAVIGATION_TEXT_CONFIDENCE.LOW]: 1,
    };

    if (
      !existing ||
      confidenceRank[candidate.confidence] > confidenceRank[existing.confidence]
    ) {
      unique.set(key, candidate);
    }
  });

  return [...unique.values()].sort(
    (left, right) =>
      left.measureIndex - right.measureIndex || left.type.localeCompare(right.type),
  );
}

export function detectNavigationGraphicCandidates({
  imageData,
  measures,
  pageNumber,
  systems,
  textItems,
}) {
  const width = Number(imageData?.width) || 0;
  const height = Number(imageData?.height) || 0;
  const safeSystems = Array.isArray(systems) ? systems : [];
  const safeTextItems = Array.isArray(textItems) ? textItems : [];

  if (!imageData?.data || width <= 0 || height <= 0 || safeSystems.length === 0) {
    return {
      candidates: [],
      diagnostics: { candidateCount: 0, pageNumber: Number(pageNumber), systems: [] },
    };
  }

  const mask = createInkMask(imageData);
  const pageMeasures = getPageMeasures(measures, pageNumber, safeSystems);
  const repeatBoundaries = createRepeatBoundaries(pageMeasures);
  const repeatCandidates = repeatBoundaries.flatMap((boundary) => {
    const system = safeSystems[boundary.systemIndex];

    if (!system) return [];

    return detectRepeatAtBoundary({
      boundary,
      height,
      mask,
      pageNumber,
      system,
      width,
    });
  });
  const voltaCandidates = detectVoltaCandidates({
    height,
    mask,
    measures: pageMeasures,
    pageNumber,
    repeatCandidates,
    systems: safeSystems,
    textItems: safeTextItems,
    width,
  });
  const candidates = deduplicateCandidates([
    ...repeatCandidates,
    ...voltaCandidates,
  ]);

  return {
    candidates,
    diagnostics: {
      candidateCount: candidates.length,
      pageNumber: Number(pageNumber),
      repeatBoundaryCount: repeatBoundaries.length,
      systems: safeSystems.map((system, systemIndex) => ({
        candidateCount: candidates.filter(
          (candidate) => candidate.evidence.staffAssociation.systemIndex === systemIndex,
        ).length,
        staffBottom: system.staffBottom,
        staffSpacing: system.staffSpacing,
        staffTop: system.staffTop,
        systemIndex,
      })),
    },
  };
}

export function isVoltaAnchorCandidate(candidate) {
  return candidate?.type === NAVIGATION_VOLTA_ANCHOR_TYPE &&
    Array.isArray(candidate.passes) &&
    candidate.passes.length > 0;
}

export function getNavigationGraphicCandidateSemanticType(candidate) {
  return isVoltaAnchorCandidate(candidate)
    ? NAVIGATION_ENDING_TYPE
    : candidate?.type;
}
