import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyScoreTextItem,
  isNavigationInstructionText,
  isPerformanceInstructionText,
  SCORE_TEXT_CATEGORIES,
} from '../src/utils/scoreTextClassification.js';

const SYSTEM = {
  staffBottom: 0.25,
  staffSpacing: 0.02,
  staffTop: 0.17,
};

function classify(text, metadata = {}) {
  return classifyScoreTextItem({
    baselineY: 0.32,
    text,
    ...metadata,
  }, {
    system: SYSTEM,
  }).category;
}

test('Navigation command text를 lyric이 아닌 navigation으로 분류한다', () => {
  ['To Coda', 'D.S.', 'DS al Coda', 'D.S. al Fine', 'D.C. al Fine'].forEach(
    (value) => {
      assert.equal(isNavigationInstructionText(value), true, value);
      assert.equal(classify(value), SCORE_TEXT_CATEGORIES.NAVIGATION, value);
    },
  );
});

test('Fine은 staff-relative instruction context에서만 navigation으로 분류한다', () => {
  assert.equal(
    classify('Fine', { baselineY: 0.27 }),
    SCORE_TEXT_CATEGORIES.NAVIGATION,
  );
  assert.equal(classify('Fine'), SCORE_TEXT_CATEGORIES.LYRIC_CANDIDATE);
});

test('performance instruction을 별도 category로 분류한다', () => {
  ['(2x only)', '2nd time only', 'rit.', 'ritard.', 'simile', 'ad lib.'].forEach(
    (value) => {
      assert.equal(isPerformanceInstructionText(value), true, value);
      assert.equal(
        classify(value),
        SCORE_TEXT_CATEGORIES.PERFORMANCE_INSTRUCTION,
        value,
      );
    },
  );
});

test('영어와 혼합 가사는 instruction filter를 통과한다', () => {
  ['This is our page', 'This is ou - r page', 'K-pop forever', '우리의 This is our page'].forEach(
    (value) => {
      assert.equal(
        classify(value),
        SCORE_TEXT_CATEGORIES.LYRIC_CANDIDATE,
        value,
      );
    },
  );
});

test('가사 baseline의 독립 하이픈은 표시 후처리를 위한 lyric separator로 유지한다', () => {
  assert.equal(
    classifyScoreTextItem(
      { baselineY: 0.37, text: '-' },
      {
        allowLyricContinuationSeparator: true,
        system: SYSTEM,
      },
    ).category,
    SCORE_TEXT_CATEGORIES.LYRIC_CANDIDATE,
  );
  assert.equal(
    classifyScoreTextItem(
      { baselineY: 0.37, text: '-' },
      {
        allowLyricContinuationSeparator: true,
        isNotation: true,
        system: SYSTEM,
      },
    ).category,
    SCORE_TEXT_CATEGORIES.METADATA,
  );
});
