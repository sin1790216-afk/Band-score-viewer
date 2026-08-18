import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectNavigationGraphicCandidates,
  NAVIGATION_GRAPHIC_CANDIDATE_SOURCES,
  NAVIGATION_VOLTA_ANCHOR_TYPE,
} from '../src/utils/navigationGraphicDetection.js';
import {
  NAVIGATION_MARKER_TYPES,
} from '../src/utils/navigationMarkers.js';
import {
  NAVIGATION_TEXT_MATCH_STATUS,
  reconcileNavigationTextCandidates,
} from '../src/utils/navigationTextDetection.js';
import { validateNavigationModel } from '../src/utils/navigationValidation.js';
import { resolvePlaybackSequence } from '../src/utils/playbackResolver.js';
import { exportMeasuresJson } from '../src/state/projectState.js';

const SYSTEM = {
  contentBottom: 0.46,
  contentTop: 0.08,
  index: 0,
  regionCount: 2,
  staffBottom: 0.28,
  staffSpacing: 0.02,
  staffTop: 0.2,
  width: 0.8,
  x: 0.1,
};

const MEASURES = [
  {
    height: 0.38,
    id: 'm1',
    navigationEndings: [],
    navigationMarkers: [],
    page: 1,
    width: 0.4,
    x: 0.1,
    y: 0.08,
  },
  {
    height: 0.38,
    id: 'm2',
    navigationEndings: [],
    navigationMarkers: [],
    page: 1,
    width: 0.4,
    x: 0.5,
    y: 0.08,
  },
];

function createRaster(size = 1000) {
  const data = new Uint8ClampedArray(size * size * 4);
  data.fill(255);

  function drawRect(normalizedX, normalizedY, normalizedWidth, normalizedHeight) {
    const startX = Math.max(0, Math.floor(normalizedX * size));
    const startY = Math.max(0, Math.floor(normalizedY * size));
    const endX = Math.min(size - 1, Math.ceil((normalizedX + normalizedWidth) * size));
    const endY = Math.min(size - 1, Math.ceil((normalizedY + normalizedHeight) * size));

    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        const dataIndex = (y * size + x) * 4;
        data[dataIndex] = 0;
        data[dataIndex + 1] = 0;
        data[dataIndex + 2] = 0;
        data[dataIndex + 3] = 255;
      }
    }
  }

  for (let lineIndex = 0; lineIndex < 5; lineIndex += 1) {
    drawRect(0.1, 0.2 + lineIndex * 0.02, 0.8, 0.0015);
  }

  return {
    drawRect,
    imageData: { data, height: size, width: size },
  };
}

function drawVerticalBar(raster, x, width = 0.002) {
  raster.drawRect(x - width / 2, SYSTEM.staffTop, width, SYSTEM.staffBottom - SYSTEM.staffTop);
}

function drawRepeatDots(raster, x) {
  raster.drawRect(x - 0.003, 0.227, 0.006, 0.006);
  raster.drawRect(x - 0.003, 0.247, 0.006, 0.006);
}

function drawRepeatStart(raster, boundaryX) {
  drawVerticalBar(raster, boundaryX);
  drawVerticalBar(raster, boundaryX + 0.011);
  drawRepeatDots(raster, boundaryX + 0.025);
}

function drawRepeatEnd(raster, boundaryX) {
  drawRepeatDots(raster, boundaryX - 0.025);
  drawVerticalBar(raster, boundaryX - 0.011);
  drawVerticalBar(raster, boundaryX);
}

function drawBidirectionalRepeat(raster, boundaryX) {
  drawRepeatDots(raster, boundaryX - 0.02);
  drawVerticalBar(raster, boundaryX - 0.005);
  drawVerticalBar(raster, boundaryX + 0.005);
  drawRepeatDots(raster, boundaryX + 0.02);
}

function drawFermataLikeGlyph(raster, x) {
  raster.drawRect(x - 0.012, 0.218, 0.024, 0.002);
  raster.drawRect(x - 0.016, 0.22, 0.003, 0.008);
  raster.drawRect(x + 0.013, 0.22, 0.003, 0.008);
  raster.drawRect(x - 0.003, 0.235, 0.006, 0.006);
}

