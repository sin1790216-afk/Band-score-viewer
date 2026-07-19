import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Document, Page, pdfjs } from 'react-pdf';
import { io } from 'socket.io-client';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import './App.css';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const REGISTER_MODE = 'register';
const PLAY_MODE = 'play';
const ROLE_SELECT_MODE = 'role-select';
const TEACHER_MODE = 'teacher';
const STUDENT_MODE = 'student';
const VOCAL_MODE = 'vocal';
const TEACHER_PDF_SOURCE = 'teacher';
const LOCAL_PDF_SOURCE = 'local';
const STUDENT_ZOOM_VIEW = 'zoom';
const STUDENT_PAGE_VIEW = 'page';
const PDF_WIDTH_SCALE = 1.5;
const PAGE_FIT_PADDING = 24;
const DEFAULT_PAGE_ASPECT_RATIO = 0.707;
const SOCKET_PORT = import.meta.env.VITE_SOCKET_PORT || '4000';
const SOCKET_SERVER_URL =
  import.meta.env.VITE_SOCKET_SERVER_URL ||
  `${window.location.protocol}//${formatSocketHost(window.location.hostname)}:${SOCKET_PORT}`;
const SAME_ORIGIN_SOCKET_URL = window.location.origin;

const DEFAULT_MEASURE = {
  width: 140,
  height: 90,
  bpm: 120,
  beats: 4,
  lyric: '',
};

const MIN_MEASURE_SIZE = {
  width: 40,
  height: 30,
};

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

function getMeasureFileName(fileName) {
  return fileName ? fileName.replace(/\.pdf$/i, '.json') : 'measures.json';
}

function getPositiveNumber(value, fallbackValue) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallbackValue;
}

function normalizeMeasure(measure) {
  const nextMeasure = measure && typeof measure === 'object' ? measure : {};

  return {
    ...DEFAULT_MEASURE,
    ...nextMeasure,
    bpm: getPositiveNumber(nextMeasure.bpm, DEFAULT_MEASURE.bpm),
    beats: getPositiveNumber(nextMeasure.beats, DEFAULT_MEASURE.beats),
    lyric: typeof nextMeasure.lyric === 'string' ? nextMeasure.lyric : '',
  };
}

function normalizeMeasures(nextMeasures) {
  return Array.isArray(nextMeasures) ? nextMeasures.map(normalizeMeasure) : [];
}

function getTrimmedLyric(measure) {
  return measure?.lyric?.trim() || '';
}

function getMeasureDurationMs(measure) {
  const bpm = getPositiveNumber(measure?.bpm, DEFAULT_MEASURE.bpm);
  const beats = getPositiveNumber(measure?.beats, DEFAULT_MEASURE.beats);

  // TODO: 향후 "Auto Advance Offset(ms)" 옵션을 추가하여 사용자가 +/-오프셋을 직접 조절할 수 있도록 확장 가능.
  return (60 / bpm) * beats * 1000;
}

function formatSocketHost(hostname) {
  return hostname.includes(':') ? `[${hostname}]` : hostname;
}

function toPdfBlobPart(data) {
  if (data instanceof Blob) {
    return data;
  }

  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return data;
  }

  if (data?.type === 'Buffer' && Array.isArray(data.data)) {
    return new Uint8Array(data.data);
  }

  if (Array.isArray(data)) {
    return new Uint8Array(data);
  }

  return null;
}

function getLogicalSyncState(syncState) {
  return {
    fileName: syncState?.fileName || '',
    pageNumber: syncState?.pageNumber || 1,
    measureIndex: syncState?.measureIndex || 0,
  };
}

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

