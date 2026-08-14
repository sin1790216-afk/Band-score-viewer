const DEFAULT_OPTIONS = {
  attachedBranchMinimumLengthInStaffSpaces: 0.55,
  attachedBranchMinimumThicknessInStaffSpaces: 0.4,
  attachedBranchReachInStaffSpaces: 1.5,
  attachedBranchStaffLineExclusionInStaffSpaces: 0.2,
  barlineContinuityRatio: 0.99,
  barlineOutsideInkRatio: 0.3,
  diagnosticBarlineContinuityRatio: 0.65,
  diagnosticBarlineOutsideInkRatio: 0.5,
  inkThreshold: 190,
  maximumRecoveredBarlinesPerSystem: 8,
  minimumFirstMeasureWidthInStaffSpaces: 22,
  minimumMeasureWidthInStaffSpaces: 14,
  minimumStaffWidthRatio: 0.25,
  oversizedMeasureWidthRatio: 1.65,
  recoveryBarlineContinuityRatio: 0.93,
  recoveryBarlineOutsideInkRatio: 0.3,
  rowCoverageRatio: 0.28,
};

export const DEFAULT_TARGET_RENDER_WIDTH = 1400;
export const DEFAULT_MAX_RENDER_SCALE = 3;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function getMedian(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function createInkMask(imageData, inkThreshold) {
  const { data, height, width } = imageData;
  const mask = new Uint8Array(width * height);

  for (let pixelIndex = 0; pixelIndex < mask.length; pixelIndex += 1) {
    const dataIndex = pixelIndex * 4;
    const alpha = data[dataIndex + 3] / 255;
    const red = data[dataIndex] * alpha + 255 * (1 - alpha);
    const green = data[dataIndex + 1] * alpha + 255 * (1 - alpha);
    const blue = data[dataIndex + 2] * alpha + 255 * (1 - alpha);
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;

    mask[pixelIndex] = luminance <= inkThreshold ? 1 : 0;
  }

  return mask;
}

function mergeConsecutiveValues(values, maximumGap = 1) {
  if (values.length === 0) return [];

  const groups = [];
  let start = values[0];
  let end = values[0];

  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];

    if (value - end <= maximumGap + 1) {
      end = value;
      continue;
    }

    groups.push({ end, start });
    start = value;
    end = value;
  }

  groups.push({ end, start });
  return groups;
}

function findHorizontalBands(mask, width, height, options) {
  const minimumInkPixels = width * options.rowCoverageRatio;
  const candidateRows = [];

  for (let y = 0; y < height; y += 1) {
    let inkPixels = 0;
    const rowOffset = y * width;

    for (let x = 0; x < width; x += 1) {
      inkPixels += mask[rowOffset + x];
    }

    if (inkPixels >= minimumInkPixels) candidateRows.push(y);
  }

  const maximumLineThickness = Math.max(6, Math.round(height * 0.004));

  return mergeConsecutiveValues(candidateRows)
    .map(({ end, start }) => ({
      center: (start + end) / 2,
      end,
      start,
      thickness: end - start + 1,
    }))
    .filter((band) => band.thickness <= maximumLineThickness);
}

function isStaffSequence(bands) {
  const gaps = bands.slice(1).map((band, index) => band.center - bands[index].center);
  const minimumGap = Math.min(...gaps);
  const maximumGap = Math.max(...gaps);
  const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;

  return (
    minimumGap >= 3 &&
    maximumGap / minimumGap <= 1.45 &&
    gaps.every((gap) => Math.abs(gap - averageGap) <= averageGap * 0.25)
  );
}

function findStaffGroups(horizontalBands) {
  const staffGroups = [];

  for (let index = 0; index <= horizontalBands.length - 5; index += 1) {
    const bands = horizontalBands.slice(index, index + 5);

    if (!isStaffSequence(bands)) continue;

    const spacing =
      (bands[4].center - bands[0].center) / Math.max(1, bands.length - 1);

    staffGroups.push({ bands, spacing });
    index += 4;
  }

  return staffGroups;
}