function drawM81LikeVerticalFragments(raster, x) {
  raster.drawRect(x - 0.001, 0.228, 0.002, 0.013);
  raster.drawRect(x - 0.001, 0.248, 0.002, 0.013);
}

function drawVoltaBracket(raster, measureX, endX, y = 0.145) {
  raster.drawRect(measureX, y, endX - measureX, 0.0015);
}

function drawBeamLikeShape(raster, startX, endX, y) {
  raster.drawRect(startX, y, endX - startX, SYSTEM.staffSpacing * 0.6);
}

function text(value, x, baselineY, width = 0.02, sourceIndex = 0) {
  return {
    baselineY,
    height: 0.018,
    page: 1,
    sourceIndex,
    text: value,
    width,
    x,
    y: baselineY - 0.018,
  };
}

function glyphText(
  value,
  x,
  baselineY,
  width = 0.03,
  sourceIndex = 0,
  fontName = 'music-font',
) {
  return {
    ...text(value, x, baselineY, width, sourceIndex),
    fontName,
  };
}

function getNotationFontContext(fontName = 'music-font') {
  return [
    glyphText('\u0153', 0.3, 0.24, 0.02, 90, fontName),
    glyphText('\u0152', 0.34, 0.24, 0.02, 91, fontName),
  ];
}

function drawGlyphInk(raster, item) {
  raster.drawRect(item.x, item.y, item.width, item.height);
}

function detect(
  raster,
  textItems = [],
  measures = MEASURES,
  { pageNumber = 1, systems = [SYSTEM] } = {},
) {
  return detectNavigationGraphicCandidates({
    imageData: raster.imageData,
    measures,
    pageNumber,
    systems,
    textItems,
  }).candidates;
}

test('명확한 ||:를 repeat-start로 현재 Measure 시작 경계에 연결한다', () => {
  const raster = createRaster();
  drawRepeatStart(raster, 0.1);

  const [candidate] = detect(raster);

  assert.equal(candidate.type, NAVIGATION_MARKER_TYPES.REPEAT_START);
  assert.equal(candidate.measureId, 'm1');
  assert.equal(candidate.measureIndex, 0);
  assert.equal(candidate.source, NAVIGATION_GRAPHIC_CANDIDATE_SOURCES.GRAPHICS);
  assert.equal(candidate.evidence.measureAssociation.boundary, 'start');
});

test('명확한 :||를 repeat-end로 앞 Measure 끝 경계에 연결한다', () => {
  const raster = createRaster();
  drawRepeatEnd(raster, 0.5);

  const [candidate] = detect(raster);

  assert.equal(candidate.type, NAVIGATION_MARKER_TYPES.REPEAT_END);
  assert.equal(candidate.measureId, 'm1');
  assert.equal(candidate.measureIndex, 0);
  assert.equal(candidate.evidence.measureAssociation.boundary, 'end');
});

test('하나의 shared boundary 관측에서 좌우 dot을 Start와 End로 판정한다', () => {
  const raster = createRaster();
  drawBidirectionalRepeat(raster, 0.5);

  const candidates = detect(raster).filter((candidate) =>
    candidate.type === NAVIGATION_MARKER_TYPES.REPEAT_START ||
    candidate.type === NAVIGATION_MARKER_TYPES.REPEAT_END
  );

  assert.deepEqual(
    candidates.map((candidate) => ({
      boundaryKind: candidate.evidence.measureAssociation.boundaryKind,
      measureId: candidate.measureId,
      type: candidate.type,
    })),
    [
      {
        boundaryKind: 'shared',
        measureId: 'm1',
        type: NAVIGATION_MARKER_TYPES.REPEAT_END,
      },
      {
        boundaryKind: 'shared',
        measureId: 'm2',
        type: NAVIGATION_MARKER_TYPES.REPEAT_START,
      },
    ],
  );
});

