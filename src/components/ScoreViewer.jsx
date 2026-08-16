import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import {
  canonicalToRenderRect,
  NORMALIZED_COORDINATE_BASIS,
  renderPointToCanonical,
} from '../utils/measureCoordinates.js';
import { MEASURE_RESIZE_DIRECTIONS } from '../utils/measureResize.js';
import {
  getNavigationMarkerLabel,
  normalizeNavigationMarkers,
} from '../utils/navigationMarkers.js';
import { getNavigationEndingBadges } from '../utils/navigationModel.js';
import {
  getPageLoadIdentity,
  getSurfaceIdentity,
  getTargetPageNumber,
  isReadySurface as isReadyPdfSurface,
} from '../utils/pdfRenderLifecycle.js';
import {
  createStudentAnnotationId,
  MAX_ANNOTATION_POINTS,
} from '../utils/studentAnnotations.js';

pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

const REGISTER_MODE = 'register';
const PDF_WIDTH_SCALE = 1.5;
const PAGE_FIT_PADDING = 24;
const DEFAULT_PAGE_ASPECT_RATIO = 0.707;
const PDF_PAGE_VIEW = 'page';
const PDF_WIDTH_VIEW = 'width';

const RESIZE_HANDLES = [
  {
    className: 'resize-handle top-left',
    direction: MEASURE_RESIZE_DIRECTIONS.TOP_LEFT,
    label: '왼쪽 위 크기 조절',
  },
  {
    className: 'resize-handle top',
    direction: MEASURE_RESIZE_DIRECTIONS.TOP,
    label: '위쪽 크기 조절',
  },
  {
    className: 'resize-handle top-right',
    direction: MEASURE_RESIZE_DIRECTIONS.TOP_RIGHT,
    label: '오른쪽 위 크기 조절',
  },
  {
    className: 'resize-handle left',
    direction: MEASURE_RESIZE_DIRECTIONS.LEFT,
    label: '왼쪽 크기 조절',
  },
  {
    className: 'resize-handle right',
    direction: MEASURE_RESIZE_DIRECTIONS.RIGHT,
    label: '오른쪽 크기 조절',
  },
  {
    className: 'resize-handle bottom-left',
    direction: MEASURE_RESIZE_DIRECTIONS.BOTTOM_LEFT,
    label: '왼쪽 아래 크기 조절',
  },
  {
    className: 'resize-handle bottom',
    direction: MEASURE_RESIZE_DIRECTIONS.BOTTOM,
    label: '아래쪽 크기 조절',
  },
  {
    className: 'resize-handle bottom-right',
    direction: MEASURE_RESIZE_DIRECTIONS.BOTTOM_RIGHT,
    label: '오른쪽 아래 크기 조절',
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
  audioMappedMeasureIds = [],
  audioTargetMeasureIndex = -1,
  annotationColor = '#d62828',
  annotationEnabled,
  annotationStrokes = [],
  canEdit,
  displayMeasureIndex,
  displayPageNumber,
  draggedMeasureIndex,
  measures,
  mode,
  onAddAnnotationStroke,
  onActivateMeasure,
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
  pdfViewMode,
  renderResetVersion,
  resizedMeasureIndex,
  selectedMeasureIndex,
  showNavigationMarkers = false,
  showAudioMeasureTargets = false,
  studentPdfSource,
  viewerMode,
}) {
  const pdfViewerRef = useRef(null);
  const pdfPageFrameRef = useRef(null);
  const pdfCanvasStackRef = useRef(null);
  const annotationPointerRef = useRef(null);
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
  const navigationEndingBadgesByMeasureId = useMemo(
    () => (showNavigationMarkers ? getNavigationEndingBadges(measures) : new Map()),
    [measures, showNavigationMarkers],
  );
  const [readySurface, setReadySurface] = useState(null);
  const [draftAnnotationStroke, setDraftAnnotationStroke] = useState(null);

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
  const widthFitPdfPageWidth = Math.max(100, viewerSize.width - PAGE_FIT_PADDING);
  const isPageFitView = pdfViewMode === PDF_PAGE_VIEW;
  const renderedPdfPageWidth = isPageFitView
    ? fittedPdfPageWidth
    : pdfViewMode === PDF_WIDTH_VIEW
      ? widthFitPdfPageWidth
      : zoomPdfPageWidth;
  const surfaceIdentity = getSurfaceIdentity({
    pageNumber: pdfPageNumber,
    pdfIdentity: pdfUrl,
    renderResetVersion,
    renderWidth: renderedPdfPageWidth,
    studentPdfSource,
    studentViewMode: pdfViewMode,
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
  const currentPageAnnotationStrokes = useMemo(
    () =>
      annotationStrokes.filter(
        (stroke) => Number(stroke.page) === pdfPageNumber,
      ),
    [annotationStrokes, pdfPageNumber],
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
        studentViewMode: pdfViewMode,
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
      pdfViewMode,
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

  function getAnnotationPoint(event) {
    const pageRect = getCurrentSurfaceRect();

    if (!pageRect) return null;

    const point = renderPointToCanonical(
      event.clientX,
      event.clientY,
      pageRect,
    );

    if (!point) return null;

    return {
      x: Math.min(Math.max(point.x, 0), 1),
      y: Math.min(Math.max(point.y, 0), 1),
    };
  }

  function startAnnotationStroke(event) {
    if (!annotationEnabled || !isSurfaceReady || event.button !== 0) return;

    const point = getAnnotationPoint(event);

    if (!point) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const stroke = {
      color: annotationColor,
      id: createStudentAnnotationId(),
      page: pdfPageNumber,
      points: [point],
      width: 3,
    };

    annotationPointerRef.current = {
      pointerId: event.pointerId,
      stroke,
    };
    setDraftAnnotationStroke(stroke);
  }

  function moveAnnotationStroke(event) {
    const activePointer = annotationPointerRef.current;

    if (!activePointer || activePointer.pointerId !== event.pointerId) return;

    const point = getAnnotationPoint(event);

    if (!point) return;

    event.preventDefault();
    event.stopPropagation();

    const previousPoints = activePointer.stroke.points;
    const previousPoint = previousPoints[previousPoints.length - 1];
    const pointDistance = Math.hypot(
      point.x - previousPoint.x,
      point.y - previousPoint.y,
    );

    if (
      pointDistance < 0.0005 ||
      previousPoints.length >= MAX_ANNOTATION_POINTS
    ) {
      return;
    }

    const stroke = {
      ...activePointer.stroke,
      points: [...previousPoints, point],
    };

    annotationPointerRef.current = {
      ...activePointer,
      stroke,
    };
    setDraftAnnotationStroke(stroke);
  }

  function finishAnnotationStroke(event, shouldCommit) {
    const activePointer = annotationPointerRef.current;

    if (!activePointer || activePointer.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    annotationPointerRef.current = null;
    setDraftAnnotationStroke(null);

    if (shouldCommit) {
      onAddAnnotationStroke(activePointer.stroke);
    }
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
    pdfViewMode,
    viewerMode,
  ]);

  useEffect(() => {
    annotationPointerRef.current = null;
    setDraftAnnotationStroke(null);
  }, [annotationEnabled, surfaceIdentity]);

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
    if (annotationEnabled) return;
    if (!shouldRenderHighlights) return;

    const nextCurrentMeasure = measuresRef.current[displayMeasureIndex];

    if (isPageFitView) {
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
    annotationEnabled,
    calculateHighlightRect,
    currentMeasureMatchesPage,
    displayMeasureIndex,
    isPageFitView,
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
    pdfViewMode,
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
              className={`pdf-page-frame ${isPageFitView ? 'fit-page-wrapper' : ''}`}
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
                  audioMappedMeasureIds={audioMappedMeasureIds}
                  audioTargetMeasureIndex={audioTargetMeasureIndex}
                  calculateHighlightRect={calculateHighlightRect}
                  currentMeasure={shouldRenderHighlights ? currentMeasure : null}
                  currentMeasureIndex={displayMeasureIndex}
                  currentPageMeasures={shouldRenderHighlights ? currentPageMeasures : []}
                  draggedMeasureIndex={draggedMeasureIndex}
                  mode={mode}
                  navigationEndingBadgesByMeasureId={
                    navigationEndingBadgesByMeasureId
                  }
                  onActivateMeasure={onActivateMeasure}
                  onEndMeasureDrag={onEndMeasureDrag}
                  onEndMeasureResize={onEndMeasureResize}
                  onMoveMeasure={onMoveMeasure}
                  onResizeMeasure={onResizeMeasure}
                  onSelectMeasure={onSelectMeasure}
                  onStartMeasureDrag={onStartMeasureDrag}
                  onStartMeasureResize={onStartMeasureResize}
                  resizedMeasureIndex={resizedMeasureIndex}
                  selectedMeasureIndex={canEdit ? selectedMeasureIndex : -1}
                  showNavigationMarkers={showNavigationMarkers}
                  showAudioMeasureTargets={showAudioMeasureTargets}
                />

                {viewerMode === 'student' && isSurfaceReady && (
                  <StudentAnnotationOverlay
                    draftStroke={draftAnnotationStroke}
                    enabled={annotationEnabled}
                    onPointerCancel={(event) =>
                      finishAnnotationStroke(event, false)
                    }
                    onPointerDown={startAnnotationStroke}
                    onPointerMove={moveAnnotationStroke}
                    onPointerUp={(event) => finishAnnotationStroke(event, true)}
                    strokes={currentPageAnnotationStrokes}
                    surfaceSize={readySurface}
                  />
                )}
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

function StudentAnnotationOverlay({
  draftStroke,
  enabled,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  strokes,
  surfaceSize,
}) {
  const visibleStrokes = draftStroke ? [...strokes, draftStroke] : strokes;

  return (
    <div
      className={`student-annotation-overlay ${enabled ? 'drawing-enabled' : ''}`}
      onPointerCancel={onPointerCancel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <svg
        aria-hidden="true"
        className="student-annotation-svg"
        preserveAspectRatio="none"
        viewBox={`0 0 ${surfaceSize.width} ${surfaceSize.height}`}
      >
        {visibleStrokes.map((stroke) => (
          <StudentAnnotationStroke
            key={stroke.id}
            stroke={stroke}
            surfaceSize={surfaceSize}
          />
        ))}
      </svg>
    </div>
  );
}

function StudentAnnotationStroke({ stroke, surfaceSize }) {
  const renderedPoints = stroke.points.map((point) => ({
    x: point.x * surfaceSize.width,
    y: point.y * surfaceSize.height,
  }));

  if (renderedPoints.length === 1) {
    return (
      <circle
        cx={renderedPoints[0].x}
        cy={renderedPoints[0].y}
        fill={stroke.color}
        r={stroke.width / 2}
      />
    );
  }

  return (
    <polyline
      fill="none"
      points={renderedPoints.map((point) => `${point.x},${point.y}`).join(' ')}
      stroke={stroke.color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={stroke.width}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function MeasureOverlay({
  audioMappedMeasureIds,
  audioTargetMeasureIndex,
  calculateHighlightRect,
  currentMeasure,
  currentMeasureIndex,
  currentPageMeasures,
  draggedMeasureIndex,
  mode,
  navigationEndingBadgesByMeasureId,
  onActivateMeasure,
  onEndMeasureDrag,
  onEndMeasureResize,
  onMoveMeasure,
  onResizeMeasure,
  onSelectMeasure,
  onStartMeasureDrag,
  onStartMeasureResize,
  resizedMeasureIndex,
  selectedMeasureIndex,
  showNavigationMarkers,
  showAudioMeasureTargets,
}) {
  const visibleMeasures =
    mode === REGISTER_MODE || showAudioMeasureTargets
      ? currentPageMeasures
      : currentMeasure
        ? [{ measure: currentMeasure, index: currentMeasureIndex }]
        : [];

  return (
    <div className="overlay">
      {visibleMeasures.map(({ measure, index }) => {
        const highlightRect = calculateHighlightRect(measure);
        const isAudioMapped = audioMappedMeasureIds.includes(measure.id);
        const navigationMarkers = showNavigationMarkers
          ? normalizeNavigationMarkers(measure.navigationMarkers)
          : [];
        const navigationEndingBadges = showNavigationMarkers
          ? navigationEndingBadgesByMeasureId.get(measure.id) || []
          : [];

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
            } ${index === resizedMeasureIndex ? 'resizing' : ''} ${
              showAudioMeasureTargets ? 'audio-target' : ''
            } ${isAudioMapped ? 'audio-mapped' : ''} ${
              index === audioTargetMeasureIndex ? 'audio-target-selected' : ''
            } ${index === currentMeasureIndex ? 'current-measure' : ''}`}
            key={measure.id}
            onClick={(event) => {
              event.stopPropagation();
              if (mode === REGISTER_MODE) {
                onSelectMeasure(index);
              } else {
                onActivateMeasure?.(index);
              }
            }}
            onPointerDown={
              mode === REGISTER_MODE
                ? (event) => onStartMeasureDrag(index, event, highlightRect)
                : undefined
            }
            onPointerMove={mode === REGISTER_MODE ? onMoveMeasure : undefined}
            onPointerUp={mode === REGISTER_MODE ? onEndMeasureDrag : undefined}
            onPointerCancel={mode === REGISTER_MODE ? onEndMeasureDrag : undefined}
            style={highlightStyle}
            aria-label={`measure ${index + 1}`}
          >
            {(navigationMarkers.length > 0 || navigationEndingBadges.length > 0) && (
              <span aria-hidden="true" className="navigation-marker-badges">
                {navigationMarkers.map((marker) => (
                  <span key={marker.type}>
                    {getNavigationMarkerLabel(marker.type)}
                  </span>
                ))}
                {navigationEndingBadges.map((badge) => (
                  <span className="navigation-ending-badge" key={badge.id}>
                    {badge.label}
                  </span>
                ))}
              </span>
            )}
            {mode === REGISTER_MODE && index === selectedMeasureIndex && (
              <>
                {RESIZE_HANDLES.map((handle) => (
                  <span
                    aria-label={handle.label}
                    className={handle.className}
                    key={handle.direction}
                    onPointerDown={(event) =>
                      onStartMeasureResize(
                        index,
                        handle.direction,
                        event,
                        highlightRect,
                      )
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
