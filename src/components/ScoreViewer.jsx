import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import {
  canonicalToRenderRect,
  NORMALIZED_COORDINATE_BASIS,
  renderPointToCanonical,
} from '../utils/measureCoordinates.js';
import {
  getPageLoadIdentity,
  getSurfaceIdentity,
  getTargetPageNumber,
  isReadySurface as isReadyPdfSurface,
} from '../utils/pdfRenderLifecycle.js';

pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

const REGISTER_MODE = 'register';
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
    coordinateSpace: measure.coordinateSpace,
    coordinateStatus: measure.coordinateStatus,
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

function areSizesEqual(left, right) {
  return left?.width === right?.width && left?.height === right?.height;
}

function ScoreViewer({
  canEdit,
  displayMeasureIndex,
  displayPageNumber,
  draggedMeasureIndex,
  isStudentPageView,
  measures,
  mode,
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
  viewerMode,
}) {
  const pdfViewerRef = useRef(null);
  const pdfPageFrameRef = useRef(null);
  const pdfCanvasStackRef = useRef(null);
  const documentIdentityRef = useRef(pdfUrl);
  const pageLoadIdentityRef = useRef('');
  const surfaceIdentityRef = useRef('');
  const scrolledPageNumberRef = useRef(0);
  const measuresRef = useRef(measures);
  const [viewerSize, setViewerSize] = useState({ height: 100, width: 100 });
  const [documentState, setDocumentState] = useState({
    identity: '',
    totalPages: 0,
  });
  const [pageGeometry, setPageGeometry] = useState({
    aspectRatio: DEFAULT_PAGE_ASPECT_RATIO,
    identity: '',
  });
  const [readySurface, setReadySurface] = useState(null);

  documentIdentityRef.current = pdfUrl;

  const documentReady = Boolean(
    pdfUrl && documentState.identity === pdfUrl && documentState.totalPages > 0,
  );
  const pdfPageNumber = getTargetPageNumber(
    displayPageNumber,
    documentReady ? documentState.totalPages : 0,
  );
  const pageLoadIdentity = getPageLoadIdentity(pdfUrl, pdfPageNumber);
  const pageAspectRatio =
    pageGeometry.identity === pageLoadIdentity
      ? pageGeometry.aspectRatio
      : DEFAULT_PAGE_ASPECT_RATIO;
  const zoomPdfPageWidth = viewerSize.width * PDF_WIDTH_SCALE;
  const fittedPdfPageWidth = Math.max(
    100,
    Math.min(
      Math.max(100, viewerSize.width - PAGE_FIT_PADDING),
      Math.max(100, viewerSize.height - PAGE_FIT_PADDING) * pageAspectRatio,
    ),
  );
  const renderedPdfPageWidth = isStudentPageView ? fittedPdfPageWidth : zoomPdfPageWidth;
  const surfaceIdentity = getSurfaceIdentity({
    pageNumber: pdfPageNumber,
    pdfIdentity: pdfUrl,
    renderResetVersion,
    renderWidth: renderedPdfPageWidth,
    studentPdfSource,
    studentViewMode,
    viewerMode,
  });

  pageLoadIdentityRef.current = pageLoadIdentity;
  surfaceIdentityRef.current = surfaceIdentity;

  const isSurfaceReady = isReadyPdfSurface(
    readySurface,
    surfaceIdentity,
    pdfPageNumber,
  );
  const renderedPageNumber = isSurfaceReady ? readySurface.pageNumber : 0;
  const currentMeasure = measures[displayMeasureIndex] || null;
  const currentMeasureMatchesPage =
    currentMeasure && Number(currentMeasure.page) === pdfPageNumber;
  const shouldRenderHighlights =
    isSurfaceReady && (mode === REGISTER_MODE || currentMeasureMatchesPage);
  const currentPageMeasures = useMemo(
    () =>
      measures
        .map((measure, index) => ({ measure, index }))
        .filter(({ measure }) => Number(measure.page) === pdfPageNumber),
    [measures, pdfPageNumber],
  );

  const measureViewer = useCallback(() => {
    const viewer = pdfViewerRef.current;

    if (!viewer) return;

    const nextSize = {
      height: viewer.clientHeight || 100,
      width: viewer.clientWidth || 100,
    };

    setViewerSize((previousSize) =>
      areSizesEqual(previousSize, nextSize) ? previousSize : nextSize,
    );
  }, []);

  const getCurrentSurfaceRect = useCallback(() => {
    if (
      readySurface?.identity !== surfaceIdentity ||
      readySurface?.pageNumber !== pdfPageNumber
    ) {
      return null;
    }

    const pageRect = getPlainRect(pdfCanvasStackRef.current);

    if (!pageRect || pageRect.width <= 0 || pageRect.height <= 0) return null;

    return pageRect;
  }, [pdfPageNumber, readySurface, surfaceIdentity]);

  const calculateHighlightRect = useCallback(
    (measure) => canonicalToRenderRect(measure, getCurrentSurfaceRect()),
    [getCurrentSurfaceRect],
  );

  function getPdfOriginDebugData() {
    const pageFrame = pdfPageFrameRef.current;
    const canvasStack = pdfCanvasStackRef.current;
    const canvas = canvasStack?.querySelector('canvas') || null;
    const textLayer = canvasStack?.querySelector('.react-pdf__Page__textContent') || null;
    const overlay = canvasStack?.querySelector('.overlay') || null;

    return {
      canvasElement: getElementDebugName(canvas),
      canvasRect: getPlainRect(canvas),
      canvasStackElement: getElementDebugName(canvasStack),
      canvasStackRect: getPlainRect(canvasStack),
      highlightParentElement: getElementDebugName(overlay),
      overlayElement: getElementDebugName(overlay),
      overlayRect: getPlainRect(overlay),
      pageFrameElement: getElementDebugName(pageFrame),
      pageFrameRect: getPlainRect(pageFrame),
      textLayerElement: getElementDebugName(textLayer),
      textLayerRect: getPlainRect(textLayer),
    };
  }

  const getDebugSnapshot = useCallback(
    (label) => {
      const currentMeasureRect = calculateHighlightRect(currentMeasure);

      return {
        label,
        currentMeasure: getMeasureDebugData(currentMeasure),
        currentMeasureRect,
        displayMeasureIndex,
        displayPageNumber,
        documentIdentity: documentState.identity,
        documentReady,
        highlightVisible: shouldRenderHighlights,
        origin: getPdfOriginDebugData(),
        pdfPageNumber,
        readySurface,
        renderedPageNumber,
        requestedSurfaceIdentity: surfaceIdentity,
        role: canEdit ? 'teacher' : viewerMode,
        scrollLeft: pdfViewerRef.current?.scrollLeft ?? null,
        scrollTop: pdfViewerRef.current?.scrollTop ?? null,
        studentPdfSource,
        studentViewMode,
        totalPages: documentState.totalPages,
        viewMode: viewerMode,
      };
    },
    [
      calculateHighlightRect,
      canEdit,
      currentMeasure,
      displayMeasureIndex,
      displayPageNumber,
      documentReady,
      documentState.identity,
      documentState.totalPages,
      pdfPageNumber,
      readySurface,
      renderedPageNumber,
      shouldRenderHighlights,
      studentPdfSource,
      studentViewMode,
      surfaceIdentity,
      viewerMode,
    ],
  );

  function handleDocumentLoadSuccess(pdf, loadedDocumentIdentity) {
    if (loadedDocumentIdentity !== documentIdentityRef.current) return;

    setDocumentState({
      identity: loadedDocumentIdentity,
      totalPages: pdf.numPages,
    });
    onTotalPagesChange(pdf.numPages);
    measureViewer();
  }

  function handlePageLoadSuccess(pdfPage, loadedPageIdentity) {
    if (loadedPageIdentity !== pageLoadIdentityRef.current) return;

    const viewport = pdfPage.getViewport({ scale: 1 });

    if (viewport.width <= 0 || viewport.height <= 0) return;

    setPageGeometry({
      aspectRatio: viewport.width / viewport.height,
      identity: loadedPageIdentity,
    });
  }

  function handlePageRenderSuccess(renderedSurfaceIdentity, nextRenderedPageNumber) {
    if (
      renderedSurfaceIdentity !== surfaceIdentityRef.current ||
      nextRenderedPageNumber !== pdfPageNumber
    ) {
      return;
    }

    const pageRect = getPlainRect(pdfCanvasStackRef.current);
    const canvasRect = getPlainRect(
      pdfCanvasStackRef.current?.querySelector('canvas') || null,
    );

    if (
      !pageRect ||
      !canvasRect ||
      pageRect.width <= 0 ||
      pageRect.height <= 0 ||
      canvasRect.width <= 0 ||
      canvasRect.height <= 0
    ) {
      return;
    }

    setReadySurface({
      height: pageRect.height,
      identity: renderedSurfaceIdentity,
      pageNumber: nextRenderedPageNumber,
      width: pageRect.width,
    });
    console.log('[pdf-lifecycle] surface ready', {
      canvas: { height: canvasRect.height, width: canvasRect.width },
      pageNumber: nextRenderedPageNumber,
      surface: { height: pageRect.height, width: pageRect.width },
      surfaceIdentity: renderedSurfaceIdentity,
    });
  }

  function handlePageClick(event) {
    const pageRect = getCurrentSurfaceRect();

    if (!pageRect) return;

    const point = renderPointToCanonical(event.clientX, event.clientY, pageRect);

    if (!point) return;

    onPageClick({
      coordinateBasis: NORMALIZED_COORDINATE_BASIS,
      pageNumber: pdfPageNumber,
      point,
      scaleX: pageRect.width,
      scaleY: pageRect.height,
    });
  }

  useEffect(() => {
    measureViewer();
    window.addEventListener('resize', measureViewer);

    const viewer = pdfViewerRef.current;
    const resizeObserver =
      viewer && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(measureViewer)
        : null;

    resizeObserver?.observe(viewer);

    return () => {
      window.removeEventListener('resize', measureViewer);
      resizeObserver?.disconnect();
    };
  }, [measureViewer]);

  useEffect(() => {
    setDocumentState({ identity: '', totalPages: 0 });
    setPageGeometry({
      aspectRatio: DEFAULT_PAGE_ASPECT_RATIO,
      identity: '',
    });
    setReadySurface(null);
    onTotalPagesChange(0);
    scrolledPageNumberRef.current = 0;
    pdfViewerRef.current?.scrollTo({ left: 0, top: 0, behavior: 'auto' });
    measureViewer();
  }, [measureViewer, onTotalPagesChange, pdfUrl]);

  useEffect(() => {
    setReadySurface(null);
    scrolledPageNumberRef.current = 0;
    measureViewer();
  }, [
    measureViewer,
    renderResetVersion,
    studentPdfSource,
    studentViewMode,
    viewerMode,
  ]);

  useEffect(() => {
    const canvasStack = pdfCanvasStackRef.current;

    if (!canvasStack || typeof ResizeObserver === 'undefined') return;

    const resizeObserver = new ResizeObserver(() => {
      const pageRect = getPlainRect(canvasStack);

      if (!pageRect || pageRect.width <= 0 || pageRect.height <= 0) return;

      setReadySurface((previousSurface) => {
        if (previousSurface?.identity !== surfaceIdentityRef.current) {
          return previousSurface;
        }

        const nextSurface = {
          ...previousSurface,
          height: pageRect.height,
          width: pageRect.width,
        };

        return areSizesEqual(previousSurface, nextSurface)
          ? previousSurface
          : nextSurface;
      });
    });

    resizeObserver.observe(canvasStack);

    return () => {
      resizeObserver.disconnect();
    };
  }, [documentReady, pdfPageNumber, surfaceIdentity]);

  useEffect(() => {
    measuresRef.current = measures;
  }, [measures]);

  useEffect(() => {
    if (!shouldRenderHighlights) return;

    const nextCurrentMeasure = measuresRef.current[displayMeasureIndex];

    if (isStudentPageView) {
      pdfViewerRef.current?.scrollTo({ left: 0, top: 0, behavior: 'auto' });
      scrolledPageNumberRef.current = pdfPageNumber;
      return;
    }

    if (
      !pdfViewerRef.current ||
      !pdfCanvasStackRef.current ||
      !nextCurrentMeasure ||
      Number(nextCurrentMeasure.page) !== pdfPageNumber
    ) {
      return;
    }

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
    currentMeasureMatchesPage,
    displayMeasureIndex,
    isStudentPageView,
    pdfPageNumber,
    readySurface?.height,
    readySurface?.identity,
    readySurface?.width,
    shouldRenderHighlights,
  ]);

  useEffect(() => {
    onDebugSnapshot(getDebugSnapshot('PDF lifecycle changed'));
  }, [getDebugSnapshot, onDebugSnapshot]);

  useEffect(() => {
    console.log('[page-sync]', {
      displayPageNumber,
      documentReady,
      measureIndex: displayMeasureIndex,
      pdfPageNumber,
      pdfSource: studentPdfSource,
      renderedPageNumber,
      role: canEdit ? 'teacher' : viewerMode,
      surfaceReady: isSurfaceReady,
      totalPages: documentState.totalPages,
      viewMode: viewerMode,
    });
  }, [
    canEdit,
    displayMeasureIndex,
    displayPageNumber,
    documentReady,
    documentState.totalPages,
    isSurfaceReady,
    pdfPageNumber,
    renderedPageNumber,
    studentPdfSource,
    viewerMode,
  ]);

  const pageKey = [
    pdfUrl,
    pdfPageNumber,
    viewerMode,
    studentPdfSource,
    studentViewMode,
    renderResetVersion,
  ].join('|');

  return (
    <div className="pdf-viewer" ref={pdfViewerRef}>
      {pdfUrl && (
        <Document
          file={pdfUrl}
          key={pdfUrl}
          onLoadSuccess={(pdf) => handleDocumentLoadSuccess(pdf, pdfUrl)}
          onLoadError={(error) => console.error(error)}
        >
          {documentReady && (
            <div
              className={`pdf-page-frame ${isStudentPageView ? 'fit-page-wrapper' : ''}`}
              ref={pdfPageFrameRef}
            >
              <div className="pdf-canvas-stack" ref={pdfCanvasStackRef}>
                <Page
                  key={pageKey}
                  pageNumber={pdfPageNumber}
                  width={renderedPdfPageWidth}
                  onClick={handlePageClick}
                  onLoadSuccess={(pdfPage) =>
                    handlePageLoadSuccess(pdfPage, pageLoadIdentity)
                  }
                  onRenderSuccess={() =>
                    handlePageRenderSuccess(surfaceIdentity, pdfPageNumber)
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
                  onEndMeasureResize={onEndMeasureResize}
                  onMoveMeasure={onMoveMeasure}
                  onResizeMeasure={onResizeMeasure}
                  onSelectMeasure={onSelectMeasure}
                  onStartMeasureDrag={onStartMeasureDrag}
                  onStartMeasureResize={onStartMeasureResize}
                  resizedMeasureIndex={resizedMeasureIndex}
                  selectedMeasureIndex={canEdit ? selectedMeasureIndex : -1}
                />
              </div>
            </div>
          )}
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
  onMoveMeasure,
  onResizeMeasure,
  onSelectMeasure,
  onStartMeasureDrag,
  onStartMeasureResize,
  resizedMeasureIndex,
  selectedMeasureIndex,
}) {
  const visibleMeasures =
    mode === REGISTER_MODE
      ? currentPageMeasures
      : currentMeasure
        ? [{ measure: currentMeasure, index: currentMeasureIndex }]
        : [];

  return (
    <div className="overlay">
      {visibleMeasures.map(({ measure, index }) => {
        const highlightRect = calculateHighlightRect(measure);

        if (!highlightRect) return null;

        const highlightStyle = {
          height: highlightRect.height,
          left: highlightRect.left,
          top: highlightRect.top,
          width: highlightRect.width,
        };

        return (
          <button
            type="button"
            className={`highlight ${index === selectedMeasureIndex ? 'selected' : ''} ${
              index === draggedMeasureIndex ? 'dragging' : ''
            } ${index === resizedMeasureIndex ? 'resizing' : ''}`}
            key={measure.id}
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