test('시스템 첫 Measure의 음자리표·조표 뒤 realistic ||:도 시작점에 연결한다', () => {
  const raster = createRaster();
  drawRepeatStart(raster, 0.17);

  const [candidate] = detect(raster);

  assert.equal(candidate.type, NAVIGATION_MARKER_TYPES.REPEAT_START);
  assert.equal(candidate.measureId, 'm1');
  assert.equal(candidate.evidence.measureAssociation.boundaryKind, 'system-start');
  assert.ok(candidate.evidence.measureAssociation.observedBarX > MEASURES[0].x);
});

test('repeat dot이 없는 일반 double barline은 Repeat 후보가 아니다', () => {
  const raster = createRaster();
  drawVerticalBar(raster, 0.1);
  drawVerticalBar(raster, 0.111);

  assert.deepEqual(detect(raster), []);
});

test('페이지 끝 final barline은 Repeat 후보가 아니다', () => {
  const raster = createRaster();
  drawVerticalBar(raster, 0.889);
  drawVerticalBar(raster, 0.9, 0.005);

  assert.deepEqual(detect(raster), []);
});

test('final barline 주변 fermata glyph의 점 하나를 repeat dot pair로 사용하지 않는다', () => {
  const raster = createRaster();
  drawVerticalBar(raster, 0.889);
  drawVerticalBar(raster, 0.9, 0.005);
  drawFermataLikeGlyph(raster, 0.87);

  assert.deepEqual(detect(raster), []);
});

test('note stem과 augmentation dot만으로 Repeat 후보를 만들지 않는다', () => {
  const raster = createRaster();
  drawVerticalBar(raster, 0.1);
  raster.drawRect(0.113, 0.227, 0.005, 0.005);
  raster.drawRect(0.125, 0.227, 0.005, 0.005);

  assert.deepEqual(detect(raster), []);
});

test('barline 옆 notehead와 augmentation dot을 repeat dot pair로 사용하지 않는다', () => {
  const raster = createRaster();
  drawVerticalBar(raster, 0.5);
  drawVerticalBar(raster, 0.511);
  raster.drawRect(0.523, 0.225, 0.012, 0.009);
  raster.drawRect(0.542, 0.227, 0.005, 0.005);

  assert.deepEqual(detect(raster), []);
});

test('M81처럼 가늘고 긴 musical glyph 파편 두 개는 repeat dot이 아니다', () => {
  const raster = createRaster();
  drawVerticalBar(raster, 0.5);
  drawVerticalBar(raster, 0.511);
  drawM81LikeVerticalFragments(raster, 0.525);

  assert.deepEqual(detect(raster), []);
});

test('staff line에 걸친 하나의 복잡한 glyph 조각은 독립 repeat dot이 아니다', () => {
  const raster = createRaster();
  drawVerticalBar(raster, 0.5);
  drawVerticalBar(raster, 0.511);
  raster.drawRect(0.523, 0.219, 0.005, 0.044);
  raster.drawRect(0.519, 0.228, 0.014, 0.008);

  assert.deepEqual(detect(raster), []);
});

test('두 raster scale에서 같은 normalized Repeat 후보를 만든다', () => {
  const small = createRaster(500);
  const large = createRaster(1000);
  drawRepeatStart(small, 0.1);
  drawRepeatStart(large, 0.1);

  const [smallCandidate] = detect(small);
  const [largeCandidate] = detect(large);

  assert.equal(smallCandidate.type, largeCandidate.type);
  assert.equal(smallCandidate.measureId, largeCandidate.measureId);
  assert.ok(Math.abs(smallCandidate.bounds.x - largeCandidate.bounds.x) < 0.01);
  assert.ok(
    Math.abs(smallCandidate.bounds.width - largeCandidate.bounds.width) < 0.01,
    JSON.stringify({ large: largeCandidate.bounds, small: smallCandidate.bounds }),
  );
});

