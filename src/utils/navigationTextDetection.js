import {
  getNavigationMarkerLabel,
  hasNavigationMarker,
  NAVIGATION_MARKER_TYPES,
} from './navigationMarkers.js';
import { collectNavigationEndings } from './navigationEndings.js';
import { NORMALIZED_COORDINATE_SPACE } from './measureCoordinates.js';
import {
  classifyScoreTextItem,
  normalizeScoreText,
  SCORE_TEXT_CATEGORIES,
} from './scoreTextClassification.js';

export const NAVIGATION_TEXT_CANDIDATE_SOURCE = 'pdf-text';
const VOLTA_ANCHOR_CANDIDATE_TYPE = 'volta-anchor';

export const NAVIGATION_TEXT_CONFIDENCE = Object.freeze({
  HIGH: 'high',
  LOW: 'low',
  MEDIUM: 'medium',
});

export const NAVIGATION_TEXT_MATCH_STATUS = Object.freeze({
  MATCHED_EXISTING_MARKER: 'matched-existing-marker',
  UNAPPLIED: 'unapplied',
});

const MAX_COMMAND_TEXT_ITEM_COUNT = 4;
const LINE_BASELINE_HEIGHT_RATIO = 0.6;
const LINE_BASELINE_STAFF_SPACING_RATIO = 0.5;
const CLUSTER_GAP_HEIGHT_RATIO = 3.5;
const CLUSTER_GAP_STAFF_SPACING_RATIO = 4;
const SYSTEM_OUTER_MARGIN_STAFF_SPACES = 4;

const COMMAND_MATCHERS = Object.freeze([
  {
    pattern: /^d\.?\s*s\.?\s+al\s+coda\.?$/iu,
    type: NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_CODA,
  },
  {
    pattern: /^d\.?\s*s\.?\s+al\s+fine\.?$/iu,
    type: NAVIGATION_MARKER_TYPES.DAL_SEGNO_AL_FINE,
  },
  {
    pattern: /^to\s+coda\.?$/iu,
    type: NAVIGATION_MARKER_TYPES.TO_CODA,
  },
  {
    pattern: /^d\.?\s*s\.?$/iu,
    type: NAVIGATION_MARKER_TYPES.DAL_SEGNO,
  },
  {
    pattern: /^fine\.?$/iu,
    type: NAVIGATION_MARKER_TYPES.FINE,
  },
]);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function getBounds(items) {
  const left = Math.min(...items.map((item) => Number(item.x) || 0));
  const top = Math.min(...items.map((item) => Number(item.y) || 0));
  const right = Math.max(
    ...items.map((item) => (Number(item.x) || 0) + (Number(item.width) || 0)),
  );
  const bottom = Math.max(
    ...items.map((item) => (Number(item.y) || 0) + (Number(item.height) || 0)),
  );

  return {
    coordinateSpace: NORMALIZED_COORDINATE_SPACE,
    height: Math.max(0, bottom - top),
    width: Math.max(0, right - left),
    x: left,
    y: top,
  };
}

function getDistanceToRange(value, start, end) {
  if (value < start) return start - value;
  if (value > end) return value - end;
  return 0;
}

function getSystemIdentity(system, index) {
  return Number.isInteger(system?.index) ? system.index : index;
}

function findSystemAssociation(item, systems) {
  const baselineY = Number(item?.baselineY);

  if (!Number.isFinite(baselineY) || !Array.isArray(systems)) return null;

  const associations = systems.flatMap((system, index) => {
    const staffSpacing = Number(system?.staffSpacing) || 0;
    const contentTop = Number(system?.contentTop);
    const contentBottom = Number(system?.contentBottom);
    const staffTop = Number(system?.staffTop);
    const staffBottom = Number(system?.staffBottom);

    if (
      !Number.isFinite(contentTop) ||
      !Number.isFinite(contentBottom) ||
      !Number.isFinite(staffTop) ||
      !Number.isFinite(staffBottom) ||
      staffSpacing <= 0
    ) {
      return [];
    }

    const contentDistance = getDistanceToRange(
      baselineY,
      contentTop,
      contentBottom,
    );
    const staffDistance = getDistanceToRange(baselineY, staffTop, staffBottom);
    const isInsideContent = contentDistance === 0;

    if (
      !isInsideContent &&
      contentDistance > staffSpacing * SYSTEM_OUTER_MARGIN_STAFF_SPACES
    ) {
      return [];
    }

    return [
      {
        contentDistance,
        index,
        isInsideContent,
        staffDistance,
        system,
        systemIdentity: getSystemIdentity(system, index),
      },
    ];
  });

  return associations.sort(
    (left, right) =>
      Number(right.isInsideContent) - Number(left.isInsideContent) ||
      left.contentDistance - right.contentDistance ||
      left.staffDistance - right.staffDistance,
  )[0] || null;
}

