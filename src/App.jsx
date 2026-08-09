import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { io } from 'socket.io-client';

import './App.css';
import ScoreViewer from './components/ScoreViewer.jsx';
import { decodeBsvProject, encodeBsvProject } from './project/bsvCodec.js';
import {
  BSV_FILE_MIME_TYPE,
  PDF_MIME_TYPE,
} from './project/bsvSchema.js';
import {
  createInitialProjectState,
  createProjectMeasure,
  DEFAULT_MEASURE,
  exportMeasuresJson,
  getPositiveNumber,
  importMeasuresJson,
  normalizeMeasures,
  prepareMeasuresForProject,
  PROJECT_ACTIONS,
  projectReducer,
} from './state/projectState.js';
import {
  createInitialSessionState,
  getLogicalSyncState,
  INITIAL_SYNC_STATE,
  SESSION_ACTIONS,
  sessionReducer,
} from './state/sessionState.js';
import {
  NORMALIZED_COORDINATE_SPACE,
  NORMALIZED_COORDINATE_STATUS,
} from './utils/measureCoordinates.js';

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
const SOCKET_PORT = import.meta.env.VITE_SOCKET_PORT || '4000';
const SOCKET_SERVER_URL =
  import.meta.env.VITE_SOCKET_SERVER_URL ||
  `${window.location.protocol}//${formatSocketHost(window.location.hostname)}:${SOCKET_PORT}`;
const SAME_ORIGIN_SOCKET_URL = window.location.origin;

const MIN_MEASURE_SIZE = {
  width: 40,
  height: 30,
};

function getMeasureFileName(fileName) {
  return fileName ? fileName.replace(/\.pdf$/i, '.json') : 'measures.json';
}