function hasInkNear(mask, width, height, x, y, radius) {
  const minimumY = clamp(Math.floor(y - radius), 0, height - 1);
  const maximumY = clamp(Math.ceil(y + radius), 0, height - 1);

  for (let sampleY = minimumY; sampleY <= maximumY; sampleY += 1) {
    if (mask[sampleY * width + x]) return true;
  }

  return false;
}

function findStaffHorizontalRange(mask, width, height, staffGroup, options) {
  const activeColumns = [];
  const sampleRadius = Math.max(
    1,
    Math.ceil(Math.max(...staffGroup.bands.map((band) => band.thickness)) / 2),
  );

  for (let x = 0; x < width; x += 1) {
    const lineHits = staffGroup.bands.reduce(
      (count, band) =>
        count + Number(hasInkNear(mask, width, height, x, band.center, sampleRadius)),
      0,
    );

    if (lineHits >= 3) activeColumns.push(x);
  }

  if (activeColumns.length === 0) return null;

  const ranges = mergeConsecutiveValues(
    activeColumns,
    Math.max(2, Math.round(staffGroup.spacing * 0.5)),
  );
  const widestRange = ranges.reduce((widest, range) =>
    range.end - range.start > widest.end - widest.start ? range : widest,
  );

  if (widestRange.end - widestRange.start < width * options.minimumStaffWidthRatio) {
    return null;
  }

  return widestRange;
}

function getGapInkRatio(mask, width, height, x, startY, endY) {
  const minimumY = clamp(Math.ceil(startY), 0, height - 1);
  const maximumY = clamp(Math.floor(endY), 0, height - 1);
  const sampleCount = Math.max(1, maximumY - minimumY + 1);
  let inkCount = 0;

  for (let y = minimumY; y <= maximumY; y += 1) {
    let hasInk = false;

    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const sampleX = x + offsetX;

      if (sampleX >= 0 && sampleX < width && mask[y * width + sampleX]) {
        hasInk = true;
        break;
      }
    }

    inkCount += Number(hasInk);
  }

  return inkCount / sampleCount;
}

function getAttachedInkRun(mask, width, y, startX, direction, maximumLength) {
  let runLength = 0;

  for (let step = 0; step < maximumLength; step += 1) {
    const x = startX + step * direction;

    if (x < 0 || x >= width || !mask[y * width + x]) break;
    runLength += 1;
  }

  return runLength;
}

function hasAttachedSideBranch(
  mask,
  width,
  height,
  staffGroup,
  strokeGroup,
  options,
) {
  const firstLine = staffGroup.bands[0].center;
  const lastLine = staffGroup.bands.at(-1).center;
  const maximumBranchLength = Math.ceil(
    staffGroup.spacing * options.attachedBranchReachInStaffSpaces,
  );
  const minimumBranchLength = Math.ceil(
    staffGroup.spacing * options.attachedBranchMinimumLengthInStaffSpaces,
  );
  const minimumBranchThickness = Math.ceil(
    staffGroup.spacing * options.attachedBranchMinimumThicknessInStaffSpaces,
  );
  const staffLineExclusion =
    staffGroup.spacing * options.attachedBranchStaffLineExclusionInStaffSpaces;
  const verticalReach = staffGroup.spacing * options.attachedBranchReachInStaffSpaces;
  const minimumY = clamp(Math.floor(firstLine - verticalReach), 0, height - 1);
  const maximumY = clamp(Math.ceil(lastLine + verticalReach), 0, height - 1);
  const branchRows = [];

  for (let y = minimumY; y <= maximumY; y += 1) {
    const isStaffLine = staffGroup.bands.some(
      (band) =>
        y >= band.start - staffLineExclusion &&
        y <= band.end + staffLineExclusion,
    );

    if (isStaffLine) continue;

    let hasStrokeInk = false;

    for (let x = strokeGroup.start; x <= strokeGroup.end; x += 1) {
      if (mask[y * width + x]) {
        hasStrokeInk = true;
        break;
      }
    }

    if (!hasStrokeInk) continue;

    const leftRun = getAttachedInkRun(
      mask,
      width,
      y,
      strokeGroup.start - 1,
      -1,
      maximumBranchLength,
    );
    const rightRun = getAttachedInkRun(
      mask,
      width,
      y,
      strokeGroup.end + 1,
      1,
      maximumBranchLength,
    );

    if (Math.max(leftRun, rightRun) >= minimumBranchLength) {
      branchRows.push(y);
    }
  }

  return mergeConsecutiveValues(
    branchRows,
    Math.floor(staffGroup.spacing * 0.1),
  ).some(({ end, start }) => end - start + 1 >= minimumBranchThickness);
}

