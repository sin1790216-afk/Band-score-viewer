const DEFAULT_OPTIONS = {
  attachedBranchMinimumLengthInStaffSpaces: 0.55,
  attachedBranchMinimumThicknessInStaffSpaces: 0.4,
  attachedBranchReachInStaffSpaces: 1.5,
  attachedBranchStaffLineExclusionInStaffSpaces: 0.2,
  barlineContinuityRatio: 0.99,
  barlineOutsideInkRatio: 0.3,
  inkThreshold: 190,
  minimumFirstMeasureWidthInStaffSpaces: 22,
  minimumMeasureWidthInStaffSpaces: 14,
  minimumStaffWidthRatio: 0.25,
  rowCoverageRatio: 0.28,
};

const DEFAULT_TARGET_RENDER_WIDTH = 1400;
const DEFAULT_MAX_RENDER_SCALE = 3;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
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

function findBarlineCenters(mask, width, height, staffGroup, staffRange, options) {
  const candidateColumns = [];
  const firstLine = staffGroup.bands[0].center;
  const lastLine = staffGroup.bands.at(-1).center;
  const exteriorInset = staffGroup.spacing * 0.5;
  const exteriorDepth = staffGroup.spacing * 2.5;

  for (let x = staffRange.start; x <= staffRange.end; x += 1) {
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

    if (
      continuityRatio >= options.barlineContinuityRatio &&
      Math.max(upperOutsideInkRatio, lowerOutsideInkRatio) <=
        options.barlineOutsideInkRatio
    ) {
      candidateColumns.push(x);
    }
  }

  return mergeConsecutiveValues(candidateColumns, 1)
    .filter(
      (strokeGroup) =>
        !hasAttachedSideBranch(
          mask,
          width,
          height,
          staffGroup,
          strokeGroup,
          options,
        ),
    )
    .map(({ end, start }) => (start + end) / 2);
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

  const minimumMeasureWidth = Math.max(
    staffSpacing * options.minimumMeasureWidthInStaffSpaces,
    8,
  );
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

export function detectMeasureCandidates(imageData, userOptions = {}) {
  const width = Number(imageData?.width) || 0;
  const height = Number(imageData?.height) || 0;

  if (!imageData?.data || width <= 0 || height <= 0) return [];

  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const mask = createInkMask(imageData, options.inkThreshold);
  const horizontalBands = findHorizontalBands(mask, width, height, options);
  const staffGroups = findStaffGroups(horizontalBands);
  const contentRanges = getStaffContentRanges(staffGroups, height);
  const candidates = [];

  staffGroups.forEach((staffGroup, staffIndex) => {
    const staffRange = findStaffHorizontalRange(
      mask,
      width,
      height,
      staffGroup,
      options,
    );

    if (!staffRange) return;

    const barlineCenters = findBarlineCenters(
      mask,
      width,
      height,
      staffGroup,
      staffRange,
      options,
    );
    const boundaries = getMeasureBoundaries(
      staffRange,
      barlineCenters,
      staffGroup.spacing,
      options,
    );
    const verticalRange = contentRanges[staffIndex];

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

  return candidates;
}

export async function recognizePdfDocumentPages(
  pdf,
  {
    createCanvas,
    maxRenderScale = DEFAULT_MAX_RENDER_SCALE,
    onProgress,
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

    const pageMeasures = detectMeasureCandidates(
      context.getImageData(0, 0, canvas.width, canvas.height),
    );

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
