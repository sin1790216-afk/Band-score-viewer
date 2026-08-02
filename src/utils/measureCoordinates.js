export const NORMALIZED_COORDINATE_SPACE = 'normalized-page-v1';
export const NORMALIZED_COORDINATE_STATUS = 'validated';
export const LEGACY_COORDINATE_STATUS = 'legacy-bounds-unverified';
export const NORMALIZED_COORDINATE_BASIS = {
  height: 1,
  source: 'normalized',
  width: 1,
};

function getFiniteCoordinate(value, fallbackValue = 0) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : fallbackValue;
}

function getPositiveCoordinate(value) {
  const numberValue = getFiniteCoordinate(value);

  return numberValue > 0 ? numberValue : 0;
}

function getExplicitCoordinateBasis(measure) {
  if (measure?.coordinateSpace === NORMALIZED_COORDINATE_SPACE) {
    return NORMALIZED_COORDINATE_BASIS;
  }

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

function getConsistentPageBasis(pageMeasures) {
  const explicitBases = pageMeasures
    .map(getExplicitCoordinateBasis)
    .filter(Boolean)
    .filter((basis) => basis.source !== 'normalized');

  if (explicitBases.length === 0) return null;

  const [firstBasis] = explicitBases;
  const hasOneBasis = explicitBases.every(
    (basis) =>
      basis.width === firstBasis.width && basis.height === firstBasis.height,
  );

  return hasOneBasis
    ? {
        ...firstBasis,
        source: 'page-explicit-basis',
      }
    : null;
}

export function getMeasureCoordinateBasis(measure) {
  return getExplicitCoordinateBasis(measure);
}

export function getLegacyPageBounds(pageMeasures) {
  return pageMeasures.reduce(
    (bounds, measure) => {
      const x = getFiniteCoordinate(measure?.x);
      const y = getFiniteCoordinate(measure?.y);
      const width = getPositiveCoordinate(measure?.width);
      const height = getPositiveCoordinate(measure?.height);

      return {
        height: Math.max(bounds.height, y + height),
        width: Math.max(bounds.width, x + width),
      };
    },
    { height: 0, width: 0 },
  );
}

function toCanonicalMeasure(measure, sourceBasis, coordinateStatus) {
  const sourceWidth = getPositiveCoordinate(sourceBasis?.width) || 1;
  const sourceHeight = getPositiveCoordinate(sourceBasis?.height) || 1;
  const nextMeasure = {
    ...measure,
    coordinateHeight: 1,
    coordinateSpace: NORMALIZED_COORDINATE_SPACE,
    coordinateStatus,
    coordinateWidth: 1,
    height: getPositiveCoordinate(measure?.height) / sourceHeight,
    width: getPositiveCoordinate(measure?.width) / sourceWidth,
    x: getFiniteCoordinate(measure?.x) / sourceWidth,
    y: getFiniteCoordinate(measure?.y) / sourceHeight,
  };

  if (coordinateStatus === LEGACY_COORDINATE_STATUS) {
    nextMeasure.legacyCoordinateHeight = sourceHeight;
    nextMeasure.legacyCoordinateSource = sourceBasis?.source || 'unknown';
    nextMeasure.legacyCoordinateWidth = sourceWidth;
  }

  return nextMeasure;
}

export function normalizeMeasureCoordinates(measures) {
  if (!Array.isArray(measures)) return [];

  const measuresByPage = new Map();

  measures.forEach((measure) => {
    const page = Number(measure?.page) || 1;
    const pageMeasures = measuresByPage.get(page) || [];

    pageMeasures.push(measure);
    measuresByPage.set(page, pageMeasures);
  });

  const legacyBasisByPage = new Map();

  measuresByPage.forEach((pageMeasures, page) => {
    const legacyMeasures = pageMeasures.filter(
      (measure) => !getExplicitCoordinateBasis(measure),
    );

    if (legacyMeasures.length === 0) return;

    const consistentPageBasis = getConsistentPageBasis(pageMeasures);

    if (consistentPageBasis) {
      legacyBasisByPage.set(page, consistentPageBasis);
      return;
    }

    const bounds = getLegacyPageBounds(legacyMeasures);

    legacyBasisByPage.set(page, {
      height: bounds.height || 1,
      source: 'legacy-bounds',
      width: bounds.width || 1,
    });
  });

  return measures.map((measure) => {
    if (isCanonicalMeasure(measure)) {
      return {
        ...measure,
        coordinateHeight: 1,
        coordinateSpace: NORMALIZED_COORDINATE_SPACE,
        coordinateStatus: measure.coordinateStatus || NORMALIZED_COORDINATE_STATUS,
        coordinateWidth: 1,
      };
    }

    const explicitBasis = getExplicitCoordinateBasis(measure);

    if (explicitBasis) {
      return toCanonicalMeasure(
        measure,
        explicitBasis,
        measure.coordinateStatus || NORMALIZED_COORDINATE_STATUS,
      );
    }

    const page = Number(measure?.page) || 1;

    return toCanonicalMeasure(
      measure,
      legacyBasisByPage.get(page),
      LEGACY_COORDINATE_STATUS,
    );
  });
}

export function isCanonicalMeasure(measure) {
  if (measure?.coordinateSpace !== NORMALIZED_COORDINATE_SPACE) return false;

  return ['x', 'y', 'width', 'height'].every((field) =>
    Number.isFinite(Number(measure[field])),
  );
}

export function canonicalToRenderRect(measure, surfaceRect) {
  if (
    !isCanonicalMeasure(measure) ||
    !surfaceRect ||
    surfaceRect.width <= 0 ||
    surfaceRect.height <= 0
  ) {
    return null;
  }

  return {
    coordinateBasis: NORMALIZED_COORDINATE_BASIS,
    height: Number(measure.height) * surfaceRect.height,
    left: Number(measure.x) * surfaceRect.width,
    scaleFactor: surfaceRect.width,
    scaleX: surfaceRect.width,
    scaleY: surfaceRect.height,
    top: Number(measure.y) * surfaceRect.height,
    width: Number(measure.width) * surfaceRect.width,
  };
}

export function renderPointToCanonical(clientX, clientY, surfaceRect) {
  if (!surfaceRect || surfaceRect.width <= 0 || surfaceRect.height <= 0) return null;

  return {
    x: (clientX - surfaceRect.left) / surfaceRect.width,
    y: (clientY - surfaceRect.top) / surfaceRect.height,
  };
}