function getBarlineColumnMetrics(
  mask,
  width,
  height,
  staffGroup,
  x,
) {
  const firstLine = staffGroup.bands[0].center;
  const lastLine = staffGroup.bands.at(-1).center;
  const exteriorInset = staffGroup.spacing * 0.5;
  const exteriorDepth = staffGroup.spacing * 2.5;
  const continuityRatio = getGapInkRatio(
    mask,
    width,
    height,
    x,
    firstLine,
    lastLine,
  );
  const upperOutsideInkRatio = getGapInkRatio(
    mask,
    width,
    height,
    x,
    firstLine - exteriorDepth,
    firstLine - exteriorInset,
  );
  const lowerOutsideInkRatio = getGapInkRatio(
    mask,
    width,
    height,
    x,
    lastLine + exteriorInset,
    lastLine + exteriorDepth,
  );
  const staffLineSampleRadius = Math.max(
    1,
    Math.ceil(Math.max(...staffGroup.bands.map((band) => band.thickness)) / 2),
  );
  const staffLineIntersectionRatio =
    staffGroup.bands.reduce(
      (count, band) =>
        count +
        Number(
          hasInkNear(
            mask,
            width,
            height,
            x,
            band.center,
            staffLineSampleRadius,
          ),
        ),
      0,
    ) / staffGroup.bands.length;

  return {
    continuityRatio,
    lowerOutsideInkRatio,
    outsideInkRatio: Math.max(
      upperOutsideInkRatio,
      lowerOutsideInkRatio,
    ),
    staffLineIntersectionRatio,
    upperOutsideInkRatio,
    x,
  };
}

function getBestStrokeMetrics(columnMetrics, strokeGroup) {
  return columnMetrics
    .slice(strokeGroup.start, strokeGroup.end + 1)
    .reduce((best, metrics) => {
      if (!best) return metrics;
      if (metrics.continuityRatio !== best.continuityRatio) {
        return metrics.continuityRatio > best.continuityRatio ? metrics : best;
      }
      if (metrics.staffLineIntersectionRatio !== best.staffLineIntersectionRatio) {
        return metrics.staffLineIntersectionRatio >
          best.staffLineIntersectionRatio
          ? metrics
          : best;
      }

      return metrics.outsideInkRatio < best.outsideInkRatio ? metrics : best;
    }, null);
}

