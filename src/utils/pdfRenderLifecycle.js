export function getTargetPageNumber(displayPageNumber, totalPages) {
  const requestedPageNumber = Math.max(Number(displayPageNumber) || 1, 1);
  const availablePageCount = Number(totalPages) || 0;

  return availablePageCount > 0
    ? Math.min(requestedPageNumber, availablePageCount)
    : requestedPageNumber;
}

export function getPageLoadIdentity(pdfIdentity, pageNumber) {
  return `${pdfIdentity}|${pageNumber}`;
}

export function getSurfaceIdentity({
  pdfIdentity,
  pageNumber,
  renderResetVersion,
  renderWidth,
  studentPdfSource,
  studentViewMode,
  viewerMode,
}) {
  return [
    pdfIdentity,
    pageNumber,
    viewerMode,
    studentPdfSource,
    studentViewMode,
    renderResetVersion,
    Number(renderWidth).toFixed(3),
  ].join('|');
}

export function isReadySurface(readySurface, surfaceIdentity, pageNumber) {
  return Boolean(
    readySurface?.identity === surfaceIdentity &&
      readySurface.pageNumber === pageNumber &&
      readySurface.width > 0 &&
      readySurface.height > 0,
  );
}