test('Maestro Segno glyph를 staff 위 위치와 raster ink로 탐지한다', () => {
  const raster = createRaster();
  const segno = glyphText('%', 0.18, 0.16);
  drawGlyphInk(raster, segno);

  const candidate = detect(raster, [segno, ...getNotationFontContext()])
    .find((item) => item.type === NAVIGATION_MARKER_TYPES.SEGNO);

  assert.equal(candidate.measureId, 'm1');
  assert.equal(candidate.source, NAVIGATION_GRAPHIC_CANDIDATE_SOURCES.HYBRID);
  assert.equal(candidate.confidence, 'high');
  assert.equal(candidate.bounds.coordinateSpace, 'normalized-page-v1');
  assert.equal(candidate.evidence.detectionPath, 'music-font-glyph');
  assert.equal(candidate.evidence.glyphIdentity.mapping, 'maestro-percent-glyph');
  assert.ok(candidate.evidence.staffAssociation.distanceAboveInStaffSpaces > 0.5);
});

test('Maestro private-use Coda glyph를 대상 Measure에 연결한다', () => {
  const raster = createRaster();
  const coda = glyphText('\uf0de', 0.56, 0.16, 0.025, 1);
  drawGlyphInk(raster, coda);

  const candidate = detect(raster, [coda, ...getNotationFontContext()])
    .find((item) => item.type === NAVIGATION_MARKER_TYPES.CODA);

  assert.equal(candidate.measureId, 'm2');
  assert.equal(candidate.measureIndex, 1);
  assert.equal(candidate.evidence.glyphIdentity.mapping, 'maestro-private-use-glyph');
});

test('표준 Unicode Segno와 Coda는 custom font profile 없이도 탐지한다', () => {
  const raster = createRaster();
  const segno = glyphText('\u{1d10b}', 0.18, 0.16, 0.03, 0, 'unicode-font');
  const coda = glyphText('\u{1d10c}', 0.56, 0.16, 0.03, 1, 'unicode-font');
  drawGlyphInk(raster, segno);
  drawGlyphInk(raster, coda);

  const candidates = detect(raster, [segno, coda]);

  assert.deepEqual(
    candidates.map((candidate) => candidate.type),
    [NAVIGATION_MARKER_TYPES.SEGNO, NAVIGATION_MARKER_TYPES.CODA],
  );
});

test('여러 페이지에서도 symbol 후보의 page와 Measure 연결을 유지한다', () => {
  const raster = createRaster();
  const segno = glyphText('%', 0.18, 0.16);
  const pageTwoMeasures = MEASURES.map((measure) => ({
    ...measure,
    id: `${measure.id}-page-2`,
    page: 2,
  }));
  drawGlyphInk(raster, segno);

  const candidate = detect(
    raster,
    [segno, ...getNotationFontContext()],
    pageTwoMeasures,
    { pageNumber: 2 },
  ).find((item) => item.type === NAVIGATION_MARKER_TYPES.SEGNO);

  assert.equal(candidate.pageNumber, 2);
  assert.equal(candidate.measureId, 'm1-page-2');
});

test('같은 Measure의 중복 symbol 관측은 후보 하나로 정리한다', () => {
  const raster = createRaster();
  const first = glyphText('%', 0.18, 0.16, 0.03, 0);
  const duplicate = glyphText('%', 0.181, 0.16, 0.03, 1);
  drawGlyphInk(raster, first);
  drawGlyphInk(raster, duplicate);

  const candidates = detect(raster, [
    first,
    duplicate,
    ...getNotationFontContext(),
  ]).filter((item) => item.type === NAVIGATION_MARKER_TYPES.SEGNO);

  assert.equal(candidates.length, 1);
});

test('오선 안의 Maestro percent treble-clef glyph는 Segno가 아니다', () => {
  const raster = createRaster();
  const clef = glyphText('%', 0.12, 0.24);
  drawGlyphInk(raster, clef);

  const candidates = detect(raster, [clef, ...getNotationFontContext()])
    .filter((item) => item.type === NAVIGATION_MARKER_TYPES.SEGNO);

  assert.deepEqual(candidates, []);
});