function groupSystemLines(items, system) {
  const lines = [];
  const staffSpacing = Number(system?.staffSpacing) || 0;

  [...items]
    .sort(
      (left, right) =>
        Number(left.baselineY) - Number(right.baselineY) ||
        Number(left.x) - Number(right.x),
    )
    .forEach((item) => {
      const tolerance = Math.max(
        (Number(item.height) || 0) * LINE_BASELINE_HEIGHT_RATIO,
        staffSpacing * LINE_BASELINE_STAFF_SPACING_RATIO,
      );
      const line = lines.find(
        (candidate) =>
          Math.abs(candidate.baselineY - Number(item.baselineY)) <= tolerance,
      );

      if (!line) {
        lines.push({ baselineY: Number(item.baselineY), items: [item] });
        return;
      }

      line.items.push(item);
      line.baselineY =
        line.items.reduce(
          (sum, lineItem) => sum + Number(lineItem.baselineY),
          0,
        ) / line.items.length;
    });

  return lines;
}

function groupAdjacentItems(items, system) {
  const clusters = [];
  const staffSpacing = Number(system?.staffSpacing) || 0;

  [...items]
    .sort((left, right) => Number(left.x) - Number(right.x))
    .forEach((item) => {
      const cluster = clusters[clusters.length - 1];

      if (!cluster) {
        clusters.push([item]);
        return;
      }

      const previous = cluster[cluster.length - 1];
      const gap = Number(item.x) - (Number(previous.x) + Number(previous.width));
      const representativeHeight = Math.max(
        Number(previous.height) || 0,
        Number(item.height) || 0,
      );
      const maximumGap = Math.max(
        staffSpacing * CLUSTER_GAP_STAFF_SPACING_RATIO,
        representativeHeight * CLUSTER_GAP_HEIGHT_RATIO,
      );

      if (gap <= maximumGap) {
        cluster.push(item);
      } else {
        clusters.push([item]);
      }
    });

  return clusters;
}

function matchCanonicalCommand(value) {
  const normalizedText = normalizeScoreText(value);
  const matcher = COMMAND_MATCHERS.find((candidate) =>
    candidate.pattern.test(normalizedText),
  );

  return matcher
    ? { normalizedText, type: matcher.type }
    : null;
}

function createCombinedTextItem(items, rawText) {
  const bounds = getBounds(items);

  return {
    ...bounds,
    baselineY:
      items.reduce((sum, item) => sum + Number(item.baselineY), 0) /
      items.length,
    text: rawText,
  };
}

function findCommandMatches(cluster, system) {
  const matches = [];
  let startIndex = 0;

  while (startIndex < cluster.length) {
    const maximumItemCount = Math.min(
      MAX_COMMAND_TEXT_ITEM_COUNT,
      cluster.length - startIndex,
    );
    let match = null;

    for (let itemCount = maximumItemCount; itemCount >= 1; itemCount -= 1) {
      const items = cluster.slice(startIndex, startIndex + itemCount);
      const rawText = items.map((item) => item.text).join(' ');
      const command = matchCanonicalCommand(rawText);

      if (!command) continue;

      const combinedItem = createCombinedTextItem(items, rawText);
      const classification = classifyScoreTextItem(combinedItem, { system });

      if (classification.category !== SCORE_TEXT_CATEGORIES.NAVIGATION) {
        continue;
      }

      match = {
        bounds: getBounds(items),
        classification,
        itemCount,
        items,
        normalizedText: command.normalizedText,
        rawText,
        type: command.type,
      };
      break;
    }

    if (match) {
      matches.push(match);
      startIndex += match.itemCount;
    } else {
      startIndex += 1;
    }
  }

  return matches;
}

