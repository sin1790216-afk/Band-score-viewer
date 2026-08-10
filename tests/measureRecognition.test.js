import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectMeasureCandidates,
  detectScoreLayout,
  getStaffContentRanges,
  recognizePdfDocumentPages,
  recognizePdfLoadingTaskPages,
} from '../src/utils/measureRecognition.js';

function createImage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = 255;
  }

  return { data, height, width };
}

function drawPixel(image, x, y) {
  if (x < 0 || x >= image.width || y < 0 || y >= image.height) return;

  const index = (Math.floor(y) * image.width + Math.floor(x)) * 4;

  image.data[index] = 0;
  image.data[index + 1] = 0;
  image.data[index + 2] = 0;
  image.data[index + 3] = 255;
}

function drawHorizontalLine(image, startX, endX, y, thickness = 1) {
  for (let offsetY = 0; offsetY < thickness; offsetY += 1) {
    for (let x = startX; x <= endX; x += 1) drawPixel(image, x, y + offsetY);
  }
}

function drawVerticalLine(image, x, startY, endY, thickness = 1) {
  for (let offsetX = 0; offsetX < thickness; offsetX += 1) {
    for (let y = startY; y <= endY; y += 1) drawPixel(image, x + offsetX, y);
  }
}

function drawStaff(image, { barlines, left, scale, top }) {
  const spacing = 10 * scale;
  const right = image.width - left;

  for (let line = 0; line < 5; line += 1) {
    drawHorizontalLine(image, left, right, top + line * spacing, scale);
  }

  barlines.forEach((x) => {
    drawVerticalLine(image, x, top, top + spacing * 4, scale);
  });

  // 음표 기둥은 일부 줄 간격만 관통하므로 마디선으로 검출되면 안 된다.
  drawVerticalLine(image, left + spacing * 7, top + spacing, top + spacing * 3, scale);
}

function createScore(scale = 1) {
  const image = createImage(1000 * scale, 700 * scale);

  drawStaff(image, {
    barlines: [80, 300, 600, 920].map((value) => value * scale),
    left: 80 * scale,
    scale,
    top: 150 * scale,
  });
  drawStaff(image, {
    barlines: [80, 400, 700, 920].map((value) => value * scale),
    left: 80 * scale,
    scale,
    top: 430 * scale,
  });

  return image;
}

function assertClose(actual, expected, tolerance = 0.005) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function createStaffGroup(firstLine, spacing = 10) {
  return {
    bands: Array.from({ length: 5 }, (_, index) => {
      const center = firstLine + index * spacing;

      return { center, end: center, start: center, thickness: 1 };
    }),
    spacing,
  };
}

test('오선의 마디선을 읽기 순서의 정규화 박스로 변환한다', () => {
  const candidates = detectMeasureCandidates(createScore());

  assert.equal(candidates.length, 6);
  assertClose(candidates[0].x, 0.08);
  assertClose(candidates[0].width, 0.22);
  assertClose(candidates[1].x, 0.3);
  assertClose(candidates[1].width, 0.3);
  assert.ok(candidates[0].y < candidates[3].y);
});

test('옆가지가 없는 순수 vertical barline은 그대로 검출한다', () => {
  const candidates = detectMeasureCandidates(createScore());

  assert.equal(candidates.length, 6);
  assertClose(candidates[1].x, 0.3);
});

test('notehead가 직접 붙은 vertical stem은 barline으로 검출하지 않는다', () => {
  const image = createScore();

  drawVerticalLine(image, 450, 150, 190, 2);
  drawHorizontalLine(image, 430, 449, 174, 6);

  const candidates = detectMeasureCandidates(image);

  assert.equal(candidates.length, 6);
  assertClose(candidates[1].x, 0.3);
  assertClose(candidates[1].width, 0.3);
});

test('beam이 직접 붙은 vertical stem은 barline으로 검출하지 않는다', () => {
  const image = createScore();

  drawVerticalLine(image, 450, 144, 190, 2);
  drawHorizontalLine(image, 410, 449, 144, 4);

  const candidates = detectMeasureCandidates(image);

  assert.equal(candidates.length, 6);
  assertClose(candidates[1].x, 0.3);
  assertClose(candidates[1].width, 0.3);
});

test('barline 가까이에 있지만 직접 연결되지 않은 음표는 barline을 제거하지 않는다', () => {
  const image = createScore();

  drawHorizontalLine(image, 278, 292, 174, 6);

  const candidates = detectMeasureCandidates(image);

  assert.equal(candidates.length, 6);
  assertClose(candidates[0].width, 0.22);
  assertClose(candidates[1].x, 0.3);
});

test('서로 다른 렌더 크기에서도 같은 정규화 좌표를 만든다', () => {
  const regular = detectMeasureCandidates(createScore(1));
  const doubled = detectMeasureCandidates(createScore(2));

  assert.equal(doubled.length, regular.length);

  regular.forEach((candidate, index) => {
    assertClose(doubled[index].x, candidate.x);
    assertClose(doubled[index].y, candidate.y);
    assertClose(doubled[index].width, candidate.width);
    assertClose(doubled[index].height, candidate.height);
  });
});

test('오선이 없는 페이지에서는 후보를 만들지 않는다', () => {
  assert.deepEqual(detectMeasureCandidates(createImage(800, 1000)), []);
});

test('오선 밖의 빔까지 이어지는 음표 기둥을 마디선으로 보지 않는다', () => {
  const image = createScore();

  drawVerticalLine(image, 200, 120, 190, 2);
  drawHorizontalLine(image, 170, 200, 120, 2);

  const candidates = detectMeasureCandidates(image);

  assert.equal(candidates.length, 6);
});