function findBarlineAnalysis(
  mask,
  width,
  height,
  staffGroup,
  staffRange,
  options,
) {
  const columnMetrics = Array.from({ length: width }, (_, x) =>
    getBarlineColumnMetrics(mask, width, height, staffGroup, x),
  );
  const strictColumns = [];
  const diagnosticColumns = [];

  for (let x = staffRange.start; x <= staffRange.end; x += 1) {
    const metrics = columnMetrics[x];

    if (
      metrics.continuityRatio >= options.barlineContinuityRatio &&
      metrics.outsideInkRatio <= options.barlineOutsideInkRatio
    ) {
      strictColumns.push(x);
    }

    if (
      metrics.continuityRatio >= options.diagnosticBarlineContinuityRatio &&
      metrics.outsideInkRatio <= options.diagnosticBarlineOutsideInkRatio
    ) {
      diagnosticColumns.push(x);
    }
  }

  const strictStrokes = mergeConsecutiveValues(strictColumns, 1).map(
    (strokeGroup) => ({
      attachedSideBranch: hasAttachedSideBranch(
        mask,
        width,
        height,
        staffGroup,
        strokeGroup,
        options,
      ),
      center: (strokeGroup.start + strokeGroup.end) / 2,
      metrics: getBestStrokeMetrics(columnMetrics, strokeGroup),
      strokeGroup,
    }),
  );
  const acceptedStrokes = strictStrokes.filter(
    (stroke) => !stroke.attachedSideBranch,
  );
  const diagnosticStrokes = mergeConsecutiveValues(diagnosticColumns, 1).map(
    (strokeGroup) => {
      const metrics = getBestStrokeMetrics(columnMetrics, strokeGroup);
      const center = metrics?.x ?? (strokeGroup.start + strokeGroup.end) / 2;
      const attachedSideBranch = hasAttachedSideBranch(
        mask,
        width,
        height,
        staffGroup,
        strokeGroup,
        options,
      );
      const acceptedStroke = acceptedStrokes.find(
        (stroke) =>
          stroke.strokeGroup.end >= strokeGroup.start &&
          stroke.strokeGroup.start <= strokeGroup.end,
      );
      const recoverable =
        !attachedSideBranch &&
        metrics.continuityRatio >= options.recoveryBarlineContinuityRatio &&
        metrics.outsideInkRatio <= options.recoveryBarlineOutsideInkRatio &&
        metrics.staffLineIntersectionRatio === 1;
      let rejectedReason = '';

      if (!acceptedStroke) {
        if (attachedSideBranch) rejectedReason = 'attached-side-branch';
        else if (
          metrics.continuityRatio < options.recoveryBarlineContinuityRatio
        ) {
          rejectedReason = 'insufficient-continuity';
        } else if (
          metrics.outsideInkRatio > options.recoveryBarlineOutsideInkRatio
        ) {
          rejectedReason = 'outside-ink';
        } else if (metrics.staffLineIntersectionRatio < 1) {
          rejectedReason = 'incomplete-staff-intersections';
        } else {
          rejectedReason = 'below-strict-threshold';
        }
      }

      return {
        accepted: Boolean(acceptedStroke),
        attachedSideBranch,
        center: acceptedStroke?.center ?? center,
        metrics,
        recoverable,
        rejectedReason,
        strokeGroup,
      };
    },
  );

  return {
    acceptedCenters: acceptedStrokes.map((stroke) => stroke.center),
    acceptedStrokes,
    diagnosticStrokes,
    recoveryCandidates: diagnosticStrokes.filter(
      (stroke) => stroke.recoverable,
    ),
  };
}

function getMinimumMeasureWidth(staffSpacing, options) {
  return Math.max(
    staffSpacing * options.minimumMeasureWidthInStaffSpaces,
    8,
  );
}

