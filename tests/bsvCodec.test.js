import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeBsvProject, encodeBsvProject } from '../src/project/bsvCodec.js';
import {
  BSV_FORMAT,
  BSV_SCHEMA_VERSION,
  BsvProjectError,
  PDF_MIME_TYPE,
} from '../src/project/bsvSchema.js';
import {
  createInitialProjectState,
  PROJECT_ACTIONS,
  projectReducer,
} from '../src/state/projectState.js';
import {
  NORMALIZED_COORDINATE_SPACE,
  NORMALIZED_COORDINATE_STATUS,
} from '../src/utils/measureCoordinates.js';
import { DEFAULT_AUDIO_SETTINGS } from '../src/utils/audioSettings.js';
import { applyLyricCandidates } from '../src/utils/lyricRecognition.js';

const TEST_TIMESTAMP = '2026-08-02T05:00:00.000Z';
const PDF_BYTES = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF',
);
const MEASURE = {
  beats: 3,
  bpm: 90,
  coordinateHeight: 1,
  coordinateSpace: NORMALIZED_COORDINATE_SPACE,
  coordinateStatus: NORMALIZED_COORDINATE_STATUS,
  coordinateWidth: 1,
  height: 0.1,
  id: 'measure-bsv-1',
  lyric: '첫 번째 줄\n두 번째 줄',
  navigationMarkers: [{ type: 'segno' }],
  page: 2,
  width: 0.2,
  x: 0.25,
  y: 0.5,
};

function createProjectState() {
  return createInitialProjectState({
    audioSettings: {
      startOffsetSeconds: 12.5,
      url: 'https://example.com/backing-track',
    },
    measures: [MEASURE],
    metadata: {
      createdAt: '2026-08-01T01:00:00.000Z',
      title: '합주곡',
      updatedAt: '2026-08-01T01:00:00.000Z',
    },
    pdfMetadata: {
      fileName: '한글 악보.pdf',
      mimeType: PDF_MIME_TYPE,
    },
  });
}

async function createEncodedProject() {
  return encodeBsvProject({
    now: TEST_TIMESTAMP,
    pdfBlob: new Blob([PDF_BYTES], { type: PDF_MIME_TYPE }),
    projectState: createProjectState(),
  });
}

function expectBsvError(callback, code) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof BsvProjectError);
    assert.equal(error.code, code);
    return true;
  });
}

test('.bsv v1 encode and decode round-trip preserves project and PDF data', async () => {
  const encoded = await createEncodedProject();
  const decoded = decodeBsvProject(encoded.text);

  assert.equal(decoded.document.format, BSV_FORMAT);
  assert.equal(decoded.document.schemaVersion, BSV_SCHEMA_VERSION);
  assert.deepEqual(decoded.projectState, {
    audioSettings: {
      startOffsetSeconds: 12.5,
      url: 'https://example.com/backing-track',
    },
    measures: [MEASURE],
    metadata: {
      createdAt: '2026-08-01T01:00:00.000Z',
      title: '합주곡',
      updatedAt: TEST_TIMESTAMP,
    },
    pdfMetadata: {
      fileName: '한글 악보.pdf',
      mimeType: PDF_MIME_TYPE,
    },
  });
  assert.deepEqual(decoded.pdfBytes, PDF_BYTES);
  assert.deepEqual(
    new Uint8Array(await decoded.pdfBlob.arrayBuffer()),
    PDF_BYTES,
  );
});

test('PDF data larger than one codec chunk round-trips without whole-array spread', async () => {
  const largePdfBytes = new Uint8Array(100_000);

  largePdfBytes.set(PDF_BYTES.subarray(0, 8));
  const encoded = await encodeBsvProject({
    now: TEST_TIMESTAMP,
    pdfBlob: new Blob([largePdfBytes], { type: PDF_MIME_TYPE }),
    projectState: createProjectState(),
  });
  const decoded = decodeBsvProject(encoded.text);

  assert.deepEqual(decoded.pdfBytes, largePdfBytes);
});

test('.bsv stores PDF metadata once and preserves byteLength', async () => {
  const { document } = await createEncodedProject();

  assert.equal(document.project.pdfMetadata.fileName, '한글 악보.pdf');
  assert.equal(document.project.pdfMetadata.mimeType, PDF_MIME_TYPE);
  assert.equal(document.assets.scorePdf.byteLength, PDF_BYTES.byteLength);
  assert.equal('fileName' in document.assets.scorePdf, false);
  assert.equal('mimeType' in document.assets.scorePdf, false);
});

test('.bsv preserves normalized coordinates, BPM, Beats, and multiline lyrics', async () => {
  const decoded = decodeBsvProject((await createEncodedProject()).text);
  const [measure] = decoded.projectState.measures;

  assert.equal(measure.coordinateSpace, NORMALIZED_COORDINATE_SPACE);
  assert.equal(measure.coordinateWidth, 1);
  assert.equal(measure.coordinateHeight, 1);
  assert.equal(measure.id, MEASURE.id);
  assert.equal(measure.bpm, 90);
  assert.equal(measure.beats, 3);
  assert.equal(measure.lyric, '첫 번째 줄\n두 번째 줄');
  assert.deepEqual(measure.navigationMarkers, [{ type: 'segno' }]);
});

