function getPositiveCoordinate(value) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function getBasisKey(basis) {
  return `${basis.width}:${basis.height}`;
}

export function getMeasureCoordinateBasis(measure) {
  const coordinateWidth = getPositiveCoordinate(measure?.coordinateWidth);
  const coordinateHeight = getPositiveCoordinate(measure?.coordinateHeight);

  if (coordinateWidth && coordinateHeight) {
    return {
      height: coordinateHeight,
      source: 'coordinate',
      width: coordinateWidth,
    };
  }

  const baseWidth = getPositiveCoordinate(measure?.baseWidth);
  const baseHeight = getPositiveCoordinate(measure?.baseHeight);

  if (baseWidth && baseHeight) {
    return {
      height: baseHeight,
      source: 'base',
      width: baseWidth,
    };
  }

  const pageWidth = getPositiveCoordinate(measure?.pageWidth);
  const pageHeight = getPositiveCoordinate(measure?.pageHeight);

  if (pageWidth && pageHeight) {
    return {
      height: pageHeight,
      source: 'page',
      width: pageWidth,
    };
  }

  return null;
}

export function getLegacyPageBounds(pageMeasures) {
  return pageMeasures.reduce(
    (bounds, measure) => ({
      height: Math.max(bounds.height, Number(measure.y) + Number(measure.height)),
      width: Math.max(bounds.width, Number(measure.x) + Number(measure.width)),
    }),
    { height: 0, width: 0 },
  );
}

export function getPreferredPageCoordinateBasis(pageMeasures) {
  const basisCounts = new Map();

  pageMeasures.forEach((measure, index) => {
    const basis = getMeasureCoordinateBasis(measure);

    if (!basis) return;

    const key = getBasisKey(basis);
    const currentEntry = basisCounts.get(key);

    basisCounts.set(key, {
      basis,
      count: (currentEntry?.count || 0) + 1,
      firstIndex: currentEntry?.firstIndex ?? index,
    });
  });

  return (
    [...basisCounts.values()].sort(
      (left, right) => right.count - left.count || left.firstIndex - right.firstIndex,
    )[0]?.basis || null
  );
}

export function getMeasureRenderBasis(measure, pageMeasures) {
  const storedBasis = getMeasureCoordinateBasis(measure);

  if (storedBasis) return storedBasis;

  const legacyBounds = getLegacyPageBounds(pageMeasures);

  if (legacyBounds.width <= 0 || legacyBounds.height <= 0) return null;

  return {
    ...legacyBounds,
    source: 'legacy-bounds',
  };
}

export function hasCoordinateMigrationNeed(measures) {
  const pageBasisKeys = new Map();

  for (const measure of measures) {
    const coordinateWidth = getPositiveCoordinate(measure?.coordinateWidth);
    const coordinateHeight = getPositiveCoordinate(measure?.coordinateHeight);

    if (!coordinateWidth || !coordinateHeight) return true;

    const pageKey = Number(measure.page) || 1;
    const basisKey = `${coordinateWidth}:${coordinateHeight}`;
    const existingBasisKey = pageBasisKeys.get(pageKey);

    if (existingBasisKey && existingBasisKey !== basisKey) return true;

    pageBasisKeys.set(pageKey, basisKey);
  }

  return false;
}

export function migrateMeasuresToCoordinateBases(measures, pageRenderMetrics) {
  const metricsByPage = new Map(
    pageRenderMetrics.map((metrics) => [Number(metrics.page), metrics]),
  );
  const measuresByPage = new Map();

  measures.forEach((measure) => {
    const page = Number(measure.page) || 1;
    const pageMeasures = measuresByPage.get(page) || [];

    pageMeasures.push(measure);
    measuresByPage.set(page, pageMeasures);
  });

  const targetBasisByPage = new Map();

  measuresByPage.forEach((pageMeasures, page) => {
    const preferredBasis = getPreferredPageCoordinateBasis(pageMeasures);

    if (preferredBasis) {
      targetBasisByPage.set(page, preferredBasis);
      return;
    }

    const renderMetrics = metricsByPage.get(page);

    if (!renderMetrics) return;

    const legacyBounds = getLegacyPageBounds(pageMeasures);

    targetBasisByPage.set(page, {
      height: Math.max(legacyBounds.height, renderMetrics.height),
      source: 'teacher-render',
      width: Math.max(legacyBounds.width, renderMetrics.width),
    });
  });

  return measures.map((measure) => {
    const page = Number(measure.page) || 1;
    const targetBasis = targetBasisByPage.get(page);

    if (!targetBasis) return measure;

    const sourceBasis = getMeasureCoordinateBasis(measure);
    const scaleX = sourceBasis ? targetBasis.width / sourceBasis.width : 1;
    const scaleY = sourceBasis ? targetBasis.height / sourceBasis.height : 1;
    const alreadyMigrated =
      sourceBasis?.source === 'coordinate' &&
      sourceBasis.width === targetBasis.width &&
      sourceBasis.height === targetBasis.height;

    if (alreadyMigrated) return measure;

    return {
      ...measure,
      coordinateHeight: targetBasis.height,
      coordinateWidth: targetBasis.width,
      height: Number(measure.height) * scaleY,
      width: Number(measure.width) * scaleX,
      x: Number(measure.x) * scaleX,
      y: Number(measure.y) * scaleY,
    };
  });
}
