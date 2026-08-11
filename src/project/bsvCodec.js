import {
  createInitialProjectState,
  getPersistableMeasures,
  normalizeMeasures,
} from '../state/projectState.js';
import { normalizeAudioSettings } from '../utils/audioSettings.js';
import {
  BASE64_ENCODING,
  BSV_FORMAT,
  BSV_SCHEMA_VERSION,
  BsvProjectError,
  migrateBsvProject,
  PDF_MIME_TYPE,
} from './bsvSchema.js';

const BASE64_CHUNK_SIZE = 32 * 1024;
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PDF_SIGNATURE_SEARCH_BYTES = 1024;

function getBase64Encoder() {
  if (typeof globalThis.btoa === 'function') return globalThis.btoa.bind(globalThis);

  if (globalThis.Buffer) {
    return (binary) => globalThis.Buffer.from(binary, 'binary').toString('base64');
  }

  throw new BsvProjectError('BASE64_UNAVAILABLE', '이 환경에서는 PDF를 저장할 수 없습니다.');
}

function getBase64Decoder() {
  if (typeof globalThis.atob === 'function') return globalThis.atob.bind(globalThis);

  if (globalThis.Buffer) {
    return (base64) => globalThis.Buffer.from(base64, 'base64').toString('binary');
  }

  throw new BsvProjectError('BASE64_UNAVAILABLE', '이 환경에서는 PDF를 불러올 수 없습니다.');
}

function bytesToBase64(bytes) {
  const encode = getBase64Encoder();
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_SIZE);
    const characters = new Array(chunk.length);

    for (let index = 0; index < chunk.length; index += 1) {
      characters[index] = String.fromCharCode(chunk[index]);
    }

    binary += characters.join('');
  }

  return encode(binary);
}

function isValidBase64(base64Data) {
  return (
    base64Data.length > 0 &&
    base64Data.length % 4 === 0 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(base64Data)
  );
}

function base64ToBytes(base64Data) {
  if (!isValidBase64(base64Data)) {
    throw new BsvProjectError('PDF_BASE64_INVALID', 'PDF base64 데이터가 손상되었습니다.');
  }

  let binary;

  try {
    binary = getBase64Decoder()(base64Data);
  } catch (error) {
    throw new BsvProjectError('PDF_BASE64_INVALID', 'PDF base64 데이터를 해석할 수 없습니다.', {
      cause: error,
    });
  }

  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function assertPdfSignature(bytes) {
  const lastStartIndex = Math.min(
    bytes.length - PDF_SIGNATURE.length,
    PDF_SIGNATURE_SEARCH_BYTES - PDF_SIGNATURE.length,
  );
  let hasPdfSignature = false;

  for (let startIndex = 0; startIndex <= lastStartIndex; startIndex += 1) {
    if (PDF_SIGNATURE.every((value, index) => bytes[startIndex + index] === value)) {
      hasPdfSignature = true;
      break;
    }
  }

  if (!hasPdfSignature) {
    throw new BsvProjectError('PDF_SIGNATURE_INVALID', '내장된 파일이 유효한 PDF가 아닙니다.');
  }
}

function getDefaultTitle(fileName) {
  const title = fileName.replace(/\.pdf$/i, '').trim();

  return title || fileName;
}

function getTimestamp(now) {
  const timestamp = typeof now === 'function' ? now() : now;
  const value = timestamp || new Date().toISOString();

  if (Number.isNaN(Date.parse(value))) {
    throw new BsvProjectError('PROJECT_DATE_INVALID', '프로젝트 저장 날짜를 만들 수 없습니다.');
  }

  return new Date(value).toISOString();
}

function getProjectMetadata(projectState, timestamp) {
  const fileName = projectState.pdfMetadata?.fileName || '';
  const previousMetadata = projectState.metadata || {};
  const createdAt = previousMetadata.createdAt || timestamp;

  return {
    createdAt,
    title: previousMetadata.title?.trim() || getDefaultTitle(fileName),
    updatedAt: timestamp,
  };
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new BsvProjectError('PDF_READ_FAILED', 'PDF 파일을 읽을 수 없습니다.'));
    };
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function blobToBase64(blob) {
  if (typeof FileReader === 'function') {
    const dataUrl = await readBlobAsDataUrl(blob);
    const separatorIndex = typeof dataUrl === 'string' ? dataUrl.indexOf(',') : -1;
    const prefix = separatorIndex >= 0 ? dataUrl.slice(0, separatorIndex) : '';
    const base64Data = separatorIndex >= 0 ? dataUrl.slice(separatorIndex + 1) : '';

    if (!prefix.endsWith(';base64') || !isValidBase64(base64Data)) {
      throw new BsvProjectError('PDF_BASE64_INVALID', 'PDF를 base64로 변환할 수 없습니다.');
    }

    return base64Data;
  }

  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

function parseBsvText(jsonText) {
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new BsvProjectError('INVALID_JSON', '프로젝트 파일의 JSON을 읽을 수 없습니다.', {
      cause: error,
    });
  }
}

