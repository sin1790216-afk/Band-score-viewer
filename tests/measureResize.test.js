import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MEASURE_RESIZE_DIRECTIONS,
  resizeCanonicalMeasure,
} from '../src/utils/measureResize.js';

const measure = {
  height: 0.3,
  width: 0.4,
  x: 0.2,
  y: 0.3,
};

const minimumSize = {
  minimumHeight: 0.05,
  minimumWidth: 0.05,
};

function resize(direction, deltaX, deltaY) {
  return resizeCanonicalMeasure({
    ...minimumSize,
    deltaX,
    deltaY,
    direction,
    measure,
  });
}

function assertRectClose(actual, expected) {
  ['x', 'y', 'width', 'height'].forEach((field) => {
    assert.ok(
      Math.abs(actual[field] - expected[field]) < 1e-12,
      `${field}: expected ${actual[field]} to equal ${expected[field]}`,
    );
  });
}

test('left resize는 오른쪽 경계를 유지하며 x와 width를 변경한다', () => {
  assertRectClose(resize(MEASURE_RESIZE_DIRECTIONS.LEFT, 0.1, 0), {
    height: 0.3,
    width: 0.3,
    x: 0.3,
    y: 0.3,
  });
});

test('right resize는 x를 유지하며 width를 변경한다', () => {
  assertRectClose(resize(MEASURE_RESIZE_DIRECTIONS.RIGHT, 0.2, 0), {
    height: 0.3,
    width: 0.6000000000000001,
    x: 0.2,
    y: 0.3,
  });
});

test('top resize는 아래 경계를 유지하며 y와 height를 변경한다', () => {
  assertRectClose(resize(MEASURE_RESIZE_DIRECTIONS.TOP, 0, 0.1), {
    height: 0.19999999999999996,
    width: 0.4,
    x: 0.2,
    y: 0.4,
  });
});

test('bottom resize는 y를 유지하며 height를 변경한다', () => {
  assertRectClose(resize(MEASURE_RESIZE_DIRECTIONS.BOTTOM, 0, 0.2), {
    height: 0.49999999999999994,
    width: 0.4,
    x: 0.2,
    y: 0.3,
  });
});

test('top-left resize는 오른쪽 아래 모서리를 유지한다', () => {
  assertRectClose(resize(MEASURE_RESIZE_DIRECTIONS.TOP_LEFT, -0.1, -0.1), {
    height: 0.4,
    width: 0.5,
    x: 0.1,
    y: 0.19999999999999998,
  });
});

test('top-right resize는 왼쪽 아래 모서리를 유지한다', () => {
  assertRectClose(resize(MEASURE_RESIZE_DIRECTIONS.TOP_RIGHT, 0.1, -0.1), {
    height: 0.4,
    width: 0.5,
    x: 0.2,
    y: 0.19999999999999998,
  });
});

test('bottom-left resize는 오른쪽 위 모서리를 유지한다', () => {
  assertRectClose(resize(MEASURE_RESIZE_DIRECTIONS.BOTTOM_LEFT, -0.1, 0.1), {
    height: 0.39999999999999997,
    width: 0.5,
    x: 0.1,
    y: 0.3,
  });
});

test('bottom-right resize는 왼쪽 위 모서리를 유지한다', () => {
  assertRectClose(resize(MEASURE_RESIZE_DIRECTIONS.BOTTOM_RIGHT, 0.1, 0.1), {
    height: 0.39999999999999997,
    width: 0.5,
    x: 0.2,
    y: 0.3,
  });
});

test('resize 결과를 정규화 페이지 경계 안으로 제한한다', () => {
  assertRectClose(resize(MEASURE_RESIZE_DIRECTIONS.TOP_LEFT, -1, -1), {
    height: 0.6,
    width: 0.6000000000000001,
    x: 0,
    y: 0,
  });
  assertRectClose(resize(MEASURE_RESIZE_DIRECTIONS.BOTTOM_RIGHT, 1, 1), {
    height: 0.7,
    width: 0.8,
    x: 0.2,
    y: 0.3,
  });
});

test('handle이 반대 경계를 넘어도 minimum width와 height를 유지한다', () => {
  assertRectClose(resize(MEASURE_RESIZE_DIRECTIONS.TOP_LEFT, 1, 1), {
    height: 0.050000000000000044,
    width: 0.050000000000000044,
    x: 0.55,
    y: 0.5499999999999999,
  });
  assertRectClose(resize(MEASURE_RESIZE_DIRECTIONS.BOTTOM_RIGHT, -1, -1), {
    height: 0.04999999999999999,
    width: 0.04999999999999999,
    x: 0.2,
    y: 0.3,
  });
});

test('모든 resize 결과는 normalized coordinate 범위에 머문다', () => {
  Object.values(MEASURE_RESIZE_DIRECTIONS).forEach((direction) => {
    const result = resize(direction, 2, -2);

    assert.ok(result.x >= 0 && result.y >= 0);
    assert.ok(result.width > 0 && result.height > 0);
    assert.ok(result.x + result.width <= 1);
    assert.ok(result.y + result.height <= 1);
  });
});