test('일반 텍스트 font의 percent와 다른 notation glyph는 Segno/Coda가 아니다', () => {
  const raster = createRaster();
  const percent = glyphText('%', 0.18, 0.16, 0.03, 0, 'body-font');
  const unrelatedGlyphs = [
    glyphText('&', 0.24, 0.16, 0.03, 1),
    glyphText('\u0153', 0.3, 0.16, 0.03, 2),
    glyphText('\uf0ee', 0.36, 0.16, 0.03, 3),
  ];
  drawGlyphInk(raster, percent);
  unrelatedGlyphs.forEach((item) => drawGlyphInk(raster, item));

  const candidates = detect(raster, [percent, ...unrelatedGlyphs])
    .filter((item) =>
      item.type === NAVIGATION_MARKER_TYPES.SEGNO ||
      item.type === NAVIGATION_MARKER_TYPES.CODA
    );

  assert.deepEqual(candidates, []);
});

test('경로 A는 staff 위 1. text와 명확한 bracket line을 high Volta로 만든다', () => {
  const raster = createRaster();
  drawVoltaBracket(raster, 0.1, 0.36);

  const candidate = detect(raster, [text('1.', 0.105, 0.17)])
    .find((item) => item.type === NAVIGATION_VOLTA_ANCHOR_TYPE);

  assert.equal(candidate.type, NAVIGATION_VOLTA_ANCHOR_TYPE);
  assert.deepEqual(candidate.passes, [1]);
  assert.equal(candidate.measureId, 'm1');
  assert.equal(candidate.source, NAVIGATION_GRAPHIC_CANDIDATE_SOURCES.HYBRID);
  assert.equal(candidate.confidence, 'high');
  assert.equal(candidate.evidence.detectionPath, 'graphic-bracket');
  assert.equal(candidate.evidence.horizontalBracket.anchor, 'label-relative');
  assert.ok(candidate.evidence.horizontalBracket.lengthInStaffSpaces >= 2.5);
  assert.equal(candidate.evidence.repeatStructure, null);
});

test('system 첫 Measure에서 label이 measure.x와 멀어도 bracket을 Graphic Volta로 만든다', () => {
  const raster = createRaster();
  const measures = [
    { ...MEASURES[0], width: 0.2, x: 0.06 },
    { ...MEASURES[1], width: 0.4, x: 0.26 },
  ];
  drawVoltaBracket(raster, 0.125, 0.36);

  const candidate = detect(raster, [text('1.', 0.13, 0.17)], measures)
    .find((item) => item.type === NAVIGATION_VOLTA_ANCHOR_TYPE);

  assert.equal(candidate.measureId, 'm1');
  assert.equal(candidate.confidence, 'high');
  assert.equal(candidate.evidence.detectionPath, 'graphic-bracket');
  assert.equal(candidate.evidence.nearMeasureStart, false);
  assert.equal(candidate.evidence.horizontalBracket.anchor, 'label-relative');
});

test('staff 위 6.15칸 bracket도 label geometry로 Graphic Volta가 된다', () => {
  const raster = createRaster();
  const measures = [
    { ...MEASURES[0], width: 0.2, x: 0.06 },
    { ...MEASURES[1], width: 0.4, x: 0.26 },
  ];
  const bracketY = SYSTEM.staffTop - SYSTEM.staffSpacing * 6.15;
  const labelBaselineY = SYSTEM.staffTop - SYSTEM.staffSpacing * 3.9;
  drawVoltaBracket(raster, 0.125, 0.36, bracketY);

  const candidate = detect(
    raster,
    [text('1.', 0.13, labelBaselineY)],
    measures,
  ).find((item) => item.type === NAVIGATION_VOLTA_ANCHOR_TYPE);

  assert.equal(candidate.measureId, 'm1');
  assert.equal(candidate.confidence, 'high');
  assert.equal(candidate.evidence.nearMeasureStart, false);
  assert.ok(
    Math.abs(candidate.evidence.horizontalBracket.y - bracketY) < 0.003,
  );
});