test('a legacy .bsv without navigation markers receives an empty marker list', async () => {
  const { document } = await createEncodedProject();

  delete document.project.measures[0].navigationMarkers;
  const decoded = decodeBsvProject(JSON.stringify(document));

  assert.deepEqual(decoded.projectState.measures[0].navigationMarkers, []);
});

test('.bsv rejects malformed navigation markers', async () => {
  const { document } = await createEncodedProject();

  document.project.measures[0].navigationMarkers = [{ type: 'unknown-marker' }];

  expectBsvError(
    () => decodeBsvProject(JSON.stringify(document)),
    'MEASURE_NAVIGATION_MARKERS_INVALID',
  );
});

test('.bsv preserves a lyric applied from an automatic recognition candidate', async () => {
  const lyricGeometry = {
    lines: [{ endX: 0.4, lineIndex: 0, referenceGap: 0.02, startX: 0.2 }],
    page: 2,
    systemEndX: 0.9,
    systemIndex: 0,
    systemStartX: 0.1,
  };
  const recognizedMeasures = applyLyricCandidates(
    [{ ...MEASURE, lyric: '' }],
    [
      {
        lyric: '자동 인식 가사\n둘째 줄',
        lyricGeometry,
        measureId: MEASURE.id,
      },
    ],
  ).measures;
  const encoded = await encodeBsvProject({
    now: TEST_TIMESTAMP,
    pdfBlob: new Blob([PDF_BYTES], { type: PDF_MIME_TYPE }),
    projectState: createInitialProjectState({
      ...createProjectState(),
      measures: recognizedMeasures,
    }),
  });
  const decoded = decodeBsvProject(encoded.text);

  assert.equal(decoded.projectState.measures[0].lyric, '자동 인식 가사\n둘째 줄');
  assert.deepEqual(
    encoded.document.project.measures[0].lyricGeometry,
    lyricGeometry,
  );
  assert.deepEqual(decoded.projectState.measures[0].lyricGeometry, lyricGeometry);
});

test('.bsv preserves three verse lines and an empty middle verse', async () => {
  const multilineLyric = '1절 가사\n\n3절 가사';
  const encoded = await encodeBsvProject({
    now: TEST_TIMESTAMP,
    pdfBlob: new Blob([PDF_BYTES], { type: PDF_MIME_TYPE }),
    projectState: createInitialProjectState({
      ...createProjectState(),
      measures: [{ ...MEASURE, lyric: multilineLyric }],
    }),
  });
  const decoded = decodeBsvProject(encoded.text);

  assert.equal(encoded.document.project.measures[0].lyric, multilineLyric);
  assert.equal(decoded.projectState.measures[0].lyric, multilineLyric);
});

test('.bsv preserves BPM after a Teacher global tempo application', async () => {
  const projectState = projectReducer(
    createInitialProjectState({
      ...createProjectState(),
      measures: [
        MEASURE,
        { ...MEASURE, bpm: 110, id: 'measure-bsv-2', x: 0.5 },
      ],
    }),
    {
      type: PROJECT_ACTIONS.APPLY_BPM_TO_ALL_MEASURES,
      bpm: 126,
    },
  );
  const encoded = await encodeBsvProject({
    now: TEST_TIMESTAMP,
    pdfBlob: new Blob([PDF_BYTES], { type: PDF_MIME_TYPE }),
    projectState,
  });
  const decoded = decodeBsvProject(encoded.text);

  assert.deepEqual(
    decoded.projectState.measures.map((measure) => measure.bpm),
    [126, 126],
  );
});

test('.bsv preserves the audio link and start offset', async () => {
  const decoded = decodeBsvProject((await createEncodedProject()).text);

  assert.deepEqual(decoded.projectState.audioSettings, {
    startOffsetSeconds: 12.5,
    url: 'https://example.com/backing-track',
  });
});

test('a legacy .bsv without audio settings receives compatible defaults', async () => {
  const { document } = await createEncodedProject();

  delete document.project.audioSettings;
  const decoded = decodeBsvProject(JSON.stringify(document));

  assert.deepEqual(decoded.projectState.audioSettings, DEFAULT_AUDIO_SETTINGS);
});

test('.bsv rejects malformed audio settings instead of replacing them', async () => {
  const invalidUrlProject = await createEncodedProject();

  invalidUrlProject.document.project.audioSettings.url = 42;
  expectBsvError(
    () => decodeBsvProject(JSON.stringify(invalidUrlProject.document)),
    'AUDIO_URL_INVALID',
  );

  const invalidOffsetProject = await createEncodedProject();

  invalidOffsetProject.document.project.audioSettings.startOffsetSeconds = -1;
  expectBsvError(
    () => decodeBsvProject(JSON.stringify(invalidOffsetProject.document)),
    'AUDIO_START_OFFSET_INVALID',
  );
});