test('오선 시작부의 음표 기둥으로 지나치게 좁은 첫 박스를 만들지 않는다', () => {
  const image = createScore();

  drawVerticalLine(image, 250, 150, 190, 2);

  const candidates = detectMeasureCandidates(image);

  assert.equal(candidates.length, 6);
  assertClose(candidates[0].width, 0.22);
});

test('system content band는 인접 system 사이의 중간 경계를 공유한다', () => {
  const ranges = getStaffContentRanges(
    [createStaffGroup(100), createStaffGroup(300), createStaffGroup(460)],
    600,
  );

  assert.deepEqual(ranges, [
    { bottom: 220, top: 20 },
    { bottom: 400, top: 220 },
    { bottom: 560, top: 400 },
  ]);
});

test('첫 system과 마지막 system content band는 page boundary 안에 머문다', () => {
  const firstNearPageTop = getStaffContentRanges(
    [createStaffGroup(30), createStaffGroup(180)],
    300,
  );
  const lastNearPageBottom = getStaffContentRanges(
    [createStaffGroup(100), createStaffGroup(250)],
    300,
  );

  assert.equal(firstNearPageTop[0].top, 0);
  assert.equal(lastNearPageBottom[1].bottom, 300);
});

test('같은 system의 모든 measure는 동일한 vertical content band를 사용한다', () => {
  const candidates = detectMeasureCandidates(createScore());
  const firstSystemCandidates = candidates.slice(0, 3);
  const secondSystemCandidates = candidates.slice(3);

  assert.equal(new Set(firstSystemCandidates.map((measure) => measure.y)).size, 1);
  assert.equal(new Set(firstSystemCandidates.map((measure) => measure.height)).size, 1);
  assert.equal(new Set(secondSystemCandidates.map((measure) => measure.y)).size, 1);
  assert.equal(new Set(secondSystemCandidates.map((measure) => measure.height)).size, 1);
});

test('가사 분석용 score layout은 기존 measure와 정규화된 staff geometry를 함께 제공한다', () => {
  const layout = detectScoreLayout(createScore());

  assert.deepEqual(layout.measures, detectMeasureCandidates(createScore()));
  assert.equal(layout.systems.length, 2);
  assertClose(layout.systems[0].staffTop, 150 / 700);
  assertClose(layout.systems[0].staffBottom, 190 / 700);
  assertClose(layout.systems[0].staffSpacing, 10 / 700);
  assert.equal(layout.systems[0].contentTop, layout.measures[0].y);
  assertClose(
    layout.systems[0].contentBottom,
    layout.measures[0].y + layout.measures[0].height,
  );
});

test('PDF 페이지를 순서대로 분석하고 각 후보에 페이지 번호를 붙인다', async () => {
  const progress = [];
  const cleanedPages = [];
  const image = createScore();
  const pdf = {
    numPages: 2,
    async getPage(pageNumber) {
      return {
        cleanup() {
          cleanedPages.push(pageNumber);
        },
        getViewport({ scale }) {
          return { height: image.height * scale, width: image.width * scale };
        },
        render() {
          return { promise: Promise.resolve() };
        },
      };
    },
  };

  const measures = await recognizePdfDocumentPages(pdf, {
    createCanvas() {
      return {
        getContext() {
          return {
            fillRect() {},
            getImageData() {
              return image;
            },
          };
        },
        height: image.height,
        width: image.width,
      };
    },
    onProgress: (nextProgress) => progress.push(nextProgress),
    targetRenderWidth: image.width,
  });

  assert.equal(measures.length, 12);
  assert.deepEqual(
    measures.slice(0, 6).map((measure) => measure.page),
    [1, 1, 1, 1, 1, 1],
  );
  assert.deepEqual(
    measures.slice(6).map((measure) => measure.page),
    [2, 2, 2, 2, 2, 2],
  );
  assert.deepEqual(progress, [
    { currentPage: 1, totalPages: 2 },
    { currentPage: 2, totalPages: 2 },
  ]);
  assert.deepEqual(cleanedPages, [1, 2]);
});

test('PDF 페이지 분석이 끝난 뒤 loading task를 종료한다', async () => {
  const events = [];
  const image = createScore();
  let finishRender;
  const renderPromise = new Promise((resolve) => {
    finishRender = () => {
      events.push('render-complete');
      resolve();
    };
  });
  const loadingTask = {
    async destroy() {
      events.push('destroy');
    },
    promise: Promise.resolve({
      numPages: 1,
      async getPage() {
        return {
          cleanup() {
            events.push('page-cleanup');
          },
          getViewport({ scale }) {
            return { height: image.height * scale, width: image.width * scale };
          },
          render() {
            events.push('render-start');
            return { promise: renderPromise };
          },
        };
      },
    }),
  };

  const recognitionPromise = recognizePdfLoadingTaskPages(loadingTask, {
    createCanvas() {
      return {
        getContext() {
          return {
            fillRect() {},
            getImageData() {
              return image;
            },
          };
        },
        height: image.height,
        width: image.width,
      };
    },
    targetRenderWidth: image.width,
  });

  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, ['render-start']);

  finishRender();
  const measures = await recognitionPromise;

  assert.equal(measures.length, 6);
  assert.deepEqual(events, [
    'render-start',
    'render-complete',
    'page-cleanup',
    'destroy',
  ]);
});