test('measure.x에서 먼 ending text는 graphic 또는 fallback 증거가 없으면 reject한다', () => {
  const raster = createRaster();
  const measures = [
    { ...MEASURES[0], width: 0.2, x: 0.06 },
    { ...MEASURES[1], width: 0.4, x: 0.26 },
  ];

  const candidates = detect(raster, [text('1.', 0.13, 0.17)], measures)
    .filter((candidate) => candidate.type === NAVIGATION_VOLTA_ANCHOR_TYPE);

  assert.deepEqual(candidates, []);
});

test('ending text와 관계없는 horizontal line은 Graphic Volta가 아니다', () => {
  const raster = createRaster();
  const measures = [
    { ...MEASURES[0], width: 0.2, x: 0.06 },
    { ...MEASURES[1], width: 0.4, x: 0.26 },
  ];
  drawVoltaBracket(raster, 0.5, 0.8);

  const candidates = detect(raster, [text('1.', 0.13, 0.17)], measures)
    .filter((candidate) => candidate.type === NAVIGATION_VOLTA_ANCHOR_TYPE);

  assert.deepEqual(candidates, []);
});

test('ending text 주변의 두꺼운 beam 유사 도형은 Graphic Volta가 아니다', () => {
  const raster = createRaster();
  const measures = [
    { ...MEASURES[0], width: 0.2, x: 0.06 },
    { ...MEASURES[1], width: 0.4, x: 0.26 },
  ];
  drawBeamLikeShape(raster, 0.125, 0.25, 0.142);

  const candidates = detect(raster, [text('1.', 0.13, 0.17)], measures)
    .filter((candidate) => candidate.type === NAVIGATION_VOLTA_ANCHOR_TYPE);

  assert.deepEqual(candidates, []);
});

test('Graphic bracket과 Repeat 증거가 함께 있어도 Volta 후보는 하나다', () => {
  const raster = createRaster();
  drawVoltaBracket(raster, 0.1, 0.36);
  drawRepeatEnd(raster, 0.5);

  const candidates = detect(raster, [text('1.', 0.105, 0.17)])
    .filter((candidate) => candidate.type === NAVIGATION_VOLTA_ANCHOR_TYPE);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].confidence, 'high');
  assert.equal(candidates[0].evidence.detectionPath, 'graphic-bracket');
  assert.equal(candidates[0].evidence.repeatStructure.distance, 0);
});

test('2.와 3.을 generic pass point anchor로 각각 연결한다', () => {
  const raster = createRaster();
  drawVoltaBracket(raster, 0.1, 0.36);
  drawVoltaBracket(raster, 0.5, 0.76);

  const candidates = detect(raster, [
    text('2.', 0.105, 0.17, 0.02, 0),
    text('3.', 0.505, 0.17, 0.02, 1),
  ]).filter((candidate) => candidate.type === NAVIGATION_VOLTA_ANCHOR_TYPE);

  assert.deepEqual(
    candidates.map((candidate) => ({ measureId: candidate.measureId, passes: candidate.passes })),
    [
      { measureId: 'm1', passes: [2] },
      { measureId: 'm2', passes: [3] },
    ],
  );
});

test('복수 pass 표기는 배열을 허용하고 구조 증거를 공유한다', () => {
  const raster = createRaster();
  drawVoltaBracket(raster, 0.1, 0.36);

  const candidate = detect(raster, [text('1,3.', 0.105, 0.17, 0.035)])
    .find((item) => item.type === NAVIGATION_VOLTA_ANCHOR_TYPE);

  assert.deepEqual(candidate.passes, [1, 3]);
});

test('경로 B는 가로선 없이 같은 Measure의 Repeat 구조를 high Volta로 만든다', () => {
  const raster = createRaster();
  drawRepeatEnd(raster, 0.5);

  const candidate = detect(raster, [text('1.', 0.105, 0.17)])
    .find((item) => item.type === NAVIGATION_VOLTA_ANCHOR_TYPE);

  assert.equal(candidate.confidence, 'high');
  assert.equal(candidate.evidence.detectionPath, 'text-structure');
  assert.equal(candidate.evidence.horizontalBracket, null);
  assert.equal(candidate.evidence.repeatStructure.distance, 0);
  assert.equal(candidate.evidence.repeatStructure.type, NAVIGATION_MARKER_TYPES.REPEAT_END);
});