function getMeasureBoundaries(staffRange, barlineCenters, staffSpacing, options) {
  const edgeMergeDistance = Math.max(3, staffSpacing * 1.4);
  const rawBoundaries = [staffRange.start, ...barlineCenters, staffRange.end].sort(
    (left, right) => left - right,
  );
  const boundaries = [];

  rawBoundaries.forEach((boundary) => {
    const previousBoundary = boundaries.at(-1);

    if (previousBoundary === undefined || boundary - previousBoundary > edgeMergeDistance) {
      boundaries.push(boundary);
      return;
    }

    if (
      previousBoundary !== staffRange.start &&
      boundary !== staffRange.end
    ) {
      boundaries[boundaries.length - 1] = (previousBoundary + boundary) / 2;
    }
  });

  if (boundaries[0] !== staffRange.start) boundaries.unshift(staffRange.start);
  if (boundaries.at(-1) !== staffRange.end) boundaries.push(staffRange.end);

  const minimumMeasureWidth = getMinimumMeasureWidth(staffSpacing, options);
  const minimumFirstMeasureWidth = Math.max(
    staffSpacing * options.minimumFirstMeasureWidthInStaffSpaces,
    minimumMeasureWidth,
  );
  const filtered = [boundaries[0]];

  boundaries.slice(1, -1).forEach((boundary) => {
    const requiredWidth =
      filtered.length === 1 ? minimumFirstMeasureWidth : minimumMeasureWidth;

    if (boundary - filtered.at(-1) >= requiredWidth) filtered.push(boundary);
  });

  const rightEdge = boundaries.at(-1);

  if (rightEdge - filtered.at(-1) < minimumMeasureWidth && filtered.length > 1) {
    filtered.pop();
  }

  filtered.push(rightEdge);
  return filtered;
}

function getMeasureWidthStatistics(boundaries, staffSpacing) {
  const widths = boundaries
    .slice(0, -1)
    .map((boundary, index) => boundaries[index + 1] - boundary);

  if (widths.length === 0) {
    return {
      lowerQuartileWidth: 0,
      madWidth: 0,
      medianWidth: 0,
      widths,
      widthsInStaffSpaces: [],
    };
  }

  const sortedWidths = [...widths].sort((left, right) => left - right);
  const medianWidth = getMedian(widths);
  const madWidth = getMedian(
    widths.map((measureWidth) => Math.abs(measureWidth - medianWidth)),
  );
  const lowerQuartileWidth =
    sortedWidths[Math.floor((sortedWidths.length - 1) * 0.25)];

  return {
    lowerQuartileWidth,
    madWidth,
    medianWidth,
    widths,
    widthsInStaffSpaces: widths.map(
      (measureWidth) => measureWidth / staffSpacing,
    ),
  };
}

function findOversizedMeasureIndexes(boundaries, staffSpacing, options) {
  const statistics = getMeasureWidthStatistics(boundaries, staffSpacing);

  if (statistics.widths.length < 2 || statistics.lowerQuartileWidth <= 0) {
    return { indexes: [], statistics };
  }

  const minimumExcess = getMinimumMeasureWidth(staffSpacing, options);
  const oversizedThreshold =
    statistics.lowerQuartileWidth * options.oversizedMeasureWidthRatio;
  const indexes = statistics.widths.flatMap((measureWidth, index) =>
    measureWidth >= oversizedThreshold &&
    measureWidth - statistics.lowerQuartileWidth >= minimumExcess
      ? [index]
      : [],
  );

  return { indexes, statistics };
}

function getRecoveryCandidateScore(
  candidate,
  leftWidth,
  rightWidth,
  referenceWidth,
) {
  const widthFit =
    Math.abs(leftWidth / referenceWidth - 1) +
    Math.abs(rightWidth / referenceWidth - 1);
  const continuityPenalty = 1 - candidate.metrics.continuityRatio;
  const outsideInkPenalty = candidate.metrics.outsideInkRatio;

  return widthFit + continuityPenalty + outsideInkPenalty;
}

