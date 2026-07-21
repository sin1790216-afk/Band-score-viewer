import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import {
  getLegacyPageBounds,
  getMeasureRenderBasis,
  getPreferredPageCoordinateBasis,
  hasCoordinateMigrationNeed,
} from '../utils/measureCoordinates.js';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const REGISTER_MODE = 'register';
const STUDENT_MODE = 'student';
const PDF_WIDTH_SCALE = 1.5;
const PAGE_FIT_PADDING = 24;
const DEFAULT_PAGE_ASPECT_RATIO = 0.707;

const RESIZE_HANDLES = [
  {
    axis: 'horizontal',
    className: 'resize-handle horizontal',
    label: '가로 크기 조절',
  },
  {
    axis: 'vertical',
    className: 'resize-handle vertical',
    label: '세로 크기 조절',
  },
  {
    axis: 'both',
    className: 'resize-handle corner',
    label: '가로 세로 크기 조절',
  },
];

function getPlainRect(element) {
  if (!element) return null;

  const rect = element.getBoundingClientRect();

  return {
    bottom: rect.bottom,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.width,
    x: rect.x,
    y: rect.y,
  };
}

function getMeasureDebugData(measure) {
  if (!measure) return null;

  return {
    height: measure.height,
    width: measure.width,
    x: measure.x,
    y: measure.y,
  };
}

function getElementDebugName(element) {
  if (!element) return null;

  const className =
    typeof element.className === 'string'
      ? element.className
      : element.className?.baseVal || '';

  return {
    className,
    id: element.id || '',
    tagName: element.tagName,
  };
}