function findMeasureSystemIndex(measure, systems) {
  const centerY = Number(measure.y) + Number(measure.height) / 2;
  const containingSystems = systems
    .map((system, index) => ({ index, system }))
    .filter(
      ({ system }) =>
        centerY >= Number(system.contentTop) &&
        centerY <= Number(system.contentBottom),
    );

  if (containingSystems.length === 1) return containingSystems[0].index;

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

function getHorizontalAssociationScore(bounds, measure, system) {
  const candidateLeft = Number(bounds.x);
  const candidateRight = candidateLeft + Number(bounds.width);
  const candidateCenter = candidateLeft + Number(bounds.width) / 2;
  const measureLeft = Number(measure.x);
  const measureRight = measureLeft + Number(measure.width);
  const measureCenter = measureLeft + Number(measure.width) / 2;
  const overlap = Math.max(
    0,
    Math.min(candidateRight, measureRight) -
      Math.max(candidateLeft, measureLeft),
  );
  const referenceWidth = Math.max(
    Number(bounds.width),
    Number(system.staffSpacing) || 0,
    Number.EPSILON,
  );
  const overlapRatio = clamp(overlap / referenceWidth, 0, 1);
  const centerInside =
    candidateCenter >= measureLeft && candidateCenter <= measureRight;
  const edgeDistance = getDistanceToRange(
    candidateCenter,
    measureLeft,
    measureRight,
  );
  const distanceRatio = edgeDistance /
    Math.max(Number(measure.width), Number(system.staffSpacing), Number.EPSILON);
  const centerDistanceRatio =
    Math.abs(candidateCenter - measureCenter) /
    Math.max(Number(measure.width), Number.EPSILON);
  const score =
    (centerInside ? 4 : 0) +
    overlapRatio * 2 +
    Math.max(0, 1 - distanceRatio) +
    Math.max(0, 0.5 - centerDistanceRatio);

  return {
    centerDistanceRatio,
    centerInside,
    distanceRatio,
    measureId: measure.id || null,
    measureIndex: measure.measureIndex,
    overlapRatio,
    score,
  };
}

export function associateNavigationTextWithMeasure({
  bounds,
  measures,
  system,
  systemIndex,
  systems,
}) {
  const systemMeasures = measures.filter(
    (measure) => findMeasureSystemIndex(measure, systems) === systemIndex,
  );
  const scores = systemMeasures
    .map((measure) => ({
      measure,
      ...getHorizontalAssociationScore(bounds, measure, system),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.centerDistanceRatio - right.centerDistanceRatio ||
        left.measureIndex - right.measureIndex,
    );
  const best = scores[0];
  const second = scores[1];

  if (!best) {
    return {
      associationConfidence: NAVIGATION_TEXT_CONFIDENCE.LOW,
      evidence: { reason: 'no-measure-in-system', scores: [] },
      measureId: null,
      measureIndex: -1,
    };
  }

  const scoreDifference = second ? best.score - second.score : Infinity;
  const isAmbiguous = Boolean(
    second &&
      scoreDifference < 0.35 &&
      (second.centerInside || second.overlapRatio > 0),
  );

  if (isAmbiguous) {
    return {
      associationConfidence: NAVIGATION_TEXT_CONFIDENCE.LOW,
      evidence: {
        reason: 'ambiguous-horizontal-association',
        scores: scores.slice(0, 3).map(({ measure: _measure, ...score }) => score),
      },
      measureId: null,
      measureIndex: -1,
    };
  }

  const isStrong = best.centerInside || best.overlapRatio >= 0.6;
  const isUsable =
    isStrong ||
    (best.overlapRatio > 0 && scoreDifference >= 0.35) ||
    (best.distanceRatio <= 0.5 && scoreDifference >= 0.5);

  if (!isUsable) {
    return {
      associationConfidence: NAVIGATION_TEXT_CONFIDENCE.LOW,
      evidence: {
        reason: 'measure-too-far',
        scores: scores.slice(0, 3).map(({ measure: _measure, ...score }) => score),
      },
      measureId: null,
      measureIndex: -1,
    };
  }

  return {
    associationConfidence: isStrong
      ? NAVIGATION_TEXT_CONFIDENCE.HIGH
      : NAVIGATION_TEXT_CONFIDENCE.MEDIUM,
    evidence: {
      reason: isStrong ? 'clear-horizontal-association' : 'nearest-valid-measure',
      scores: scores.slice(0, 3).map(({ measure: _measure, ...score }) => score),
    },
    measureId: best.measure.id || null,
    measureIndex: best.measureIndex,
  };
}

function getCandidateConfidence(itemCount, associationConfidence) {
  if (associationConfidence === NAVIGATION_TEXT_CONFIDENCE.LOW) {
    return NAVIGATION_TEXT_CONFIDENCE.LOW;
  }
  if (
    itemCount === 1 &&
    associationConfidence === NAVIGATION_TEXT_CONFIDENCE.HIGH
  ) {
    return NAVIGATION_TEXT_CONFIDENCE.HIGH;
  }

  return NAVIGATION_TEXT_CONFIDENCE.MEDIUM;
}

function getDiagnosticClassifications(items, system) {
  return items.map((item) => {
    const classification = classifyScoreTextItem(item, { system });

    return {
      baselineY: item.baselineY,
      category: classification.category,
      rawText: item.text,
      sourceIndex: item.sourceIndex,
      x: item.x,
    };
  });
}

export function detectNavigationTextCandidates({
  measures,
  pageNumber,
  systems,
  textItems,
}) {
  const safeMeasures = Array.isArray(measures)
    ? measures
        .map((measure, measureIndex) => ({ ...measure, measureIndex }))
        .filter((measure) => Number(measure.page) === Number(pageNumber))
    : [];
  const safeSystems = Array.isArray(systems) ? systems : [];
  const safeTextItems = Array.isArray(textItems) ? textItems : [];
  const systemItems = new Map();
  const unassignedTextItems = [];

  safeTextItems.forEach((item) => {
    const association = findSystemAssociation(item, safeSystems);

    if (!association) {
      unassignedTextItems.push(item);
      return;
    }

    const items = systemItems.get(association.index) || [];
    items.push(item);
    systemItems.set(association.index, items);
  });

  const candidates = [];
  const classifications = [];

  safeSystems.forEach((system, systemIndex) => {
    const items = systemItems.get(systemIndex) || [];
    classifications.push(
      ...getDiagnosticClassifications(items, system).map((classification) => ({
        ...classification,
        systemIndex: getSystemIdentity(system, systemIndex),
      })),
    );

    groupSystemLines(items, system).forEach((line, lineIndex) => {
      groupAdjacentItems(line.items, system).forEach((cluster, clusterIndex) => {
        findCommandMatches(cluster, system).forEach((match) => {
          const measureAssociation = associateNavigationTextWithMeasure({
            bounds: match.bounds,
            measures: safeMeasures,
            system,
            systemIndex,
            systems: safeSystems,
          });
          const sourceIndexes = match.items.map((item) => item.sourceIndex);
          const candidate = {
            bounds: match.bounds,
            confidence: getCandidateConfidence(
              match.itemCount,
              measureAssociation.associationConfidence,
            ),
            evidence: {
              associationConfidence:
                measureAssociation.associationConfidence,
              classification: match.classification,
              measureAssociation: measureAssociation.evidence,
              systemAssociation: {
                lineIndex,
                sourceClusterIndex: clusterIndex,
                staffBottom: system.staffBottom,
                staffSpacing: system.staffSpacing,
                staffTop: system.staffTop,
                systemIndex: getSystemIdentity(system, systemIndex),
              },
              textItems: match.items.map((item) => ({
                baselineY: item.baselineY,
                height: item.height,
                sourceIndex: item.sourceIndex,
                text: item.text,
                width: item.width,
                x: item.x,
                y: item.y,
              })),
            },
            id: [
              NAVIGATION_TEXT_CANDIDATE_SOURCE,
              pageNumber,
              match.type,
              sourceIndexes.join('-'),
            ].join(':'),
            measureId: measureAssociation.measureId,
            measureIndex: measureAssociation.measureIndex,
            normalizedText: match.normalizedText,
            pageNumber: Number(pageNumber),
            rawText: match.rawText,
            source: NAVIGATION_TEXT_CANDIDATE_SOURCE,
            type: match.type,
          };

          candidates.push(candidate);
        });
      });
    });
  });

  return {
    candidates,
    diagnostics: {
      candidateCount: candidates.length,
      classifications,
      pageNumber: Number(pageNumber),
      systemCount: safeSystems.length,
      unassignedTextItemCount: unassignedTextItems.length,
    },
  };
}

export function reconcileNavigationTextCandidates(candidates, measures) {
  const safeMeasures = Array.isArray(measures) ? measures : [];
  const navigationEndings = collectNavigationEndings(safeMeasures);

  return (Array.isArray(candidates) ? candidates : []).map((candidate) => {
    const measure = safeMeasures[candidate.measureIndex];
    const isSameMeasure =
      measure &&
      (!candidate.measureId || !measure.id || measure.id === candidate.measureId);
    const matched = isSameMeasure && (
      candidate.type === VOLTA_ANCHOR_CANDIDATE_TYPE
        ? navigationEndings.some(
            (ending) =>
              ending.startMeasureId === measure.id &&
              JSON.stringify(ending.passes) === JSON.stringify(candidate.passes),
          )
        : hasNavigationMarker(measure, candidate.type)
    );

    return {
      ...candidate,
      matchStatus: matched
        ? NAVIGATION_TEXT_MATCH_STATUS.MATCHED_EXISTING_MARKER
        : NAVIGATION_TEXT_MATCH_STATUS.UNAPPLIED,
    };
  });
}

export function createNavigationTextMeasureIdentity(measures) {
  return JSON.stringify(
    (Array.isArray(measures) ? measures : []).map((measure) => [
      measure?.id || '',
      Number(measure?.page) || 0,
      Number(measure?.x) || 0,
      Number(measure?.y) || 0,
      Number(measure?.width) || 0,
      Number(measure?.height) || 0,
    ]),
  );
}

export function isNavigationTextCandidateStateCurrent(
  state,
  { measureIdentity, pdfIdentity },
) {
  return Boolean(
    state &&
      state.measureIdentity === measureIdentity &&
      state.pdfIdentity === pdfIdentity,
  );
}

export function getNavigationTextCandidateLabel(candidate) {
  if (candidate?.type === VOLTA_ANCHOR_CANDIDATE_TYPE) {
    return `${(candidate.passes || []).join(',')}. 괄호`;
  }

  return getNavigationMarkerLabel(candidate?.type);
}