export async function encodeBsvProject({ projectState, pdfBlob, now }) {
  if (
    !pdfBlob ||
    typeof pdfBlob.arrayBuffer !== 'function' ||
    typeof pdfBlob.slice !== 'function' ||
    !Number.isSafeInteger(pdfBlob.size) ||
    pdfBlob.size <= 0
  ) {
    throw new BsvProjectError('PDF_BLOB_MISSING', '저장할 PDF가 없습니다.');
  }

  const fileName = projectState?.pdfMetadata?.fileName || '';
  const mimeType = projectState?.pdfMetadata?.mimeType || pdfBlob.type || PDF_MIME_TYPE;

  if (!fileName || mimeType !== PDF_MIME_TYPE) {
    throw new BsvProjectError('PDF_METADATA_INVALID', '저장할 PDF 정보가 올바르지 않습니다.');
  }

  assertPdfSignature(
    new Uint8Array(await pdfBlob.slice(0, PDF_SIGNATURE_SEARCH_BYTES).arrayBuffer()),
  );

  const timestamp = getTimestamp(now);
  const document = {
    assets: {
      scorePdf: {
        byteLength: pdfBlob.size,
        data: await blobToBase64(pdfBlob),
        encoding: BASE64_ENCODING,
      },
    },
    format: BSV_FORMAT,
    metadata: getProjectMetadata(projectState, timestamp),
    project: {
      audioSettings: normalizeAudioSettings(projectState.audioSettings),
      measures: normalizeMeasures(getPersistableMeasures(projectState.measures)),
      pdfMetadata: {
        fileName,
        mimeType,
      },
    },
    schemaVersion: BSV_SCHEMA_VERSION,
  };

  migrateBsvProject(document);

  return {
    document,
    text: JSON.stringify(document, null, 2),
  };
}

export function decodeBsvProject(jsonText) {
  const document = migrateBsvProject(parseBsvText(jsonText));
  const pdfBytes = base64ToBytes(document.assets.scorePdf.data);

  if (pdfBytes.byteLength !== document.assets.scorePdf.byteLength) {
    throw new BsvProjectError(
      'PDF_BYTE_LENGTH_MISMATCH',
      'PDF 파일 크기가 프로젝트 정보와 일치하지 않습니다.',
    );
  }

  assertPdfSignature(pdfBytes);

  const projectState = createInitialProjectState({
    audioSettings: document.project.audioSettings,
    measures: document.project.measures,
    metadata: document.metadata,
    pdfMetadata: document.project.pdfMetadata,
  });
  const pdfBlob = new Blob([pdfBytes], {
    type: projectState.pdfMetadata.mimeType,
  });

  return {
    document,
    pdfBlob,
    pdfBytes,
    projectState,
  };
}