function findBestRecoverySplit({
  boundaries,
  candidates,
  options,
  staffSpacing,
}) {
  const { indexes, statistics } = findOversizedMeasureIndexes(
    boundaries,
    staffSpacing,
    options,
  );
  const minimumMeasureWidth = getMinimumMeasureWidth(staffSpacing, options);
  let bestSplit = null;

  indexes.forEach((boundaryIndex) => {
    const left = boundaries[boundaryIndex];
    const right = boundaries[boundaryIndex + 1];
    const regionWidth = right - left;
    const beforeMaximumError = Math.abs(
      regionWidth / statistics.lowerQuartileWidth - 1,
    );

    candidates.forEach((candidate) => {
      if (candidate.center <= left || candidate.center >= right) return;

      const leftWidth = candidate.center - left;
      const rightWidth = right - candidate.center;

      if (
        leftWidth < minimumMeasureWidth ||
        rightWidth < minimumMeasureWidth
      ) {
        return;
      }

      const afterMaximumError = Math.max(
        Math.abs(leftWidth / statistics.lowerQuartileWidth - 1),
        Math.abs(rightWidth / statistics.lowerQuartileWidth - 1),
      );

      if (afterMaximumError >= beforeMaximumError) return;

      const score = getRecoveryCandidateScore(
        candidate,
        leftWidth,
        rightWidth,
        statistics.lowerQuartileWidth,
      );

      if (!bestSplit || score < bestSplit.score) {
        bestSplit = {
          boundaryIndex,
          candidate,
          left,
          leftWidth,
          right,
          rightWidth,
          score,
        };
      }
    });
  });

  return { bestSplit, statistics, suspiciousIndexes: indexes };
}

function recoverOversizedMeasureBoundaries({
  barlineAnalysis,
  boundaries: initialBoundaries,
  options,
  staffSpacing,
}) {
  let boundaries = [...initialBoundaries];
  const recovered = [];
  const initialOversized = findOversizedMeasureIndexes(
    boundaries,
    staffSpacing,
    options,
  );

  for (
    let pass = 0;
    pass < options.maximumRecoveredBarlinesPerSystem;
    pass += 1
  ) {
    const { bestSplit } = findBestRecoverySplit({
      boundaries,
      candidates: barlineAnalysis.recoveryCandidates.filter(
        (candidate) =>
          !recovered.some((item) => item.x === candidate.center),
      ),
      options,
      staffSpacing,
    });

    if (!bestSplit) break;

    boundaries.splice(bestSplit.boundaryIndex + 1, 0, bestSplit.candidate.center);
    recovered.push({
      continuityRatio: bestSplit.candidate.metrics.continuityRatio,
      leftWidthInStaffSpaces: bestSplit.leftWidth / staffSpacing,
      outsideInkRatio: bestSplit.candidate.metrics.outsideInkRatio,
      pass,
      rightWidthInStaffSpaces: bestSplit.rightWidth / staffSpacing,
      staffLineIntersectionRatio:
        bestSplit.candidate.metrics.staffLineIntersectionRatio,
      x: bestSplit.candidate.center,
    });
  }

  return {
    boundaries,
    finalStatistics: getMeasureWidthStatistics(boundaries, staffSpacing),
    initialBoundaries: [...initialBoundaries],
    initialStatistics: initialOversized.statistics,
    initiallySuspiciousIndexes: initialOversized.indexes,
    recovered,
  };
}

export function getStaffContentRanges(staffGroups, pageHeight) {
  if (!Array.isArray(staffGroups) || staffGroups.length === 0 || pageHeight <= 0) {
    return [];
  }

  return staffGroups.map((staffGroup, staffIndex) => {
    const firstLine = staffGroup.bands[0].center;
    const lastLine = staffGroup.bands.at(-1).center;
    const previousStaff = staffGroups[staffIndex - 1];
    const nextStaff = staffGroups[staffIndex + 1];
    const previousBoundary = previousStaff
      ? (previousStaff.bands.at(-1).center + firstLine) / 2
      : nextStaff
        ? firstLine - (nextStaff.bands[0].center - lastLine) / 2
        : firstLine - staffGroup.spacing * 4;
    const nextBoundary = nextStaff
      ? (lastLine + nextStaff.bands[0].center) / 2
      : previousStaff
        ? lastLine + (firstLine - previousStaff.bands.at(-1).center) / 2
        : lastLine + staffGroup.spacing * 6;

    return {
      bottom: clamp(nextBoundary, firstLine, pageHeight),
      top: clamp(previousBoundary, 0, lastLine),
    };
  });
}