function App() {
  const fileInputRef = useRef(null);
  const jsonInputRef = useRef(null);
  const studentPdfInputRef = useRef(null);
  const pdfViewerRef = useRef(null);
  const pdfPageFrameRef = useRef(null);
  const pdfCanvasStackRef = useRef(null);
  const dragStateRef = useRef(null);
  const resizeStateRef = useRef(null);
  const studentPdfSourceRef = useRef(TEACHER_PDF_SOURCE);
  const viewerModeRef = useRef(ROLE_SELECT_MODE);
  const socketRef = useRef(null);
  const autoplayTimerRef = useRef(null);
  const isRepeatEnabledRef = useRef(false);
  const measuresRef = useRef([]);
  const measureIndexRef = useRef(0);
  const pageNumberRef = useRef(1);
  const pdfPageNumberRef = useRef(1);
  const scrolledPageNumberRef = useRef(1);
  const pdfObjectUrlRef = useRef('');
  const teacherPdfObjectUrlRef = useRef('');
  const debugSnapshotRef = useRef({});
  const shouldPublishMeasuresRef = useRef(false);
  const syncStateRef = useRef({
    fileName: '',
    pageNumber: 1,
    measureIndex: 0,
  });

  const [fileName, setFileName] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [pdfUrl, setPdfUrl] = useState('');
  const [pdfWidth, setPdfWidth] = useState(100);
  const [pdfViewerHeight, setPdfViewerHeight] = useState(100);
  const [pageRenderWidth, setPageRenderWidth] = useState(100 * PDF_WIDTH_SCALE);
  const [renderedPageNumber, setRenderedPageNumber] = useState(0);
  const [pageAspectRatio, setPageAspectRatio] = useState(DEFAULT_PAGE_ASPECT_RATIO);
  const [measures, setMeasures] = useState([]);
  const [measureIndex, setMeasureIndex] = useState(0);
  const [selectedMeasureIndex, setSelectedMeasureIndex] = useState(-1);
  const [draggedMeasureIndex, setDraggedMeasureIndex] = useState(-1);
  const [resizedMeasureIndex, setResizedMeasureIndex] = useState(-1);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [isRepeatEnabled, setIsRepeatEnabled] = useState(false);
  const [mode, setMode] = useState(REGISTER_MODE);
  const [isLyricEditorOpen, setIsLyricEditorOpen] = useState(false);
  const [pdfLayoutVersion, setPdfLayoutVersion] = useState(0);
  const [renderSyncVersion, setRenderSyncVersion] = useState(0);
  const [studentViewMode, setStudentViewMode] = useState(STUDENT_ZOOM_VIEW);
  const [studentPdfSource, setStudentPdfSource] = useState(TEACHER_PDF_SOURCE);
  const [viewerMode, setViewerMode] = useState(ROLE_SELECT_MODE);
  const [syncState, setSyncState] = useState({
    fileName: '',
    pageNumber: 1,
    measureIndex: 0,
  });

  const hasSelectedRole = viewerMode !== ROLE_SELECT_MODE;
  const canEdit = viewerMode === TEACHER_MODE;
  const isStudentPageView =
    viewerMode === STUDENT_MODE && studentViewMode === STUDENT_PAGE_VIEW;
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
  const teacherDisplayPageNumber = pageNumber;
  const studentDisplayPageNumber = syncState.pageNumber;
  const displayPageNumber = canEdit ? teacherDisplayPageNumber : studentDisplayPageNumber;
  const requestedPageNumber = isStudentPageView ? studentDisplayPageNumber : displayPageNumber;
  const pdfPageNumber =
    totalPages > 0 ? Math.min(Math.max(requestedPageNumber, 1), totalPages) : requestedPageNumber;
  const actualPagePropPassedToReactPdf = pdfPageNumber;
  pdfPageNumberRef.current = pdfPageNumber;
  const isPdfPageRenderReady = renderedPageNumber === pdfPageNumber;
  const displayMeasureIndex = canEdit ? measureIndex : syncState.measureIndex;
  const currentMeasure = measures[displayMeasureIndex] || null;
  const isFitViewHighlightVisible =
    !isStudentPageView ||
    (renderedPageNumber === studentDisplayPageNumber &&
      currentMeasure?.page === studentDisplayPageNumber);
  const shouldRenderHighlights = isPdfPageRenderReady && isFitViewHighlightVisible;
  const nextDifferentLyric =
    measures
      .slice(displayMeasureIndex + 1)
      .map(getTrimmedLyric)
      .find((lyric) => lyric && lyric !== getTrimmedLyric(currentMeasure)) || '';
  const selectedMeasure = measures[selectedMeasureIndex] || null;
  const overlayMode = canEdit ? mode : PLAY_MODE;
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
      const maxMeasureRight = pageMeasures.reduce(
        (maxRight, measure) => Math.max(maxRight, measure.x + measure.width),
        0,
      );
      const maxMeasureBottom = pageMeasures.reduce(
        (maxBottom, measure) => Math.max(maxBottom, measure.y + measure.height),
        0,
      );
      const explicitWidth = pageMeasures.reduce(
        (maxWidth, measure) =>
          Math.max(maxWidth, measure.coordinateWidth || measure.baseWidth || measure.pageWidth || 0),
        0,
      );
      const explicitHeight = pageMeasures.reduce(
        (maxHeight, measure) =>
          Math.max(
            maxHeight,
            measure.coordinateHeight || measure.baseHeight || measure.pageHeight || 0,
          ),
        0,
      );

      return {
        height:
          explicitHeight > 0
            ? explicitHeight
            : Math.max(maxMeasureBottom, pageRect?.height || 0),
        width:
          explicitWidth > 0
            ? explicitWidth
            : Math.max(maxMeasureRight, pageRect?.width || 0),
      };
    },
    [measures],
  );

  const getMeasureScale = useCallback(
    (measure, pageRect = getCurrentPageRect()) => {
      if (!measure || !pageRect || pageRect.width <= 0 || pageRect.height <= 0) return null;

      const coordinateBasis = getPageCoordinateBasis(measure.page, pageRect);

      if (coordinateBasis.width <= 0 || coordinateBasis.height <= 0) return null;

      return {
        coordinateBasis,
        scaleX: pageRect.width / coordinateBasis.width,
        scaleY: pageRect.height / coordinateBasis.height,
      };
    },
    [getCurrentPageRect, getPageCoordinateBasis],
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

  const calculateHighlightRect = useCallback((measure) => {
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
  }, [getCurrentPageRect, getMeasureScale]);

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
      pageNumber,
      pageRenderWidth,
      pdfPageDomRect: getCurrentPageRect(),
      pdfPageNumber,
      actualPagePropPassedToReactPdf,
      renderedPageNumber,
      role: canEdit ? TEACHER_MODE : viewerMode,
      scrollLeft: pdfViewerRef.current?.scrollLeft ?? null,
      scrollTop: pdfViewerRef.current?.scrollTop ?? null,
      studentPdfSource,
      studentDisplayPageNumber,
      studentViewMode,
      highlightVisible: shouldRenderHighlights,
      syncMeasureIndex: syncState.measureIndex,
      syncPageNumber: syncState.pageNumber,
      ignoredSyncPageRenderWidth: syncState.pageRenderWidth,
      totalPages,
      viewMode: viewerMode,
    };
  }

  debugSnapshotRef.current = getDebugSnapshot('latest render');
  console.log('[debug] render check', getDebugSnapshot('App render'));

  function publishSyncState(nextSyncState) {
    const logicalNextSyncState = getLogicalSyncState({
      ...syncStateRef.current,
      ...nextSyncState,
    });
    let mergedSyncState = syncStateRef.current;

    setSyncState(logicalNextSyncState);

    mergedSyncState = {
      ...syncStateRef.current,
      ...logicalNextSyncState,
    };
    syncStateRef.current = mergedSyncState;
    socketRef.current?.emit('sync:update', mergedSyncState);
  }

  function setSyncedFileName(nextFileName) {
    setFileName(nextFileName);
    publishSyncState({ fileName: nextFileName });
  }

  function setSyncedPageNumber(nextPageNumber) {
    setPageNumber(nextPageNumber);
    publishSyncState({ pageNumber: nextPageNumber });
  }

  function setSyncedMeasureIndex(nextMeasureIndex) {
    setMeasureIndex(nextMeasureIndex);
    publishSyncState({ measureIndex: nextMeasureIndex });
  }

  function setLocalPdfUrl(nextPdfUrl, options = {}) {
    if (
      pdfObjectUrlRef.current &&
      pdfObjectUrlRef.current !== teacherPdfObjectUrlRef.current &&
      !options.keepPrevious
    ) {
      URL.revokeObjectURL(pdfObjectUrlRef.current);
    }

    pdfObjectUrlRef.current = nextPdfUrl;
    setPdfUrl(nextPdfUrl);
  }

  function resetPdfRenderState() {
    const nextPdfWidth = pdfViewerRef.current?.clientWidth || 100;
    const nextPdfViewerHeight = pdfViewerRef.current?.clientHeight || 100;
    const nextPageRenderWidth = nextPdfWidth * PDF_WIDTH_SCALE;

    pdfViewerRef.current?.scrollTo({ left: 0, top: 0, behavior: 'auto' });
    scrolledPageNumberRef.current = 0;
    setPdfWidth(nextPdfWidth);
    setPdfViewerHeight(nextPdfViewerHeight);
    setPageRenderWidth(nextPageRenderWidth);
    setRenderedPageNumber(0);
    setPageAspectRatio(DEFAULT_PAGE_ASPECT_RATIO);
    setTotalPages(0);
    setPdfLayoutVersion((previousVersion) => previousVersion + 1);
    setRenderSyncVersion((previousVersion) => previousVersion + 1);
  }

  const resetViewRenderState = useCallback(() => {
    pdfViewerRef.current?.scrollTo({ left: 0, top: 0, behavior: 'auto' });
    pdfPageFrameRef.current = null;
    pdfCanvasStackRef.current = null;
    dragStateRef.current = null;
    resizeStateRef.current = null;
    scrolledPageNumberRef.current = 0;
    setDraggedMeasureIndex(-1);
    setResizedMeasureIndex(-1);
    setRenderedPageNumber(0);
    setPdfLayoutVersion((previousVersion) => previousVersion + 1);
    setRenderSyncVersion((previousVersion) => previousVersion + 1);
  }, []);

  const selectViewerMode = useCallback((nextViewerMode) => {
    // TODO: 향후 Teacher 선택 시 인증/비밀번호 검사를 이 지점에 연결.
    if (nextViewerMode === viewerMode) return;

    resetViewRenderState();
    setIsLyricEditorOpen(false);
    setViewerMode(nextViewerMode);
  }, [resetViewRenderState, viewerMode]);

  function setTeacherPdfUrl(nextPdfUrl) {
    if (
      teacherPdfObjectUrlRef.current &&
      teacherPdfObjectUrlRef.current !== pdfObjectUrlRef.current
    ) {
      URL.revokeObjectURL(teacherPdfObjectUrlRef.current);
    }

    teacherPdfObjectUrlRef.current = nextPdfUrl;

    if (
      viewerModeRef.current === TEACHER_MODE ||
      studentPdfSourceRef.current === TEACHER_PDF_SOURCE
    ) {
      setLocalPdfUrl(nextPdfUrl, { keepPrevious: true });
    }
  }

  function useTeacherPdf() {
    setStudentPdfSource(TEACHER_PDF_SOURCE);

    if (teacherPdfObjectUrlRef.current) {
      resetPdfRenderState();
      setLocalPdfUrl(teacherPdfObjectUrlRef.current, { keepPrevious: true });
    }
  }

  function openStudentPdf() {
    studentPdfInputRef.current?.click();
  }

  function selectStudentPdf(event) {
    const file = event.target.files[0];

    if (!file) return;

    // Student local PDFs must match the teacher PDF layout for measure overlays to align.
    setStudentPdfSource(LOCAL_PDF_SOURCE);
    setFileName(file.name);
    resetPdfRenderState();
    setLocalPdfUrl(URL.createObjectURL(file));
  }

  function publishMeasures(nextMeasures) {
    socketRef.current?.emit('measures:update', normalizeMeasures(nextMeasures));
  }

  function updateMeasures(nextMeasuresOrUpdater) {
    shouldPublishMeasuresRef.current = true;
    setMeasures((previousMeasures) => {
      const nextMeasures =
        typeof nextMeasuresOrUpdater === 'function'
          ? nextMeasuresOrUpdater(previousMeasures)
          : nextMeasuresOrUpdater;

      return normalizeMeasures(nextMeasures);
    });
  }

  async function publishPdf(file) {
    const data = await file.arrayBuffer();

    socketRef.current?.emit('pdf:update', {
      data,
      fileName: file.name,
      type: file.type || 'application/pdf',
    });
  }

  function updatePdfWidth() {
    if (pdfViewerRef.current) {
      const nextPdfWidth = pdfViewerRef.current.clientWidth;
      const nextPdfViewerHeight = pdfViewerRef.current.clientHeight;

      setPdfWidth(nextPdfWidth);
      setPdfViewerHeight(nextPdfViewerHeight);
    }
  }

  function updatePageRenderWidth() {
    if (pdfCanvasStackRef.current) {
      const nextPageRenderWidth = pdfCanvasStackRef.current.getBoundingClientRect().width;

      setPageRenderWidth(nextPageRenderWidth);
    }
  }

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
  }

  function openPdf() {
    fileInputRef.current?.click();
  }

  function selectPdf(event) {
    const file = event.target.files[0];

    if (!file) return;

    stopAutoplay();

    dragStateRef.current = null;
    resizeStateRef.current = null;
    measuresRef.current = [];
    setMeasures([]);
    publishMeasures([]);
    setSyncedMeasureIndex(0);
    setSelectedMeasureIndex(-1);
    setDraggedMeasureIndex(-1);
    setResizedMeasureIndex(-1);
    scrolledPageNumberRef.current = 1;
    setSyncedFileName(file.name);
    setSyncedPageNumber(1);
    resetPdfRenderState();
    setTeacherPdfUrl(URL.createObjectURL(file));
    publishPdf(file).catch((error) => console.error(error));
  }

  function saveJson() {
    const data = JSON.stringify(measures, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = getMeasureFileName(fileName);
    link.click();

    URL.revokeObjectURL(url);
  }

  function loadJson(event) {
    const file = event.target.files[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onload = (readerEvent) => {
      const data = JSON.parse(readerEvent.target.result);

      const nextMeasures = normalizeMeasures(data);

      updateMeasures(nextMeasures);
      setSyncedMeasureIndex(0);
      setSelectedMeasureIndex(-1);
    };

    reader.readAsText(file);
  }

  function addMeasure(event) {
    if (!canEdit || mode !== REGISTER_MODE || !pdfCanvasStackRef.current) return;

    const rect = pdfCanvasStackRef.current.getBoundingClientRect();
    const coordinateBasis = getPageCoordinateBasis(displayPageNumber, rect);
    const scaleX = rect.width / coordinateBasis.width;
    const scaleY = rect.height / coordinateBasis.height;
    const x = (event.clientX - rect.left) / scaleX;
    const y = (event.clientY - rect.top) / scaleY;
    const nextMeasure = {
      page: displayPageNumber,
      coordinateHeight: coordinateBasis.height,
      coordinateWidth: coordinateBasis.width,
      x: x - DEFAULT_MEASURE.width / scaleX / 2,
      y: y - DEFAULT_MEASURE.height / scaleY / 2,
      ...DEFAULT_MEASURE,
      height: DEFAULT_MEASURE.height / scaleY,
      width: DEFAULT_MEASURE.width / scaleX,
    };

    updateMeasures((previousMeasures) => {
      const nextMeasures = [...previousMeasures, nextMeasure];
      setSelectedMeasureIndex(nextMeasures.length - 1);
      return nextMeasures;
    });
  }

  const deleteSelectedMeasure = useCallback(() => {
    if (!canEdit || mode !== REGISTER_MODE || selectedMeasureIndex < 0) return;

    const nextMeasureIndex =
      measureIndex > selectedMeasureIndex
        ? measureIndex - 1
        : measureIndex >= measures.length - 1
          ? Math.max(0, measures.length - 2)
          : measureIndex;

    updateMeasures((previousMeasures) =>
      previousMeasures.filter((_, index) => index !== selectedMeasureIndex),
    );
    setSyncedMeasureIndex(nextMeasureIndex);
    setSelectedMeasureIndex(-1);
  }, [canEdit, measureIndex, measures.length, mode, selectedMeasureIndex]);

  function startMeasureDrag(index, event) {
    if (!canEdit || mode !== REGISTER_MODE) return;

    const measure = measures[index];

    if (!measure) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const highlightRect = calculateHighlightRect(measure);

    dragStateRef.current = {
      coordinateBasis: highlightRect?.coordinateBasis || null,
      index,
      pointerId: event.pointerId,
      scaleX: highlightRect?.scaleX || 1,
      scaleY: highlightRect?.scaleY || 1,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: measure.x,
      startY: measure.y,
    };

    setSelectedMeasureIndex(index);
    setDraggedMeasureIndex(index);
  }

  function moveMeasure(event) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();

    const nextX = dragState.startX + (event.clientX - dragState.startClientX) / dragState.scaleX;
    const nextY = dragState.startY + (event.clientY - dragState.startClientY) / dragState.scaleY;

    updateMeasures((previousMeasures) =>
      previousMeasures.map((measure, index) =>
        index === dragState.index
          ? {
              ...measure,
              coordinateHeight:
                measure.coordinateHeight || dragState.coordinateBasis?.height || measure.height,
              coordinateWidth:
                measure.coordinateWidth || dragState.coordinateBasis?.width || measure.width,
              x: nextX,
              y: nextY,
            }
          : measure,
      ),
    );
  }

  function endMeasureDrag(event) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    dragStateRef.current = null;
    setDraggedMeasureIndex(-1);
  }

  function startMeasureResize(index, axis, event) {
    if (!canEdit || mode !== REGISTER_MODE) return;

    const measure = measures[index];

    if (!measure) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const highlightRect = calculateHighlightRect(measure);

    resizeStateRef.current = {
      coordinateBasis: highlightRect?.coordinateBasis || null,
      index,
      pointerId: event.pointerId,
      scaleX: highlightRect?.scaleX || 1,
      scaleY: highlightRect?.scaleY || 1,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: measure.width,
      startHeight: measure.height,
      axis,
    };

    setSelectedMeasureIndex(index);
    setResizedMeasureIndex(index);
  }

  function resizeMeasure(event) {
    const resizeState = resizeStateRef.current;

    if (!resizeState || resizeState.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();

    const resizedWidth = Math.max(
      MIN_MEASURE_SIZE.width / resizeState.scaleX,
      resizeState.startWidth + (event.clientX - resizeState.startClientX) / resizeState.scaleX,
    );
    const resizedHeight = Math.max(
      MIN_MEASURE_SIZE.height / resizeState.scaleY,
      resizeState.startHeight + (event.clientY - resizeState.startClientY) / resizeState.scaleY,
    );

    updateMeasures((previousMeasures) =>
      previousMeasures.map((measure, index) =>
        index === resizeState.index
          ? {
              ...measure,
              coordinateHeight:
                measure.coordinateHeight || resizeState.coordinateBasis?.height || measure.height,
              coordinateWidth:
                measure.coordinateWidth || resizeState.coordinateBasis?.width || measure.width,
              width:
                resizeState.axis === 'horizontal' || resizeState.axis === 'both'
                  ? resizedWidth
                  : measure.width,
              height:
                resizeState.axis === 'vertical' || resizeState.axis === 'both'
                  ? resizedHeight
                  : measure.height,
            }
          : measure,
      ),
    );
  }

  function endMeasureResize(event) {
    const resizeState = resizeStateRef.current;

    if (!resizeState || resizeState.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    resizeStateRef.current = null;
    setResizedMeasureIndex(-1);
  }

  function updateSelectedMeasureTiming(field, value) {
    if (selectedMeasureIndex < 0) return;

    const fallbackValue =
      field === 'bpm'
        ? selectedMeasure?.bpm || DEFAULT_MEASURE.bpm
        : selectedMeasure?.beats || DEFAULT_MEASURE.beats;
    const nextValue = getPositiveNumber(value, fallbackValue);

    updateMeasures((previousMeasures) =>
      previousMeasures.map((measure, index) =>
        index === selectedMeasureIndex
          ? {
              ...measure,
              [field]: nextValue,
            }
          : measure,
      ),
    );
  }

  function openLyricEditor() {
    setIsLyricEditorOpen(true);
  }

  function updateMeasureLyric(measureIndexToUpdate, lyric) {
    updateMeasures((previousMeasures) =>
      previousMeasures.map((measure, index) => ({
        ...measure,
        lyric: index === measureIndexToUpdate ? lyric : measure.lyric,
      })),
    );
  }

  function goToPage(nextPageNumber) {
    if (nextPageNumber < 1 || nextPageNumber > totalPages) return;

    setSyncedPageNumber(nextPageNumber);
    setSelectedMeasureIndex(-1);
  }

  function goToMeasure(nextMeasureIndex) {
    const nextMeasure = measures[nextMeasureIndex];

    if (!nextMeasure) return;

    if (nextMeasure.page !== pageNumber) {
      setSyncedPageNumber(nextMeasure.page);
    }

    setSyncedMeasureIndex(nextMeasureIndex);
  }

  function clearAutoplayTimer() {
    if (!autoplayTimerRef.current) return;

    window.clearTimeout(autoplayTimerRef.current);
    autoplayTimerRef.current = null;
  }

  function stopAutoplay() {
    clearAutoplayTimer();
    setIsAutoPlaying(false);
  }

  function goToMeasureFromAutoplay(nextMeasureIndex) {
    const nextMeasure = measuresRef.current[nextMeasureIndex];

    if (!nextMeasure) return;

    if (nextMeasure.page !== pageNumberRef.current) {
      setSyncedPageNumber(nextMeasure.page);
    }

    setSyncedMeasureIndex(nextMeasureIndex);
  }

  function scheduleNextAutoplayStep(currentIndex) {
    clearAutoplayTimer();

    const currentAutoplayMeasure = measuresRef.current[currentIndex];

    if (!currentAutoplayMeasure) {
      setIsAutoPlaying(false);
      return;
    }

    autoplayTimerRef.current = window.setTimeout(() => {
      const isLastMeasure = currentIndex >= measuresRef.current.length - 1;

      if (isLastMeasure && !isRepeatEnabledRef.current) {
        clearAutoplayTimer();
        setIsAutoPlaying(false);
        return;
      }

      const nextMeasureIndex = isLastMeasure ? 0 : currentIndex + 1;

      goToMeasureFromAutoplay(nextMeasureIndex);

      if (nextMeasureIndex >= measuresRef.current.length - 1 && !isRepeatEnabledRef.current) {
        clearAutoplayTimer();
        setIsAutoPlaying(false);
        return;
      }

      scheduleNextAutoplayStep(nextMeasureIndex);
    }, getMeasureDurationMs(currentAutoplayMeasure));
  }

  function startAutoplay() {
    if (!canEdit || isAutoPlaying || measures.length === 0) return;

    const startMeasureIndex = Math.min(measureIndexRef.current, measures.length - 1);

    setIsAutoPlaying(true);
    scheduleNextAutoplayStep(startMeasureIndex);
  }

  useEffect(() => {
    window.addEventListener('resize', updatePdfWidth);
    window.addEventListener('resize', updatePageRenderWidth);

    return () => {
      window.removeEventListener('resize', updatePdfWidth);
      window.removeEventListener('resize', updatePageRenderWidth);
    };
  }, []);

  useEffect(() => {
    let fallbackStarted = false;
    let activeSocket = null;

    function attachSocket(socket, label) {
      activeSocket = socket;
      socketRef.current = socket;
      console.log(`[socket] connecting to ${label}`, socket.io.uri);

      socket.on('connect', () => {
        console.log(`[socket] connected to ${label}`, socket.id);
      });

      socket.on('connect_error', (error) => {
        console.warn(`[socket] connect_error on ${label}`, error.message);

        if (fallbackStarted || label === 'same-origin') return;

        fallbackStarted = true;
        socket.disconnect();

        const fallbackSocket = io(SAME_ORIGIN_SOCKET_URL, {
          transports: ['websocket', 'polling'],
          timeout: 5000,
        });

        attachSocket(fallbackSocket, 'same-origin');
      });

      socket.on('sync:state', (nextSyncState) => {
        syncStateRef.current = getLogicalSyncState({
          ...syncStateRef.current,
          ...nextSyncState,
        });
        setFileName(syncStateRef.current.fileName);
        setSyncState(syncStateRef.current);
        setRenderSyncVersion((previousVersion) => previousVersion + 1);
        console.log('[socket] received sync:state', syncStateRef.current);
        console.table({
          ...debugSnapshotRef.current,
          label: 'socket sync:state received',
          receivedMeasureIndex: nextSyncState?.measureIndex,
          receivedPageNumber: nextSyncState?.pageNumber,
          ignoredReceivedPageRenderWidth: nextSyncState?.pageRenderWidth,
        });
      });

      socket.on('pdf:state', (nextPdf) => {
        const pdfBlobPart = toPdfBlobPart(nextPdf?.data);

        if (!pdfBlobPart) {
          console.warn('[socket] received pdf:state without usable PDF data');
          return;
        }

        setFileName(nextPdf.fileName);
        if (
          viewerModeRef.current === TEACHER_MODE ||
          studentPdfSourceRef.current === TEACHER_PDF_SOURCE
        ) {
          resetPdfRenderState();
        }
        setTeacherPdfUrl(
          URL.createObjectURL(
            new Blob([pdfBlobPart], { type: nextPdf.type || 'application/pdf' }),
          ),
        );
        console.log('[socket] received pdf:state', nextPdf.fileName);
        console.table({
          ...debugSnapshotRef.current,
          label: 'socket pdf:state received',
          receivedFileName: nextPdf.fileName,
        });
      });

      socket.on('measures:state', (nextMeasures) => {
        const normalizedMeasures = normalizeMeasures(nextMeasures);

        measuresRef.current = normalizedMeasures;
        setMeasures(normalizedMeasures);
        setRenderSyncVersion((previousVersion) => previousVersion + 1);
        console.log(
          '[socket] received measures:state',
          Array.isArray(nextMeasures) ? nextMeasures.length : 0,
        );
        console.table({
          ...debugSnapshotRef.current,
          label: 'socket measures:state received',
          receivedMeasuresLength: normalizedMeasures.length,
        });
      });
    }

    attachSocket(
      io(SOCKET_SERVER_URL, {
        transports: ['websocket', 'polling'],
        timeout: 5000,
      }),
      'host-port',
    );

    return () => {
      activeSocket?.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!shouldPublishMeasuresRef.current) return;

    shouldPublishMeasuresRef.current = false;
    publishMeasures(measures);
  }, [measures]);

  useEffect(() => {
    measuresRef.current = measures;
  }, [measures]);

  useEffect(() => {
    measureIndexRef.current = measureIndex;
  }, [measureIndex]);

  useEffect(() => {
    pageNumberRef.current = pageNumber;
  }, [pageNumber]);

  useEffect(() => {
    pdfPageNumberRef.current = pdfPageNumber;
  }, [pdfPageNumber]);

  useEffect(() => {
    isRepeatEnabledRef.current = isRepeatEnabled;
  }, [isRepeatEnabled]);

  useEffect(() => {
    return () => {
      clearAutoplayTimer();

      if (pdfObjectUrlRef.current) {
        URL.revokeObjectURL(pdfObjectUrlRef.current);
      }
      if (
        teacherPdfObjectUrlRef.current &&
        teacherPdfObjectUrlRef.current !== pdfObjectUrlRef.current
      ) {
        URL.revokeObjectURL(teacherPdfObjectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    viewerModeRef.current = viewerMode;

    if (viewerMode !== TEACHER_MODE) {
      stopAutoplay();
    }

    console.log('[debug] viewMode changed');
    console.table({
      ...debugSnapshotRef.current,
      label: 'viewMode changed',
      nextViewMode: viewerMode,
    });
  }, [viewerMode]);

  useEffect(() => {
    if (!hasSelectedRole || viewerMode === VOCAL_MODE || !pdfUrl) return;

    resetPdfRenderState();

    const animationFrameId = window.requestAnimationFrame(() => {
      updatePdfWidth();
      updatePageRenderWidth();
      setRenderSyncVersion((previousVersion) => previousVersion + 1);
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [hasSelectedRole, pdfUrl, studentPdfSource, studentViewMode, viewerMode]);

  useEffect(() => {
    studentPdfSourceRef.current = studentPdfSource;
  }, [studentPdfSource]);

  useEffect(() => {
    function handleKeyDown(event) {
      if ((viewerMode === STUDENT_MODE || viewerMode === VOCAL_MODE) && event.key === 'Escape') {
        selectViewerMode(ROLE_SELECT_MODE);
        return;
      }

      const targetTagName = event.target.tagName;
      const isTyping =
        event.target.isContentEditable ||
        targetTagName === 'INPUT' ||
        targetTagName === 'TEXTAREA' ||
        targetTagName === 'SELECT';

      if (isTyping || event.key !== 'Backspace') return;

      deleteSelectedMeasure();
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [deleteSelectedMeasure, selectViewerMode, viewerMode]);

  useEffect(() => {
    if (!hasSelectedRole) return;

    updatePdfWidth();
    updatePageRenderWidth();
  }, [hasSelectedRole, viewerMode]);

  useEffect(() => {
    if (!hasSelectedRole || viewerMode === VOCAL_MODE || !pdfCanvasStackRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      updatePageRenderWidth();
      setRenderSyncVersion((previousVersion) => previousVersion + 1);
    });

    resizeObserver.observe(pdfCanvasStackRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [
    hasSelectedRole,
    pdfLayoutVersion,
    pdfPageNumber,
    renderedPdfPageWidth,
    studentViewMode,
    viewerMode,
  ]);

  useEffect(() => {
    if (!hasSelectedRole || viewerMode === VOCAL_MODE) return;

    const nextCurrentMeasure = measuresRef.current[displayMeasureIndex];

    if (!shouldRenderHighlights) return;

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
    hasSelectedRole,
    isStudentPageView,
    pdfPageNumber,
    renderSyncVersion,
    shouldRenderHighlights,
    viewerMode,
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
      localPageNumber: pageNumber,
      syncPageNumber: syncState.pageNumber,
      totalPages,
    });
  }, [
    displayMeasureIndex,
    measures.length,
    pageNumber,
    pdfPageNumber,
    pdfUrl,
    renderedPageNumber,
    studentPdfSource,
    syncState.pageNumber,
    totalPages,
    viewerMode,
  ]);

  useEffect(() => {
    console.log('[page-sync]', {
      role: canEdit ? TEACHER_MODE : viewerMode,
      viewMode: viewerMode,
      syncPageNumber: syncState.pageNumber,
      localPageNumber: pageNumber,
      studentDisplayPageNumber,
      pdfPageNumber,
      renderedPageNumber,
      totalPages,
      pdfSource: studentPdfSource,
      measureIndex: displayMeasureIndex,
    });
  }, [
    canEdit,
    displayMeasureIndex,
    pageNumber,
    pdfPageNumber,
    renderedPageNumber,
    studentDisplayPageNumber,
    studentPdfSource,
    syncState.pageNumber,
    totalPages,
    viewerMode,
  ]);

  useEffect(() => {
    if (!isStudentPageView) return;

    const originDebugData = getPdfOriginDebugData();

    console.log('[fit-page-sync]', {
      studentViewMode,
      syncPageNumber: syncState.pageNumber,
      studentDisplayPageNumber,
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
    isStudentPageView,
    renderedPageNumber,
    renderSyncVersion,
    shouldRenderHighlights,
    studentDisplayPageNumber,
    studentViewMode,
    syncState.pageNumber,
    totalPages,
  ]);

  return (
    <div
      className={`app ${
        viewerMode === ROLE_SELECT_MODE
          ? 'role-select-mode'
          : viewerMode === STUDENT_MODE
          ? `student-mode ${
              studentViewMode === STUDENT_PAGE_VIEW ? 'student-page-view' : 'student-zoom-view'
            }`
          : viewerMode === VOCAL_MODE
            ? 'vocal-mode'
            : 'teacher-mode'
      }`}
    >
      {viewerMode === ROLE_SELECT_MODE ? (
        <RoleSelectView onSelectViewerMode={selectViewerMode} />
      ) : canEdit ? (
        <header className="header">
          <h1>Band Score Viewer</h1>
          <p>밴드 수업용 실시간 악보 시스템</p>
          <div className="viewer-mode-controls">
            <button
              className={viewerMode === TEACHER_MODE ? 'active' : ''}
              onClick={() => selectViewerMode(TEACHER_MODE)}
              type="button"
            >
              Teacher
            </button>
            <button
              className={viewerMode === STUDENT_MODE ? 'active' : ''}
              onClick={() => selectViewerMode(STUDENT_MODE)}
              type="button"
            >
              Student
            </button>
            <button
              className={viewerMode === VOCAL_MODE ? 'active' : ''}
              onClick={() => selectViewerMode(VOCAL_MODE)}
              type="button"
            >
              Vocal
            </button>
            <button onClick={() => selectViewerMode(ROLE_SELECT_MODE)} type="button">
              화면 선택
            </button>
          </div>
        </header>
      ) : (
        <div className="floating-view-controls">
          <button onClick={() => selectViewerMode(ROLE_SELECT_MODE)} type="button">
            화면 선택
          </button>
          <button onClick={() => selectViewerMode(TEACHER_MODE)} type="button">
            Teacher
          </button>
        </div>
      )}

      {viewerMode === STUDENT_MODE && (
        <div className="student-pdf-controls">
          <button
            className={studentPdfSource === TEACHER_PDF_SOURCE ? 'active' : ''}
            onClick={useTeacherPdf}
            type="button"
          >
            선생님 PDF 보기
          </button>
          <button
            className={studentPdfSource === LOCAL_PDF_SOURCE ? 'active' : ''}
            onClick={openStudentPdf}
            type="button"
          >
            내 PDF 열기
          </button>
          <button
            className={studentViewMode === STUDENT_ZOOM_VIEW ? 'active' : ''}
            onClick={() => setStudentViewMode(STUDENT_ZOOM_VIEW)}
            type="button"
          >
            확대모드
          </button>
          <button
            className={studentViewMode === STUDENT_PAGE_VIEW ? 'active' : ''}
            onClick={() => setStudentViewMode(STUDENT_PAGE_VIEW)}
            type="button"
          >
            한 페이지 보기
          </button>
          <input
            accept=".pdf"
            className="file-input"
            onChange={selectStudentPdf}
            ref={studentPdfInputRef}
            type="file"
          />
        </div>
      )}

      {viewerMode === ROLE_SELECT_MODE ? null : viewerMode === VOCAL_MODE ? (
        <VocalView currentMeasure={currentMeasure} nextLyric={nextDifferentLyric} />
      ) : (
      <main className="main">
        {canEdit && (
          <Sidebar
            canEdit={canEdit}
            fileInputRef={fileInputRef}
            isAutoPlaying={isAutoPlaying}
            isRepeatEnabled={isRepeatEnabled}
            jsonInputRef={jsonInputRef}
            measureIndex={measureIndex}
            measureTotal={measures.length}
            mode={mode}
            onStartAutoplay={startAutoplay}
            onStopAutoplay={stopAutoplay}
            onLoadJson={loadJson}
            onOpenJson={() => jsonInputRef.current?.click()}
            onOpenPdf={openPdf}
            onPdfSelected={selectPdf}
            onSaveJson={saveJson}
            onSetMode={setMode}
            onSetRepeatEnabled={setIsRepeatEnabled}
            onGoToPage={goToPage}
            onGoToMeasure={goToMeasure}
            onOpenLyricEditor={openLyricEditor}
            onUpdateSelectedMeasureTiming={updateSelectedMeasureTiming}
            pageNumber={pageNumber}
            selectedMeasure={selectedMeasure}
            selectedMeasureIndex={selectedMeasureIndex}
            totalPages={totalPages}
          />
        )}

        {canEdit && isLyricEditorOpen && (
          <section className="lyric-editor-panel">
            <div className="lyric-editor-header">
              <h2>가사 편집</h2>
              <button onClick={() => setIsLyricEditorOpen(false)} type="button">
                닫기
              </button>
            </div>
            <div className="lyric-measure-list">
              {measures.map((measure, index) => (
                <label className="lyric-measure-row" key={index}>
                  <span>{index + 1}</span>
                  <textarea
                    onChange={(event) => updateMeasureLyric(index, event.target.value)}
                    placeholder="이 마디의 가사"
                    value={measure.lyric}
                  />
                </label>
              ))}
            </div>
          </section>
        )}

        <section className="pdf-area">
          {canEdit && (
            <div className="status-bar">
              <p>{fileName}</p>
            </div>
          )}

          <div className="pdf-viewer" ref={pdfViewerRef}>
            {pdfUrl && (
              <Document
                file={pdfUrl}
                key={pdfLayoutKey}
                onLoadSuccess={(pdf) => {
                  setTotalPages(pdf.numPages);
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
                          ? `fit-${pdfUrl}-${studentPdfSource}-${studentDisplayPageNumber}`
                          : `${pdfLayoutKey}-${pdfPageNumber}`
                      }
                      pageNumber={actualPagePropPassedToReactPdf}
                      width={renderedPdfPageWidth}
                      onClick={addMeasure}
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
                      mode={overlayMode}
                      onEndMeasureDrag={endMeasureDrag}
                      onHighlightRecalculated={logHighlightCalculation}
                      onMoveMeasure={moveMeasure}
                      onResizeMeasure={resizeMeasure}
                      onSelectMeasure={setSelectedMeasureIndex}
                      onStartMeasureResize={startMeasureResize}
                      onStartMeasureDrag={startMeasureDrag}
                      onEndMeasureResize={endMeasureResize}
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
        </section>
      </main>
      )}

      {viewerMode !== ROLE_SELECT_MODE && <footer className="footer" />}
    </div>
  );
}

function RoleSelectView({ onSelectViewerMode }) {
  return (
    <main className="role-select">
      <h1>Band Score Viewer</h1>
      <p>사용할 화면을 선택하세요.</p>
      <div className="role-select-actions">
        <button onClick={() => onSelectViewerMode(TEACHER_MODE)} type="button">
          Teacher
        </button>
        <button onClick={() => onSelectViewerMode(STUDENT_MODE)} type="button">
          Student
        </button>
        <button onClick={() => onSelectViewerMode(VOCAL_MODE)} type="button">
          Vocal
        </button>
      </div>
    </main>
  );
}

function VocalView({ currentMeasure, nextLyric }) {
  const currentLyric = getTrimmedLyric(currentMeasure);
  const upcomingLyric = nextLyric || '';

  return (
    <main className="vocal-view">
      <section className="vocal-current">{currentLyric}</section>
      <section className="vocal-next">{upcomingLyric}</section>
    </main>
  );
}

function Sidebar({
  canEdit,
  fileInputRef,
  isAutoPlaying,
  isRepeatEnabled,
  jsonInputRef,
  measureIndex,
  measureTotal,
  mode,
  onGoToMeasure,
  onGoToPage,
  onLoadJson,
  onOpenLyricEditor,
  onOpenJson,
  onOpenPdf,
  onPdfSelected,
  onSaveJson,
  onSetMode,
  onSetRepeatEnabled,
  onStartAutoplay,
  onStopAutoplay,
  onUpdateSelectedMeasureTiming,
  pageNumber,
  selectedMeasure,
  selectedMeasureIndex,
  totalPages,
}) {
  return (
    <aside className="sidebar">
      {canEdit && (
        <>
          <button onClick={onOpenPdf}>PDF 열기</button>
          <button onClick={onSaveJson}>💾 JSON 저장</button>
          <button onClick={onOpenJson}>📂 JSON 불러오기</button>
          <button onClick={onOpenLyricEditor}>가사 편집</button>

          <input
            type="file"
            accept=".json"
            ref={jsonInputRef}
            className="file-input"
            onChange={onLoadJson}
          />

          <button onClick={() => onSetMode(REGISTER_MODE)}>📝 등록모드</button>
          <button onClick={() => onSetMode(PLAY_MODE)}>▶ 연주모드</button>

          <input
            className="file-input"
            type="file"
            accept=".pdf"
            ref={fileInputRef}
            onChange={onPdfSelected}
          />

          {mode === REGISTER_MODE ? (
            <>
              <button onClick={() => onGoToPage(pageNumber - 1)}>◀ 페이지</button>
              <button onClick={() => onGoToPage(pageNumber + 1)}>▶ 페이지</button>
            </>
          ) : (
            <>
              <button onClick={() => onGoToMeasure(0)}>⏮ 처음</button>
              <button onClick={() => onGoToMeasure(measureIndex - 1)}>◀ 마디</button>
              <button onClick={() => onGoToMeasure(measureIndex + 1)}>▶ 마디</button>
            </>
          )}

          <div className="autoplay-controls">
            <label className="repeat-toggle">
              <input
                checked={isRepeatEnabled}
                onChange={(event) => onSetRepeatEnabled(event.target.checked)}
                type="checkbox"
              />
              반복재생
            </label>
            <button
              disabled={isAutoPlaying || measureTotal === 0}
              onClick={onStartAutoplay}
              type="button"
            >
              {isAutoPlaying ? '재생 중' : '▶ Start'}
            </button>
            <button disabled={!isAutoPlaying} onClick={onStopAutoplay} type="button">
              ■ Stop
            </button>
          </div>
        </>
      )}

      {canEdit ? (
        <>
          {mode === REGISTER_MODE && selectedMeasure && (
            <div className="measure-timing-editor">
              <p>선택 마디 : {selectedMeasureIndex + 1}</p>
              <label>
                BPM
                <input
                  min="1"
                  onChange={(event) =>
                    onUpdateSelectedMeasureTiming('bpm', event.target.value)
                  }
                  type="number"
                  value={selectedMeasure.bpm}
                />
              </label>
              <label>
                Beats
                <input
                  min="1"
                  onChange={(event) =>
                    onUpdateSelectedMeasureTiming('beats', event.target.value)
                  }
                  type="number"
                  value={selectedMeasure.beats}
                />
              </label>
            </div>
          )}

          <p>key</p>
          <p>현재 마디</p>
          <p>{mode}</p>
        </>
      ) : (
        <>
          <p>{STUDENT_MODE}</p>
          <p>현재 마디</p>
        </>
      )}

      <p>
        {measureTotal > 0 ? measureIndex + 1 : 0} / {measureTotal}
      </p>
      {!canEdit && <p>현재 페이지</p>}
      <p>
        {pageNumber} / {totalPages}
      </p>
    </aside>
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
            onPointerDown={(event) => onStartMeasureDrag(index, event)}
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
                    onPointerDown={(event) => onStartMeasureResize(index, handle.axis, event)}
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

export default App;
