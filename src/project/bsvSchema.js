import {
  isCanonicalMeasure,
  NORMALIZED_COORDINATE_SPACE,
} from '../utils/measureCoordinates.js';
import { isValidMeasureId } from '../utils/measureIdentity.js';
import {
  DEFAULT_AUDIO_SETTINGS,
  MAX_AUDIO_URL_LENGTH,
} from '../utils/audioSettings.js';
import { isValidNavigationMarkers } from '../utils/navigationMarkers.js';
import {
  collectNavigationEndings,
  isValidNavigationEndings,
} from '../utils/navigationEndings.js';

export const BSV_FORMAT = 'band-score-viewer-project';
export const BSV_SCHEMA_VERSION = 1;
export const BSV_FILE_MIME_TYPE = 'application/vnd.band-score-viewer+json';
export const PDF_MIME_TYPE = 'application/pdf';
export const BASE64_ENCODING = 'base64';

export class BsvProjectError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'BsvProjectError';
    this.code = code;
  }
}

function fail(code, message, options) {
  throw new BsvProjectError(code, message, options);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidIsoDate(value) {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isPositiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function assertValidMetadata(metadata) {
  if (!isObject(metadata)) {
    fail('PROJECT_METADATA_MISSING', '프로젝트 metadata가 없습니다.');
  }

  if (typeof metadata.title !== 'string' || metadata.title.trim().length === 0) {
    fail('PROJECT_TITLE_INVALID', '프로젝트 제목이 올바르지 않습니다.');
  }

  if (!isValidIsoDate(metadata.createdAt) || !isValidIsoDate(metadata.updatedAt)) {
    fail('PROJECT_DATE_INVALID', '프로젝트 저장 날짜가 올바르지 않습니다.');
  }
}

function assertValidMeasure(measure, index, measureIds) {
  if (!isObject(measure)) {
    fail('MEASURE_INVALID', `${index + 1}번 마디 데이터가 올바르지 않습니다.`);
  }

  if (!Number.isInteger(Number(measure.page)) || Number(measure.page) < 1) {
    fail('MEASURE_PAGE_INVALID', `${index + 1}번 마디의 페이지가 올바르지 않습니다.`);
  }

  if (!isValidMeasureId(measure.id)) {
    fail('MEASURE_ID_INVALID', `${index + 1}번 마디의 ID가 올바르지 않습니다.`);
  }

  if (measureIds.has(measure.id)) {
    fail('MEASURE_ID_DUPLICATE', `${index + 1}번 마디의 ID가 중복되었습니다.`);
  }

  measureIds.add(measure.id);

  if (!isCanonicalMeasure(measure)) {
    fail('MEASURE_COORDINATES_INVALID', `${index + 1}번 마디의 좌표가 올바르지 않습니다.`);
  }

  if (
    measure.coordinateSpace !== NORMALIZED_COORDINATE_SPACE ||
    Number(measure.coordinateWidth) !== 1 ||
    Number(measure.coordinateHeight) !== 1 ||
    !isPositiveNumber(measure.width) ||
    !isPositiveNumber(measure.height)
  ) {
    fail(
      'MEASURE_COORDINATE_SPACE_INVALID',
      `${index + 1}번 마디가 normalized-page-v1 좌표가 아닙니다.`,
    );
  }

  if (!isPositiveNumber(measure.bpm) || !isPositiveNumber(measure.beats)) {
    fail('MEASURE_TIMING_INVALID', `${index + 1}번 마디의 BPM/Beats가 올바르지 않습니다.`);
  }

  if (typeof measure.lyric !== 'string') {
    fail('MEASURE_LYRIC_INVALID', `${index + 1}번 마디의 가사가 올바르지 않습니다.`);
  }

  if (!isValidNavigationMarkers(measure.navigationMarkers)) {
    fail(
      'MEASURE_NAVIGATION_MARKERS_INVALID',
      `${index + 1}번 마디의 Navigation Marker가 올바르지 않습니다.`,
    );
  }

  if (!isValidNavigationEndings(measure.navigationEndings)) {
    fail(
      'MEASURE_NAVIGATION_ENDINGS_INVALID',
      `${index + 1}번 마디의 괄호 데이터가 올바르지 않습니다.`,
    );
  }
}

function assertValidProject(project) {
  if (!isObject(project)) {
    fail('PROJECT_DATA_MISSING', '프로젝트 데이터가 없습니다.');
  }

  if (!isObject(project.pdfMetadata)) {
    fail('PDF_METADATA_MISSING', 'PDF metadata가 없습니다.');
  }

  if (
    typeof project.pdfMetadata.fileName !== 'string' ||
    project.pdfMetadata.fileName.trim().length === 0
  ) {
    fail('PDF_FILE_NAME_INVALID', 'PDF 파일명이 올바르지 않습니다.');
  }

  if (project.pdfMetadata.mimeType !== PDF_MIME_TYPE) {
    fail('PDF_MIME_TYPE_INVALID', 'PDF MIME type이 올바르지 않습니다.');
  }

  if (!Array.isArray(project.measures)) {
    fail('PROJECT_MEASURES_MISSING', '프로젝트의 마디 데이터가 없습니다.');
  }

  if (!isObject(project.audioSettings)) {
    fail('AUDIO_SETTINGS_MISSING', '프로젝트의 음원 설정이 없습니다.');
  }

  if (
    typeof project.audioSettings.url !== 'string' ||
    project.audioSettings.url.length > MAX_AUDIO_URL_LENGTH
  ) {
    fail('AUDIO_URL_INVALID', '프로젝트의 음원 링크가 올바르지 않습니다.');
  }

  if (
    !Number.isFinite(project.audioSettings.startOffsetSeconds) ||
    project.audioSettings.startOffsetSeconds < 0
  ) {
    fail('AUDIO_START_OFFSET_INVALID', '프로젝트의 음원 시작 오프셋이 올바르지 않습니다.');
  }

  const measureIds = new Set();

  project.measures.forEach((measure, index) =>
    assertValidMeasure(measure, index, measureIds),
  );

  collectNavigationEndings(project.measures).forEach((ending) => {
    if (
      !measureIds.has(ending.startMeasureId) ||
      !measureIds.has(ending.repeatStartMeasureId) ||
      !measureIds.has(ending.repeatEndMeasureId) ||
      (ending.explicitEndMeasureId &&
        !measureIds.has(ending.explicitEndMeasureId))
    ) {
      fail(
        'MEASURE_NAVIGATION_ENDING_REFERENCE_INVALID',
        '괄호가 존재하지 않는 마디를 참조합니다.',
      );
    }
  });
}

function assertValidPdfAsset(assets) {
  if (!isObject(assets) || !isObject(assets.scorePdf)) {
    fail('PDF_ASSET_MISSING', '프로젝트에 PDF 파일 데이터가 없습니다.');
  }

  const pdfAsset = assets.scorePdf;

  if (pdfAsset.encoding !== BASE64_ENCODING) {
    fail('PDF_ENCODING_INVALID', 'PDF 인코딩 형식이 올바르지 않습니다.');
  }

  if (!Number.isSafeInteger(pdfAsset.byteLength) || pdfAsset.byteLength <= 0) {
    fail('PDF_BYTE_LENGTH_INVALID', 'PDF 파일 크기 정보가 올바르지 않습니다.');
  }

  if (typeof pdfAsset.data !== 'string' || pdfAsset.data.length === 0) {
    fail('PDF_DATA_INVALID', 'PDF 파일 데이터가 비어 있습니다.');
  }
}

export function validateBsvV1Document(document) {
  assertValidMetadata(document.metadata);
  assertValidProject(document.project);
  assertValidPdfAsset(document.assets);

  return document;
}

export function migrateBsvProject(rawProject) {
  if (!isObject(rawProject)) {
    fail('PROJECT_DOCUMENT_INVALID', 'Band Score Viewer 프로젝트 문서가 아닙니다.');
  }

  if (rawProject.format !== BSV_FORMAT) {
    fail('FORMAT_INVALID', '지원하는 Band Score Viewer 프로젝트 형식이 아닙니다.');
  }

  if (rawProject.schemaVersion === undefined || rawProject.schemaVersion === null) {
    fail('SCHEMA_VERSION_MISSING', '프로젝트 schemaVersion이 없습니다.');
  }

  if (rawProject.schemaVersion !== BSV_SCHEMA_VERSION) {
    fail(
      'SCHEMA_VERSION_UNSUPPORTED',
      `지원하지 않는 프로젝트 schemaVersion입니다: ${rawProject.schemaVersion}`,
    );
  }

  const migratedProject = {
    ...rawProject,
    project: isObject(rawProject.project)
      ? {
          ...rawProject.project,
          audioSettings: Object.prototype.hasOwnProperty.call(
            rawProject.project,
            'audioSettings',
          )
            ? rawProject.project.audioSettings
            : { ...DEFAULT_AUDIO_SETTINGS },
        }
      : rawProject.project,
  };

  return validateBsvV1Document(migratedProject);
}
