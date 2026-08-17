import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import { io } from 'socket.io-client';

import './App.css';
import LocalAudioPlayer from './components/LocalAudioPlayer.jsx';
import NavigationEditor from './components/NavigationEditor.jsx';
import NavigationMarkerLabel from './components/NavigationMarkerLabel.jsx';
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
  createEmptySharedSessionState,
  createInitialSessionState,
  getLogicalSyncState,
  getTeacherSyncState,
  INITIAL_SYNC_STATE,
  SESSION_ACTIONS,
  sessionReducer,
} from './state/sessionState.js';
import {
  NORMALIZED_COORDINATE_SPACE,
  NORMALIZED_COORDINATE_STATUS,
} from './utils/measureCoordinates.js';
import { resizeCanonicalMeasure } from './utils/measureResize.js';
import {
  getNavigationRepeatPolicy,
  NAVIGATION_MARKER_OPTIONS,
  NAVIGATION_REPEAT_POLICIES,
  NAVIGATION_REPEAT_POLICY_OPTIONS,
  setNavigationMarkerRepeatPolicy,
  supportsNavigationRepeatPolicy,
  toggleNavigationMarker,
} from './utils/navigationMarkers.js';
import { validateNavigationModel } from './utils/navigationValidation.js';
import {
  advancePlaybackProgression as advancePlaybackProgressionState,
  createPlaybackProgression,
  isPlaybackProgressionAtMeasure,
  rewindPlaybackProgression,
} from './utils/playbackResolver.js';
import {
  createMeasureRecognitionRuntimeDiagnostics,
  isCurrentMeasureRecognitionResult,
  prepareRecognizedMeasures,
} from './utils/measureRecognitionRuntime.js';
import { recognizeMeasuresInPdf } from './utils/pdfMeasureRecognition.js';
import { detectNavigationCandidatesInPdf } from './utils/pdfNavigationTextDetection.js';
import { applyLyricCandidates } from './utils/lyricRecognition.js';
import { recognizeLyricsInPdf } from './utils/pdfLyricRecognition.js';
import {
  createNavigationTextMeasureIdentity,
  isNavigationTextCandidateStateCurrent,
  reconcileNavigationTextCandidates,
} from './utils/navigationTextDetection.js';
import {
  createVocalViewModel,
  getMeaningfulLyric,
} from './utils/vocalPhrases.js';
import {
  createLanguagePhraseRequestId,
  createLanguagePhraseSourceKey,
  evaluateLanguagePhraseResolveResponse,
  getLanguagePhrasesForMeasures,
  LANGUAGE_PHRASE_EVENTS,
  LANGUAGE_PHRASE_RESOLVE_ACK_TIMEOUT_MS,
  validateLanguagePhraseState,
} from './utils/languagePhrases.js';
import {
  getFullscreenElement,
  isFullscreenSupported,
  toggleDocumentFullscreen,
} from './utils/fullscreen.js';
import { clampFloatingPanelPosition } from './utils/floatingPanel.js';
import {
  clampStudentAnnotationPageNumber,
  createStudentAnnotationDocumentKey,
  getStudentAnnotationStrokes,
  loadStudentAnnotationLibrary,
  removeLastStudentAnnotationStroke,
  removeStudentAnnotationPage,
  saveStudentAnnotationLibrary,
  setStudentAnnotationStrokes,
  STUDENT_ANNOTATION_PALETTE,
} from './utils/studentAnnotations.js';
import {
  DEFAULT_AUDIO_SETTINGS,
  getOpenableAudioUrl,
  getStudentAudioSettings,
  loadStudentAudioSettingsLibrary,
  normalizeAudioSettings,
  saveStudentAudioSettingsLibrary,
  setStudentAudioSettings,
} from './utils/audioSettings.js';
import {
  clearStudentAudioPickerRecovery,
  consumeStudentAudioPickerRecovery,
  isSupportedLocalAudioFile,
  LOCAL_AUDIO_FILE_ACCEPT,
  markStudentAudioPickerRecovery,
} from './utils/audioPlayback.js';
import {
  createLocalAudioIdentity,
  createAudioTimelineAnchor,
  createStudentAudioTimelineKey,
  getAudioTimelineAnchorMeasureIndex,
  getAudioTimelineFirstMeasureStartSeconds,
  getAudioTimelineMarkersFromAnchor,
  getAudioTimelinePlaybackTimings,
  getEffectiveAudioTimelineMarkers,
  getMeasureTimelineTiming,
  getMeasureTimelineTime,
  getStudentAudioTimelineMarkers,
  getStudentAudioTimelineTimings,
  loadStudentAudioTimelineLibrary,
  applyStudentAudioTimelineBpm,
  removeStudentAudioTimelineMarker,
  removeStudentAudioTimelineTiming,
  saveStudentAudioTimelineLibrary,
  setStudentAudioTimelineMarker,
  setStudentAudioTimelineTiming,
} from './utils/audioTimeline.js';
import {
  AUDIO_SOURCE_TYPES,
  createSharedAudioIdentity,
  getSelectedAudioAsset,
  getSharedAudioAssetUrl,
  isSupportedSharedAudioFile,
  normalizeSharedAudioMetadata,
  SHARED_AUDIO_EVENTS,
} from './utils/sharedAudio.js';
import {
  estimateServerClockOffsetMs,
  isPlaybackSnapshotForMetadata,
  normalizeSharedAudioPlaybackSnapshot,
  shouldAcceptPlaybackSnapshot,
  shouldFollowTeacherSharedAudio,
  STUDENT_SHARED_AUDIO_MODES,
} from './utils/sharedAudioPlayback.js';

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
const TEACHER_PAGE_VIEW = 'page';
const TEACHER_WIDTH_VIEW = 'width';
const TEACHER_AUDIO_SOURCE = AUDIO_SOURCE_TYPES.TEACHER_SHARED_LOCAL;
const LOCAL_AUDIO_SOURCE = AUDIO_SOURCE_TYPES.STUDENT_PERSONAL_LOCAL;
const SOCKET_PORT = import.meta.env.VITE_SOCKET_PORT || '4000';
const SOCKET_SERVER_URL =
  import.meta.env.VITE_SOCKET_SERVER_URL ||
  `${window.location.protocol}//${formatSocketHost(window.location.hostname)}:${SOCKET_PORT}`;
const SAME_ORIGIN_SOCKET_URL = window.location.origin;

const MIN_MEASURE_CANONICAL_SIZE = {
  height: 0.015,
  width: 0.02,
};

function createInitialLyricRecognitionState() {
  return {
    candidates: [],
    message: '',
    status: 'idle',
  };
}

function createInitialNavigationTextDetectionState({
  measureIdentity = '',
  pdfIdentity = '',
} = {}) {
  return {
    candidates: [],
    measureIdentity,
    message: '',
    pdfIdentity,
    status: 'idle',
  };
}

function getMeasureFileName(fileName) {
  return fileName ? fileName.replace(/\.pdf$/i, '.json') : 'measures.json';
}

function getProjectFileName(fileName) {
  return fileName
    ? `${fileName.replace(/\.pdf$/i, '')}.bsv`
    : 'band-score-viewer.bsv';
}

function getMeasureDurationMs(measure) {
  const bpm = getPositiveNumber(measure?.bpm, DEFAULT_MEASURE.bpm);
  const beats = getPositiveNumber(measure?.beats, DEFAULT_MEASURE.beats);

  // TODO: 향후 "Auto Advance Offset(ms)" 옵션을 추가하여 사용자가 +/-오프셋을 직접 조절할 수 있도록 확장 가능.
  return (60 / bpm) * beats * 1000;
}

function getProjectDefaultBpm(measures) {
  if (!Array.isArray(measures) || measures.length === 0) {
    return DEFAULT_MEASURE.bpm;
  }

  const bpmCounts = new Map();

  measures.forEach((measure) => {
    const bpm = getPositiveNumber(measure?.bpm, DEFAULT_MEASURE.bpm);

    bpmCounts.set(bpm, (bpmCounts.get(bpm) || 0) + 1);
  });

  return Array.from(bpmCounts.entries()).reduce(
    (mostCommon, candidate) =>
      candidate[1] > mostCommon[1] ? candidate : mostCommon,
    [getPositiveNumber(measures[0]?.bpm, DEFAULT_MEASURE.bpm), 0],
  )[0];
}

function formatSocketHost(hostname) {
  return hostname.includes(':') ? `[${hostname}]` : hostname;
}

function getBrowserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getBrowserSessionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
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

function getViewportGeometry() {
  const visualViewport = window.visualViewport;

  return {
    height:
      visualViewport?.height ||
      document.documentElement.clientHeight ||
      window.innerHeight,
    left: visualViewport?.offsetLeft || 0,
    top: visualViewport?.offsetTop || 0,
    width:
      visualViewport?.width ||
      document.documentElement.clientWidth ||
      window.innerWidth,
  };
}

