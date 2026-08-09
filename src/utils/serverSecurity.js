import { isAbsolute, relative, resolve, sep } from 'node:path';

export const MAX_PDF_BYTES = 100 * 1024 * 1024;
export const MAX_MEASURES = 20_000;

const PDF_MIME_TYPE = 'application/pdf';
const PDF_SIGNATURE = Buffer.from('%PDF-');
const PDF_SIGNATURE_SEARCH_BYTES = 1024;

export function resolveStaticRequest(distDirectory, requestUrl) {
  let pathname;

  try {
    pathname = decodeURIComponent(
      new URL(requestUrl || '/', 'http://localhost').pathname,
    );
  } catch {
    return null;
  }

  if (pathname.includes('\0')) return null;

  const requestPath = pathname === '/' ? '/index.html' : pathname;
  const relativeRequestPath = requestPath.replace(/^\/+/, '');
  const filePath = resolve(distDirectory, relativeRequestPath);
  const relativeFilePath = relative(distDirectory, filePath);
  const isOutsideDist =
    relativeFilePath === '..' ||
    relativeFilePath.startsWith(`..${sep}`) ||
    isAbsolute(relativeFilePath);

  if (isOutsideDist) return null;

  return {
    filePath,
    requestPath,
  };
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }

  return null;
}

export function validatePdfState(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const data = toBuffer(payload.data);
  const fileName =
    typeof payload.fileName === 'string' ? payload.fileName.trim() : '';
  const type = payload.type || PDF_MIME_TYPE;

  if (
    !data ||
    data.byteLength < PDF_SIGNATURE.length ||
    data.byteLength > MAX_PDF_BYTES ||
    !fileName ||
    fileName.length > 255 ||
    type !== PDF_MIME_TYPE
  ) {
    return null;
  }

  const signatureSearch = data.subarray(
    0,
    Math.min(data.byteLength, PDF_SIGNATURE_SEARCH_BYTES),
  );

  if (signatureSearch.indexOf(PDF_SIGNATURE) < 0) return null;

  return {
    data,
    fileName,
    type: PDF_MIME_TYPE,
  };
}

export function isValidMeasuresState(payload) {
  return (
    Array.isArray(payload) &&
    payload.length <= MAX_MEASURES &&
    payload.every(
      (measure) =>
        measure !== null &&
        typeof measure === 'object' &&
        !Array.isArray(measure),
    )
  );
}