function createSystemRecognitionDiagnostics({
  barlineAnalysis,
  height,
  recovery,
  staffGroup,
  systemIndex,
  width,
}) {
  const finalBoundaries = recovery.boundaries;
  const toNormalizedX = (value) => value / width;
  const getNeighborDistanceInStaffSpaces = (x) =>
    Math.min(...finalBoundaries.map((boundary) => Math.abs(boundary - x))) /
    staffGroup.spacing;

  return {
    acceptedBarlineX: barlineAnalysis.acceptedCenters.map(toNormalizedX),
    diagnosticBarlineCount: barlineAnalysis.diagnosticStrokes.length,
    finalBoundaryX: recovery.boundaries.map(toNormalizedX),
    finalRegionCount: Math.max(0, recovery.boundaries.length - 1),
    finalMeasureWidthsInStaffSpaces:
      recovery.finalStatistics.widthsInStaffSpaces,
    initialBoundaryX: recovery.initialBoundaries.map(toNormalizedX),
    initialRegionCount: Math.max(0, recovery.initialBoundaries.length - 1),
    initialMeasureWidthsInStaffSpaces:
      recovery.initialStatistics.widthsInStaffSpaces,
    initiallySuspiciousIndexes: recovery.initiallySuspiciousIndexes,
    madMeasureWidthInStaffSpaces:
      recovery.initialStatistics.madWidth / staffGroup.spacing,
    medianMeasureWidthInStaffSpaces:
      recovery.initialStatistics.medianWidth / staffGroup.spacing,
    recoveredBarlines: recovery.recovered.map((item) => ({
      ...item,
      x: toNormalizedX(item.x),
    })),
    rejectedBarlines: barlineAnalysis.diagnosticStrokes
      .filter((stroke) => !stroke.accepted)
      .map((stroke) => ({
        attachedSideBranch: stroke.attachedSideBranch,
        neighboringBarlineDistanceInStaffSpaces:
          getNeighborDistanceInStaffSpaces(stroke.center),
        reason: stroke.rejectedReason,
        recoverable: stroke.recoverable,
        staffLineIntersectionRatio:
          stroke.metrics.staffLineIntersectionRatio,
        verticalContinuityRatio: stroke.metrics.continuityRatio,
        outsideInkRatio: stroke.metrics.outsideInkRatio,
        x: toNormalizedX(stroke.center),
      })),
    staffSpacing: staffGroup.spacing / height,
    systemIndex,
  };
}

function detectScoreLayoutInternal(
  imageData,
  userOptions = {},
  includeDiagnostics = false,
) {
  const width = Number(imageData?.width) || 0;
  const height = Number(imageData?.height) || 0;

  if (!imageData?.data || width <= 0 || height <= 0) {
    return includeDiagnostics
      ? { diagnostics: [], measures: [], systems: [] }
      : { measures: [], systems: [] };
  }

  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const mask = createInkMask(imageData, options.inkThreshold);
  const horizontalBands = findHorizontalBands(mask, width, height, options);
  const staffGroups = findStaffGroups(horizontalBands);
  const contentRanges = getStaffContentRanges(staffGroups, height);
  const candidates = [];
  const diagnostics = [];
  const systems = [];

  staffGroups.forEach((staffGroup, staffIndex) => {
    const staffRange = findStaffHorizontalRange(
      mask,
      width,
      height,
      staffGroup,
      options,
    );

    if (!staffRange) return;

    const barlineAnalysis = findBarlineAnalysis(
      mask,
      width,
      height,
      staffGroup,
      staffRange,
      options,
    );
    const initialBoundaries = getMeasureBoundaries(
      staffRange,
      barlineAnalysis.acceptedCenters,
      staffGroup.spacing,
      options,
    );
    const recovery = recoverOversizedMeasureBoundaries({
      barlineAnalysis,
      boundaries: initialBoundaries,
      options,
      staffSpacing: staffGroup.spacing,
    });
    const boundaries = recovery.boundaries;
    const verticalRange = contentRanges[staffIndex];
    const systemIndex = systems.length;

    systems.push({
      contentBottom: verticalRange.bottom / height,
      contentTop: verticalRange.top / height,
      index: systemIndex,
      regionCount: boundaries.length - 1,
      staffBottom: staffGroup.bands.at(-1).center / height,
      staffSpacing: staffGroup.spacing / height,
      staffTop: staffGroup.bands[0].center / height,
      width: (staffRange.end - staffRange.start) / width,
      x: staffRange.start / width,
    });

    if (includeDiagnostics) {
      diagnostics.push(
        createSystemRecognitionDiagnostics({
          barlineAnalysis,
          height,
          recovery,
          staffGroup,
          systemIndex,
          width,
        }),
      );
    }

    for (let boundaryIndex = 0; boundaryIndex < boundaries.length - 1; boundaryIndex += 1) {
      const left = boundaries[boundaryIndex];
      const right = boundaries[boundaryIndex + 1];

      candidates.push({
        height: (verticalRange.bottom - verticalRange.top) / height,
        width: (right - left) / width,
        x: left / width,
        y: verticalRange.top / height,
      });
    }
  });

  return includeDiagnostics
    ? { diagnostics, measures: candidates, systems }
    : { measures: candidates, systems };
}

