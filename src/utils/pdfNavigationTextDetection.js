import { pdfjs } from 'react-pdf';

import {
  DEFAULT_MAX_RENDER_SCALE,
  DEFAULT_TARGET_RENDER_WIDTH,
  detectScoreLayout,
} from './measureRecognition.js';
import { normalizePdfTextItems } from './lyricRecognition.js';
import { detectNavigationTextCandidates } from './navigationTextDetection.js';

pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

export async function detectNavigationTextInPdf(
  pdfBlob,
  measures,
  { onPageDiagnostics, onProgress } = {},
) {
  if (!(pdfBlob instanceof Blob)) {
    throw new Error('Navigation을 분석할 PDF가 없습니다.');
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await pdfBlob.arrayBuffer()),
    disableFontFace: true,
  });

  try {
    const pdf = await loadingTask.promise;
    const candidates = [];
    const diagnostics = [];
    let extractedTextItemCount = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onProgress?.({ currentPage: pageNumber, totalPages: pdf.numPages });

      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const renderScale = Math.max(
        1,
        Math.min(
          DEFAULT_MAX_RENDER_SCALE,
          DEFAULT_TARGET_RENDER_WIDTH / baseViewport.width,
        ),
      );
      const renderViewport = page.getViewport({ scale: renderScale });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });

      if (!context) {
        throw new Error('PDF Navigation 분석용 canvas를 만들 수 없습니다.');
      }

      try {
        canvas.width = Math.ceil(renderViewport.width);
        canvas.height = Math.ceil(renderViewport.height);
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: context, viewport: renderViewport })
          .promise;

        const layout = detectScoreLayout(
          context.getImageData(0, 0, canvas.width, canvas.height),
        );
        const textContent = await page.getTextContent();
        const normalizedTextItems = normalizePdfTextItems(
          textContent.items,
          baseViewport,
          textContent.styles,
          pageNumber,
        );
        const pageResult = detectNavigationTextCandidates({
          measures,
          pageNumber,
          systems: layout.systems,
          textItems: normalizedTextItems,
        });
        const pageDiagnostics = {
          ...pageResult.diagnostics,
          raster: {
            height: canvas.height,
            renderScale,
            width: canvas.width,
          },
        };

        extractedTextItemCount += normalizedTextItems.length;
        candidates.push(...pageResult.candidates);
        diagnostics.push(pageDiagnostics);
        onPageDiagnostics?.(pageDiagnostics);
      } finally {
        page.cleanup();
        canvas.width = 0;
        canvas.height = 0;
      }
    }

    return { candidates, diagnostics, extractedTextItemCount };
  } finally {
    await loadingTask.destroy();
  }
}
