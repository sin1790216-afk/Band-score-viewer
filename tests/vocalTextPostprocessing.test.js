import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exportMeasuresJson,
  importMeasuresJson,
  createInitialProjectState,
} from '../src/state/projectState.js';
import {
  decodeBsvProject,
  encodeBsvProject,
} from '../src/project/bsvCodec.js';
import { PDF_MIME_TYPE } from '../src/project/bsvSchema.js';
import {
  createVocalDisplayText,
  normalizeVocalExtractionArtifacts,
} from '../src/utils/vocalTextPostprocessing.js';
import { createVocalPhrases } from '../src/utils/vocalPhrases.js';

test('음절마다 공백이 들어간 명백한 PDF 추출 흔적만 표시용으로 합친다', () => {
  assert.equal(
    normalizeVocalExtractionArtifacts('매 만 지 는 바 람'),
    '매만지는바람',
  );
});

test('정상 띄어쓰기와 짧은 한글 단어 나열은 과도하게 합치지 않는다', () => {
  assert.equal(
    normalizeVocalExtractionArtifacts('이미 정상 띄어쓰기된 한국어'),
    '이미 정상 띄어쓰기된 한국어',
  );
  assert.equal(normalizeVocalExtractionArtifacts('나 너 둘 다'), '나 너 둘 다');
});

test('영어와 숫자 및 기호가 포함된 가사는 그대로 유지한다', () => {
  const text = 'Hello world\nVerse 2: Love & Peace!';

  assert.equal(normalizeVocalExtractionArtifacts(text), text);
});

test('영어 음절 분리 하이픈은 표시용 문자열에서만 연결한다', () => {
  assert.equal(
    normalizeVocalExtractionArtifacts('This is ou - r page -'),
    'This is our page',
  );
  assert.equal(
    createVocalDisplayText('우리의 This is ou - r page -'),
    '우리의 This is our page',
  );
});

test('영어 단어 내부의 의미 있는 하이픈은 보존한다', () => {
  assert.equal(
    normalizeVocalExtractionArtifacts('K-pop X-ray mother-in-law'),
    'K-pop X-ray mother-in-law',
  );
  assert.equal(normalizeVocalExtractionArtifacts('A - B'), 'A - B');
});

test('독립된 악보용 separator만 제거하고 의미 있는 하이픈은 보존한다', () => {
  assert.equal(
    normalizeVocalExtractionArtifacts('웃었던 -\n- 도사...'),
    '웃었던\n도사...',
  );
  assert.equal(
    normalizeVocalExtractionArtifacts('었던－날 －도사'),
    '었던날 도사',
  );
  assert.equal(
    normalizeVocalExtractionArtifacts('K-pop 10-20 A - B 서울 - 부산'),
    'K-pop 10-20 A - B 서울 - 부산',
  );
});

test('후처리는 완성된 Phrase 문맥에 적용하고 measure.lyric과 Phrase text를 보존한다', () => {
  const measures = [
    { id: 'measure-1', lyric: '따 사 로 운' },
    { id: 'measure-2', lyric: '햇 살 속 에 서' },
  ];
  const originalLyrics = measures.map((measure) => measure.lyric);
  const [phrase] = createVocalPhrases(measures);

  assert.deepEqual(
    measures.map((measure) => measure.lyric),
    originalLyrics,
  );
  assert.equal(phrase.text, '따 사 로 운 햇 살 속 에 서');
  assert.equal(phrase.displayText, '따사로운햇살속에서');
});

test('교체 가능한 spacing provider는 Phrase 전체 문맥의 공백만 바꿀 수 있다', () => {
  const text = '따사 로운 햇살속에서';

  assert.equal(
    createVocalDisplayText(text, {
      spacingProvider: () => '따사로운 햇살 속에서',
    }),
    '따사로운 햇살 속에서',
  );
  assert.equal(
    createVocalDisplayText(text, {
      spacingProvider: () => '원문을 바꾼 결과',
    }),
    text,
  );
});

test('spacing provider 실패 시 원문 기반 표시 문자열로 fallback한다', () => {
  assert.equal(
    createVocalDisplayText('원본 가사', {
      spacingProvider: () => {
        throw new Error('provider failed');
      },
    }),
    '원본 가사',
  );
});

test('JSON round-trip은 displayText를 저장하지 않고 원본 lyric을 그대로 보존한다', () => {
  const sourceLyric = '매 만 지 는 바 람\n둘째 줄';
  const measures = [
    {
      id: 'measure-1',
      page: 1,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.1,
      bpm: 120,
      beats: 4,
      lyric: sourceLyric,
    },
  ];
  const serialized = exportMeasuresJson(measures);
  const restored = importMeasuresJson(serialized);

  assert.equal(restored[0].lyric, sourceLyric);
  assert.equal(Object.hasOwn(JSON.parse(serialized)[0], 'displayText'), false);
});

test('.bsv round-trip도 표시용 text 없이 원본 lyric을 그대로 보존한다', async () => {
  const sourceLyric = '매 만 지 는 바 람';
  const projectState = createInitialProjectState({
    measures: [
      {
        id: 'measure-1',
        page: 1,
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.1,
        bpm: 120,
        beats: 4,
        lyric: sourceLyric,
      },
    ],
    pdfMetadata: {
      fileName: 'spacing-test.pdf',
      mimeType: PDF_MIME_TYPE,
    },
  });
  const encoded = await encodeBsvProject({
    now: '2026-08-13T00:00:00.000Z',
    pdfBlob: new Blob(
      [new TextEncoder().encode('%PDF-1.4\n%%EOF')],
      { type: PDF_MIME_TYPE },
    ),
    projectState,
  });
  const decoded = decodeBsvProject(encoded.text);

  assert.equal(decoded.projectState.measures[0].lyric, sourceLyric);
  assert.equal(
    Object.hasOwn(encoded.document.project.measures[0], 'displayText'),
    false,
  );
});