export function detectScoreLayout(imageData, userOptions = {}) {
  return detectScoreLayoutInternal(imageData, userOptions);
}

export function diagnoseScoreLayout(imageData, userOptions = {}) {
  return detectScoreLayoutInternal(imageData, userOptions, true);
}

export function detectMeasureCandidates(imageData, userOptions = {}) {
  return detectScoreLayout(imageData, userOptions).measures;
}

export async function recognizePdfDocumentPages(
  pdf,
  {
    createCanvas,
    maxRenderScale = DEFAULT_MAX_RENDER_SCALE,
    onPageDiagnostics,
    onProgress,
    recognitionOptions,
    targetRenderWidth = DEFAULT_TARGET_RENDER_WIDTH,
  } = {},
) {
  if (!pdf || !Number.isInteger(pdf.numPages) || pdf.numPages < 1) {
    throw new Error('분석할 PDF 문서가 올바르지 않습니다.');
  }

  if (typeof createCanvas !== 'function') {
    throw new Error('PDF 분석용 canvas 생성기가 없습니다.');
  }

  const measures = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress?.({ currentPage: pageNumber, totalPages: pdf.numPages });

    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const renderScale = Math.max(
      1,
      Math.min(maxRenderScale, targetRenderWidth / baseViewport.width),
    );
    const viewport = page.getViewport({ scale: renderScale });
    const canvas = createCanvas();
    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (!context) throw new Error('PDF 분석용 canvas를 만들 수 없습니다.');

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: context, viewport }).promise;

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const layout = detectScoreLayout(imageData, recognitionOptions);
    const pageMeasures = layout.measures;

    onPageDiagnostics?.({
      baseViewport: {
        height: baseViewport.height,
        width: baseViewport.width,
      },
      generatedRegionCount: pageMeasures.length,
      pageNumber,
      raster: {
        height: canvas.height,
        width: canvas.width,
      },
      renderScale,
      systems: layout.systems.map((system) => ({
        contentBottom: system.contentBottom,
        contentTop: system.contentTop,
        regionCount: system.regionCount,
        staffBottom: system.staffBottom,
        staffSpacing: system.staffSpacing,
        staffTop: system.staffTop,
      })),
      totalPages: pdf.numPages,
    });

    measures.push(
      ...pageMeasures.map((measure) => ({
        ...measure,
        page: pageNumber,
      })),
    );

    page.cleanup();
    canvas.width = 0;
    canvas.height = 0;
  }

  return measures;
}

export async function recognizePdfLoadingTaskPages(loadingTask, options) {
  try {
    const pdf = await loadingTask.promise;

    return await recognizePdfDocumentPages(pdf, options);
  } finally {
    await loadingTask.destroy();
  }
}