test('.bsv rejects a missing or invalid measure ID', async () => {
  const missingIdProject = await createEncodedProject();

  delete missingIdProject.document.project.measures[0].id;
  expectBsvError(
    () => decodeBsvProject(JSON.stringify(missingIdProject.document)),
    'MEASURE_ID_INVALID',
  );

  const invalidIdProject = await createEncodedProject();

  invalidIdProject.document.project.measures[0].id = '   ';
  expectBsvError(
    () => decodeBsvProject(JSON.stringify(invalidIdProject.document)),
    'MEASURE_ID_INVALID',
  );
});

test('.bsv rejects duplicate measure IDs', async () => {
  const { document } = await createEncodedProject();

  document.project.measures.push({
    ...document.project.measures[0],
    x: 0.55,
  });

  expectBsvError(
    () => decodeBsvProject(JSON.stringify(document)),
    'MEASURE_ID_DUPLICATE',
  );
});

test('invalid JSON is rejected', () => {
  expectBsvError(() => decodeBsvProject('{not json'), 'INVALID_JSON');
});

test('invalid format is rejected', async () => {
  const { document } = await createEncodedProject();
  document.format = 'some-other-json';

  expectBsvError(() => decodeBsvProject(JSON.stringify(document)), 'FORMAT_INVALID');
});

test('missing schemaVersion is rejected', async () => {
  const { document } = await createEncodedProject();
  delete document.schemaVersion;

  expectBsvError(
    () => decodeBsvProject(JSON.stringify(document)),
    'SCHEMA_VERSION_MISSING',
  );
});

test('unsupported future schemaVersion is rejected', async () => {
  const { document } = await createEncodedProject();
  document.schemaVersion = BSV_SCHEMA_VERSION + 1;

  expectBsvError(
    () => decodeBsvProject(JSON.stringify(document)),
    'SCHEMA_VERSION_UNSUPPORTED',
  );
});

test('missing project data is rejected', async () => {
  const { document } = await createEncodedProject();
  delete document.project;

  expectBsvError(() => decodeBsvProject(JSON.stringify(document)), 'PROJECT_DATA_MISSING');
});

test('missing PDF asset is rejected', async () => {
  const { document } = await createEncodedProject();
  delete document.assets.scorePdf;

  expectBsvError(() => decodeBsvProject(JSON.stringify(document)), 'PDF_ASSET_MISSING');
});

test('invalid PDF MIME type is rejected', async () => {
  const { document } = await createEncodedProject();
  document.project.pdfMetadata.mimeType = 'application/octet-stream';

  expectBsvError(
    () => decodeBsvProject(JSON.stringify(document)),
    'PDF_MIME_TYPE_INVALID',
  );
});

test('corrupted PDF base64 and mismatched byteLength are rejected', async () => {
  const firstEncoded = await createEncodedProject();
  firstEncoded.document.assets.scorePdf.data = 'not-valid-base64';

  expectBsvError(
    () => decodeBsvProject(JSON.stringify(firstEncoded.document)),
    'PDF_BASE64_INVALID',
  );

  const secondEncoded = await createEncodedProject();
  secondEncoded.document.assets.scorePdf.byteLength += 1;

  expectBsvError(
    () => decodeBsvProject(JSON.stringify(secondEncoded.document)),
    'PDF_BYTE_LENGTH_MISMATCH',
  );
});

test('PDF data with a damaged signature is rejected', async () => {
  const { document } = await createEncodedProject();
  const base64Data = document.assets.scorePdf.data;

  document.assets.scorePdf.data = `${base64Data[0] === 'A' ? 'B' : 'A'}${base64Data.slice(1)}`;

  expectBsvError(
    () => decodeBsvProject(JSON.stringify(document)),
    'PDF_SIGNATURE_INVALID',
  );
});

test('decode failure leaves the existing Project State unchanged', async () => {
  const currentState = createProjectState();
  const { document } = await createEncodedProject();
  document.project.measures = null;

  expectBsvError(
    () => decodeBsvProject(JSON.stringify(document)),
    'PROJECT_MEASURES_MISSING',
  );
  assert.deepEqual(currentState, createProjectState());
});

test('a prepared .bsv snapshot replaces Project State in one reducer action', async () => {
  const currentState = createInitialProjectState({
    measures: [{ ...MEASURE, lyric: '이전 가사' }],
    pdfMetadata: {
      fileName: '이전.pdf',
      mimeType: PDF_MIME_TYPE,
    },
  });
  const prepared = decodeBsvProject((await createEncodedProject()).text);
  const nextState = projectReducer(currentState, {
    type: PROJECT_ACTIONS.REPLACE_PROJECT,
    projectState: prepared.projectState,
  });

  assert.deepEqual(nextState, prepared.projectState);
});