function App() {
  const bsvInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const jsonInputRef = useRef(null);
  const studentAudioInputRef = useRef(null);
  const studentSharedAudioPlayerRef = useRef(null);
  const teacherSharedAudioInputRef = useRef(null);
  const teacherSharedAudioPanelRef = useRef(null);
  const teacherSharedAudioPanelDragRef = useRef(null);
  const studentPdfInputRef = useRef(null);
  const dragStateRef = useRef(null);
  const resizeStateRef = useRef(null);
  const studentPdfSourceRef = useRef(TEACHER_PDF_SOURCE);
  const viewerModeRef = useRef(ROLE_SELECT_MODE);
  const socketRef = useRef(null);
  const autoplayTimerRef = useRef(null);
  const autoplayTimerVersionRef = useRef(0);
  const isAutoPlayingRef = useRef(false);
  const playbackProgressionRef = useRef(null);
  const audioSettingsRef = useRef({ ...DEFAULT_AUDIO_SETTINGS });
  const projectDefaultBpmRef = useRef(DEFAULT_MEASURE.bpm);
  const isRepeatEnabledRef = useRef(false);
  const returnToStartOnEndRef = useRef(false);
  const measuresRef = useRef([]);
  const measureIndexRef = useRef(0);
  const measureRecognitionVersionRef = useRef(0);
  const lyricRecognitionVersionRef = useRef(0);
  const navigationTextDetectionVersionRef = useRef(0);
  const pageNumberRef = useRef(1);
  const pdfObjectUrlRef = useRef('');
  const teacherPdfObjectUrlRef = useRef('');
  const teacherPdfBlobRef = useRef(null);
  const studentAudioDocumentKeyRef = useRef('');
  const studentAudioPlaybackMeasureIdRef = useRef('');
  const studentLocalAudioObjectUrlRef = useRef('');
  const studentAudioSeekVersionRef = useRef(0);
  const debugSnapshotRef = useRef({});
  const shouldPublishMeasuresRef = useRef(false);
  const syncStateRef = useRef({ ...INITIAL_SYNC_STATE });
  const sharedAudioMetadataRef = useRef(null);
  const sharedAudioPlaybackStateRef = useRef(null);
  const serverClockOffsetMsRef = useRef(0);

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
  const [recoverStudentAudioPicker] = useState(() =>
    consumeStudentAudioPickerRecovery(getBrowserSessionStorage()),
  );
  const [totalPages, setTotalPages] = useState(0);
  const [pdfUrl, setPdfUrl] = useState('');
  const [selectedMeasureIndex, setSelectedMeasureIndex] = useState(-1);
  const [draggedMeasureIndex, setDraggedMeasureIndex] = useState(-1);
  const [resizedMeasureIndex, setResizedMeasureIndex] = useState(-1);
  const [mode, setMode] = useState(REGISTER_MODE);
  const [isLyricEditorOpen, setIsLyricEditorOpen] = useState(false);
  const [measureRecognitionState, setMeasureRecognitionState] = useState({
    currentPage: 0,
    message: '',
    status: 'idle',
    totalPages: 0,
  });
  const [lyricRecognitionState, setLyricRecognitionState] = useState(
    createInitialLyricRecognitionState,
  );
  const [navigationTextDetectionState, setNavigationTextDetectionState] =
    useState(createInitialNavigationTextDetectionState);
  const [languagePhraseState, setLanguagePhraseState] = useState(null);
  const [languagePhraseMutationState, setLanguagePhraseMutationState] = useState({
    message: '',
    status: 'idle',
  });
  const [pendingNavigationDecision, setPendingNavigationDecision] =
    useState(null);
  const [pdfRenderResetVersion, setPdfRenderResetVersion] = useState(0);
  const [studentViewMode, setStudentViewMode] = useState(STUDENT_ZOOM_VIEW);
  const [teacherViewMode, setTeacherViewMode] = useState(TEACHER_PAGE_VIEW);
  const [studentPdfSource, setStudentPdfSource] = useState(TEACHER_PDF_SOURCE);
  const [studentLocalPdfIdentity, setStudentLocalPdfIdentity] = useState('');
  const [studentAnnotationLibrary, setStudentAnnotationLibrary] = useState(() =>
    loadStudentAnnotationLibrary(getBrowserStorage()),
  );
  const [studentAnnotationColor, setStudentAnnotationColor] = useState(
    STUDENT_ANNOTATION_PALETTE[0].value,
  );
  const [studentAnnotationPageNumber, setStudentAnnotationPageNumber] =
    useState(1);
  const [studentAnnotationMeasureIndex, setStudentAnnotationMeasureIndex] =
    useState(0);
  const [isStudentAnnotationEnabled, setIsStudentAnnotationEnabled] =
    useState(false);
  const [isStudentAudioPanelOpen, setIsStudentAudioPanelOpen] = useState(
    recoverStudentAudioPicker,
  );
  const [studentAudioSource, setStudentAudioSource] = useState(
    recoverStudentAudioPicker ? LOCAL_AUDIO_SOURCE : TEACHER_AUDIO_SOURCE,
  );
  const [studentSharedAudioMode, setStudentSharedAudioMode] = useState(
    STUDENT_SHARED_AUDIO_MODES.PRACTICE,
  );
  const [studentSharedAudioFollowMessage, setStudentSharedAudioFollowMessage] =
    useState('');
  const [studentAudioSettingsLibrary, setStudentAudioSettingsLibrary] =
    useState(() => loadStudentAudioSettingsLibrary(getBrowserStorage()));
  const [studentAudioTimelineLibrary, setStudentAudioTimelineLibrary] =
    useState(() => loadStudentAudioTimelineLibrary(getBrowserStorage()));
  const [studentAudioTargetMeasureIndex, setStudentAudioTargetMeasureIndex] =
    useState(-1);
  const [studentAudioPlaybackMeasureId, setStudentAudioPlaybackMeasureId] =
    useState('');
  const [isStudentAudioFollowEnabled, setIsStudentAudioFollowEnabled] =
    useState(true);
  const [studentUseTeacherTempo, setStudentUseTeacherTempo] = useState(true);
  const [studentUseTeacherTimelineAnchor, setStudentUseTeacherTimelineAnchor] =
    useState(true);
  const [studentAudioSeekRequest, setStudentAudioSeekRequest] = useState(null);
  const [studentLocalAudioFileName, setStudentLocalAudioFileName] = useState('');
  const [studentLocalAudioFile, setStudentLocalAudioFile] = useState(null);
  const [studentLocalAudioUrl, setStudentLocalAudioUrl] = useState('');
  const [sharedAudioMetadata, setSharedAudioMetadata] = useState(null);
  const [sharedAudioPlaybackState, setSharedAudioPlaybackState] = useState(null);
  const [sharedAudioPlaybackSyncVersion, setSharedAudioPlaybackSyncVersion] =
    useState(0);
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const [sharedAudioServerUrl, setSharedAudioServerUrl] = useState(
    SOCKET_SERVER_URL,
  );
  const [sharedAudioWaveformFile, setSharedAudioWaveformFile] = useState(null);
  const [sharedAudioLoadError, setSharedAudioLoadError] = useState('');
  const [sharedAudioMutationState, setSharedAudioMutationState] = useState({
    message: '',
    status: 'idle',
  });
  const [isTeacherSharedAudioPanelOpen, setIsTeacherSharedAudioPanelOpen] =
    useState(false);
  const [isTeacherSharedAudioPanelDragging, setIsTeacherSharedAudioPanelDragging] =
    useState(false);
  const [teacherSharedAudioPanelPosition, setTeacherSharedAudioPanelPosition] =
    useState(null);
  const [projectDefaultBpm, setProjectDefaultBpm] = useState(
    DEFAULT_MEASURE.bpm,
  );
  const [viewerMode, setViewerMode] = useState(
    recoverStudentAudioPicker ? STUDENT_MODE : ROLE_SELECT_MODE,
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { audioSettings, measures, pdfMetadata } = projectState;
  const fileName = pdfMetadata.fileName;
  const {
    isAutoPlaying,
    isRepeatEnabled,
    measureIndex,
    pageNumber,
    returnToStartOnEnd,
    syncState,
  } = sessionState;

  const canEdit = viewerMode === TEACHER_MODE;
  const isTeacherPageView =
    viewerMode === TEACHER_MODE && teacherViewMode === TEACHER_PAGE_VIEW;
  const pdfViewMode = canEdit ? teacherViewMode : studentViewMode;
  const isStudentAnnotating =
    viewerMode === STUDENT_MODE && isStudentAnnotationEnabled;
  const synchronizedDisplayPageNumber = canEdit
    ? pageNumber
    : syncState.pageNumber;
  const synchronizedDisplayMeasureIndex = canEdit
    ? measureIndex
    : syncState.measureIndex;
  const teacherAnnotationDocumentKey = createStudentAnnotationDocumentKey({
    byteLength: teacherPdfBlobRef.current?.size,
    fileName: fileName || syncState.fileName,
    source: TEACHER_PDF_SOURCE,
  });
  const studentAnnotationDocumentKey =
    studentPdfSource === LOCAL_PDF_SOURCE
      ? studentLocalPdfIdentity
      : teacherAnnotationDocumentKey;
  const studentAnnotationStrokes = getStudentAnnotationStrokes(
    studentAnnotationLibrary,
    studentAnnotationDocumentKey,
  );
  const studentLocalAudioSettings = getStudentAudioSettings(
    studentAudioSettingsLibrary,
    studentAnnotationDocumentKey,
  );
  const sharedAudioIdentity = createSharedAudioIdentity(sharedAudioMetadata);
  const sharedAudioSettingsKey =
    studentAnnotationDocumentKey && sharedAudioIdentity
      ? `${studentAnnotationDocumentKey}|${sharedAudioIdentity}`
      : '';
  const studentSharedAudioSettings = getStudentAudioSettings(
    studentAudioSettingsLibrary,
    sharedAudioSettingsKey,
  );
  const studentDisplayAudioSettings =
    studentAudioSource === LOCAL_AUDIO_SOURCE
      ? studentLocalAudioSettings
      : audioSettings;
  const studentOpenableAudioUrl = getOpenableAudioUrl(
    studentDisplayAudioSettings.url,
  );
  const studentLocalAudioIdentity = createLocalAudioIdentity(studentLocalAudioFile);
  const sharedAudioUrl = getSharedAudioAssetUrl(
    sharedAudioMetadata,
    sharedAudioServerUrl,
  );
  const selectedStudentAudioAsset = getSelectedAudioAsset({
    personalAudioFile: studentLocalAudioFile,
    personalAudioFileName: studentLocalAudioFileName,
    personalAudioIdentity: studentLocalAudioIdentity,
    personalAudioUrl: studentLocalAudioUrl,
    selectedSource: studentAudioSource,
    sharedAudioFile: sharedAudioWaveformFile,
    sharedAudioMetadata,
    sharedAudioUrl,
  });
  const studentPlaybackAudioSettings =
    studentAudioSource === TEACHER_AUDIO_SOURCE
      ? studentSharedAudioSettings
      : studentLocalAudioSettings;
  const studentAudioTimelineKey = createStudentAudioTimelineKey(
    studentAnnotationDocumentKey,
    selectedStudentAudioAsset?.identity || '',
  );
  const studentAudioTimelineMarkers = useMemo(
    () =>
      getStudentAudioTimelineMarkers(
        studentAudioTimelineLibrary,
        studentAudioTimelineKey,
      ),
    [studentAudioTimelineKey, studentAudioTimelineLibrary],
  );
  const studentAudioTimelineTimings = useMemo(
    () =>
      getStudentAudioTimelineTimings(
        studentAudioTimelineLibrary,
        studentAudioTimelineKey,
      ),
    [studentAudioTimelineKey, studentAudioTimelineLibrary],
  );
  const isStudentSharedAudioFollowMode = shouldFollowTeacherSharedAudio({
    mode: studentSharedAudioMode,
    sourceType: selectedStudentAudioAsset?.type,
  });
  const studentAudioTimelinePlaybackTimings = useMemo(
    () =>
      getAudioTimelinePlaybackTimings(
        studentAudioTimelineTimings,
        studentUseTeacherTempo,
      ),
    [studentAudioTimelineTimings, studentUseTeacherTempo],
  );
  const firstMeasureId = measures[0]?.id || '';
  const studentPersonalFirstMeasureAnchorSeconds = getMeasureTimelineTime(
    studentAudioTimelineMarkers,
    firstMeasureId,
  );
  const canUseTeacherTimelineAnchor =
    selectedStudentAudioAsset?.type === TEACHER_AUDIO_SOURCE;
  const isUsingTeacherTimelineAnchor =
    canUseTeacherTimelineAnchor && studentUseTeacherTimelineAnchor;
  const studentAudioEffectiveMarkers = useMemo(
    () =>
      isUsingTeacherTimelineAnchor
        ? getAudioTimelineMarkersFromAnchor({
            anchor: sharedAudioMetadata?.timelineAnchor,
            measures,
            timings: studentAudioTimelinePlaybackTimings,
          })
        : getEffectiveAudioTimelineMarkers({
            markers: studentAudioTimelineMarkers,
            measures,
            timings: studentAudioTimelinePlaybackTimings,
          }),
    [
      isUsingTeacherTimelineAnchor,
      measures,
      sharedAudioMetadata?.timelineAnchor,
      studentAudioTimelineMarkers,
      studentAudioTimelinePlaybackTimings,
    ],
  );
  const studentAudioWaveformMarkers = useMemo(() => {
    const measureIndexById = new Map(
      measures.map((measure, index) => [measure.id, index]),
    );

    return studentAudioEffectiveMarkers
      .map((marker) => {
        const markerMeasureIndex = measureIndexById.get(marker.measureId);

        return Number.isInteger(markerMeasureIndex)
          ? { ...marker, measureNumber: markerMeasureIndex + 1 }
          : null;
      })
      .filter(Boolean);
  }, [measures, studentAudioEffectiveMarkers]);
  const studentAudioPlaybackMeasureIndex = measures.findIndex(
    (measure) => measure.id === studentAudioPlaybackMeasureId,
  );
  const studentAudioPlaybackMeasure =
    measures[studentAudioPlaybackMeasureIndex] || null;
  const canUseStudentMeasureAudio =
    viewerMode === STUDENT_MODE &&
    Boolean(selectedStudentAudioAsset?.sourceUrl && studentAudioTimelineKey);
  const isStudentAudioTimelineFollowEnabled =
    isStudentSharedAudioFollowMode || isStudentAudioFollowEnabled;
  const canEditStudentAudioTimeline =
    canUseStudentMeasureAudio && !isStudentSharedAudioFollowMode;
  const isStudentAudioFollowing = Boolean(
    canUseStudentMeasureAudio &&
      isStudentAudioTimelineFollowEnabled &&
      studentAudioPlaybackMeasure,
  );
  const displayPageNumber = isStudentAnnotating
    ? clampStudentAnnotationPageNumber(
        studentAnnotationPageNumber,
        totalPages,
      )
    : isStudentAudioFollowing
      ? studentAudioPlaybackMeasure.page
      : synchronizedDisplayPageNumber;
  const displayMeasureIndex = isStudentAnnotating
    ? studentAnnotationMeasureIndex
    : isStudentAudioFollowing
      ? studentAudioPlaybackMeasureIndex
      : synchronizedDisplayMeasureIndex;
  const languagePhraseSourceKey = useMemo(
    () => createLanguagePhraseSourceKey(measures),
    [measures],
  );
  const languagePhrases = useMemo(
    () => getLanguagePhrasesForMeasures(languagePhraseState, measures),
    [languagePhraseState, measures],
  );
  const vocalViewModel = useMemo(
    () =>
      createVocalViewModel(measures, displayMeasureIndex, {
        languagePhrases,
      }),
    [displayMeasureIndex, languagePhrases, measures],
  );
  const selectedMeasure = measures[selectedMeasureIndex] || null;
  const navigationMarkerValidation = useMemo(
    () => validateNavigationModel(measures),
    [measures],
  );
  const navigationTextMeasureIdentity = useMemo(
    () => createNavigationTextMeasureIdentity(measures),
    [measures],
  );
  const navigationTextPdfIdentity = teacherPdfObjectUrlRef.current || '';
  const navigationTextStateIsCurrent =
    isNavigationTextCandidateStateCurrent(navigationTextDetectionState, {
      measureIdentity: navigationTextMeasureIdentity,
      pdfIdentity: navigationTextPdfIdentity,
    });
  const navigationTextCandidates = useMemo(
    () =>
      navigationTextStateIsCurrent
        ? reconcileNavigationTextCandidates(
            navigationTextDetectionState.candidates,
            measures,
          )
        : [],
    [
      measures,
      navigationTextDetectionState.candidates,
      navigationTextStateIsCurrent,
    ],
  );
  const navigationTextDetectionUiState = navigationTextStateIsCurrent
    ? {
        ...navigationTextDetectionState,
        candidates: navigationTextCandidates,
      }
    : createInitialNavigationTextDetectionState({
        measureIdentity: navigationTextMeasureIdentity,
        pdfIdentity: navigationTextPdfIdentity,
      });
  const teacherSharedAudioAnchorMeasureIndex =
    getAudioTimelineAnchorMeasureIndex(
      sharedAudioMetadata?.timelineAnchor,
      measures,
    );
  const teacherSharedAudioFirstMeasureTime =
    getAudioTimelineFirstMeasureStartSeconds({
      anchor: sharedAudioMetadata?.timelineAnchor,
      measures,
      timings: [],
    });
  const overlayMode = canEdit ? mode : PLAY_MODE;
  const configuredAudioTargetMeasure = measures[studentAudioTargetMeasureIndex];
  const audioTargetMeasureIndex =
    configuredAudioTargetMeasure?.page === displayPageNumber
      ? studentAudioTargetMeasureIndex
      : displayMeasureIndex;
  const audioTargetMeasure = measures[audioTargetMeasureIndex] || null;
  const audioTargetMeasureTime = getMeasureTimelineTime(
    studentAudioTimelineMarkers,
    audioTargetMeasure?.id,
  );
  const audioTargetTimelineTime = getMeasureTimelineTime(
    studentAudioEffectiveMarkers,
    audioTargetMeasure?.id,
  );
  const audioTargetPersonalTiming = getMeasureTimelineTiming(
    studentAudioTimelinePlaybackTimings,
    audioTargetMeasure?.id,
  );
  const audioTargetStoredPersonalTiming = getMeasureTimelineTiming(
    studentAudioTimelineTimings,
    audioTargetMeasure?.id,
  );
  const studentPersonalGlobalBpm =
    studentAudioTimelineTimings.length >= measures.length && measures.length > 0
      ? getProjectDefaultBpm(studentAudioTimelineTimings)
      : getProjectDefaultBpm(measures);
  const audioTargetBpm =
    audioTargetPersonalTiming?.bpm ||
    audioTargetMeasure?.bpm ||
    DEFAULT_MEASURE.bpm;
  const audioTargetBeats =
    audioTargetPersonalTiming?.beats ||
    audioTargetMeasure?.beats ||
    DEFAULT_MEASURE.beats;
  const studentPageAnnotationCount = studentAnnotationStrokes.filter(
    (stroke) => stroke.page === displayPageNumber,
  ).length;
  const fullscreenSupported = isFullscreenSupported(document);
  const openableAudioUrl = getOpenableAudioUrl(audioSettings.url);
  const handleDebugSnapshot = useCallback((snapshot) => {
    debugSnapshotRef.current = snapshot;
  }, []);

  async function toggleFullscreen() {
    try {
      await toggleDocumentFullscreen(document);
    } catch (error) {
      console.error('[fullscreen] failed', error);
    }
  }

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
    pageNumberRef.current = nextPageNumber;
    dispatchSession({
      type: SESSION_ACTIONS.SET_PAGE_NUMBER,
      pageNumber: nextPageNumber,
    });
    publishSyncState({ pageNumber: nextPageNumber });
  }

  function setSyncedMeasureIndex(nextMeasureIndex) {
    measureIndexRef.current = nextMeasureIndex;
    dispatchSession({
      type: SESSION_ACTIONS.SET_MEASURE_INDEX,
      measureIndex: nextMeasureIndex,
    });
    publishSyncState({ measureIndex: nextMeasureIndex });
  }

  function setAutoPlaying(nextIsAutoPlaying) {
    isAutoPlayingRef.current = nextIsAutoPlaying;
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

  function setReturnToStartOnEnd(nextReturnToStartOnEnd) {
    const normalizedValue = Boolean(nextReturnToStartOnEnd);

    returnToStartOnEndRef.current = normalizedValue;
    dispatchSession({
      type: SESSION_ACTIONS.SET_RETURN_TO_START_ON_END,
      returnToStartOnEnd: normalizedValue,
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

  const publishCurrentTeacherPosition = useCallback((targetSocket) => {
    const nextSyncState = getTeacherSyncState(
      syncStateRef.current,
      pageNumberRef.current,
      measureIndexRef.current,
    );

    syncStateRef.current = nextSyncState;
    dispatchSession({
      type: SESSION_ACTIONS.APPLY_SYNC_STATE,
      syncState: nextSyncState,
    });
    (targetSocket || socketRef.current)?.emit('sync:update', nextSyncState);
    console.log('[sync] published current Teacher position', nextSyncState);
  }, []);

  const publishCurrentTeacherAudioSettings = useCallback((targetSocket) => {
    (targetSocket || socketRef.current)?.emit(
      'audio:update',
      audioSettingsRef.current,
    );
  }, []);

  const selectViewerMode = useCallback((nextViewerMode) => {
    // TODO: 향후 Teacher 선택 시 인증/비밀번호 검사를 이 지점에 연결.
    if (nextViewerMode === viewerMode) {
      if (nextViewerMode === TEACHER_MODE) {
        publishCurrentTeacherPosition();
        publishCurrentTeacherAudioSettings();
      }
      return;
    }

    resetViewRenderState();
    setIsLyricEditorOpen(false);
    setIsStudentAnnotationEnabled(false);
    viewerModeRef.current = nextViewerMode;

    if (nextViewerMode === TEACHER_MODE) {
      publishCurrentTeacherPosition();
      publishCurrentTeacherAudioSettings();
    }

    setViewerMode(nextViewerMode);
  }, [
    publishCurrentTeacherAudioSettings,
    publishCurrentTeacherPosition,
    resetViewRenderState,
    viewerMode,
  ]);

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
    setIsStudentAnnotationEnabled(false);
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
    setIsStudentAnnotationEnabled(false);
    setStudentLocalPdfIdentity(
      createStudentAnnotationDocumentKey({
        byteLength: file.size,
        fileName: file.name,
        lastModified: file.lastModified,
        source: LOCAL_PDF_SOURCE,
      }),
    );
    setStudentPdfSource(LOCAL_PDF_SOURCE);
    resetPdfRenderState();
    setLocalPdfUrl(URL.createObjectURL(file));
  }

  function publishMeasures(nextMeasures) {
    socketRef.current?.emit('measures:update', normalizeMeasures(nextMeasures));
  }

  function updateStudentAnnotationDocument(updateStrokes) {
    if (!studentAnnotationDocumentKey) return;

    setStudentAnnotationLibrary((previousLibrary) => {
      const previousStrokes = getStudentAnnotationStrokes(
        previousLibrary,
        studentAnnotationDocumentKey,
      );

      return setStudentAnnotationStrokes(
        previousLibrary,
        studentAnnotationDocumentKey,
        updateStrokes(previousStrokes),
      );
    });
  }

  function addStudentAnnotationStroke(stroke) {
    if (viewerMode !== STUDENT_MODE || !isStudentAnnotationEnabled) return;

    updateStudentAnnotationDocument((previousStrokes) => [
      ...previousStrokes,
      stroke,
    ]);
  }

  function toggleStudentAnnotation() {
    if (isStudentAnnotationEnabled) {
      setIsStudentAnnotationEnabled(false);
      return;
    }

    setStudentAnnotationPageNumber(
      clampStudentAnnotationPageNumber(syncState.pageNumber, totalPages),
    );
    setStudentAnnotationMeasureIndex(syncState.measureIndex);
    setIsStudentAnnotationEnabled(true);
  }

  function moveStudentAnnotationPage(offset) {
    setStudentAnnotationPageNumber((currentPageNumber) =>
      clampStudentAnnotationPageNumber(
        currentPageNumber + offset,
        totalPages,
      ),
    );
  }

  function undoStudentAnnotation() {
    updateStudentAnnotationDocument((previousStrokes) =>
      removeLastStudentAnnotationStroke(
        previousStrokes,
        displayPageNumber,
      ),
    );
  }

  function clearStudentAnnotationPage() {
    if (
      studentPageAnnotationCount === 0 ||
      !window.confirm('현재 페이지의 필기를 모두 지울까요?')
    ) {
      return;
    }

    updateStudentAnnotationDocument((previousStrokes) =>
      removeStudentAnnotationPage(previousStrokes, displayPageNumber),
    );
  }

  function applySharedSessionReset() {
    const emptySessionState = createEmptySharedSessionState();
    const wasShowingTeacherPdf =
      viewerModeRef.current === TEACHER_MODE ||
      studentPdfSourceRef.current === TEACHER_PDF_SOURCE;

    stopAutoplay();
    measureRecognitionVersionRef.current += 1;
    lyricRecognitionVersionRef.current += 1;
    navigationTextDetectionVersionRef.current += 1;
    dragStateRef.current = null;
    resizeStateRef.current = null;
    measuresRef.current = [];
    measureIndexRef.current = 0;
    pageNumberRef.current = 1;
    isRepeatEnabledRef.current = false;
    returnToStartOnEndRef.current = false;
    shouldPublishMeasuresRef.current = false;
    syncStateRef.current = emptySessionState.syncState;
    audioSettingsRef.current = emptySessionState.audioSettings;
    projectDefaultBpmRef.current = DEFAULT_MEASURE.bpm;
    sharedAudioMetadataRef.current = null;
    sharedAudioPlaybackStateRef.current = null;
    teacherPdfBlobRef.current = null;

    dispatchProject({
      type: PROJECT_ACTIONS.RESET_PROJECT,
      pdfMetadata: {
        fileName: '',
        mimeType: PDF_MIME_TYPE,
      },
    });
    dispatchSession({ type: SESSION_ACTIONS.RESET_POSITION });
    dispatchSession({
      type: SESSION_ACTIONS.SET_REPEAT_ENABLED,
      isRepeatEnabled: false,
    });
    dispatchSession({
      type: SESSION_ACTIONS.SET_RETURN_TO_START_ON_END,
      returnToStartOnEnd: false,
    });
    dispatchSession({
      type: SESSION_ACTIONS.APPLY_SYNC_STATE,
      syncState: emptySessionState.syncState,
    });
    setSelectedMeasureIndex(-1);
    setDraggedMeasureIndex(-1);
    setResizedMeasureIndex(-1);
    setIsLyricEditorOpen(false);
    setMeasureRecognitionState({
      currentPage: 0,
      message: '',
      status: 'idle',
      totalPages: 0,
    });
    setLyricRecognitionState(createInitialLyricRecognitionState());
    setLanguagePhraseState(null);
    setLanguagePhraseMutationState({ message: '', status: 'idle' });
    setIsStudentAnnotationEnabled(false);
    setSharedAudioMetadata(null);
    setSharedAudioPlaybackState(null);
    setSharedAudioPlaybackSyncVersion((version) => version + 1);
    setStudentSharedAudioMode(STUDENT_SHARED_AUDIO_MODES.PRACTICE);
    setStudentUseTeacherTempo(true);
    setStudentUseTeacherTimelineAnchor(true);
    setStudentSharedAudioFollowMessage('');
    setSharedAudioWaveformFile(null);
    setSharedAudioLoadError('');
    setSharedAudioMutationState({ message: '', status: 'idle' });
    setIsTeacherSharedAudioPanelOpen(false);
    teacherSharedAudioPanelDragRef.current = null;
    setIsTeacherSharedAudioPanelDragging(false);
    setTeacherSharedAudioPanelPosition(null);
    setProjectDefaultBpm(DEFAULT_MEASURE.bpm);
    setMode(REGISTER_MODE);
    setTeacherPdfUrl('');

    if (wasShowingTeacherPdf) {
      resetPdfRenderState();
    }
  }

  function endClassSession() {
    if (
      !canEdit ||
      !window.confirm(
        '현재 수업을 종료할까요? 선생님 PDF와 마디 정보가 모든 화면에서 초기화됩니다.',
      )
    ) {
      return;
    }

    applySharedSessionReset();
    socketRef.current?.emit('session:reset');
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
    measureRecognitionVersionRef.current += 1;
    lyricRecognitionVersionRef.current += 1;
    navigationTextDetectionVersionRef.current += 1;
    setMeasureRecognitionState({
      currentPage: 0,
      message: '',
      status: 'idle',
      totalPages: 0,
    });
    setLyricRecognitionState(createInitialLyricRecognitionState());

    const mimeType = PDF_MIME_TYPE;

    dragStateRef.current = null;
    resizeStateRef.current = null;
    measuresRef.current = [];
    audioSettingsRef.current = { ...DEFAULT_AUDIO_SETTINGS };
    projectDefaultBpmRef.current = DEFAULT_MEASURE.bpm;
    teacherPdfBlobRef.current = file;
    dispatchProject({
      type: PROJECT_ACTIONS.RESET_PROJECT,
      pdfMetadata: {
        fileName: file.name,
        mimeType,
      },
    });
    publishMeasures([]);
    socketRef.current?.emit('audio:update', audioSettingsRef.current);
    setSyncedMeasureIndex(0);
    setProjectDefaultBpm(DEFAULT_MEASURE.bpm);
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
      const nextDefaultBpm = getProjectDefaultBpm(nextMeasures);

      lyricRecognitionVersionRef.current += 1;
      setLyricRecognitionState(createInitialLyricRecognitionState());
      projectDefaultBpmRef.current = nextDefaultBpm;
      setProjectDefaultBpm(nextDefaultBpm);
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
    const nextAudioSettings = nextProjectState.audioSettings;
    const nextFileName = nextProjectState.pdfMetadata.fileName;
    const nextMimeType = nextProjectState.pdfMetadata.mimeType;
    const nextDefaultBpm = getProjectDefaultBpm(nextMeasures);

    stopAutoplay();
    measureRecognitionVersionRef.current += 1;
    lyricRecognitionVersionRef.current += 1;
    navigationTextDetectionVersionRef.current += 1;
    setMeasureRecognitionState({
      currentPage: 0,
      message: '',
      status: 'idle',
      totalPages: 0,
    });
    setLyricRecognitionState(createInitialLyricRecognitionState());
    dragStateRef.current = null;
    resizeStateRef.current = null;
    measuresRef.current = nextMeasures;
    measureIndexRef.current = 0;
    pageNumberRef.current = 1;
    isRepeatEnabledRef.current = false;
    shouldPublishMeasuresRef.current = false;
    audioSettingsRef.current = nextAudioSettings;
    projectDefaultBpmRef.current = nextDefaultBpm;
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
    setProjectDefaultBpm(nextDefaultBpm);
    setStudentPdfSource(TEACHER_PDF_SOURCE);
    resetPdfRenderState();
    setTeacherPdfUrl(nextPdfUrl);

    publishPdfData(preparedProject.pdfBytes, nextFileName, nextMimeType);
    publishMeasures(nextMeasures);
    socketRef.current?.emit('audio:update', nextAudioSettings);
    publishSyncState({
      fileName: nextFileName,
      measureIndex: 0,
      pageNumber: 1,
    });

    event.target.value = '';
  }

  async function recognizePdfMeasures() {
    const pdfBlob = teacherPdfBlobRef.current;

    if (!canEdit || !pdfBlob || measureRecognitionState.status === 'running') {
      return;
    }

    if (
      measures.length > 0 &&
      !window.confirm(
        '현재 마디를 자동인식 결과로 교체할까요? 기존 마디 편집 내용은 사라집니다.',
      )
    ) {
      return;
    }

    stopAutoplay();
    lyricRecognitionVersionRef.current += 1;
    navigationTextDetectionVersionRef.current += 1;
    setLyricRecognitionState(createInitialLyricRecognitionState());
    const recognitionVersion = measureRecognitionVersionRef.current + 1;

    measureRecognitionVersionRef.current = recognitionVersion;
    setMeasureRecognitionState({
      currentPage: 0,
      message: 'PDF 분석을 준비하고 있습니다.',
      status: 'running',
      totalPages: 0,
    });

    try {
      const pageDiagnostics = [];
      const candidates = await recognizeMeasuresInPdf(pdfBlob, {
        onPageDiagnostics: import.meta.env.DEV
          ? (diagnostics) => {
              pageDiagnostics.push(diagnostics);
            }
          : undefined,
        onProgress: ({ currentPage, totalPages: recognitionTotalPages }) => {
          setMeasureRecognitionState({
            currentPage,
            message: `${currentPage} / ${recognitionTotalPages} 페이지 분석 중`,
            status: 'running',
            totalPages: recognitionTotalPages,
          });
        },
      });

      if (
        !isCurrentMeasureRecognitionResult({
          currentPdfBlob: teacherPdfBlobRef.current,
          currentVersion: measureRecognitionVersionRef.current,
          requestedPdfBlob: pdfBlob,
          requestedVersion: recognitionVersion,
        })
      ) {
        return;
      }

      if (candidates.length === 0) {
        setMeasureRecognitionState({
          currentPage: 0,
          message: '마디 후보를 찾지 못했습니다.',
          status: 'error',
          totalPages: 0,
        });
        return;
      }

      const nextMeasures = prepareRecognizedMeasures(
        candidates,
        projectDefaultBpmRef.current,
      );
      const firstPageNumber = Number(nextMeasures[0]?.page) || 1;

      if (import.meta.env.DEV) {
        const runtimeDiagnostics = createMeasureRecognitionRuntimeDiagnostics({
          appliedMeasures: nextMeasures,
          fileName,
          pageDiagnostics,
          recognizedMeasures: candidates,
        });

        window.__BSV_MEASURE_RECOGNITION_DEBUG__ = runtimeDiagnostics;
        console.log('[MeasureRecognitionRuntime]', {
          appliedByPage: runtimeDiagnostics.appliedByPage,
          appliedTotal: runtimeDiagnostics.appliedTotal,
          fileName: runtimeDiagnostics.fileName,
          pages: pageDiagnostics.map((page) => ({
            generatedRegionCount: page.generatedRegionCount,
            pageNumber: page.pageNumber,
            raster: page.raster,
            systemRegionCounts: page.systems.map(
              (system) => system.regionCount,
            ),
          })),
          recognizedByPage: runtimeDiagnostics.recognizedByPage,
          recognizedTotal: runtimeDiagnostics.recognizedTotal,
        });
      }

      measuresRef.current = nextMeasures;
      dragStateRef.current = null;
      resizeStateRef.current = null;
      dispatchMeasureUpdate({
        type: PROJECT_ACTIONS.REPLACE_MEASURES,
        measures: nextMeasures,
      });
      setSelectedMeasureIndex(-1);
      setDraggedMeasureIndex(-1);
      setResizedMeasureIndex(-1);
      setMode(REGISTER_MODE);
      setSyncedPageNumber(firstPageNumber);
      setSyncedMeasureIndex(0);
      setMeasureRecognitionState({
        currentPage: 0,
        message: `${nextMeasures.length}개 마디 후보 생성 완료`,
        status: 'complete',
        totalPages: 0,
      });
    } catch (error) {
      console.error('[measure-recognition] failed', error);
      setMeasureRecognitionState({
        currentPage: 0,
        message: '마디 자동인식에 실패했습니다.',
        status: 'error',
        totalPages: 0,
      });
      window.alert(
        `마디 자동인식에 실패했습니다.\n${error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'}`,
      );
    }
  }

  async function detectPdfNavigationText() {
    const pdfBlob = teacherPdfBlobRef.current;

    if (
      !canEdit ||
      !pdfBlob ||
      measuresRef.current.length === 0 ||
      navigationTextDetectionState.status === 'running' ||
      measureRecognitionState.status === 'running'
    ) {
      return;
    }

    const detectionVersion = navigationTextDetectionVersionRef.current + 1;
    const requestedMeasureIdentity = createNavigationTextMeasureIdentity(
      measuresRef.current,
    );
    const requestedPdfIdentity = teacherPdfObjectUrlRef.current || '';

    navigationTextDetectionVersionRef.current = detectionVersion;
    setNavigationTextDetectionState({
      candidates: [],
      measureIdentity: requestedMeasureIdentity,
      message: 'PDF Navigation 텍스트와 기호를 분석하고 있습니다.',
      pdfIdentity: requestedPdfIdentity,
      status: 'running',
    });

    try {
      const result = await detectNavigationCandidatesInPdf(
        pdfBlob,
        measuresRef.current,
        {
          onPageDiagnostics: import.meta.env.DEV
            ? (diagnostics) => {
                console.info('[NavigationCandidateDetection] page', diagnostics);
              }
            : undefined,
          onProgress: ({ currentPage, totalPages: detectionTotalPages }) => {
            if (
              navigationTextDetectionVersionRef.current !== detectionVersion
            ) {
              return;
            }

            setNavigationTextDetectionState({
              candidates: [],
              measureIdentity: requestedMeasureIdentity,
              message: `${currentPage} / ${detectionTotalPages} 페이지 Navigation 분석 중`,
              pdfIdentity: requestedPdfIdentity,
              status: 'running',
            });
          },
        },
      );

      if (
        navigationTextDetectionVersionRef.current !== detectionVersion ||
        teacherPdfBlobRef.current !== pdfBlob ||
        teacherPdfObjectUrlRef.current !== requestedPdfIdentity ||
        createNavigationTextMeasureIdentity(measuresRef.current) !==
          requestedMeasureIdentity
      ) {
        return;
      }

      if (import.meta.env.DEV) {
        const runtimeDiagnostics = {
          candidates: result.candidates,
          diagnostics: result.diagnostics,
          extractedTextItemCount: result.extractedTextItemCount,
        };

        window.__BSV_NAVIGATION_TEXT_DETECTION_DEBUG__ = runtimeDiagnostics;
        result.candidates.forEach((candidate) => {
          const logLabel = candidate.source === 'pdf-text'
            ? '[NavigationTextDetection]'
            : '[NavigationGraphicDetection]';

          console.info(logLabel, {
            associatedMeasure:
              candidate.measureIndex >= 0
                ? `M${candidate.measureIndex + 1}`
                : null,
            canonicalType: candidate.type,
            classification: candidate.evidence.classification?.category || null,
            confidence: candidate.confidence,
            evidence: candidate.evidence,
            page: candidate.pageNumber,
            passes: candidate.passes || null,
            raw: candidate.rawText,
            source: candidate.source,
          });

          if (
            candidate.source === 'pdf-graphics' &&
            candidate.type.startsWith('repeat-')
          ) {
            console.info(
              '[RepeatDetectionDebug]',
              JSON.stringify({
                candidate: candidate.type,
                evidence: candidate.evidence,
                measure: candidate.measureIndex + 1,
                page: candidate.pageNumber,
              }),
            );
          }
        });
      }

      if (
        result.extractedTextItemCount === 0 &&
        result.candidates.length === 0
      ) {
        setNavigationTextDetectionState({
          candidates: [],
          measureIdentity: requestedMeasureIdentity,
          message:
            '지원하는 Navigation 텍스트나 기호 후보를 찾지 못했습니다. 스캔 문자 OCR은 지원하지 않습니다.',
          pdfIdentity: requestedPdfIdentity,
          status: 'error',
        });
        return;
      }

      const unmappedCount = result.candidates.filter(
        (candidate) => !candidate.measureId,
      ).length;
      const unmappedMessage = unmappedCount
        ? ` 위치 불확실 ${unmappedCount}개.`
        : '';

      setNavigationTextDetectionState({
        candidates: result.candidates,
        measureIdentity: requestedMeasureIdentity,
        message: result.candidates.length
          ? `Navigation 후보 ${result.candidates.length}개를 찾았습니다.${unmappedMessage}`
          : '지원하는 Navigation 후보를 찾지 못했습니다.',
        pdfIdentity: requestedPdfIdentity,
        status: 'complete',
      });
    } catch (error) {
      if (navigationTextDetectionVersionRef.current !== detectionVersion) {
        return;
      }

      console.error('[NavigationTextDetection] failed', error);
      setNavigationTextDetectionState({
        candidates: [],
        measureIdentity: requestedMeasureIdentity,
        message: `Navigation 후보 탐지에 실패했습니다. ${
          error instanceof Error ? error.message : ''
        }`.trim(),
        pdfIdentity: requestedPdfIdentity,
        status: 'error',
      });
    }
  }

  async function recognizePdfLyrics() {
    const pdfBlob = teacherPdfBlobRef.current;

    if (
      !canEdit ||
      !pdfBlob ||
      measures.length === 0 ||
      lyricRecognitionState.status === 'running' ||
      measureRecognitionState.status === 'running'
    ) {
      return;
    }

    const recognitionVersion = lyricRecognitionVersionRef.current + 1;

    lyricRecognitionVersionRef.current = recognitionVersion;
    setLyricRecognitionState({
      candidates: [],
      message: 'PDF 가사 텍스트를 분석하고 있습니다.',
      status: 'running',
    });

    try {
      const result = await recognizeLyricsInPdf(pdfBlob, measuresRef.current, {
        onPageDiagnostics: (diagnostics) => {
          if (import.meta.env.DEV) {
            console.info('[LyricRecognitionRuntime]', diagnostics);
          }
        },
        onProgress: ({ currentPage, totalPages: recognitionTotalPages }) => {
          setLyricRecognitionState({
            candidates: [],
            message: `${currentPage} / ${recognitionTotalPages} 페이지 가사 분석 중`,
            status: 'running',
          });
        },
      });

      if (
        lyricRecognitionVersionRef.current !== recognitionVersion ||
        teacherPdfBlobRef.current !== pdfBlob
      ) {
        return;
      }

      if (result.extractedTextItemCount === 0) {
        setLyricRecognitionState({
          candidates: [],
          message:
            '이 PDF에서 추출 가능한 가사 텍스트를 찾지 못했습니다. 스캔 PDF는 OCR이 필요합니다.',
          status: 'error',
        });
        return;
      }

      if (result.candidates.length === 0) {
        setLyricRecognitionState({
          candidates: [],
          message: '오선 아래에서 Measure에 연결할 가사 후보를 찾지 못했습니다.',
          status: 'error',
        });
        return;
      }

      const existingLyricCount = result.candidates.filter((candidate) => {
        const measure = measuresRef.current.find(
          (currentMeasure) => currentMeasure.id === candidate.measureId,
        );

        return Boolean(measure?.lyric?.trim());
      }).length;
      const preservationMessage = existingLyricCount
        ? ` 기존 가사 ${existingLyricCount}개는 적용 시 유지합니다.`
        : '';

      setLyricRecognitionState({
        candidates: result.candidates,
        message: `${measuresRef.current.length}개 마디 중 ${result.candidates.length}개 마디에서 가사 후보를 찾았습니다.${preservationMessage}`,
        status: 'ready',
      });
    } catch (error) {
      console.error('[lyric-recognition] failed', error);
      setLyricRecognitionState({
        candidates: [],
        message: `가사 자동인식에 실패했습니다. ${error instanceof Error ? error.message : ''}`.trim(),
        status: 'error',
      });
    }
  }

  function applyRecognizedLyrics() {
    if (!canEdit || lyricRecognitionState.status !== 'ready') return;

    const result = applyLyricCandidates(
      measuresRef.current,
      lyricRecognitionState.candidates,
    );

    measuresRef.current = result.measures;
    dispatchMeasureUpdate({
      type: PROJECT_ACTIONS.REPLACE_MEASURES,
      measures: result.measures,
    });
    setLyricRecognitionState({
      candidates: [],
      message: `${result.appliedCount}개 가사 적용 완료${
        result.preservedCount ? `, 기존 가사 ${result.preservedCount}개 유지` : ''
      }`,
      status: 'complete',
    });
  }

  function cancelRecognizedLyrics() {
    lyricRecognitionVersionRef.current += 1;
    setLyricRecognitionState(createInitialLyricRecognitionState());
  }

  function resolveLanguagePhrases() {
    if (
      !canEdit ||
      languagePhraseMutationState.status === 'running' ||
      !measures.some((measure) => getMeaningfulLyric(measure))
    ) {
      return;
    }

    const socket = socketRef.current;

    if (!socket?.connected) {
      setLanguagePhraseMutationState({
        message: '실시간 서버에 연결된 뒤 다시 시도해주세요.',
        status: 'error',
      });
      return;
    }

    setLanguagePhraseMutationState({
      message: '가사 문맥을 분석하고 있습니다...',
      status: 'running',
    });
    const requestId = createLanguagePhraseRequestId();

    if (import.meta.env.DEV) {
      console.log(`[LanguagePhraseRequest ${requestId}] client emit`);
    }

    socket.timeout(LANGUAGE_PHRASE_RESOLVE_ACK_TIMEOUT_MS).emit(
      LANGUAGE_PHRASE_EVENTS.RESOLVE,
      { requestId },
      (timeoutError, response) => {
        const result = evaluateLanguagePhraseResolveResponse({
          measures: measuresRef.current,
          response,
          transportError: timeoutError,
        });

        if (import.meta.env.DEV) {
          console.log(
            `[LanguagePhraseRequest ${requestId}] client ${
              result.accepted ? 'accepted' : 'rejected'
            }`,
            {
              reason: result.reason,
              responseRequestId: response?.requestId || '',
              responseStatus: response?.status || '',
            },
          );
        }

        if (!result.accepted) {
          setLanguagePhraseMutationState({
            message:
              result.reason === 'stale-source'
                ? result.message
                : `${result.message} 기존 Phrase를 계속 사용합니다.`,
            status: 'error',
          });
          return;
        }

        const nextState = result.state;

        setLanguagePhraseState(nextState);
        setLanguagePhraseMutationState(
          nextState.fallbackWindowCount > 0
            ? {
                message: `AI를 적용하지 못한 ${nextState.fallbackWindowCount}개 구간은 기존 Phrase를 사용합니다.`,
                status: 'error',
              }
            : nextState.displayCueFallbackCount > 0
              ? {
                  message: `${nextState.displayCueFallbackCount}개 표시 구간은 기존 Phrase 표시를 사용합니다.`,
                  status: 'error',
                }
            : {
                message: `${nextState.candidatePhraseCount}개 Phrase → ${nextState.phraseCount}개 문장 Phrase로 정리${
                  response.fromCache ? ' (캐시)' : ''
                }`,
                status: 'complete',
              },
        );
      },
    );
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
      bpm: projectDefaultBpmRef.current,
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

  function startMeasureResize(index, direction, event, highlightRect) {
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
      startMeasure: {
        height: measure.height,
        width: measure.width,
        x: measure.x,
        y: measure.y,
      },
      direction,
    };

    setSelectedMeasureIndex(index);
    setResizedMeasureIndex(index);
  }

  function resizeMeasure(event) {
    const resizeState = resizeStateRef.current;

    if (!resizeState || resizeState.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();

    const resizedMeasure = resizeCanonicalMeasure({
      deltaX: (event.clientX - resizeState.startClientX) / resizeState.scaleX,
      deltaY: (event.clientY - resizeState.startClientY) / resizeState.scaleY,
      direction: resizeState.direction,
      measure: resizeState.startMeasure,
      minimumHeight: MIN_MEASURE_CANONICAL_SIZE.height,
      minimumWidth: MIN_MEASURE_CANONICAL_SIZE.width,
    });

    dispatchMeasureUpdate({
      type: PROJECT_ACTIONS.UPDATE_MEASURE,
      index: resizeState.index,
      changes: {
        coordinateHeight: resizeState.coordinateHeight,
        coordinateWidth: resizeState.coordinateWidth,
        ...resizedMeasure,
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

  function toggleSelectedMeasureNavigationMarker(type) {
    if (!canEdit || isAutoPlaying || selectedMeasureIndex < 0 || !selectedMeasure) {
      return;
    }

    dispatchMeasureUpdate({
      type: PROJECT_ACTIONS.UPDATE_MEASURE,
      index: selectedMeasureIndex,
      changes: {
        navigationMarkers: toggleNavigationMarker(
          selectedMeasure.navigationMarkers,
          type,
        ),
      },
    });
    playbackProgressionRef.current = null;
    setPendingNavigationDecision(null);
  }

  function updateSelectedMeasureNavigationRepeatPolicy(type, repeatPolicy) {
    if (
      !canEdit ||
      isAutoPlaying ||
      selectedMeasureIndex < 0 ||
      !selectedMeasure ||
      !supportsNavigationRepeatPolicy(type)
    ) {
      return;
    }

    dispatchMeasureUpdate({
      type: PROJECT_ACTIONS.UPDATE_MEASURE,
      index: selectedMeasureIndex,
      changes: {
        navigationMarkers: setNavigationMarkerRepeatPolicy(
          selectedMeasure.navigationMarkers,
          type,
          repeatPolicy,
        ),
      },
    });
    playbackProgressionRef.current = null;
    setPendingNavigationDecision(null);
  }

  function replaceNavigationMeasures(nextMeasures) {
    if (!canEdit || isAutoPlaying || !Array.isArray(nextMeasures)) return;

    dispatchMeasureUpdate({
      type: PROJECT_ACTIONS.REPLACE_MEASURES,
      measures: nextMeasures,
    });
    playbackProgressionRef.current = null;
    setPendingNavigationDecision(null);
  }

  function applyTeacherGlobalBpm(value) {
    if (!canEdit || measures.length === 0) return;

    const nextBpm = getPositiveNumber(value, 0);

    if (!nextBpm) {
      window.alert('전체 템포는 0보다 큰 숫자로 입력해주세요.');
      return;
    }

    projectDefaultBpmRef.current = nextBpm;
    setProjectDefaultBpm(nextBpm);
    dispatchMeasureUpdate({
      type: PROJECT_ACTIONS.APPLY_BPM_TO_ALL_MEASURES,
      bpm: nextBpm,
    });
  }

  function updateAudioSettings(changes) {
    if (!canEdit) return;

    const nextAudioSettings = normalizeAudioSettings({
      ...audioSettingsRef.current,
      ...changes,
    });

    audioSettingsRef.current = nextAudioSettings;
    dispatchProject({
      type: PROJECT_ACTIONS.SET_AUDIO_SETTINGS,
      audioSettings: nextAudioSettings,
    });
    socketRef.current?.emit('audio:update', nextAudioSettings);
  }

  function openAudioSettingsLink(settings) {
    const url = getOpenableAudioUrl(settings.url);

    if (!url) {
      window.alert('http 또는 https로 시작하는 음원 링크를 입력해주세요.');
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function openAudioLink() {
    openAudioSettingsLink(audioSettings);
  }

  function openTeacherSharedAudioPicker() {
    teacherSharedAudioInputRef.current?.click();
  }

  function getClampedTeacherSharedAudioPanelPosition(left, top) {
    const panel = teacherSharedAudioPanelRef.current;

    if (!panel) return null;

    const panelRect = panel.getBoundingClientRect();
    const viewport = getViewportGeometry();

    return clampFloatingPanelPosition({
      left,
      panelHeight: panelRect.height,
      panelWidth: panelRect.width,
      top,
      viewportHeight: viewport.height,
      viewportLeft: viewport.left,
      viewportTop: viewport.top,
      viewportWidth: viewport.width,
    });
  }

  function startTeacherSharedAudioPanelDrag(event) {
    if (
      (event.pointerType === 'mouse' && event.button !== 0) ||
      event.target.closest('button, input, select, textarea, a, label')
    ) {
      return;
    }

    const panel = teacherSharedAudioPanelRef.current;

    if (!panel) return;

    const panelRect = panel.getBoundingClientRect();

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    teacherSharedAudioPanelDragRef.current = {
      grabOffsetX: event.clientX - panelRect.left,
      grabOffsetY: event.clientY - panelRect.top,
      pointerId: event.pointerId,
    };
    setIsTeacherSharedAudioPanelDragging(true);
  }

  function moveTeacherSharedAudioPanel(event) {
    const dragState = teacherSharedAudioPanelDragRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) return;

    event.preventDefault();
    const nextPosition = getClampedTeacherSharedAudioPanelPosition(
      event.clientX - dragState.grabOffsetX,
      event.clientY - dragState.grabOffsetY,
    );

    if (nextPosition) setTeacherSharedAudioPanelPosition(nextPosition);
  }

  function endTeacherSharedAudioPanelDrag(event) {
    const dragState = teacherSharedAudioPanelDragRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    teacherSharedAudioPanelDragRef.current = null;
    setIsTeacherSharedAudioPanelDragging(false);
  }

  function publishTeacherSharedAudioPlayback(playbackState, sourceMetadata) {
    const metadata = sharedAudioMetadataRef.current;

    if (
      !metadata ||
      sourceMetadata?.assetId !== metadata.assetId ||
      sourceMetadata?.revision !== metadata.revision ||
      !socketRef.current?.connected
    ) {
      return;
    }

    socketRef.current.emit(SHARED_AUDIO_EVENTS.PLAYBACK_UPDATE, {
      ...playbackState,
      assetId: metadata.assetId,
      revision: metadata.revision,
    });
  }

  function updateTeacherSharedAudioTimelineAnchor(timelineAnchor) {
    const metadata = sharedAudioMetadataRef.current;
    const socket = socketRef.current;

    if (!metadata || !socket?.connected) {
      window.alert('마디 시작 위치를 저장하려면 실시간 서버 연결이 필요합니다.');
      return;
    }

    setSharedAudioMutationState({
      message: '공용 음원의 마디 시작 위치를 저장하고 있습니다.',
      status: 'working',
    });
    socket.timeout(10_000).emit(
      SHARED_AUDIO_EVENTS.TIMELINE_ANCHOR_UPDATE,
      {
        assetId: metadata.assetId,
        revision: metadata.revision,
        timelineAnchor,
      },
      (error, response) => {
        if (error || !response?.ok) {
          const message =
            response?.message ||
            (error
              ? '마디 시작 위치 저장 서버가 응답하지 않습니다. Socket 서버를 재시작해주세요.'
              : '마디 시작 위치를 저장하지 못했습니다.');

          setSharedAudioMutationState({ message, status: 'error' });
          window.alert(message);
          return;
        }

        setSharedAudioMutationState({
          message:
            timelineAnchor === null
              ? '공용 음원의 마디 시작 위치를 해제했습니다.'
              : '공용 음원의 마디 시작 위치를 저장했습니다.',
          status: 'success',
        });
      },
    );
  }

  function setTeacherSharedAudioTimelineAnchor({
    measureNumber,
    positionSeconds,
  }) {
    const timelineAnchor = createAudioTimelineAnchor({
      measureNumber,
      measures: measuresRef.current,
      positionSeconds,
    });

    if (!timelineAnchor) {
      window.alert(
        `기준 마디는 1부터 ${measuresRef.current.length} 사이의 정수로 입력해주세요.`,
      );
      return;
    }

    updateTeacherSharedAudioTimelineAnchor(timelineAnchor);
  }

  async function selectTeacherSharedAudio(event) {
    const file = event.target.files[0];

    event.target.value = '';
    if (!file) return;
    if (!isSupportedSharedAudioFile(file)) {
      window.alert(
        '브라우저가 audio MIME 형식으로 인식하는 100MB 이하 음원 파일을 선택해주세요.',
      );
      return;
    }

    const socket = socketRef.current;

    if (!socket?.connected) {
      window.alert('공용 음원을 등록하려면 실시간 서버 연결이 필요합니다.');
      return;
    }

    setSharedAudioMutationState({
      message: '공용 음원을 서버에 등록하고 있습니다.',
      status: 'working',
    });

    try {
      const data = await file.arrayBuffer();

      socket.timeout(60_000).emit(
        SHARED_AUDIO_EVENTS.UPDATE,
        {
          data,
          fileName: file.name,
          mimeType: file.type,
        },
        (error, response) => {
          if (error || !response?.ok) {
            const message =
              response?.message ||
              '공용 음원을 등록하지 못했습니다. 서버 연결을 확인해주세요.';

            setSharedAudioMutationState({ message, status: 'error' });
            window.alert(message);
            return;
          }

          const normalizedMetadata = normalizeSharedAudioMetadata(
            response.metadata,
          );

          sharedAudioMetadataRef.current = normalizedMetadata;
          setSharedAudioMetadata(normalizedMetadata);
          setSharedAudioMutationState({
            message: '공용 음원이 등록되었습니다.',
            status: 'success',
          });
          setIsTeacherSharedAudioPanelOpen(true);
        },
      );
    } catch (error) {
      console.error('[shared-audio] file read failed', error);
      setSharedAudioMutationState({
        message: '음원 파일을 읽지 못했습니다.',
        status: 'error',
      });
    }
  }

  function removeTeacherSharedAudio() {
    if (
      !sharedAudioMetadata ||
      !window.confirm('현재 선생님 공유 음원을 제거할까요?')
    ) {
      return;
    }

    const socket = socketRef.current;

    if (!socket?.connected) {
      window.alert('공용 음원을 제거하려면 실시간 서버 연결이 필요합니다.');
      return;
    }

    setSharedAudioMutationState({
      message: '공용 음원을 제거하고 있습니다.',
      status: 'working',
    });
    socket.timeout(10_000).emit(
      SHARED_AUDIO_EVENTS.REMOVE,
      (error, response) => {
        if (error || !response?.ok) {
          const message = '공용 음원을 제거하지 못했습니다.';

          setSharedAudioMutationState({ message, status: 'error' });
          window.alert(message);
          return;
        }

        setSharedAudioMetadata(null);
        sharedAudioMetadataRef.current = null;
        sharedAudioPlaybackStateRef.current = null;
        setSharedAudioPlaybackState(null);
        setSharedAudioPlaybackSyncVersion((version) => version + 1);
        setSharedAudioMutationState({
          message: '공용 음원이 제거되었습니다.',
          status: 'success',
        });
        setIsTeacherSharedAudioPanelOpen(false);
      },
    );
  }

  function updateStudentLocalAudioSettings(changes) {
    if (!studentAnnotationDocumentKey) return;

    setStudentAudioSettingsLibrary((previousLibrary) =>
      setStudentAudioSettings(previousLibrary, studentAnnotationDocumentKey, {
        ...getStudentAudioSettings(
          previousLibrary,
          studentAnnotationDocumentKey,
        ),
        ...changes,
      }),
    );
  }

  function updateStudentPlaybackAudioSettings(changes) {
    const settingsKey =
      studentAudioSource === TEACHER_AUDIO_SOURCE
        ? sharedAudioSettingsKey
        : studentAnnotationDocumentKey;

    if (!settingsKey) return;

    setStudentAudioSettingsLibrary((previousLibrary) =>
      setStudentAudioSettings(previousLibrary, settingsKey, {
        ...getStudentAudioSettings(previousLibrary, settingsKey),
        ...changes,
      }),
    );
  }

  function clearStudentLocalAudioFile() {
    if (studentLocalAudioObjectUrlRef.current) {
      URL.revokeObjectURL(studentLocalAudioObjectUrlRef.current);
      studentLocalAudioObjectUrlRef.current = '';
    }

    setStudentLocalAudioFileName('');
    setStudentLocalAudioFile(null);
    setStudentLocalAudioUrl('');
    studentAudioPlaybackMeasureIdRef.current = '';
    setStudentAudioPlaybackMeasureId('');
    setStudentAudioSeekRequest(null);
    setStudentAudioTargetMeasureIndex(-1);
    if (studentAudioInputRef.current) {
      studentAudioInputRef.current.value = '';
    }
    clearStudentAudioPickerRecovery(getBrowserSessionStorage());
  }

  function beginStudentLocalAudioSelection() {
    markStudentAudioPickerRecovery(getBrowserSessionStorage());
  }

  function cancelStudentLocalAudioSelection() {
    clearStudentAudioPickerRecovery(getBrowserSessionStorage());
  }

  function selectStudentLocalAudio(event) {
    const file = event.target.files[0];

    clearStudentAudioPickerRecovery(getBrowserSessionStorage());
    if (!file) return;

    event.target.value = '';
    if (!isSupportedLocalAudioFile(file)) {
      window.alert('MP3, M4A, AAC, WAV, OGG 또는 FLAC 음원 파일을 선택해주세요.');
      return;
    }

    clearStudentLocalAudioFile();
    const nextAudioUrl = URL.createObjectURL(file);

    studentLocalAudioObjectUrlRef.current = nextAudioUrl;
    setStudentLocalAudioFile(file);
    setStudentLocalAudioFileName(file.name);
    setStudentLocalAudioUrl(nextAudioUrl);
    setStudentAudioSource(LOCAL_AUDIO_SOURCE);
    setStudentAudioTargetMeasureIndex(displayMeasureIndex);
  }

  function toggleStudentAudioPanel() {
    const shouldOpen = !isStudentAudioPanelOpen;

    if (shouldOpen) {
      setIsStudentAnnotationEnabled(false);
      setStudentAudioTargetMeasureIndex(displayMeasureIndex);
    }
    setIsStudentAudioPanelOpen(shouldOpen);
  }

  function selectStudentAudioSource(nextSource) {
    if (nextSource === studentAudioSource) return;

    studentAudioPlaybackMeasureIdRef.current = '';
    setStudentAudioPlaybackMeasureId('');
    setStudentAudioSeekRequest(null);
    setStudentAudioTargetMeasureIndex(displayMeasureIndex);
    setStudentSharedAudioMode(STUDENT_SHARED_AUDIO_MODES.PRACTICE);
    setStudentSharedAudioFollowMessage('');
    setStudentAudioSource(nextSource);
  }

  async function startStudentSharedAudioFollow() {
    setStudentSharedAudioMode(STUDENT_SHARED_AUDIO_MODES.FOLLOW);
    setStudentSharedAudioFollowMessage('');

    const playbackSnapshot = sharedAudioPlaybackStateRef.current;

    if (!playbackSnapshot) {
      setStudentSharedAudioFollowMessage(
        'Teacher의 공용 음원 재생 상태를 기다리는 중입니다.',
      );
      return;
    }

    const result = await studentSharedAudioPlayerRef.current?.applyExternalPlayback(
      playbackSnapshot,
      {
        allowPlay: true,
        clockOffsetMs: serverClockOffsetMsRef.current,
        forceSeek: true,
        prepareWhenPaused: true,
      },
    );

    if (result?.ok) {
      setStudentSharedAudioFollowMessage('Teacher의 현재 재생 위치에 합류했습니다.');
    }
  }

  function startStudentSharedAudioPractice() {
    setStudentSharedAudioMode(STUDENT_SHARED_AUDIO_MODES.PRACTICE);
    setStudentSharedAudioFollowMessage('개인 연습에서는 재생을 직접 조작할 수 있습니다.');
  }

  function handleStudentSharedAudioPlaybackBlocked(message) {
    setStudentSharedAudioFollowMessage(message);
  }

  function activateStudentAudioMeasure(nextMeasureIndex) {
    if (!canUseStudentMeasureAudio) return;

    const measure = measures[nextMeasureIndex];

    if (!measure) return;

    setStudentAudioTargetMeasureIndex(nextMeasureIndex);
    const markerTime = getMeasureTimelineTime(
      studentAudioEffectiveMarkers,
      measure.id,
    );

    if (markerTime === null) {
      setIsStudentAudioPanelOpen(true);
      return;
    }

    studentAudioSeekVersionRef.current += 1;
    setStudentAudioSeekRequest({
      playAfterSeek: true,
      timeSeconds: markerTime,
      version: studentAudioSeekVersionRef.current,
    });
  }

  function setStudentMeasureAudioTime(measureId, timeSeconds) {
    if (!studentAudioTimelineKey) return;

    setStudentAudioTimelineLibrary((previousLibrary) =>
      setStudentAudioTimelineMarker(previousLibrary, studentAudioTimelineKey, {
        measureId,
        timeSeconds,
      }),
    );
  }

  function updateStudentFirstMeasureAnchor(timeSeconds) {
    if (
      !firstMeasureId ||
      isStudentSharedAudioFollowMode ||
      isUsingTeacherTimelineAnchor
    ) {
      return;
    }

    if (timeSeconds === null) {
      removeStudentMeasureAudioTime(firstMeasureId);
      return;
    }

    setStudentMeasureAudioTime(firstMeasureId, timeSeconds);
  }

  function removeStudentMeasureAudioTime(measureId) {
    if (!studentAudioTimelineKey) return;

    setStudentAudioTimelineLibrary((previousLibrary) =>
      removeStudentAudioTimelineMarker(
        previousLibrary,
        studentAudioTimelineKey,
        measureId,
      ),
    );
  }

  function updateStudentAudioTimelineMeasure(measureId) {
    if (!measureId) {
      if (!studentAudioPlaybackMeasureIdRef.current) return;

      studentAudioPlaybackMeasureIdRef.current = '';
      setStudentAudioPlaybackMeasureId('');
      return;
    }

    const nextMeasureIndex = measures.findIndex(
      (measure) => measure.id === measureId,
    );

    if (nextMeasureIndex < 0) {
      studentAudioPlaybackMeasureIdRef.current = '';
      setStudentAudioPlaybackMeasureId('');
      return;
    }

    if (studentAudioPlaybackMeasureIdRef.current === measureId) return;

    studentAudioPlaybackMeasureIdRef.current = measureId;
    setStudentAudioPlaybackMeasureId(measureId);
    setStudentAudioTargetMeasureIndex(nextMeasureIndex);
  }

  function updateStudentAudioFollowEnabled(nextIsEnabled) {
    setIsStudentAudioFollowEnabled(nextIsEnabled);
    if (!nextIsEnabled) {
      studentAudioPlaybackMeasureIdRef.current = '';
      setStudentAudioPlaybackMeasureId('');
    }
  }

  function updateStudentMeasureAudioTiming(measureId, timing) {
    if (
      !studentAudioTimelineKey ||
      !measureId ||
      isStudentSharedAudioFollowMode ||
      studentUseTeacherTempo
    ) {
      return;
    }

    const measure = measures.find((candidate) => candidate.id === measureId);

    if (!measure) return;

    const previousTiming = getMeasureTimelineTiming(
      studentAudioTimelineTimings,
      measureId,
    );
    const fallbackBpm = previousTiming?.bpm || measure.bpm || DEFAULT_MEASURE.bpm;
    const fallbackBeats =
      previousTiming?.beats || measure.beats || DEFAULT_MEASURE.beats;

    setStudentAudioTimelineLibrary((previousLibrary) =>
      setStudentAudioTimelineTiming(previousLibrary, studentAudioTimelineKey, {
        beats: getPositiveNumber(timing.beats, fallbackBeats),
        bpm: getPositiveNumber(timing.bpm, fallbackBpm),
        measureId,
      }),
    );
  }

  function resetStudentMeasureAudioTiming(measureId) {
    if (!studentAudioTimelineKey || !measureId) return;

    setStudentAudioTimelineLibrary((previousLibrary) =>
      removeStudentAudioTimelineTiming(
        previousLibrary,
        studentAudioTimelineKey,
        measureId,
      ),
    );
  }

  function applyStudentGlobalAudioBpm(value) {
    if (
      !studentAudioTimelineKey ||
      isStudentSharedAudioFollowMode ||
      studentUseTeacherTempo
    ) {
      return;
    }

    const nextBpm = getPositiveNumber(value, 0);

    if (!nextBpm) {
      window.alert('개인 전체 템포는 0보다 큰 숫자로 입력해주세요.');
      return;
    }

    setStudentAudioTimelineLibrary((previousLibrary) =>
      applyStudentAudioTimelineBpm(
        previousLibrary,
        studentAudioTimelineKey,
        measures,
        nextBpm,
      ),
    );
  }

  function openStudentAudioLink() {
    openAudioSettingsLink(studentDisplayAudioSettings);
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
    const nextMeasure = measuresRef.current[nextMeasureIndex];

    if (!nextMeasure) return;

    playbackProgressionRef.current = createPlaybackProgression(
      measuresRef.current,
      nextMeasureIndex,
    );
    setPendingNavigationDecision(null);

    if (nextMeasure.page !== pageNumberRef.current) {
      setSyncedPageNumber(nextMeasure.page);
    }

    setSyncedMeasureIndex(nextMeasureIndex);

    if (isAutoPlaying) {
      scheduleNextAutoplayStep(nextMeasureIndex);
    }
  }

  function clearAutoplayTimer() {
    autoplayTimerVersionRef.current += 1;

    if (!autoplayTimerRef.current) return;

    window.clearTimeout(autoplayTimerRef.current);
    autoplayTimerRef.current = null;
  }

  function stopAutoplay() {
    clearAutoplayTimer();
    playbackProgressionRef.current = null;
    setPendingNavigationDecision(null);
    setAutoPlaying(false);
  }

  function syncToPlaybackStep(playbackStep) {
    if (!playbackStep) return -1;

    const nextMeasureIndex = measuresRef.current.findIndex(
      (measure) => measure.id === playbackStep.measureId,
    );
    const nextMeasure = measuresRef.current[nextMeasureIndex];

    if (!nextMeasure) return -1;

    if (nextMeasure.page !== pageNumberRef.current) {
      setSyncedPageNumber(nextMeasure.page);
    }

    setSyncedMeasureIndex(nextMeasureIndex);
    return nextMeasureIndex;
  }

  function resetPlaybackProgression(nextMeasureIndex) {
    const nextProgression = createPlaybackProgression(
      measuresRef.current,
      nextMeasureIndex,
    );

    playbackProgressionRef.current = nextProgression;
    setPendingNavigationDecision(null);
    return nextProgression;
  }

  function getPlaybackProgressionAtCurrentMeasure() {
    const currentMeasure = measuresRef.current[measureIndexRef.current];
    const currentProgression = playbackProgressionRef.current;

    if (
      isPlaybackProgressionAtMeasure(currentProgression, currentMeasure)
    ) {
      return currentProgression;
    }

    return resetPlaybackProgression(measureIndexRef.current);
  }

  function advancePlayback(navigationDecisionOverride = null) {
    const currentProgression = getPlaybackProgressionAtCurrentMeasure();
    const result = advancePlaybackProgressionState(
      currentProgression,
      measuresRef.current,
      {
        loopAtEnd: isRepeatEnabledRef.current,
        navigationDecisionOverride,
        wasAutoPlaying: isAutoPlayingRef.current,
      },
    );

    playbackProgressionRef.current = result.progression;

    if (result.blocked && result.progression.runState.pendingNavigationDecision) {
      clearAutoplayTimer();
      setPendingNavigationDecision(
        result.progression.runState.pendingNavigationDecision,
      );
      if (isAutoPlayingRef.current) setAutoPlaying(false);

      return {
        blocked: true,
        ended: false,
        measureIndex: measureIndexRef.current,
      };
    }

    setPendingNavigationDecision(null);

    if (!result.didMove || !result.progression.runState.currentStep) {
      return {
        blocked: false,
        ended: result.progression.runState.ended,
        measureIndex: measureIndexRef.current,
      };
    }

    const nextMeasureIndex = syncToPlaybackStep(
      result.progression.runState.currentStep,
    );

    return {
      blocked: false,
      ended: nextMeasureIndex < 0,
      measureIndex: nextMeasureIndex,
    };
  }

  function resolvePendingNavigationDecision(option) {
    const pendingDecision = pendingNavigationDecision;

    if (!pendingDecision || !option?.repeatDecisions) return;

    const commandMeasureIndex = measuresRef.current.findIndex(
      (measure) => measure.id === pendingDecision.command.measureId,
    );

    if (
      commandMeasureIndex >= 0 &&
      [
        NAVIGATION_REPEAT_POLICIES.REPLAY,
        NAVIGATION_REPEAT_POLICIES.SKIP,
      ].includes(option.policy)
    ) {
      const nextMeasures = measuresRef.current.map((measure, index) =>
        index === commandMeasureIndex
          ? {
              ...measure,
              navigationMarkers: setNavigationMarkerRepeatPolicy(
                measure.navigationMarkers,
                pendingDecision.command.type,
                option.policy,
              ),
            }
          : measure,
      );

      measuresRef.current = nextMeasures;
      dispatchMeasureUpdate({
        type: PROJECT_ACTIONS.REPLACE_MEASURES,
        measures: nextMeasures,
      });
    }

    setPendingNavigationDecision(null);
    const result = advancePlayback({
      commandMeasureId: pendingDecision.command.measureId,
      repeatDecisions: option.repeatDecisions,
    });

    if (result.blocked || result.ended) return;

    if (pendingDecision.wasAutoPlaying) {
      setAutoPlaying(true);
      scheduleNextAutoplayStep(result.measureIndex);
    }
  }

  function advanceManualPlayback() {
    if (!canEdit || measuresRef.current.length === 0) return;

    if (isAutoPlaying) clearAutoplayTimer();

    const result = advancePlayback();

    if (result.blocked) return;

    if (result.ended) {
      if (isAutoPlaying) finishAutoplayAtEnd();
      return;
    }

    if (isAutoPlaying) scheduleNextAutoplayStep(result.measureIndex);
  }

  function goToPreviousPlaybackStep() {
    if (!canEdit || measuresRef.current.length === 0) return;

    if (isAutoPlaying) clearAutoplayTimer();
    setPendingNavigationDecision(null);

    const currentProgression = getPlaybackProgressionAtCurrentMeasure();
    const result = rewindPlaybackProgression(currentProgression);

    if (!result.didMove || !result.progression?.runState?.currentStep) {
      if (measureIndexRef.current > 0) {
        goToMeasure(measureIndexRef.current - 1);
      } else if (isAutoPlaying) {
        scheduleNextAutoplayStep(measureIndexRef.current);
      }
      return;
    }

    playbackProgressionRef.current = result.progression;
    const previousMeasureIndex = syncToPlaybackStep(
      result.progression.runState.currentStep,
    );

    if (isAutoPlaying && previousMeasureIndex >= 0) {
      scheduleNextAutoplayStep(previousMeasureIndex);
    }
  }

  function finishAutoplayAtEnd() {
    clearAutoplayTimer();
    setAutoPlaying(false);

    if (returnToStartOnEndRef.current) {
      const firstProgression = resetPlaybackProgression(0);
      syncToPlaybackStep(firstProgression.runState.currentStep);
    }
  }

  function scheduleNextAutoplayStep(currentIndex) {
    clearAutoplayTimer();

    const currentAutoplayMeasure = measuresRef.current[currentIndex];

    if (!currentAutoplayMeasure) {
      setAutoPlaying(false);
      return;
    }

    const timerVersion = autoplayTimerVersionRef.current;

    autoplayTimerRef.current = window.setTimeout(() => {
      if (timerVersion !== autoplayTimerVersionRef.current) return;

      const result = advancePlayback();

      if (result.blocked) return;

      if (result.ended) {
        finishAutoplayAtEnd();
        return;
      }

      scheduleNextAutoplayStep(result.measureIndex);
    }, getMeasureDurationMs(currentAutoplayMeasure));
  }

  function startAutoplay() {
    if (!canEdit || isAutoPlaying || measures.length === 0) return;

    const startMeasureIndex = Math.min(measureIndexRef.current, measures.length - 1);
    const currentMeasure = measuresRef.current[startMeasureIndex];
    const currentProgression = playbackProgressionRef.current;

    if (
      !isPlaybackProgressionAtMeasure(currentProgression, currentMeasure) ||
      currentProgression.runState.ended
    ) {
      resetPlaybackProgression(startMeasureIndex);
    }
    setAutoPlaying(true);
    scheduleNextAutoplayStep(startMeasureIndex);
  }

  useEffect(() => {
    let fallbackStarted = false;
    let activeSocket = null;

    function attachSocket(socket, label, serverUrl) {
      activeSocket = socket;
      socketRef.current = socket;
      setSharedAudioServerUrl(serverUrl);
      console.log(`[socket] connecting to ${label}`, socket.io.uri);

      socket.on('connect', () => {
        console.log(`[socket] connected to ${label}`, socket.id);

        const requestSentAtMs = Date.now();

        socket.emit(SHARED_AUDIO_EVENTS.CLOCK, (response) => {
          const nextOffset = estimateServerClockOffsetMs({
            requestSentAtMs,
            responseReceivedAtMs: Date.now(),
            serverTimeMs: response?.serverTimeMs,
          });

          serverClockOffsetMsRef.current = nextOffset;
          setServerClockOffsetMs(nextOffset);
          setSharedAudioPlaybackSyncVersion((version) => version + 1);
        });

        if (viewerModeRef.current === TEACHER_MODE) {
          publishCurrentTeacherPosition(socket);
          publishCurrentTeacherAudioSettings(socket);
        }
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

        attachSocket(fallbackSocket, 'same-origin', SAME_ORIGIN_SOCKET_URL);
      });

      socket.on('sync:state', (nextSyncState) => {
        if (viewerModeRef.current === TEACHER_MODE) {
          console.log('[socket] ignored remote sync:state while in Teacher mode');
          return;
        }

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

      socket.on(LANGUAGE_PHRASE_EVENTS.STATE, (nextState) => {
        setLanguagePhraseState(nextState || null);

        if (!nextState) {
          setLanguagePhraseMutationState((previousState) =>
            previousState.status === 'running'
              ? previousState
              : { message: '', status: 'idle' },
          );
        }
      });

      socket.on('audio:state', (nextAudioSettings) => {
        if (viewerModeRef.current === TEACHER_MODE) {
          console.log('[socket] ignored remote audio:state while in Teacher mode');
          return;
        }

        const normalizedAudioSettings = normalizeAudioSettings(nextAudioSettings);

        audioSettingsRef.current = normalizedAudioSettings;
        dispatchProject({
          type: PROJECT_ACTIONS.SET_AUDIO_SETTINGS,
          audioSettings: normalizedAudioSettings,
        });
        console.log('[socket] received audio:state', normalizedAudioSettings);
      });

      socket.on(SHARED_AUDIO_EVENTS.STATE, (nextMetadata) => {
        const normalizedMetadata = normalizeSharedAudioMetadata(nextMetadata);
        const previousMetadata = sharedAudioMetadataRef.current;
        const didAssetChange =
          previousMetadata?.assetId !== normalizedMetadata?.assetId ||
          previousMetadata?.revision !== normalizedMetadata?.revision;

        sharedAudioMetadataRef.current = normalizedMetadata;
        setSharedAudioMetadata(normalizedMetadata);
        setSharedAudioLoadError('');
        if (didAssetChange) {
          sharedAudioPlaybackStateRef.current = null;
          setSharedAudioPlaybackState(null);
          setSharedAudioPlaybackSyncVersion((version) => version + 1);
          setStudentSharedAudioFollowMessage(
            normalizedMetadata
              ? '공용 음원이 교체되었습니다. 재생 상태를 기다리는 중입니다.'
              : '',
          );
        }
        setSharedAudioMutationState((previousState) =>
          previousState.status === 'working'
            ? { message: '', status: 'idle' }
            : previousState,
        );
        console.log('[socket] received shared-audio:state', normalizedMetadata);
      });

      socket.on(SHARED_AUDIO_EVENTS.PLAYBACK_STATE, (nextPlaybackState) => {
        if (nextPlaybackState === null) {
          sharedAudioPlaybackStateRef.current = null;
          setSharedAudioPlaybackState(null);
          setSharedAudioPlaybackSyncVersion((version) => version + 1);
          return;
        }

        const normalizedPlaybackState =
          normalizeSharedAudioPlaybackSnapshot(nextPlaybackState);

        if (
          !isPlaybackSnapshotForMetadata(
            normalizedPlaybackState,
            sharedAudioMetadataRef.current,
          ) ||
          !shouldAcceptPlaybackSnapshot(
            normalizedPlaybackState,
            sharedAudioPlaybackStateRef.current,
          )
        ) {
          console.warn(
            '[shared-audio] ignored stale or mismatched playback snapshot',
            nextPlaybackState,
          );
          return;
        }

        sharedAudioPlaybackStateRef.current = normalizedPlaybackState;
        setSharedAudioPlaybackState(normalizedPlaybackState);
        setSharedAudioPlaybackSyncVersion((version) => version + 1);
      });

      socket.on('session:reset', () => {
        console.log('[socket] received session:reset');
        applySharedSessionReset();
      });
    }

    attachSocket(
      io(SOCKET_SERVER_URL, {
        transports: ['websocket', 'polling'],
        timeout: 5000,
      }),
      'host-port',
      SOCKET_SERVER_URL,
    );

    return () => {
      activeSocket?.disconnect();
      socketRef.current = null;
    };
  }, [publishCurrentTeacherAudioSettings, publishCurrentTeacherPosition]);

  useEffect(() => {
    setLanguagePhraseState((previousState) =>
      validateLanguagePhraseState(previousState, measures),
    );
    setLanguagePhraseMutationState((previousState) =>
      previousState.status === 'running'
        ? previousState
        : { message: '', status: 'idle' },
    );
  }, [languagePhraseSourceKey, measures]);

  useEffect(() => {
    const shouldLoadWaveform = Boolean(
      sharedAudioUrl &&
        (viewerMode === TEACHER_MODE ||
          (viewerMode === STUDENT_MODE &&
            studentAudioSource === TEACHER_AUDIO_SOURCE)),
    );

    setSharedAudioWaveformFile(null);
    setSharedAudioLoadError('');
    if (!shouldLoadWaveform) return undefined;

    const controller = new AbortController();

    fetch(sharedAudioUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Shared audio request failed: ${response.status}`);
        }

        return response.blob();
      })
      .then((blob) => {
        if (!controller.signal.aborted) setSharedAudioWaveformFile(blob);
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;

        console.error('[shared-audio] waveform asset load failed', error);
        setSharedAudioLoadError(
          '공용 음원은 재생할 수 있지만 파형 데이터를 불러오지 못했습니다.',
        );
      });

    return () => controller.abort();
  }, [sharedAudioUrl, studentAudioSource, viewerMode]);

  useEffect(() => {
    const panel = teacherSharedAudioPanelRef.current;

    if (!canEdit || !sharedAudioMetadata || !panel) return undefined;

    function keepPanelAccessible() {
      const panelRect = panel.getBoundingClientRect();
      const nextPosition = getClampedTeacherSharedAudioPanelPosition(
        panelRect.left,
        panelRect.top,
      );

      if (!nextPosition) return;

      setTeacherSharedAudioPanelPosition((previousPosition) =>
        previousPosition?.left === nextPosition.left &&
        previousPosition?.top === nextPosition.top
          ? previousPosition
          : nextPosition,
      );
    }

    keepPanelAccessible();
    window.addEventListener('resize', keepPanelAccessible);
    window.visualViewport?.addEventListener('resize', keepPanelAccessible);
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(keepPanelAccessible);

    resizeObserver?.observe(panel);

    return () => {
      window.removeEventListener('resize', keepPanelAccessible);
      window.visualViewport?.removeEventListener('resize', keepPanelAccessible);
      resizeObserver?.disconnect();
    };
  }, [
    canEdit,
    isTeacherSharedAudioPanelOpen,
    sharedAudioMetadata,
  ]);

  useEffect(() => {
    if (!shouldPublishMeasuresRef.current) return;

    shouldPublishMeasuresRef.current = false;
    publishMeasures(measures);
  }, [measures]);

  useEffect(() => {
    measuresRef.current = measures;
  }, [measures]);

  useEffect(() => {
    setNavigationTextDetectionState((previousState) => {
      if (
        isNavigationTextCandidateStateCurrent(previousState, {
          measureIdentity: navigationTextMeasureIdentity,
          pdfIdentity: navigationTextPdfIdentity,
        })
      ) {
        return previousState;
      }

      navigationTextDetectionVersionRef.current += 1;
      return createInitialNavigationTextDetectionState({
        measureIdentity: navigationTextMeasureIdentity,
        pdfIdentity: navigationTextPdfIdentity,
      });
    });
  }, [navigationTextMeasureIdentity, navigationTextPdfIdentity]);

  useEffect(() => {
    audioSettingsRef.current = audioSettings;
  }, [audioSettings]);

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
      if (studentLocalAudioObjectUrlRef.current) {
        URL.revokeObjectURL(studentLocalAudioObjectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    viewerModeRef.current = viewerMode;

    if (viewerMode !== TEACHER_MODE) {
      stopAutoplay();
    }
    if (viewerMode !== STUDENT_MODE) {
      setIsStudentAnnotationEnabled(false);
      setIsStudentAudioPanelOpen(false);
      clearStudentLocalAudioFile();
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
    const previousDocumentKey = studentAudioDocumentKeyRef.current;

    studentAudioDocumentKeyRef.current = studentAnnotationDocumentKey;
    if (
      previousDocumentKey &&
      previousDocumentKey !== studentAnnotationDocumentKey
    ) {
      clearStudentLocalAudioFile();
    }
  }, [studentAnnotationDocumentKey]);

  useEffect(() => {
    if (
      !saveStudentAnnotationLibrary(
        getBrowserStorage(),
        studentAnnotationLibrary,
      )
    ) {
      console.warn('[annotations] local storage save failed');
    }
  }, [studentAnnotationLibrary]);

  useEffect(() => {
    if (
      !saveStudentAudioSettingsLibrary(
        getBrowserStorage(),
        studentAudioSettingsLibrary,
      )
    ) {
      console.warn('[audio] student local storage save failed');
    }
  }, [studentAudioSettingsLibrary]);

  useEffect(() => {
    if (
      !saveStudentAudioTimelineLibrary(
        getBrowserStorage(),
        studentAudioTimelineLibrary,
      )
    ) {
      console.warn('[audio] student timeline local storage save failed');
    }
  }, [studentAudioTimelineLibrary]);

  useEffect(() => {
    function updateFullscreenState() {
      setIsFullscreen(Boolean(getFullscreenElement(document)));
    }

    updateFullscreenState();
    document.addEventListener('fullscreenchange', updateFullscreenState);
    document.addEventListener('webkitfullscreenchange', updateFullscreenState);

    return () => {
      document.removeEventListener('fullscreenchange', updateFullscreenState);
      document.removeEventListener('webkitfullscreenchange', updateFullscreenState);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      const targetTagName = event.target.tagName;
      const isTyping =
        event.target.isContentEditable ||
        targetTagName === 'INPUT' ||
        targetTagName === 'TEXTAREA' ||
        targetTagName === 'SELECT';

      if (isTyping) return;

      if (
        viewerMode === STUDENT_MODE &&
        isStudentAnnotationEnabled &&
        event.key === 'Escape'
      ) {
        setIsStudentAnnotationEnabled(false);
        return;
      }

      if ((viewerMode === STUDENT_MODE || viewerMode === VOCAL_MODE) && event.key === 'Escape') {
        if (getFullscreenElement(document)) return;

        selectViewerMode(ROLE_SELECT_MODE);
        return;
      }

      if (event.key !== 'Backspace') return;

      deleteSelectedMeasure();
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    deleteSelectedMeasure,
    isStudentAnnotationEnabled,
    selectViewerMode,
    viewerMode,
  ]);

  return (
    <div
      className={`app ${
        viewerMode === ROLE_SELECT_MODE
          ? 'role-select-mode'
          : viewerMode === STUDENT_MODE
          ? `student-mode ${
              studentViewMode === STUDENT_PAGE_VIEW
                ? 'student-page-view page-fit-view'
                : 'student-zoom-view'
            }`
          : viewerMode === VOCAL_MODE
            ? 'vocal-mode'
            : `teacher-mode ${isTeacherPageView ? 'page-fit-view' : 'teacher-width-view'}`
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
            <FullscreenButton
              isFullscreen={isFullscreen}
              isSupported={fullscreenSupported}
              onToggle={toggleFullscreen}
            />
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
          <FullscreenButton
            isFullscreen={isFullscreen}
            isSupported={fullscreenSupported}
            onToggle={toggleFullscreen}
          />
        </div>
      )}

      {viewerMode === STUDENT_MODE && (
        <>
          <div
            className={`student-pdf-controls ${
              isStudentAudioPanelOpen ? 'audio-panel-open' : ''
            }`}
          >
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
            <div className="student-audio-control">
              <button
                aria-expanded={isStudentAudioPanelOpen}
                className={isStudentAudioPanelOpen ? 'active' : ''}
                onClick={toggleStudentAudioPanel}
                type="button"
              >
                음원 설정
              </button>
              <section
                aria-label="학생 음원 설정"
                className={`student-audio-panel ${
                  isStudentAudioPanelOpen ? '' : 'compact'
                }`}
                hidden={!isStudentAudioPanelOpen && !selectedStudentAudioAsset}
              >
                {isStudentAudioPanelOpen && (
                  <>
                    <div className="student-audio-panel-header">
                      <strong>음원 설정</strong>
                      <button
                        onClick={() => setIsStudentAudioPanelOpen(false)}
                        type="button"
                      >
                        닫기
                      </button>
                    </div>
                    <div className="student-audio-source-controls" role="group">
                      <button
                        aria-pressed={studentAudioSource === TEACHER_AUDIO_SOURCE}
                        className={
                          studentAudioSource === TEACHER_AUDIO_SOURCE
                            ? 'active'
                            : ''
                        }
                        onClick={() =>
                          selectStudentAudioSource(TEACHER_AUDIO_SOURCE)
                        }
                        type="button"
                      >
                        선생님 공유 음원
                      </button>
                      <button
                        aria-pressed={studentAudioSource === LOCAL_AUDIO_SOURCE}
                        className={
                          studentAudioSource === LOCAL_AUDIO_SOURCE ? 'active' : ''
                        }
                        disabled={!studentAnnotationDocumentKey}
                        onClick={() =>
                          selectStudentAudioSource(LOCAL_AUDIO_SOURCE)
                        }
                        type="button"
                      >
                        내 음원
                      </button>
                    </div>
                    {studentAudioSource === TEACHER_AUDIO_SOURCE && (
                      <div
                        aria-label="공용 음원 재생 모드"
                        className="student-shared-audio-mode-controls"
                        role="group"
                      >
                        <button
                          aria-pressed={
                            studentSharedAudioMode ===
                            STUDENT_SHARED_AUDIO_MODES.FOLLOW
                          }
                          className={
                            studentSharedAudioMode ===
                            STUDENT_SHARED_AUDIO_MODES.FOLLOW
                              ? 'active'
                              : ''
                          }
                          onClick={startStudentSharedAudioFollow}
                          type="button"
                        >
                          수업 따라가기
                        </button>
                        <button
                          aria-pressed={
                            studentSharedAudioMode ===
                            STUDENT_SHARED_AUDIO_MODES.PRACTICE
                          }
                          className={
                            studentSharedAudioMode ===
                            STUDENT_SHARED_AUDIO_MODES.PRACTICE
                              ? 'active'
                              : ''
                          }
                          onClick={startStudentSharedAudioPractice}
                          type="button"
                        >
                          개인 연습
                        </button>
                      </div>
                    )}
                    {studentAudioSource === TEACHER_AUDIO_SOURCE &&
                      studentSharedAudioFollowMessage && (
                        <small aria-live="polite">
                          {studentSharedAudioFollowMessage}
                        </small>
                      )}
                    <label>
                      음원 링크
                      <input
                        disabled={
                          studentAudioSource === LOCAL_AUDIO_SOURCE &&
                          !studentAnnotationDocumentKey
                        }
                        onChange={(event) =>
                          updateStudentLocalAudioSettings({
                            url: event.target.value,
                          })
                        }
                        placeholder="https://..."
                        readOnly={studentAudioSource === TEACHER_AUDIO_SOURCE}
                        type="url"
                        value={studentDisplayAudioSettings.url}
                      />
                    </label>
                    <label>
                      링크 시작 오프셋(초)
                      <input
                        disabled={
                          studentAudioSource === LOCAL_AUDIO_SOURCE &&
                          !studentAnnotationDocumentKey
                        }
                        min="0"
                        onChange={(event) =>
                          updateStudentLocalAudioSettings({
                            startOffsetSeconds: event.target.value,
                          })
                        }
                        readOnly={studentAudioSource === TEACHER_AUDIO_SOURCE}
                        step="0.1"
                        type="number"
                        value={studentDisplayAudioSettings.startOffsetSeconds}
                      />
                    </label>
                    <button
                      disabled={!studentOpenableAudioUrl}
                      onClick={openStudentAudioLink}
                      type="button"
                    >
                      링크 열기
                    </button>
                  </>
                )}
                {studentAudioSource === LOCAL_AUDIO_SOURCE &&
                  isStudentAudioPanelOpen && (
                    <label className="student-local-audio-file">
                      내 음원 파일
                      <input
                        accept={LOCAL_AUDIO_FILE_ACCEPT}
                        disabled={!studentAnnotationDocumentKey}
                        onCancel={cancelStudentLocalAudioSelection}
                        onChange={selectStudentLocalAudio}
                        onClick={beginStudentLocalAudioSelection}
                        ref={studentAudioInputRef}
                        type="file"
                      />
                    </label>
                  )}
                <div className="student-local-audio">
                  {selectedStudentAudioAsset ? (
                    <LocalAudioPlayer
                      audioFile={selectedStudentAudioAsset.audioFile}
                      countInBeats={audioTargetBeats}
                      countInBpm={audioTargetBpm}
                      externalPlaybackLocked={isStudentSharedAudioFollowMode}
                      externalPlaybackSnapshot={sharedAudioPlaybackState}
                      externalPlaybackSyncVersion={
                        sharedAudioPlaybackSyncVersion
                      }
                      fileName={selectedStudentAudioAsset.fileName}
                      firstMeasureAnchorSeconds={
                        getMeasureTimelineTime(
                          studentAudioEffectiveMarkers,
                          firstMeasureId,
                        )
                      }
                      globalBpm={studentPersonalGlobalBpm}
                      hasPersonalMeasureTiming={Boolean(
                        audioTargetStoredPersonalTiming,
                      )}
                      isEditorVisible={isStudentAudioPanelOpen}
                      measureMarkerTimeSeconds={audioTargetMeasureTime}
                      measureTimelineTimeSeconds={audioTargetTimelineTime}
                      measureMarkers={studentAudioWaveformMarkers}
                      onMeasureMarkerChange={setStudentMeasureAudioTime}
                      onMeasureMarkerRemove={removeStudentMeasureAudioTime}
                      onMeasureTimingChange={updateStudentMeasureAudioTiming}
                      onMeasureTimingReset={resetStudentMeasureAudioTiming}
                      onExternalPlaybackBlocked={
                        handleStudentSharedAudioPlaybackBlocked
                      }
                      onGlobalBpmApply={applyStudentGlobalAudioBpm}
                      onFirstMeasureAnchorChange={
                        updateStudentFirstMeasureAnchor
                      }
                      onStartOffsetChange={(startOffsetSeconds) =>
                        updateStudentPlaybackAudioSettings({ startOffsetSeconds })
                      }
                      onTimelineFollowEnabledChange={
                        updateStudentAudioFollowEnabled
                      }
                      onTimelineMeasureChange={updateStudentAudioTimelineMeasure}
                      onUseTeacherTimelineAnchorChange={
                        setStudentUseTeacherTimelineAnchor
                      }
                      onUseTeacherTempoChange={setStudentUseTeacherTempo}
                      personalFirstMeasureAnchorSeconds={
                        studentPersonalFirstMeasureAnchorSeconds
                      }
                      seekRequest={studentAudioSeekRequest}
                      serverClockOffsetMs={serverClockOffsetMs}
                      sourceUrl={selectedStudentAudioAsset.sourceUrl}
                      startOffsetSeconds={
                        studentPlaybackAudioSettings.startOffsetSeconds
                      }
                      targetMeasureId={audioTargetMeasure?.id || ''}
                      targetMeasureNumber={
                        audioTargetMeasure ? audioTargetMeasureIndex + 1 : 0
                      }
                      timelineFollowEnabled={
                        isStudentAudioTimelineFollowEnabled
                      }
                      useTeacherTimelineAnchor={
                        isUsingTeacherTimelineAnchor
                      }
                      useTeacherTempo={studentUseTeacherTempo}
                      canUseTeacherTimelineAnchor={
                        canUseTeacherTimelineAnchor
                      }
                      ref={studentSharedAudioPlayerRef}
                    />
                  ) : isStudentAudioPanelOpen ? (
                    <small>
                      {studentAudioSource === TEACHER_AUDIO_SOURCE
                        ? '선생님 공유 음원이 없습니다.'
                        : '이 기기에 저장된 음원 파일을 선택할 수 있습니다.'}
                    </small>
                  ) : null}
                  {sharedAudioLoadError &&
                    studentAudioSource === TEACHER_AUDIO_SOURCE && (
                      <small className="audio-error">{sharedAudioLoadError}</small>
                    )}
                  {isStudentAudioPanelOpen &&
                    studentAudioSource === TEACHER_AUDIO_SOURCE && (
                      <small>
                        공용 음원 파일은 Teacher가 교체하면 자동으로 갱신되며,
                        수업 따라가기에서는 Teacher의 위치와 속도를 사용합니다.
                      </small>
                    )}
                  {isStudentAudioPanelOpen &&
                    studentAudioSource === LOCAL_AUDIO_SOURCE && (
                      <small>
                        파일은 서버로 전송되지 않으며 화면을 나가거나 새로고침하면
                        다시 선택해야 합니다.
                      </small>
                    )}
                </div>
              </section>
            </div>
            <input
              accept=".pdf"
              className="file-input"
              onChange={selectStudentPdf}
              ref={studentPdfInputRef}
              type="file"
            />
          </div>
          <div className="student-annotation-controls">
            <button
              aria-pressed={isStudentAnnotationEnabled}
              className={isStudentAnnotationEnabled ? 'active' : ''}
              disabled={!pdfUrl || !studentAnnotationDocumentKey}
              onClick={toggleStudentAnnotation}
              type="button"
            >
              {isStudentAnnotationEnabled ? '필기 종료' : '필기'}
            </button>
            {isStudentAnnotationEnabled && (
              <>
                <div
                  aria-label="필기 색상"
                  className="student-annotation-palette"
                  role="group"
                >
                  {STUDENT_ANNOTATION_PALETTE.map((color) => (
                    <button
                      aria-label={`${color.label} 펜`}
                      aria-pressed={studentAnnotationColor === color.value}
                      className={`annotation-color-swatch ${
                        studentAnnotationColor === color.value ? 'selected' : ''
                      }`}
                      key={color.value}
                      onClick={() => setStudentAnnotationColor(color.value)}
                      style={{ '--annotation-color': color.value }}
                      title={color.label}
                      type="button"
                    >
                      <span aria-hidden="true" />
                    </button>
                  ))}
                </div>
                <div
                  aria-label="필기 페이지 이동"
                  className="student-annotation-pages"
                  role="group"
                >
                  <button
                    aria-label="이전 필기 페이지"
                    disabled={displayPageNumber <= 1}
                    onClick={() => moveStudentAnnotationPage(-1)}
                    title="이전 페이지"
                    type="button"
                  >
                    ‹
                  </button>
                  <output aria-live="polite">
                    {displayPageNumber} / {totalPages || '-'}
                  </output>
                  <button
                    aria-label="다음 필기 페이지"
                    disabled={totalPages === 0 || displayPageNumber >= totalPages}
                    onClick={() => moveStudentAnnotationPage(1)}
                    title="다음 페이지"
                    type="button"
                  >
                    ›
                  </button>
                </div>
              </>
            )}
            <button
              aria-label="현재 페이지 필기 실행 취소"
              disabled={studentPageAnnotationCount === 0}
              onClick={undoStudentAnnotation}
              title="실행 취소"
              type="button"
            >
              ↶
            </button>
            <button
              disabled={studentPageAnnotationCount === 0}
              onClick={clearStudentAnnotationPage}
              type="button"
            >
              페이지 지우기
            </button>
          </div>
        </>
      )}

      {canEdit && sharedAudioMetadata && sharedAudioUrl && (
        <section
          aria-label="선생님 공유 음원 재생"
          className={`teacher-shared-audio-panel ${
            isTeacherSharedAudioPanelOpen ? '' : 'compact'
          } ${isTeacherSharedAudioPanelDragging ? 'dragging' : ''}`}
          ref={teacherSharedAudioPanelRef}
          style={
            teacherSharedAudioPanelPosition
              ? {
                  left: teacherSharedAudioPanelPosition.left,
                  right: 'auto',
                  top: teacherSharedAudioPanelPosition.top,
                }
              : undefined
          }
        >
          <div
            className="teacher-shared-audio-panel-header"
            onLostPointerCapture={endTeacherSharedAudioPanelDrag}
            onPointerCancel={endTeacherSharedAudioPanelDrag}
            onPointerDown={startTeacherSharedAudioPanelDrag}
            onPointerMove={moveTeacherSharedAudioPanel}
            onPointerUp={endTeacherSharedAudioPanelDrag}
          >
            <strong>공용 음원</strong>
            <button
              onClick={() =>
                setIsTeacherSharedAudioPanelOpen((isOpen) => !isOpen)
              }
              type="button"
            >
              {isTeacherSharedAudioPanelOpen ? '접기' : '파형 열기'}
            </button>
          </div>
          <LocalAudioPlayer
            audioFile={sharedAudioWaveformFile}
            fileName={sharedAudioMetadata.fileName}
            isEditorVisible={isTeacherSharedAudioPanelOpen}
            key={`${sharedAudioMetadata.assetId}:${sharedAudioMetadata.revision}`}
            onPlaybackStateChange={(playbackState) =>
              publishTeacherSharedAudioPlayback(
                playbackState,
                sharedAudioMetadata,
              )
            }
            onTimelineAnchorClear={() =>
              updateTeacherSharedAudioTimelineAnchor(null)
            }
            onTimelineAnchorSet={setTeacherSharedAudioTimelineAnchor}
            showPracticeTools={false}
            sourceUrl={sharedAudioUrl}
            startOffsetSeconds={0}
            timelineAnchor={sharedAudioMetadata.timelineAnchor}
            timelineAnchorFirstMeasureSeconds={
              teacherSharedAudioFirstMeasureTime
            }
            timelineAnchorMeasureNumber={
              teacherSharedAudioAnchorMeasureIndex >= 0
                ? teacherSharedAudioAnchorMeasureIndex + 1
                : 0
            }
            timelineAnchorMeasureCount={measures.length}
          />
          {sharedAudioLoadError && (
            <small className="audio-error">{sharedAudioLoadError}</small>
          )}
        </section>
      )}

      {viewerMode === ROLE_SELECT_MODE ? null : viewerMode === VOCAL_MODE ? (
        <VocalView
          currentText={vocalViewModel.currentText}
          nextText={vocalViewModel.nextText}
        />
      ) : (
      <main className="main">
        {canEdit && (
          <Sidebar
            audioSettings={audioSettings}
            bsvInputRef={bsvInputRef}
            canEdit={canEdit}
            canSaveProject={Boolean(teacherPdfBlobRef.current)}
            canRecognizeMeasures={Boolean(teacherPdfBlobRef.current)}
            canRecognizeLyrics={Boolean(
              teacherPdfBlobRef.current && measures.length
            )}
            canDetectNavigationText={Boolean(
              teacherPdfBlobRef.current && measures.length
            )}
            canResolveLanguagePhrases={measures.some((measure) =>
              getMeaningfulLyric(measure),
            )}
            canOpenAudioLink={Boolean(openableAudioUrl)}
            canEndSession={Boolean(
              teacherPdfBlobRef.current || measures.length || sharedAudioMetadata
            )}
            fileInputRef={fileInputRef}
            isAutoPlaying={isAutoPlaying}
            isRepeatEnabled={isRepeatEnabled}
            navigationMarkerOptions={NAVIGATION_MARKER_OPTIONS}
            navigationMarkerValidation={navigationMarkerValidation}
            navigationRepeatPolicyOptions={NAVIGATION_REPEAT_POLICY_OPTIONS}
            navigationTextCandidates={navigationTextCandidates}
            navigationTextDetectionState={navigationTextDetectionUiState}
            measures={measures}
            measureRecognitionState={measureRecognitionState}
            lyricRecognitionState={lyricRecognitionState}
            languagePhraseMutationState={languagePhraseMutationState}
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
            onRecognizeMeasures={recognizePdfMeasures}
            onRecognizeLyrics={recognizePdfLyrics}
            onDetectNavigationText={detectPdfNavigationText}
            onApplyRecognizedLyrics={applyRecognizedLyrics}
            onCancelRecognizedLyrics={cancelRecognizedLyrics}
            onResolveLanguagePhrases={resolveLanguagePhrases}
            onPdfSelected={selectPdf}
            onSaveJson={saveJson}
            onSaveBsvProject={saveBsvProject}
            onSetMode={setMode}
            onSetRepeatEnabled={setRepeatEnabled}
            onSetReturnToStartOnEnd={setReturnToStartOnEnd}
            onToggleSelectedMeasureNavigationMarker={
              toggleSelectedMeasureNavigationMarker
            }
            onUpdateSelectedMeasureNavigationRepeatPolicy={
              updateSelectedMeasureNavigationRepeatPolicy
            }
            onResolvePendingNavigationDecision={
              resolvePendingNavigationDecision
            }
            onReplaceNavigationMeasures={replaceNavigationMeasures}
            onGoToPage={goToPage}
            onGoToMeasure={goToMeasure}
            onGoToPreviousPlaybackStep={goToPreviousPlaybackStep}
            onAdvancePlayback={advanceManualPlayback}
            onEndClassSession={endClassSession}
            onOpenLyricEditor={openLyricEditor}
            onOpenAudioLink={openAudioLink}
            onOpenSharedAudioPicker={openTeacherSharedAudioPicker}
            onRemoveSharedAudio={removeTeacherSharedAudio}
            onApplyGlobalBpm={applyTeacherGlobalBpm}
            onUpdateSelectedMeasureTiming={updateSelectedMeasureTiming}
            onUpdateAudioSettings={updateAudioSettings}
            pageNumber={pageNumber}
            pendingNavigationDecision={pendingNavigationDecision}
            projectDefaultBpm={projectDefaultBpm}
            returnToStartOnEnd={returnToStartOnEnd}
            sharedAudioInputRef={teacherSharedAudioInputRef}
            sharedAudioMetadata={sharedAudioMetadata}
            sharedAudioMutationState={sharedAudioMutationState}
            onSharedAudioSelected={selectTeacherSharedAudio}
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
              <div
                aria-label="Teacher PDF 보기 방식"
                className="teacher-pdf-view-controls"
                role="group"
              >
                <button
                  aria-pressed={teacherViewMode === TEACHER_PAGE_VIEW}
                  className={teacherViewMode === TEACHER_PAGE_VIEW ? 'active' : ''}
                  onClick={() => setTeacherViewMode(TEACHER_PAGE_VIEW)}
                  type="button"
                >
                  페이지 전체
                </button>
                <button
                  aria-pressed={teacherViewMode === TEACHER_WIDTH_VIEW}
                  className={teacherViewMode === TEACHER_WIDTH_VIEW ? 'active' : ''}
                  onClick={() => setTeacherViewMode(TEACHER_WIDTH_VIEW)}
                  type="button"
                >
                  너비 맞춤
                </button>
              </div>
            </div>
          )}

          <ScoreViewer
            audioMappedMeasureIds={studentAudioEffectiveMarkers.map(
              (marker) => marker.measureId,
            )}
            audioTargetMeasureIndex={audioTargetMeasureIndex}
            annotationEnabled={
              viewerMode === STUDENT_MODE && isStudentAnnotationEnabled
            }
            annotationColor={studentAnnotationColor}
            annotationStrokes={studentAnnotationStrokes}
            canEdit={canEdit}
            displayMeasureIndex={displayMeasureIndex}
            displayPageNumber={displayPageNumber}
            draggedMeasureIndex={draggedMeasureIndex}
            measures={measures}
            mode={overlayMode}
            navigationValidationIssues={navigationMarkerValidation.issues}
            navigationTextCandidates={canEdit ? navigationTextCandidates : []}
            onAddAnnotationStroke={addStudentAnnotationStroke}
            onActivateMeasure={
              canEditStudentAudioTimeline ? activateStudentAudioMeasure : null
            }
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
            pdfViewMode={pdfViewMode}
            renderResetVersion={pdfRenderResetVersion}
            resizedMeasureIndex={resizedMeasureIndex}
            selectedMeasureIndex={selectedMeasureIndex}
            showNavigationMarkers={canEdit}
            showAudioMeasureTargets={
              canEditStudentAudioTimeline && isStudentAudioPanelOpen
            }
            studentPdfSource={studentPdfSource}
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

function FullscreenButton({ isFullscreen, isSupported, onToggle }) {
  if (!isSupported) return null;

  return (
    <button
      aria-pressed={isFullscreen}
      className="fullscreen-toggle"
      onClick={onToggle}
      type="button"
    >
      {isFullscreen ? '전체화면 종료' : '⛶ 전체화면'}
    </button>
  );
}

function VocalView({ currentText, nextText }) {
  return (
    <main className="vocal-view">
      <section className="vocal-current">{currentText}</section>
      <section className="vocal-next">{nextText}</section>
    </main>
  );
}

function SidebarSection({ children, defaultOpen = false, title }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <details
      className="sidebar-section"
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      open={isOpen}
    >
      <summary>{title}</summary>
      <div className="sidebar-section-content">{children}</div>
    </details>
  );
}

function Sidebar({
  audioSettings,
  bsvInputRef,
  canEdit,
  canEndSession,
  canDetectNavigationText,
  canOpenAudioLink,
  canRecognizeMeasures,
  canRecognizeLyrics,
  canResolveLanguagePhrases,
  canSaveProject,
  fileInputRef,
  isAutoPlaying,
  isRepeatEnabled,
  jsonInputRef,
  navigationMarkerOptions,
  navigationMarkerValidation,
  navigationRepeatPolicyOptions,
  navigationTextCandidates,
  navigationTextDetectionState,
  measures,
  measureIndex,
  measureRecognitionState,
  lyricRecognitionState,
  languagePhraseMutationState,
  measureTotal,
  mode,
  onApplyGlobalBpm,
  onApplyRecognizedLyrics,
  onCancelRecognizedLyrics,
  onDetectNavigationText,
  onEndClassSession,
  onAdvancePlayback,
  onGoToMeasure,
  onGoToPage,
  onGoToPreviousPlaybackStep,
  onLoadJson,
  onLoadBsvProject,
  onOpenAudioLink,
  onOpenSharedAudioPicker,
  onOpenLyricEditor,
  onOpenBsvProject,
  onOpenJson,
  onOpenPdf,
  onRecognizeMeasures,
  onRecognizeLyrics,
  onResolveLanguagePhrases,
  onRemoveSharedAudio,
  onPdfSelected,
  onSaveJson,
  onSaveBsvProject,
  onSetMode,
  onSetRepeatEnabled,
  onSetReturnToStartOnEnd,
  onStartAutoplay,
  onStopAutoplay,
  onToggleSelectedMeasureNavigationMarker,
  onUpdateSelectedMeasureNavigationRepeatPolicy,
  onResolvePendingNavigationDecision,
  onReplaceNavigationMeasures,
  onUpdateAudioSettings,
  onUpdateSelectedMeasureTiming,
  pageNumber,
  pendingNavigationDecision,
  projectDefaultBpm,
  returnToStartOnEnd,
  sharedAudioInputRef,
  sharedAudioMetadata,
  sharedAudioMutationState,
  onSharedAudioSelected,
  selectedMeasure,
  selectedMeasureIndex,
  totalPages,
}) {
  const [measureNumberInput, setMeasureNumberInput] = useState(
    measureTotal > 0 ? String(measureIndex + 1) : '',
  );
  const [globalBpmInput, setGlobalBpmInput] = useState(
    String(projectDefaultBpm),
  );

  useEffect(() => {
    setMeasureNumberInput(measureTotal > 0 ? String(measureIndex + 1) : '');
  }, [measureIndex, measureTotal]);

  useEffect(() => {
    setGlobalBpmInput(String(projectDefaultBpm));
  }, [projectDefaultBpm]);

  const selectedRepeatPolicyMarker = selectedMeasure?.navigationMarkers?.find(
    (marker) => supportsNavigationRepeatPolicy(marker.type),
  );

  function submitMeasureNumber(event) {
    event.preventDefault();

    const measureNumber = Number(measureNumberInput);

    if (
      !Number.isInteger(measureNumber) ||
      measureNumber < 1 ||
      measureNumber > measureTotal
    ) {
      return;
    }

    onGoToMeasure(measureNumber - 1);
  }

  function submitGlobalBpm(event) {
    event.preventDefault();
    onApplyGlobalBpm(globalBpmInput);
  }

  if (!canEdit) return null;

  return (
    <aside className="sidebar">
      <input
        accept=".pdf"
        className="file-input"
        onChange={onPdfSelected}
        ref={fileInputRef}
        type="file"
      />
      <input
        accept=".bsv"
        className="file-input"
        onChange={onLoadBsvProject}
        ref={bsvInputRef}
        type="file"
      />
      <input
        accept=".json"
        className="file-input"
        onChange={onLoadJson}
        ref={jsonInputRef}
        type="file"
      />
      <input
        accept={LOCAL_AUDIO_FILE_ACCEPT}
        className="file-input"
        onChange={onSharedAudioSelected}
        ref={sharedAudioInputRef}
        type="file"
      />

      <div className="sidebar-button-grid">
        <button
          className={mode === REGISTER_MODE ? 'active' : ''}
          onClick={() => onSetMode(REGISTER_MODE)}
          type="button"
        >
          등록모드
        </button>
        <button
          className={mode === PLAY_MODE ? 'active' : ''}
          onClick={() => onSetMode(PLAY_MODE)}
          type="button"
        >
          연주모드
        </button>
      </div>

      {pendingNavigationDecision && (
        <section className="navigation-decision-prompt" role="alert">
          <strong>D.S. 이후 도돌이표 처리</strong>
          <span>두 방식 모두 유효한 연주 경로입니다.</span>
          <div className="sidebar-button-grid">
            {pendingNavigationDecision.options.map((option) => (
              <button
                key={option.id}
                onClick={() => onResolvePendingNavigationDecision(option)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>
      )}

      <SidebarSection defaultOpen title="악보">
        <button onClick={onOpenPdf} type="button">PDF 열기</button>
        <div className="measure-recognition-controls">
          <button
            disabled={
              !canRecognizeMeasures || measureRecognitionState.status === 'running'
            }
            onClick={onRecognizeMeasures}
            type="button"
          >
            {measureRecognitionState.status === 'running'
              ? '마디 분석 중'
              : '마디 자동인식'}
          </button>
          {measureRecognitionState.message && (
            <span
              aria-live="polite"
              className={`measure-recognition-status ${measureRecognitionState.status}`}
            >
              {measureRecognitionState.message}
            </span>
          )}
        </div>
        <div className="lyric-recognition-controls">
          <button
            disabled={
              !canRecognizeLyrics ||
              lyricRecognitionState.status === 'running' ||
              measureRecognitionState.status === 'running'
            }
            onClick={onRecognizeLyrics}
            type="button"
          >
            {lyricRecognitionState.status === 'running'
              ? '가사 분석 중'
              : '가사 자동인식'}
          </button>
          {lyricRecognitionState.message && (
            <span
              aria-live="polite"
              className={`lyric-recognition-status ${lyricRecognitionState.status}`}
            >
              {lyricRecognitionState.message}
            </span>
          )}
          {lyricRecognitionState.status === 'ready' && (
            <div className="lyric-recognition-actions">
              <button onClick={onApplyRecognizedLyrics} type="button">적용</button>
              <button onClick={onCancelRecognizedLyrics} type="button">취소</button>
            </div>
          )}
        </div>
        <div className="language-phrase-controls">
          <button
            disabled={
              !canResolveLanguagePhrases ||
              languagePhraseMutationState.status === 'running'
            }
            onClick={onResolveLanguagePhrases}
            type="button"
          >
            {languagePhraseMutationState.status === 'running'
              ? '가사 문맥 분석 중'
              : 'AI 가사 문장 정리'}
          </button>
          {languagePhraseMutationState.message && (
            <span
              aria-live="polite"
              className={`language-phrase-status ${languagePhraseMutationState.status}`}
            >
              {languagePhraseMutationState.message}
            </span>
          )}
        </div>
        <button onClick={onOpenLyricEditor} type="button">가사 편집</button>
      </SidebarSection>

      <SidebarSection title="프로젝트">
        <button disabled={!canSaveProject} onClick={onSaveBsvProject} type="button">
          프로젝트 저장
        </button>
        <button onClick={onOpenBsvProject} type="button">프로젝트 열기</button>
        <button
          className="session-end-button"
          disabled={!canEndSession}
          onClick={onEndClassSession}
          type="button"
        >
          수업 종료
        </button>
      </SidebarSection>

      <SidebarSection defaultOpen title="연주">
        <div className="autoplay-controls">
          <label className="repeat-toggle">
            <input
              checked={isRepeatEnabled}
              onChange={(event) => onSetRepeatEnabled(event.target.checked)}
              type="checkbox"
            />
            반복재생
          </label>
          <label className="repeat-toggle">
            <input
              checked={returnToStartOnEnd}
              onChange={(event) => onSetReturnToStartOnEnd(event.target.checked)}
              type="checkbox"
            />
            종료 후 처음으로
          </label>
          <div className="sidebar-button-grid">
            <button
              disabled={
                isAutoPlaying || Boolean(pendingNavigationDecision) || measureTotal === 0
              }
              onClick={onStartAutoplay}
              type="button"
            >
              {isAutoPlaying ? '재생 중' : '▶ Start'}
            </button>
            <button disabled={!isAutoPlaying} onClick={onStopAutoplay} type="button">
              ■ Stop
            </button>
          </div>
        </div>
        <form className="global-tempo-editor" onSubmit={submitGlobalBpm}>
          <label htmlFor="global-bpm-input">전체 템포</label>
          <div className="global-tempo-actions">
            <input
              id="global-bpm-input"
              inputMode="decimal"
              min="1"
              onChange={(event) => setGlobalBpmInput(event.target.value)}
              step="1"
              type="number"
              value={globalBpmInput}
            />
            <span aria-hidden="true">BPM</span>
            <button disabled={measureTotal === 0} type="submit">전체 적용</button>
          </div>
          <small>모든 마디의 BPM에 적용됩니다.</small>
        </form>
      </SidebarSection>

      <SidebarSection defaultOpen title="현재 마디">
        <div className="current-measure-display" aria-live="polite">
          <span>현재 마디</span>
          <strong>{measureTotal > 0 ? measureIndex + 1 : 0} / {measureTotal}</strong>
        </div>
        {mode === REGISTER_MODE ? (
          <div className="sidebar-button-grid">
            <button onClick={() => onGoToPage(pageNumber - 1)} type="button">◀ 페이지</button>
            <button onClick={() => onGoToPage(pageNumber + 1)} type="button">▶ 페이지</button>
          </div>
        ) : (
          <>
            <button onClick={() => onGoToMeasure(0)} type="button">⏮ 처음</button>
            <div className="sidebar-button-grid">
              <button onClick={onGoToPreviousPlaybackStep} type="button">◀ 마디</button>
              <button onClick={onAdvancePlayback} type="button">▶ 마디</button>
            </div>
            <form className="measure-jump-form" onSubmit={submitMeasureNumber}>
              <label htmlFor="measure-number-input">이동할 마디</label>
              <input
                id="measure-number-input"
                inputMode="numeric"
                max={measureTotal || undefined}
                min="1"
                onChange={(event) => setMeasureNumberInput(event.target.value)}
                type="number"
                value={measureNumberInput}
              />
              <button disabled={measureTotal === 0} type="submit">이동</button>
            </form>
          </>
        )}
        {mode === REGISTER_MODE && selectedMeasure && (
          <div className="measure-timing-editor">
            <strong>현재 마디 템포</strong>
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
        <div className="sidebar-status">
          <span>현재 페이지</span>
          <strong>{pageNumber} / {totalPages}</strong>
        </div>
      </SidebarSection>

      <SidebarSection title="악보 진행">
        {mode === REGISTER_MODE && selectedMeasure ? (
          <div className="navigation-marker-editor">
            <strong>악보 이동 Marker</strong>
            <span>선택 마디 : {selectedMeasureIndex + 1}</span>
            <div className="navigation-marker-actions">
              {navigationMarkerOptions.map((option) => {
                const isActive = selectedMeasure.navigationMarkers?.some(
                  (marker) => marker.type === option.type,
                );
                const accessibleLabel = option.description
                  ? `${option.label} ${option.description}`
                  : option.label;

                return (
                  <button
                    aria-label={accessibleLabel}
                    aria-pressed={isActive}
                    className={isActive ? 'active' : ''}
                    disabled={isAutoPlaying}
                    key={option.type}
                    onClick={() => onToggleSelectedMeasureNavigationMarker(option.type)}
                    title={accessibleLabel}
                    type="button"
                  >
                    <NavigationMarkerLabel type={option.type} />
                  </button>
                );
              })}
            </div>
            {selectedRepeatPolicyMarker && (
              <label className="navigation-repeat-policy">
                D.S. 이후 도돌이표
                <select
                  disabled={isAutoPlaying}
                  onChange={(event) =>
                    onUpdateSelectedMeasureNavigationRepeatPolicy(
                      selectedRepeatPolicyMarker.type,
                      event.target.value,
                    )
                  }
                  value={getNavigationRepeatPolicy(selectedRepeatPolicyMarker)}
                >
                  {navigationRepeatPolicyOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {navigationMarkerValidation.message && (
              <small className="navigation-marker-warning" role="status">
                {navigationMarkerValidation.message}
              </small>
            )}
          </div>
        ) : (
          <small className="sidebar-help">등록모드에서 마디를 선택하세요.</small>
        )}
        <NavigationEditor
          canDetectTextCandidates={canDetectNavigationText}
          disabled={isAutoPlaying}
          measures={measures}
          navigationTextCandidates={navigationTextCandidates}
          navigationTextDetectionState={navigationTextDetectionState}
          onDetectTextCandidates={onDetectNavigationText}
          onReplaceMeasures={onReplaceNavigationMeasures}
        />
      </SidebarSection>

      <SidebarSection title="오디오">
        <div className="audio-settings-editor">
          <label>
            음원 링크
            <input
              onChange={(event) => onUpdateAudioSettings({ url: event.target.value })}
              placeholder="https://..."
              type="url"
              value={audioSettings.url}
            />
          </label>
          <label>
            시작 오프셋(초)
            <input
              min="0"
              onChange={(event) =>
                onUpdateAudioSettings({ startOffsetSeconds: event.target.value })
              }
              step="0.1"
              type="number"
              value={audioSettings.startOffsetSeconds}
            />
          </label>
          <button disabled={!canOpenAudioLink} onClick={onOpenAudioLink} type="button">
            링크 열기
          </button>
        </div>
        <div className="shared-audio-editor">
          <strong>공용 로컬 음원</strong>
          <span title={sharedAudioMetadata?.fileName || ''}>
            {sharedAudioMetadata?.fileName || '등록된 음원 없음'}
          </span>
          <button
            disabled={sharedAudioMutationState.status === 'working'}
            onClick={onOpenSharedAudioPicker}
            type="button"
          >
            {sharedAudioMetadata ? '음원 교체' : '음원 추가'}
          </button>
          <button
            disabled={
              !sharedAudioMetadata || sharedAudioMutationState.status === 'working'
            }
            onClick={onRemoveSharedAudio}
            type="button"
          >
            음원 제거
          </button>
          {sharedAudioMutationState.message && (
            <small className={sharedAudioMutationState.status}>
              {sharedAudioMutationState.message}
            </small>
          )}
        </div>
      </SidebarSection>

      {import.meta.env.DEV && (
        <SidebarSection title="개발자 도구">
          <button onClick={onSaveJson} type="button">JSON 저장</button>
          <button onClick={onOpenJson} type="button">JSON 불러오기</button>
        </SidebarSection>
      )}
    </aside>
  );
}

export default App;
