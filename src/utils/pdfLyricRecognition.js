import { pdfjs } from 'react-pdf';

import {
  DEFAULT_MAX_RENDER_SCALE,
  DEFAULT_TARGET_RENDER_WIDTH,
  detectScoreLayout,
} from './measureRecognition.js';
import {
  analyzeLyricCandidates,
  normalizePdfTextItems,
} from './lyricRecognition.js';

pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

export async function recognizeLyricsInPdf(
  pdfBlob,
  measures,
  { onPageDiagnostics, onProgress } = {},
) {
  if (!(pdfBlob instanceof Blob)) {
    throw new Error('가사를 인식할 PDF가 없습니다.');
  }

  // MeasureRegion과 lyric staff bounds가 같은 PDF raster geometry를 사용한다.
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await pdfBlob.arrayBuffer()),
    disableFontFace: true,
  });

  try {
    const pdf = await loadingTask.promise;
    const candidates = [];
    const diagnostics = [];
    let extractedTextItemCount = 0;
    const stats = {
      detectedLaneCount: 0,
      oneLineMeasureCount: 0,
      purityRejectCount: 0,
      rejectedChordCount: 0,
      rejectedMetadataCount: 0,
      rejectedMusicGlyphCount: 0,
      twoLineMeasureCount: 0,
    };

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

      if (!context) throw new Error('PDF 가사 분석용 canvas를 만들 수 없습니다.');

      canvas.width = Math.ceil(renderViewport.width);
      canvas.height = Math.ceil(renderViewport.height);
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: context, viewport: renderViewport }).promise;

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
      const pageMeasures = measures
        .map((measure, measureIndex) => ({ ...measure, measureIndex }))
        .filter((measure) => measure.page === pageNumber);

      extractedTextItemCount += normalizedTextItems.length;
      const pageResult = analyzeLyricCandidates({
        measures: pageMeasures,
        systems: layout.systems,
        textItems: normalizedTextItems,
      });
      const pageDiagnostics = {
        page: pageNumber,
        rejectedSamples: pageResult.rejectedSamples,
        stats: pageResult.stats,
        systems: pageResult.diagnostics,
      };

      candidates.push(...pageResult.candidates);
      diagnostics.push(pageDiagnostics);
      stats.detectedLaneCount = Math.max(
        stats.detectedLaneCount,
        pageResult.stats.detectedLaneCount,
      );
      Object.keys(stats).forEach((key) => {
        if (key !== 'detectedLaneCount') stats[key] += pageResult.stats[key];
      });
      onPageDiagnostics?.(pageDiagnostics);

      page.cleanup();
      canvas.width = 0;
      canvas.height = 0;
    }

    return { candidates, diagnostics, extractedTextItemCount, stats };
  } finally {
    await loadingTask.destroy();
  }
}