function getProjectFileName(fileName) {
  return fileName
    ? `${fileName.replace(/\.pdf$/i, '')}.bsv`
    : 'band-score-viewer.bsv';
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

function App() {
  const bsvInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const jsonInputRef = useRef(null);
  const studentPdfInputRef = useRef(null);
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
  const pdfObjectUrlRef = useRef('');
  const teacherPdfObjectUrlRef = useRef('');
  const teacherPdfBlobRef = useRef(null);
  const debugSnapshotRef = useRef({});
  const shouldPublishMeasuresRef = useRef(false);
  const syncStateRef = useRef({ ...INITIAL_SYNC_STATE });

  const [projectState, dispatchProject] = useReducer(
    projectReducer,
    undefined,
    createInitialProjectState,
  );
  const [sessionState, dispatchSession] = useReducer(
    sessionReducer,
    undefined,
    createInitialSessionState,
  );
  const [totalPages, setTotalPages] = useState(0);
  const [pdfUrl, setPdfUrl] = useState('');
  const [selectedMeasureIndex, setSelectedMeasureIndex] = useState(-1);
  const [draggedMeasureIndex, setDraggedMeasureIndex] = useState(-1);
  const [resizedMeasureIndex, setResizedMeasureIndex] = useState(-1);
  const [mode, setMode] = useState(REGISTER_MODE);
  const [isLyricEditorOpen, setIsLyricEditorOpen] = useState(false);
  const [pdfRenderResetVersion, setPdfRenderResetVersion] = useState(0);
  const [studentViewMode, setStudentViewMode] = useState(STUDENT_ZOOM_VIEW);
  const [studentPdfSource, setStudentPdfSource] = useState(TEACHER_PDF_SOURCE);
  const [viewerMode, setViewerMode] = useState(ROLE_SELECT_MODE);
  const { measures, pdfMetadata } = projectState;
  const fileName = pdfMetadata.fileName;
  const {
    isAutoPlaying,
    isRepeatEnabled,
    measureIndex,
    pageNumber,
    syncState,
  } = sessionState;

  const canEdit = viewerMode === TEACHER_MODE;
  const isStudentPageView =
    viewerMode === STUDENT_MODE && studentViewMode === STUDENT_PAGE_VIEW;
  const displayPageNumber = canEdit ? pageNumber : syncState.pageNumber;
  const displayMeasureIndex = canEdit ? measureIndex : syncState.measureIndex;
  const currentMeasure = measures[displayMeasureIndex] || null;
  const nextDifferentLyric =
    measures
      .slice(displayMeasureIndex + 1)
      .map(getTrimmedLyric)
      .find((lyric) => lyric && lyric !== getTrimmedLyric(currentMeasure)) || '';
  const selectedMeasure = measures[selectedMeasureIndex] || null;
  const overlayMode = canEdit ? mode : PLAY_MODE;
  const handleDebugSnapshot = useCallback((snapshot) => {
    debugSnapshotRef.current = snapshot;
  }, []);

  function publishSyncState(nextSyncState) {
    const logicalNextSyncState = getLogicalSyncState({
      ...syncStateRef.current,
      ...nextSyncState,
    });
    let mergedSyncState = syncStateRef.current;

    dispatchSession({
      type: SESSION_ACTIONS.APPLY_SYNC_STATE,
      syncState: logicalNextSyncState,
    });

    mergedSyncState = {
      ...syncStateRef.current,
      ...logicalNextSyncState,
    };
    syncStateRef.current = mergedSyncState;
    socketRef.current?.emit('sync:update', mergedSyncState);
  }

  function setSyncedFileName(nextFileName) {
    dispatchProject({
      type: PROJECT_ACTIONS.SET_PDF_FILE_NAME,
      fileName: nextFileName,
    });
    publishSyncState({ fileName: nextFileName });
  }

  function setSyncedPageNumber(nextPageNumber) {
    dispatchSession({
      type: SESSION_ACTIONS.SET_PAGE_NUMBER,
      pageNumber: nextPageNumber,
    });
    publishSyncState({ pageNumber: nextPageNumber });
  }

  function setSyncedMeasureIndex(nextMeasureIndex) {
    dispatchSession({
      type: SESSION_ACTIONS.SET_MEASURE_INDEX,
      measureIndex: nextMeasureIndex,
    });
    publishSyncState({ measureIndex: nextMeasureIndex });
  }

  function setAutoPlaying(nextIsAutoPlaying) {
    dispatchSession({
      type: SESSION_ACTIONS.SET_AUTO_PLAYING,
      isAutoPlaying: nextIsAutoPlaying,
    });
  }

  function setRepeatEnabled(nextIsRepeatEnabled) {
    dispatchSession({
      type: SESSION_ACTIONS.SET_REPEAT_ENABLED,
      isRepeatEnabled: nextIsRepeatEnabled,
    });
  }

  function setLocalPdfUrl(nextPdfUrl) {
    if (
      pdfObjectUrlRef.current &&
      pdfObjectUrlRef.current !== teacherPdfObjectUrlRef.current
    ) {
      URL.revokeObjectURL(pdfObjectUrlRef.current);
    }

    pdfObjectUrlRef.current = nextPdfUrl;
    setPdfUrl(nextPdfUrl);
  }

  function resetPdfRenderState() {
    setTotalPages(0);
    setPdfRenderResetVersion((previousVersion) => previousVersion + 1);
  }

  const resetViewRenderState = useCallback(() => {
    dragStateRef.current = null;
    resizeStateRef.current = null;
    setDraggedMeasureIndex(-1);
    setResizedMeasureIndex(-1);
    setPdfRenderResetVersion((previousVersion) => previousVersion + 1);
  }, []);

  const selectViewerMode = useCallback((nextViewerMode) => {
    // TODO: 향후 Teacher 선택 시 인증/비밀번호 검사를 이 지점에 연결.
    if (nextViewerMode === viewerMode) return;

    resetViewRenderState();
    setIsLyricEditorOpen(false);
    setViewerMode(nextViewerMode);
  }, [resetViewRenderState, viewerMode]);

  function setTeacherPdfUrl(nextPdfUrl) {
    const previousTeacherPdfUrl = teacherPdfObjectUrlRef.current;
    const previousDisplayedPdfUrl = pdfObjectUrlRef.current;

    teacherPdfObjectUrlRef.current = nextPdfUrl;

    if (
      viewerModeRef.current === TEACHER_MODE ||
      studentPdfSourceRef.current === TEACHER_PDF_SOURCE
    ) {
      setLocalPdfUrl(nextPdfUrl);
    }

    if (
      previousTeacherPdfUrl &&
      previousTeacherPdfUrl !== nextPdfUrl &&
      previousTeacherPdfUrl !== previousDisplayedPdfUrl
    ) {
      URL.revokeObjectURL(previousTeacherPdfUrl);
    }
  }

  function useTeacherPdf() {
    setStudentPdfSource(TEACHER_PDF_SOURCE);

    if (teacherPdfObjectUrlRef.current) {
      resetPdfRenderState();
      setLocalPdfUrl(teacherPdfObjectUrlRef.current);
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
    resetPdfRenderState();
    setLocalPdfUrl(URL.createObjectURL(file));
  }

  function publishMeasures(nextMeasures) {
    socketRef.current?.emit('measures:update', normalizeMeasures(nextMeasures));
  }

  function dispatchMeasureUpdate(action) {
    shouldPublishMeasuresRef.current = true;
    dispatchProject(action);
  }

  function publishPdfData(data, nextFileName, mimeType) {
    socketRef.current?.emit('pdf:update', {
      data,
      fileName: nextFileName,
      type: mimeType || PDF_MIME_TYPE,
    });
  }

  async function publishPdf(pdfBlob, nextFileName, mimeType) {
    publishPdfData(
      await pdfBlob.arrayBuffer(),
      nextFileName,
      mimeType || pdfBlob.type || PDF_MIME_TYPE,
    );
  }

  function openPdf() {
    fileInputRef.current?.click();
  }

  function selectPdf(event) {
    const file = event.target.files[0];

    if (!file) return;

    stopAutoplay();

    const mimeType = PDF_MIME_TYPE;

    dragStateRef.current = null;
    resizeStateRef.current = null;
    measuresRef.current = [];
    teacherPdfBlobRef.current = file;
    dispatchProject({
      type: PROJECT_ACTIONS.RESET_PROJECT,
      pdfMetadata: {
        fileName: file.name,
        mimeType,
      },
    });
    publishMeasures([]);
    setSyncedMeasureIndex(0);
    setSelectedMeasureIndex(-1);
    setDraggedMeasureIndex(-1);
    setResizedMeasureIndex(-1);
    setSyncedFileName(file.name);
    setSyncedPageNumber(1);
    resetPdfRenderState();
    setTeacherPdfUrl(URL.createObjectURL(file));
    publishPdf(file, file.name, mimeType).catch((error) => console.error(error));
  }

  function saveJson() {
    const data = exportMeasuresJson(measures);
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
      const nextMeasures = importMeasuresJson(readerEvent.target.result);

      dispatchMeasureUpdate({
        type: PROJECT_ACTIONS.IMPORT_MEASURES,
        measures: nextMeasures,
      });
      setSyncedMeasureIndex(0);
      setSelectedMeasureIndex(-1);
    };

    reader.readAsText(file);
  }

  function openBsvProject() {
    bsvInputRef.current?.click();
  }

  function showBsvError(actionLabel, error) {
    console.error(`[bsv] ${actionLabel} failed`, error);
    window.alert(
      `${actionLabel}할 수 없습니다.\n${error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'}`,
    );
  }

  async function saveBsvProject() {
    const pdfBlob = teacherPdfBlobRef.current;

    if (!pdfBlob) {
      window.alert('프로젝트를 저장하려면 먼저 PDF를 열어주세요.');
      return;
    }

    try {
      const encodedProject = await encodeBsvProject({
        pdfBlob,
        projectState,
      });
      const blob = new Blob([encodedProject.text], { type: BSV_FILE_MIME_TYPE });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = getProjectFileName(fileName);
      link.click();

      URL.revokeObjectURL(url);
      dispatchProject({
        type: PROJECT_ACTIONS.SET_PROJECT_METADATA,
        metadata: encodedProject.document.metadata,
      });
    } catch (error) {
      showBsvError('프로젝트를 저장', error);
    }
  }

  async function loadBsvProject(event) {
    const file = event.target.files[0];

    if (!file) return;

    let preparedProject;
    let nextPdfUrl;

    try {
      preparedProject = decodeBsvProject(await file.text());
      nextPdfUrl = URL.createObjectURL(preparedProject.pdfBlob);
    } catch (error) {
      event.target.value = '';
      showBsvError('프로젝트를 열', error);
      return;
    }

    const nextProjectState = preparedProject.projectState;
    const nextMeasures = nextProjectState.measures;
    const nextFileName = nextProjectState.pdfMetadata.fileName;
    const nextMimeType = nextProjectState.pdfMetadata.mimeType;

    stopAutoplay();
    dragStateRef.current = null;
    resizeStateRef.current = null;
    measuresRef.current = nextMeasures;
    measureIndexRef.current = 0;
    pageNumberRef.current = 1;
    isRepeatEnabledRef.current = false;
    shouldPublishMeasuresRef.current = false;
    teacherPdfBlobRef.current = preparedProject.pdfBlob;
    studentPdfSourceRef.current = TEACHER_PDF_SOURCE;

    dispatchProject({
      type: PROJECT_ACTIONS.REPLACE_PROJECT,
      projectState: nextProjectState,
    });
    dispatchSession({ type: SESSION_ACTIONS.RESET_POSITION });
    dispatchSession({
      type: SESSION_ACTIONS.SET_REPEAT_ENABLED,
      isRepeatEnabled: false,
    });
    setSelectedMeasureIndex(-1);
    setDraggedMeasureIndex(-1);
    setResizedMeasureIndex(-1);
    setIsLyricEditorOpen(false);
    setStudentPdfSource(TEACHER_PDF_SOURCE);
    resetPdfRenderState();
    setTeacherPdfUrl(nextPdfUrl);

    publishPdfData(preparedProject.pdfBytes, nextFileName, nextMimeType);
    publishMeasures(nextMeasures);
    publishSyncState({
      fileName: nextFileName,
      measureIndex: 0,
      pageNumber: 1,
    });

    event.target.value = '';
  }

  function addMeasure(pageMetrics) {
    if (!canEdit || mode !== REGISTER_MODE || !pageMetrics) return;

    const {
      coordinateBasis,
      pageNumber: renderedPageNumber,
      point,
      scaleX,
      scaleY,
    } = pageMetrics;
    const nextMeasure = createProjectMeasure({
      page: renderedPageNumber,
      coordinateHeight: coordinateBasis.height,
      coordinateSpace: NORMALIZED_COORDINATE_SPACE,
      coordinateStatus: NORMALIZED_COORDINATE_STATUS,
      coordinateWidth: coordinateBasis.width,
      x: point.x - DEFAULT_MEASURE.width / scaleX / 2,
      y: point.y - DEFAULT_MEASURE.height / scaleY / 2,
      ...DEFAULT_MEASURE,
      height: DEFAULT_MEASURE.height / scaleY,
      width: DEFAULT_MEASURE.width / scaleX,
    });

    if (!nextMeasure) return;

    setSelectedMeasureIndex(measures.length);
    dispatchMeasureUpdate({
      type: PROJECT_ACTIONS.ADD_MEASURE,
      measure: nextMeasure,
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

    dispatchMeasureUpdate({
      type: PROJECT_ACTIONS.DELETE_MEASURE,
      index: selectedMeasureIndex,
    });
    setSyncedMeasureIndex(nextMeasureIndex);
    setSelectedMeasureIndex(-1);
  }, [canEdit, measureIndex, measures.length, mode, selectedMeasureIndex]);

  function startMeasureDrag(index, event, highlightRect) {
    if (!canEdit || mode !== REGISTER_MODE) return;

    const measure = measures[index];

    if (!measure) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    dragStateRef.current = {
      coordinateHeight:
        measure.coordinateHeight || highlightRect?.coordinateBasis?.height || measure.height,
      coordinateWidth:
        measure.coordinateWidth || highlightRect?.coordinateBasis?.width || measure.width,
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

    dispatchMeasureUpdate({
      type: PROJECT_ACTIONS.UPDATE_MEASURE,
      index: dragState.index,
      changes: {
        coordinateHeight: dragState.coordinateHeight,
        coordinateWidth: dragState.coordinateWidth,
        x: nextX,
        y: nextY,
      },
    });
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

  function startMeasureResize(index, axis, event, highlightRect) {
    if (!canEdit || mode !== REGISTER_MODE) return;

    const measure = measures[index];

    if (!measure) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    resizeStateRef.current = {
      coordinateHeight:
        measure.coordinateHeight || highlightRect?.coordinateBasis?.height || measure.height,
      coordinateWidth:
        measure.coordinateWidth || highlightRect?.coordinateBasis?.width || measure.width,
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

    dispatchMeasureUpdate({
      type: PROJECT_ACTIONS.UPDATE_MEASURE,
      index: resizeState.index,
      changes: {
        coordinateHeight: resizeState.coordinateHeight,
        coordinateWidth: resizeState.coordinateWidth,
        width:
          resizeState.axis === 'horizontal' || resizeState.axis === 'both'
            ? resizedWidth
            : resizeState.startWidth,
        height:
          resizeState.axis === 'vertical' || resizeState.axis === 'both'
            ? resizedHeight
            : resizeState.startHeight,
      },
    });
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

    dispatchMeasureUpdate({
      type: PROJECT_ACTIONS.UPDATE_MEASURE,
      index: selectedMeasureIndex,
      changes: {
        [field]: nextValue,
      },
    });
  }

  function openLyricEditor() {
    setIsLyricEditorOpen(true);
  }

  function updateMeasureLyric(measureIndexToUpdate, lyric) {
    dispatchMeasureUpdate({
      type: PROJECT_ACTIONS.UPDATE_MEASURE,
      index: measureIndexToUpdate,
      changes: { lyric },
    });
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
    setAutoPlaying(false);
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
      setAutoPlaying(false);
      return;
    }

    autoplayTimerRef.current = window.setTimeout(() => {
      const isLastMeasure = currentIndex >= measuresRef.current.length - 1;

      if (isLastMeasure && !isRepeatEnabledRef.current) {
        clearAutoplayTimer();
        setAutoPlaying(false);
        return;
      }

      const nextMeasureIndex = isLastMeasure ? 0 : currentIndex + 1;

      goToMeasureFromAutoplay(nextMeasureIndex);

      if (nextMeasureIndex >= measuresRef.current.length - 1 && !isRepeatEnabledRef.current) {
        clearAutoplayTimer();
        setAutoPlaying(false);
        return;
      }

      scheduleNextAutoplayStep(nextMeasureIndex);
    }, getMeasureDurationMs(currentAutoplayMeasure));
  }

  function startAutoplay() {
    if (!canEdit || isAutoPlaying || measures.length === 0) return;

    const startMeasureIndex = Math.min(measureIndexRef.current, measures.length - 1);

    setAutoPlaying(true);
    scheduleNextAutoplayStep(startMeasureIndex);
  }

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
        dispatchProject({
          type: PROJECT_ACTIONS.SET_PDF_FILE_NAME,
          fileName: syncStateRef.current.fileName,
        });
        dispatchSession({
          type: SESSION_ACTIONS.APPLY_SYNC_STATE,
          syncState: syncStateRef.current,
        });
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

        const mimeType = PDF_MIME_TYPE;
        const pdfBlob = new Blob([pdfBlobPart], { type: mimeType });

        teacherPdfBlobRef.current = pdfBlob;
        dispatchProject({
          type: PROJECT_ACTIONS.SET_PDF_METADATA,
          pdfMetadata: {
            fileName: nextPdf.fileName,
            mimeType,
          },
        });
        if (
          viewerModeRef.current === TEACHER_MODE ||
          studentPdfSourceRef.current === TEACHER_PDF_SOURCE
        ) {
          resetPdfRenderState();
        }
        setTeacherPdfUrl(URL.createObjectURL(pdfBlob));
        console.log('[socket] received pdf:state', nextPdf.fileName);
        console.table({
          ...debugSnapshotRef.current,
          label: 'socket pdf:state received',
          receivedFileName: nextPdf.fileName,
        });
      });

      socket.on('measures:state', (nextMeasures) => {
        const normalizedMeasures = prepareMeasuresForProject(nextMeasures);

        measuresRef.current = normalizedMeasures;
        dispatchProject({
          type: PROJECT_ACTIONS.REPLACE_MEASURES,
          measures: normalizedMeasures,
        });
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
            bsvInputRef={bsvInputRef}
            canEdit={canEdit}
            canSaveProject={Boolean(teacherPdfBlobRef.current)}
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
            onLoadBsvProject={loadBsvProject}
            onOpenBsvProject={openBsvProject}
            onOpenJson={() => jsonInputRef.current?.click()}
            onOpenPdf={openPdf}
            onPdfSelected={selectPdf}
            onSaveJson={saveJson}
            onSaveBsvProject={saveBsvProject}
            onSetMode={setMode}
            onSetRepeatEnabled={setRepeatEnabled}
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
                <label className="lyric-measure-row" key={measure.id}>
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

          <ScoreViewer
            canEdit={canEdit}
            displayMeasureIndex={displayMeasureIndex}
            displayPageNumber={displayPageNumber}
            draggedMeasureIndex={draggedMeasureIndex}
            isStudentPageView={isStudentPageView}
            measures={measures}
            mode={overlayMode}
            onDebugSnapshot={handleDebugSnapshot}
            onEndMeasureDrag={endMeasureDrag}
            onEndMeasureResize={endMeasureResize}
            onMoveMeasure={moveMeasure}
            onPageClick={addMeasure}
            onResizeMeasure={resizeMeasure}
            onSelectMeasure={setSelectedMeasureIndex}
            onStartMeasureDrag={startMeasureDrag}
            onStartMeasureResize={startMeasureResize}
            onTotalPagesChange={setTotalPages}
            pdfUrl={pdfUrl}
            renderResetVersion={pdfRenderResetVersion}
            resizedMeasureIndex={resizedMeasureIndex}
            selectedMeasureIndex={selectedMeasureIndex}
            studentPdfSource={studentPdfSource}
            studentViewMode={studentViewMode}
            viewerMode={viewerMode}
          />
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
  bsvInputRef,
  canEdit,
  canSaveProject,
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
  onLoadBsvProject,
  onOpenLyricEditor,
  onOpenBsvProject,
  onOpenJson,
  onOpenPdf,
  onPdfSelected,
  onSaveJson,
  onSaveBsvProject,
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
          <button disabled={!canSaveProject} onClick={onSaveBsvProject} type="button">
            프로젝트 저장 (.bsv)
          </button>
          <button onClick={onOpenBsvProject} type="button">
            프로젝트 열기 (.bsv)
          </button>
          <button onClick={onSaveJson}>💾 JSON 저장</button>
          <button onClick={onOpenJson}>📂 JSON 불러오기</button>
          <button onClick={onOpenLyricEditor}>가사 편집</button>

          <input
            accept=".bsv"
            className="file-input"
            onChange={onLoadBsvProject}
            ref={bsvInputRef}
            type="file"
          />

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

export default App;