test('경로 B는 인접 Measure의 Repeat 구조를 medium Volta로 만든다', () => {
  const raster = createRaster();
  drawRepeatEnd(raster, 0.5);

  const candidate = detect(raster, [text('2.', 0.505, 0.17, 0.02, 1)])
    .find((item) => item.type === NAVIGATION_VOLTA_ANCHOR_TYPE);

  assert.equal(candidate.measureId, 'm2');
  assert.equal(candidate.confidence, 'medium');
  assert.equal(candidate.evidence.detectionPath, 'text-structure');
  assert.equal(candidate.evidence.repeatStructure.distance, 1);
});

test('bracket과 Repeat 또는 기존 Ending이 모두 없으면 Volta가 아니다', () => {
  const raster = createRaster();

  const candidates = detect(raster, [text('1.', 0.105, 0.17)])
    .filter((candidate) => candidate.type === NAVIGATION_VOLTA_ANCHOR_TYPE);

  assert.deepEqual(candidates, []);
});

test('bracket 없는 마디 번호, 페이지 번호와 chord 숫자는 Volta가 아니다', () => {
  const raster = createRaster();
  const candidates = detect(raster, [
    text('1.', 0.105, 0.17, 0.02, 0),
    text('2.', 0.5, 0.05, 0.02, 1),
    text('7.', 0.3, 0.17, 0.02, 2),
  ]);

  assert.deepEqual(candidates, []);
});

test('staff line 자체는 Volta horizontal bracket으로 사용하지 않는다', () => {
  const raster = createRaster();

  assert.deepEqual(detect(raster, [text('1.', 0.105, 0.17)]), []);
});

test('같은 Measure와 pass의 기존 Ending은 이미 지정됨으로 조정한다', () => {
  const raster = createRaster();
  const measures = MEASURES.map((measure, index) => ({
    ...measure,
    navigationEndings: index === 0
      ? [{
          confidence: 1,
          id: 'ending-1',
          passes: [1],
          repeatEndMeasureId: 'm2',
          repeatStartMeasureId: 'm1',
          source: 'manual',
          startMeasureId: 'm1',
          type: 'volta',
        }]
      : [],
  }));
  const candidate = detect(raster, [text('1.', 0.105, 0.17)], measures)
    .find((item) => item.type === NAVIGATION_VOLTA_ANCHOR_TYPE);

  const [reconciled] = reconcileNavigationTextCandidates([candidate], measures);

  assert.equal(candidate.confidence, 'high');
  assert.equal(candidate.evidence.detectionPath, 'text-structure');
  assert.equal(candidate.evidence.endingStructure.id, 'ending-1');
  assert.equal(
    reconciled.matchStatus,
    NAVIGATION_TEXT_MATCH_STATUS.MATCHED_EXISTING_MARKER,
  );
});

test('Graphic Candidate 생성은 Project, Validator와 Playback sequence를 바꾸지 않는다', () => {
  const measures = MEASURES.map((measure) => ({ ...measure }));
  const beforeProject = JSON.stringify(measures);
  const beforeJsonExport = exportMeasuresJson(measures);
  const beforeSocketPayload = JSON.stringify({ measures });
  const beforeValidation = validateNavigationModel(measures);
  const beforeSequence = resolvePlaybackSequence(measures);
  const raster = createRaster();
  drawRepeatStart(raster, 0.1);
  const segno = glyphText('%', 0.18, 0.16);
  drawGlyphInk(raster, segno);

  const candidates = detect(raster, [segno, ...getNotationFontContext()], measures);

  assert.equal(candidates.length, 2);
  assert.equal(JSON.stringify(measures), beforeProject);
  assert.equal(exportMeasuresJson(measures), beforeJsonExport);
  assert.equal(JSON.stringify({ measures }), beforeSocketPayload);
  assert.deepEqual(validateNavigationModel(measures), beforeValidation);
  assert.deepEqual(resolvePlaybackSequence(measures), beforeSequence);
});