function ScoreViewer({
  canEdit,
  displayMeasureIndex,
  displayPageNumber,
  draggedMeasureIndex,
  measures,
  mode,
  onCoordinateMetricsReady,
  onDebugSnapshot,
  onEndMeasureDrag,
  onEndMeasureResize,
  onMoveMeasure,
  onPageClick,
  onResizeMeasure,
  onSelectMeasure,
  onStartMeasureDrag,
  onStartMeasureResize,
  onTotalPagesChange,
  pdfUrl,
  renderResetVersion,
  resizedMeasureIndex,
  selectedMeasureIndex,
  studentPdfSource,
  studentViewMode,
  totalPages,
  viewerMode,
  isStudentPageView,
}) {
  const pdfViewerRef = useRef(null);
  const pdfPageFrameRef = useRef(null);
  const pdfCanvasStackRef = useRef(null);
  const pdfDocumentRef = useRef(null);
  const pdfPageNumberRef = useRef(1);
  const scrolledPageNumberRef = useRef(1);
  const measuresRef = useRef(measures);
  const coordinateMigrationRequestRef = useRef(0);
  const [pdfWidth, setPdfWidth] = useState(100);
  const [pdfViewerHeight, setPdfViewerHeight] = useState(100);
  const [pageRenderWidth, setPageRenderWidth] = useState(100 * PDF_WIDTH_SCALE);
  const [renderedPageNumber, setRenderedPageNumber] = useState(0);
  const [pageAspectRatio, setPageAspectRatio] = useState(DEFAULT_PAGE_ASPECT_RATIO);
  const [pdfLayoutVersion, setPdfLayoutVersion] = useState(0);
  const [renderSyncVersion, setRenderSyncVersion] = useState(0);

  const zoomPdfPageWidth = pdfWidth * PDF_WIDTH_SCALE;
  const fittedPdfPageWidth = Math.max(
    100,
    Math.min(
      Math.max(100, pdfWidth - PAGE_FIT_PADDING),
      Math.max(100, pdfViewerHeight - PAGE_FIT_PADDING) * pageAspectRatio,
    ),
  );
  const renderedPdfPageWidth = isStudentPageView ? fittedPdfPageWidth : zoomPdfPageWidth;
  const pdfLayoutKey = `${pdfUrl}-${viewerMode}-${studentPdfSource}-${studentViewMode}-${pdfLayoutVersion}`;
  const pdfPageNumber =
    totalPages > 0
      ? Math.min(Math.max(displayPageNumber, 1), totalPages)
      : displayPageNumber;
  const actualPagePropPassedToReactPdf = pdfPageNumber;
  pdfPageNumberRef.current = pdfPageNumber;

  const currentMeasure = measures[displayMeasureIndex] || null;
  const isPdfPageRenderReady = renderedPageNumber === pdfPageNumber;
  const isFitViewHighlightVisible =
    !isStudentPageView ||
    (renderedPageNumber === displayPageNumber && currentMeasure?.page === displayPageNumber);
  const shouldRenderHighlights = isPdfPageRenderReady && isFitViewHighlightVisible;
  const needsCoordinateMigration = useMemo(
    () => canEdit && hasCoordinateMigrationNeed(measures),
    [canEdit, measures],
  );
  const currentPageMeasures = useMemo(
    () =>
      measures
        .map((measure, index) => ({ measure, index }))
        .filter(({ measure }) => measure.page === pdfPageNumber),
    [measures, pdfPageNumber],
  );

  const getCurrentPageRect = useCallback(() => {
    return getPlainRect(pdfCanvasStackRef.current);
  }, []);

  const getPageCoordinateBasis = useCallback(
    (measurePage, pageRect) => {
      const pageMeasures = measures.filter((measure) => measure.page === measurePage);
      const preferredBasis = getPreferredPageCoordinateBasis(pageMeasures);

      if (preferredBasis) return preferredBasis;

      const legacyBounds = getLegacyPageBounds(pageMeasures);

      if (legacyBounds.width > 0 && legacyBounds.height > 0) {
        return {
          ...legacyBounds,
          source: 'legacy-bounds',
        };
      }

      return {
        height: pageRect?.height || 0,
        source: 'new-page-render',
        width: pageRect?.width || 0,
      };
    },
    [measures],
  );

  const getMeasureScale = useCallback(
    (measure, pageRect = getCurrentPageRect()) => {
      if (!measure || !pageRect || pageRect.width <= 0 || pageRect.height <= 0) return null;

      const pageMeasures = measures.filter((pageMeasure) => pageMeasure.page === measure.page);
      const coordinateBasis = getMeasureRenderBasis(measure, pageMeasures);

      if (coordinateBasis.width <= 0 || coordinateBasis.height <= 0) return null;

      return {
        coordinateBasis,
        scaleX: pageRect.width / coordinateBasis.width,
        scaleY: pageRect.height / coordinateBasis.height,
      };
    },
    [getCurrentPageRect, measures],
  );

  const calculateHighlightRect = useCallback(
    (measure) => {
      const pageRect = getCurrentPageRect();

      if (!measure || !pageRect || pageRect.width <= 0) return null;

      const measureScale = getMeasureScale(measure, pageRect);

      if (!measureScale) return null;

      return {
        coordinateBasis: measureScale.coordinateBasis,
        height: measure.height * measureScale.scaleY,
        left: measure.x * measureScale.scaleX,
        scaleFactor: measureScale.scaleX,
        scaleX: measureScale.scaleX,
        scaleY: measureScale.scaleY,
        top: measure.y * measureScale.scaleY,
        width: measure.width * measureScale.scaleX,
      };
    },
    [getCurrentPageRect, getMeasureScale],
  );

  function getPdfOriginDebugData() {
    const pageFrame = pdfPageFrameRef.current;
    const canvasStack = pdfCanvasStackRef.current;
    const canvas = canvasStack?.querySelector('canvas') || null;
    const textLayer = canvasStack?.querySelector('.react-pdf__Page__textContent') || null;
    const overlay = canvasStack?.querySelector('.overlay') || null;
    const highlightParent = overlay || null;

    return {
      canvasElement: getElementDebugName(canvas),
      canvasRect: getPlainRect(canvas),
      canvasStackElement: getElementDebugName(canvasStack),
      canvasStackRect: getPlainRect(canvasStack),
      coordinateBasis: 'pdf-canvas-stack',
      highlightParentElement: getElementDebugName(highlightParent),
      highlightParentMatchesPageFrame: highlightParent === pageFrame,
      highlightParentMatchesCanvasStack: highlightParent === canvasStack,
      highlightParentMatchesOverlay: highlightParent === overlay,
      highlightParentRect: getPlainRect(highlightParent),
      overlayElement: getElementDebugName(overlay),
      overlayRect: getPlainRect(overlay),
      pageFrameElement: getElementDebugName(pageFrame),
      pageFrameRect: getPlainRect(pageFrame),
      textLayerElement: getElementDebugName(textLayer),
      textLayerRect: getPlainRect(textLayer),
    };
  }

  function getDebugSnapshot(label) {
    const currentMeasureScale = getMeasureScale(currentMeasure);

    return {
      label,
      displayMeasureIndex,
      displayPageNumber,
      measure: getMeasureDebugData(currentMeasure),
      measureScaleFactor: currentMeasureScale?.scaleX || null,
      measureScaleX: currentMeasureScale?.scaleX || null,
      measureScaleY: currentMeasureScale?.scaleY || null,
      measureCoordinateBasis: currentMeasureScale?.coordinateBasis || null,
      origin: getPdfOriginDebugData(),
      pageRenderWidth,
      pdfPageDomRect: getCurrentPageRect(),
      pdfPageNumber,
      actualPagePropPassedToReactPdf,
      renderedPageNumber,
      role: canEdit ? 'teacher' : viewerMode,
      scrollLeft: pdfViewerRef.current?.scrollLeft ?? null,
      scrollTop: pdfViewerRef.current?.scrollTop ?? null,
      studentPdfSource,
      studentViewMode,
      highlightVisible: shouldRenderHighlights,
      totalPages,
      viewMode: viewerMode,
    };
  }

  const updatePdfWidth = useCallback(() => {
    if (!pdfViewerRef.current) return;

    setPdfWidth(pdfViewerRef.current.clientWidth);
    setPdfViewerHeight(pdfViewerRef.current.clientHeight);
  }, []);

  const updatePageRenderWidth = useCallback(() => {
    if (!pdfCanvasStackRef.current) return;

    setPageRenderWidth(pdfCanvasStackRef.current.getBoundingClientRect().width);
  }, []);

  const resetPdfRenderState = useCallback(() => {
    const nextPdfWidth = pdfViewerRef.current?.clientWidth || 100;
    const nextPdfViewerHeight = pdfViewerRef.current?.clientHeight || 100;

    pdfViewerRef.current?.scrollTo({ left: 0, top: 0, behavior: 'auto' });
    pdfDocumentRef.current = null;
    scrolledPageNumberRef.current = 0;
    setPdfWidth(nextPdfWidth);
    setPdfViewerHeight(nextPdfViewerHeight);
    setPageRenderWidth(nextPdfWidth * PDF_WIDTH_SCALE);
    setRenderedPageNumber(0);
    setPageAspectRatio(DEFAULT_PAGE_ASPECT_RATIO);
    onTotalPagesChange(0);
    setPdfLayoutVersion((previousVersion) => previousVersion + 1);
    setRenderSyncVersion((previousVersion) => previousVersion + 1);
  }, [onTotalPagesChange]);

  function handlePageRenderSuccess(nextRenderedPageNumber) {
    if (nextRenderedPageNumber !== pdfPageNumberRef.current) return;

    setRenderedPageNumber(nextRenderedPageNumber);
    updatePageRenderWidth();
    setRenderSyncVersion((previousVersion) => previousVersion + 1);
    console.log('PDF rendered');
    console.table(getDebugSnapshot('PDF rendered'));
  }

  function handlePageLoadSuccess(pdfPage) {
    const viewport = pdfPage.getViewport({ scale: 1 });

    if (viewport.height > 0) {
      setPageAspectRatio(viewport.width / viewport.height);
    }
  }

  function handlePageClick(event) {
    const pageRect = getCurrentPageRect();

    if (!pageRect || pageRect.width <= 0 || pageRect.height <= 0) return;

    const coordinateBasis = getPageCoordinateBasis(pdfPageNumber, pageRect);

    onPageClick(event, {
      coordinateBasis,
      pageNumber: pdfPageNumber,
      pageRect,
      scaleX: pageRect.width / coordinateBasis.width,
      scaleY: pageRect.height / coordinateBasis.height,
    });
  }

  function logHighlightCalculation(
    index,
    measure,
    highlightRect,
    highlightStyle,
    highlightParentElement,
  ) {
    const originDebugData = getPdfOriginDebugData();

    console.log('Highlight recalculated');
    console.table({
      ...getDebugSnapshot('Highlight recalculated'),
      canvasRect: originDebugData.canvasRect,
      canvasStackRect: originDebugData.canvasStackRect,
      coordinateBasis: 'pdf-canvas-stack',
      formulaLeft: `${measure.x} * ${highlightRect.scaleX} = ${highlightStyle.left}`,
      formulaTop: `${measure.y} * ${highlightRect.scaleY} = ${highlightStyle.top}`,
      highlightCalculationParent: 'overlay inside pdf-canvas-stack',
      highlightParentElement: getElementDebugName(highlightParentElement),
      highlightParentRect: getPlainRect(highlightParentElement),
      highlightParentMatchesPageFrame: highlightParentElement === pdfPageFrameRef.current,
      highlightParentMatchesCanvasStack: highlightParentElement === pdfCanvasStackRef.current,
      highlightHeight: highlightStyle.height,
      highlightRect,
      isCurrentDisplayedMeasure: index === displayMeasureIndex,
      renderedHighlightIndex: index,
      highlightLeft: highlightStyle.left,
      highlightTop: highlightStyle.top,
      highlightWidth: highlightStyle.width,
      highlightWidthFormula: `${measure.width} * ${highlightRect.scaleX} = ${highlightStyle.width}`,
      highlightHeightFormula: `${measure.height} * ${highlightRect.scaleY} = ${highlightStyle.height}`,
      measureCoordinateBasisHeight: highlightRect.coordinateBasis.height,
      measureCoordinateBasisWidth: highlightRect.coordinateBasis.width,
      measureHeight: measure.height,
      measurePage: measure.page,
      measureWidth: measure.width,
      measureX: measure.x,
      measureY: measure.y,
      overlayRect: originDebugData.overlayRect,
      scaleFactor: highlightRect.scaleX,
      scaleX: highlightRect.scaleX,
      scaleY: highlightRect.scaleY,
    });
    console.log('[coordinate-metrics]', {
      coordinateHeight: highlightRect.coordinateBasis.height,
      coordinateSource: highlightRect.coordinateBasis.source,
      coordinateWidth: highlightRect.coordinateBasis.width,
      highlight: {
        height: highlightStyle.height,
        left: highlightStyle.left,
        top: highlightStyle.top,
        width: highlightStyle.width,
      },
      measure: getMeasureDebugData(measure),
      measureIndex: index,
      page: measure.page,
      pageFrame: {
        height: originDebugData.canvasStackRect?.height,
        width: originDebugData.canvasStackRect?.width,
      },
      role: canEdit ? 'teacher' : viewerMode,
      scaleX: highlightRect.scaleX,
      scaleY: highlightRect.scaleY,
    });
  }

  const latestDebugSnapshot = getDebugSnapshot('latest render');
  onDebugSnapshot(latestDebugSnapshot);
  console.log('[debug] render check', getDebugSnapshot('ScoreViewer render'));

  useEffect(() => {
    window.addEventListener('resize', updatePdfWidth);
    window.addEventListener('resize', updatePageRenderWidth);

    return () => {
      window.removeEventListener('resize', updatePdfWidth);
      window.removeEventListener('resize', updatePageRenderWidth);
    };
  }, [updatePageRenderWidth, updatePdfWidth]);

  useEffect(() => {
    resetPdfRenderState();

    if (!pdfUrl) return;

    const animationFrameId = window.requestAnimationFrame(() => {
      updatePdfWidth();
      updatePageRenderWidth();
      setRenderSyncVersion((previousVersion) => previousVersion + 1);
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [
    pdfUrl,
    renderResetVersion,
    resetPdfRenderState,
    studentPdfSource,
    studentViewMode,
    updatePageRenderWidth,
    updatePdfWidth,
    viewerMode,
  ]);

  useEffect(() => {
    updatePdfWidth();
    updatePageRenderWidth();
  }, [updatePageRenderWidth, updatePdfWidth, viewerMode]);

  useEffect(() => {
    if (!pdfCanvasStackRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      updatePageRenderWidth();
      setRenderSyncVersion((previousVersion) => previousVersion + 1);
    });

    resizeObserver.observe(pdfCanvasStackRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [
    pdfLayoutVersion,
    pdfPageNumber,
    renderedPdfPageWidth,
    studentViewMode,
    updatePageRenderWidth,
    viewerMode,
  ]);

  useEffect(() => {
    measuresRef.current = measures;
  }, [measures]);

  useEffect(() => {
    if (
      !canEdit ||
      !needsCoordinateMigration ||
      !pdfDocumentRef.current ||
      renderedPageNumber !== pdfPageNumber
    ) {
      return;
    }

    const pageRect = getCurrentPageRect();

    if (!pageRect || pageRect.width <= 0 || pageRect.height <= 0) return;

    const pdfDocument = pdfDocumentRef.current;
    const migrationRequestId = coordinateMigrationRequestRef.current + 1;
    const measurePages = [
      ...new Set(
        measures
          .map((measure) => Number(measure.page))
          .filter(
            (page) => Number.isInteger(page) && page >= 1 && page <= pdfDocument.numPages,
          ),
      ),
    ];

    coordinateMigrationRequestRef.current = migrationRequestId;

    Promise.all(
      measurePages.map(async (page) => {
        const pdfPage = await pdfDocument.getPage(page);
        const viewport = pdfPage.getViewport({ scale: 1 });

        return {
          height:
            page === pdfPageNumber
              ? pageRect.height
              : pageRect.width * (viewport.height / viewport.width),
          page,
          width: pageRect.width,
        };
      }),
    )
      .then((pageMetrics) => {
        if (coordinateMigrationRequestRef.current !== migrationRequestId) return;

        console.log('[coordinate-migration] Teacher legacy basis ready', pageMetrics);
        onCoordinateMetricsReady(pageMetrics);
      })
      .catch((error) => {
        console.error('[coordinate-migration] failed to read PDF page metrics', error);
      });
  }, [
    canEdit,
    getCurrentPageRect,
    measures,
    needsCoordinateMigration,
    onCoordinateMetricsReady,
    pdfPageNumber,
    renderedPageNumber,
  ]);

  useEffect(() => {
    if (!shouldRenderHighlights) return;

    const nextCurrentMeasure = measuresRef.current[displayMeasureIndex];

    if (isStudentPageView) {
      pdfViewerRef.current?.scrollTo({ left: 0, top: 0, behavior: 'auto' });
      scrolledPageNumberRef.current = pdfPageNumber;
      return;
    }

    if (!pdfViewerRef.current || !pdfCanvasStackRef.current || !nextCurrentMeasure) return;

    const highlightRect = calculateHighlightRect(nextCurrentMeasure);

    if (!highlightRect) return;

    const didPageChange = scrolledPageNumberRef.current !== pdfPageNumber;
    const viewer = pdfViewerRef.current;
    const canvasStack = pdfCanvasStackRef.current;

    viewer.scrollTo({
      left: canvasStack.offsetLeft + highlightRect.left - viewer.clientWidth / 2,
      top: canvasStack.offsetTop + highlightRect.top - viewer.clientHeight / 2,
      behavior: didPageChange ? 'auto' : 'smooth',
    });
    scrolledPageNumberRef.current = pdfPageNumber;
  }, [
    calculateHighlightRect,
    displayMeasureIndex,
    isStudentPageView,
    pdfPageNumber,
    renderSyncVersion,
    shouldRenderHighlights,
  ]);

  useEffect(() => {
    if (viewerMode !== STUDENT_MODE) return;

    console.log('[student] state', {
      hasPdfUrl: Boolean(pdfUrl),
      measureIndex: displayMeasureIndex,
      pdfPageNumber,
      pdfSource: studentPdfSource,
      renderedPageNumber,
      measuresLength: measures.length,
      displayPageNumber,
      totalPages,
    });
  }, [
    displayMeasureIndex,
    displayPageNumber,
    measures.length,
    pdfPageNumber,
    pdfUrl,
    renderedPageNumber,
    studentPdfSource,
    totalPages,
    viewerMode,
  ]);

  useEffect(() => {
    console.log('[page-sync]', {
      role: canEdit ? 'teacher' : viewerMode,
      viewMode: viewerMode,
      displayPageNumber,
      pdfPageNumber,
      renderedPageNumber,
      totalPages,
      pdfSource: studentPdfSource,
      measureIndex: displayMeasureIndex,
    });
  }, [
    canEdit,
    displayMeasureIndex,
    displayPageNumber,
    pdfPageNumber,
    renderedPageNumber,
    studentPdfSource,
    totalPages,
    viewerMode,
  ]);

  useEffect(() => {
    if (!isStudentPageView) return;

    const originDebugData = getPdfOriginDebugData();

    console.log('[fit-page-sync]', {
      studentViewMode,
      displayPageNumber,
      renderedPageNumber,
      actualPagePropPassedToReactPdf,
      currentMeasurePage: currentMeasure?.page ?? null,
      totalPages,
      canvasRect: originDebugData.canvasRect,
      overlayRect: originDebugData.overlayRect,
      highlightVisible: shouldRenderHighlights,
    });
  }, [
    actualPagePropPassedToReactPdf,
    currentMeasure?.page,
    displayPageNumber,
    isStudentPageView,
    renderedPageNumber,
    renderSyncVersion,
    shouldRenderHighlights,
    studentViewMode,
    totalPages,
  ]);

  return (
    <div className="pdf-viewer" ref={pdfViewerRef}>
      {pdfUrl && (
        <Document
          file={pdfUrl}
          key={pdfLayoutKey}
          onLoadSuccess={(pdf) => {
            pdfDocumentRef.current = pdf;
            onTotalPagesChange(pdf.numPages);
            updatePdfWidth();
            setRenderSyncVersion((previousVersion) => previousVersion + 1);
          }}
          onLoadError={(error) => console.error(error)}
        >
          <div
            className={`pdf-page-frame ${isStudentPageView ? 'fit-page-wrapper' : ''}`}
            key={pdfLayoutKey}
            ref={pdfPageFrameRef}
          >
            <div className="pdf-canvas-stack" ref={pdfCanvasStackRef}>
              <Page
                key={
                  isStudentPageView
                    ? `fit-${pdfUrl}-${studentPdfSource}-${displayPageNumber}`
                    : `${pdfLayoutKey}-${pdfPageNumber}`
                }
                pageNumber={actualPagePropPassedToReactPdf}
                width={renderedPdfPageWidth}
                onClick={handlePageClick}
                onLoadSuccess={handlePageLoadSuccess}
                onRenderSuccess={() =>
                  handlePageRenderSuccess(actualPagePropPassedToReactPdf)
                }
              />

              <MeasureOverlay
                calculateHighlightRect={calculateHighlightRect}
                currentMeasure={shouldRenderHighlights ? currentMeasure : null}
                currentMeasureIndex={displayMeasureIndex}
                currentPageMeasures={shouldRenderHighlights ? currentPageMeasures : []}
                draggedMeasureIndex={draggedMeasureIndex}
                mode={mode}
                onEndMeasureDrag={onEndMeasureDrag}
                onHighlightRecalculated={logHighlightCalculation}
                onMoveMeasure={onMoveMeasure}
                onResizeMeasure={onResizeMeasure}
                onSelectMeasure={onSelectMeasure}
                onStartMeasureResize={onStartMeasureResize}
                onStartMeasureDrag={onStartMeasureDrag}
                onEndMeasureResize={onEndMeasureResize}
                resizedMeasureIndex={resizedMeasureIndex}
                selectedMeasureIndex={canEdit ? selectedMeasureIndex : -1}
              />
            </div>
          </div>
        </Document>
      )}
      {!pdfUrl && !canEdit && (
        <div className="student-waiting-message">Teacher가 PDF를 열기를 기다리는 중</div>
      )}
    </div>
  );
}

function MeasureOverlay({
  calculateHighlightRect,
  currentMeasure,
  currentMeasureIndex,
  currentPageMeasures,
  draggedMeasureIndex,
  mode,
  onEndMeasureDrag,
  onEndMeasureResize,
  onHighlightRecalculated,
  onMoveMeasure,
  onResizeMeasure,
  onSelectMeasure,
  onStartMeasureDrag,
  onStartMeasureResize,
  resizedMeasureIndex,
  selectedMeasureIndex,
}) {
  const overlayRef = useRef(null);
  const visibleMeasures =
    mode === REGISTER_MODE
      ? currentPageMeasures
      : currentMeasure
        ? [{ measure: currentMeasure, index: currentMeasureIndex }]
        : [];

  return (
    <div className="overlay" ref={overlayRef}>
      {visibleMeasures.map(({ measure, index }) => {
        const highlightRect = calculateHighlightRect(measure);

        if (!highlightRect) return null;

        const highlightStyle = {
          height: highlightRect.height,
          left: highlightRect.left,
          top: highlightRect.top,
          width: highlightRect.width,
        };

        onHighlightRecalculated?.(
          index,
          measure,
          highlightRect,
          highlightStyle,
          overlayRef.current,
        );

        return (
          <button
            type="button"
            className={`highlight ${index === selectedMeasureIndex ? 'selected' : ''} ${
              index === draggedMeasureIndex ? 'dragging' : ''
            } ${index === resizedMeasureIndex ? 'resizing' : ''}`}
            key={index}
            onClick={(event) => {
              event.stopPropagation();
              if (mode === REGISTER_MODE) {
                onSelectMeasure(index);
              }
            }}
            onPointerDown={(event) => onStartMeasureDrag(index, event, highlightRect)}
            onPointerMove={onMoveMeasure}
            onPointerUp={onEndMeasureDrag}
            onPointerCancel={onEndMeasureDrag}
            style={highlightStyle}
            aria-label={`measure ${index + 1}`}
          >
            {mode === REGISTER_MODE && (
              <>
                {RESIZE_HANDLES.map((handle) => (
                  <span
                    aria-label={handle.label}
                    className={handle.className}
                    key={handle.axis}
                    onPointerDown={(event) =>
                      onStartMeasureResize(index, handle.axis, event, highlightRect)
                    }
                    onPointerMove={onResizeMeasure}
                    onPointerUp={onEndMeasureResize}
                    onPointerCancel={onEndMeasureResize}
                    role="button"
                    tabIndex={-1}
                  />
                ))}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default ScoreViewer;
