import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import AudioWaveform from './AudioWaveform.jsx';
import {
  clampAudioTime,
  formatAudioTime,
  getCountInFrequency,
  getCountInTiming,
  getLocalAudioStartTime,
  LOCAL_AUDIO_PLAYBACK_RATES,
  normalizeLocalAudioPlaybackRate,
} from '../utils/audioPlayback.js';
import { getAudioTimelineMarkerAtTime } from '../utils/audioTimeline.js';
import {
  getSharedAudioPlaybackCorrection,
  normalizeSharedAudioPlaybackRate,
  SHARED_AUDIO_DRIFT_CHECK_INTERVAL_MS,
  SHARED_AUDIO_PLAYBACK_COMMANDS,
} from '../utils/sharedAudioPlayback.js';

const LocalAudioPlayer = forwardRef(function LocalAudioPlayer({
  audioFile,
  canUseTeacherTimelineAnchor = false,
  countInBeats,
  countInBpm,
  externalPlaybackLocked = false,
  externalPlaybackSnapshot,
  externalPlaybackSyncVersion = 0,
  fileName,
  firstMeasureAnchorSeconds,
  globalBpm,
  hasPersonalMeasureTiming,
  isEditorVisible,
  measureMarkerTimeSeconds,
  measureTimelineTimeSeconds,
  measureMarkers,
  onMeasureMarkerChange,
  onMeasureMarkerRemove,
  onMeasureTimingChange,
  onMeasureTimingReset,
  onExternalPlaybackBlocked,
  onFirstMeasureAnchorChange,
  onGlobalBpmApply,
  onPlaybackStateChange,
  onStartOffsetChange,
  onTimelineAnchorClear,
  onTimelineAnchorSet,
  onTimelineFollowEnabledChange,
  onTimelineMeasureChange,
  onUseTeacherTimelineAnchorChange,
  onUseTeacherTempoChange,
  personalFirstMeasureAnchorSeconds,
  seekRequest,
  sourceUrl,
  startOffsetSeconds,
  serverClockOffsetMs = 0,
  targetMeasureId,
  targetMeasureNumber,
  timelineAnchor,
  timelineAnchorFirstMeasureSeconds,
  timelineAnchorMeasureCount = 0,
  timelineAnchorMeasureNumber,
  timelineFollowEnabled,
  useTeacherTimelineAnchor = false,
  useTeacherTempo = false,
  showPracticeTools = true,
}, forwardedRef) {
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const animationFrameRef = useRef(0);
  const countInRunRef = useRef({ nodes: [], timerIds: [], version: 0 });
  const isCountInActiveRef = useRef(false);
  const isCountInEnabledRef = useRef(true);
  const isCountInPlaybackRef = useRef(false);
  const isApplyingExternalPlaybackRef = useRef(false);
  const isExternalPlaybackUnlockedRef = useRef(false);
  const applyExternalPlaybackRef = useRef(null);
  const playbackStateCallbackRef = useRef(onPlaybackStateChange);
  const seekToTimeRef = useRef(null);
  const [countInBeat, setCountInBeat] = useState(0);
  const [isCountInActive, setIsCountInActive] = useState(false);
  const [isCountInEnabled, setIsCountInEnabled] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [globalBpmInput, setGlobalBpmInput] = useState(
    String(globalBpm || countInBpm || 120),
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [playbackError, setPlaybackError] = useState('');
  const [timelineAnchorInputError, setTimelineAnchorInputError] = useState('');
  const [timelineAnchorMeasureInput, setTimelineAnchorMeasureInput] =
    useState('1');
  const timelinePlaybackRef = useRef({
    enabled: timelineFollowEnabled,
    markers: measureMarkers,
    onMeasureChange: onTimelineMeasureChange,
  });

  playbackStateCallbackRef.current = onPlaybackStateChange;

  timelinePlaybackRef.current = {
    enabled: timelineFollowEnabled,
    markers: measureMarkers,
    onMeasureChange: onTimelineMeasureChange,
  };

  function notifyTimelineMeasure(timeSeconds) {
    const timelinePlayback = timelinePlaybackRef.current;
    const activeMarker = timelinePlayback.enabled
      ? getAudioTimelineMarkerAtTime(timelinePlayback.markers, timeSeconds)
      : null;
    const nextMeasureId = activeMarker?.measureId || '';

    timelinePlayback.onMeasureChange?.(nextMeasureId);
  }

  function notifyPlaybackState(command, audio = audioRef.current) {
    const callback = playbackStateCallbackRef.current;

    if (!audio || !callback) return;

    callback({
      anchorPositionSeconds: audio.currentTime || 0,
      command,
      isPlaying: !audio.paused && !audio.ended,
      playbackRate: audio.playbackRate || 1,
    });
  }

  function getCurrentCountInTiming() {
    const measureTiming = getCountInTiming(countInBpm, countInBeats);

    return getCountInTiming(measureTiming.bpm * playbackRate, measureTiming.beats);
  }

  function cancelCountIn(updateState = true) {
    countInRunRef.current.version += 1;
    countInRunRef.current.timerIds.forEach((timerId) =>
      window.clearTimeout(timerId),
    );
    countInRunRef.current.nodes.forEach((node) => {
      try {
        node.stop();
      } catch {
        // A click oscillator may already have finished naturally.
      }
    });
    countInRunRef.current.timerIds = [];
    countInRunRef.current.nodes = [];
    isCountInActiveRef.current = false;
    isCountInPlaybackRef.current = false;
    if (updateState) {
      setIsCountInActive(false);
      setCountInBeat(0);
    }
  }

  function getAudioContext() {
    if (audioContextRef.current) return audioContextRef.current;

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextConstructor) return null;

    audioContextRef.current = new AudioContextConstructor();
    return audioContextRef.current;
  }

  function scheduleCountInClick(context, startTime, frequency) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.frequency.setValueAtTime(frequency, startTime);
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.32, startTime + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.07);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(startTime);
    oscillator.stop(startTime + 0.075);
    countInRunRef.current.nodes.push(oscillator);
  }

  async function playAudioAfterCountIn(audio, version) {
    if (countInRunRef.current.version !== version) return;

    countInRunRef.current.timerIds = [];
    countInRunRef.current.nodes = [];
    isCountInActiveRef.current = false;
    setIsCountInActive(false);
    setCountInBeat(0);
    isCountInPlaybackRef.current = true;

    try {
      await audio.play();
    } catch {
      isCountInPlaybackRef.current = false;
      setPlaybackError('예비박 후 음원을 자동으로 재생하지 못했습니다. 다시 재생해주세요.');
    }
  }

  async function playAudioImmediately(audio = audioRef.current) {
    if (!audio) return;

    cancelCountIn();
    isCountInPlaybackRef.current = true;

    try {
      await audio.play();
    } catch {
      isCountInPlaybackRef.current = false;
      setPlaybackError('음원을 재생하지 못했습니다. 다시 재생해주세요.');
    }
  }

  async function startCountIn() {
    const audio = audioRef.current;

    if (!audio || audio.readyState < HTMLMediaElement.HAVE_METADATA) return;
    if (!isCountInEnabledRef.current) {
      playAudioImmediately(audio);
      return;
    }

    audio.pause();
    cancelCountIn();
    const version = countInRunRef.current.version;
    const context = getAudioContext();

    isCountInActiveRef.current = true;
    setIsCountInActive(true);

    if (!context) {
      setPlaybackError('이 브라우저는 메트로놈 예비박을 지원하지 않습니다.');
      playAudioImmediately(audio);
      return;
    }

    try {
      await context.resume();
    } catch {
      cancelCountIn();
      setPlaybackError('메트로놈을 시작하지 못했습니다. 다시 재생해주세요.');
      return;
    }

    if (countInRunRef.current.version !== version) return;

    const timing = getCurrentCountInTiming();
    const leadSeconds = 0.05;
    const firstBeatTime = context.currentTime + leadSeconds;

    setPlaybackError('');
    for (let beatIndex = 0; beatIndex < timing.beats; beatIndex += 1) {
      const beatTime = firstBeatTime + beatIndex * timing.beatDurationSeconds;

      scheduleCountInClick(context, beatTime, getCountInFrequency(beatIndex));
      const beatTimerId = window.setTimeout(
        () => {
          if (countInRunRef.current.version === version) {
            setCountInBeat(beatIndex + 1);
          }
        },
        Math.max(0, (beatTime - context.currentTime) * 1_000),
      );

      countInRunRef.current.timerIds.push(beatTimerId);
    }

    const completionTimerId = window.setTimeout(
      () => playAudioAfterCountIn(audio, version),
      (leadSeconds + timing.totalDurationSeconds) * 1_000,
    );

    countInRunRef.current.timerIds.push(completionTimerId);
  }

  function seekToStartOffset() {
    const audio = audioRef.current;

    if (!audio || audio.readyState < HTMLMediaElement.HAVE_METADATA) return;

    const nextTime = getLocalAudioStartTime(
      startOffsetSeconds,
      audio.duration,
    );

    cancelCountIn();
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
    notifyTimelineMeasure(nextTime);
  }

  function seekToTime(nextTime, { playAfterSeek = false } = {}) {
    const audio = audioRef.current;

    if (!audio || audio.readyState < HTMLMediaElement.HAVE_METADATA) return;

    const clampedTime = clampAudioTime(nextTime, audio.duration);

    if (playAfterSeek) audio.pause();
    cancelCountIn();
    audio.currentTime = clampedTime;
    setCurrentTime(clampedTime);
    notifyTimelineMeasure(clampedTime);
    if (playAfterSeek) {
      if (isCountInEnabledRef.current) {
        startCountIn();
      } else {
        playAudioImmediately(audio);
      }
    }
  }

  seekToTimeRef.current = seekToTime;

  function updatePlaybackRate(nextPlaybackRate) {
    const normalizedRate = normalizeLocalAudioPlaybackRate(nextPlaybackRate);

    setPlaybackRate(normalizedRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = normalizedRate;
    }
  }

  async function applyExternalPlayback(
    snapshot,
    {
      allowPlay = false,
      clockOffsetMs = serverClockOffsetMs,
      forceSeek = false,
      prepareWhenPaused = false,
    } = {},
  ) {
    const audio = audioRef.current;

    if (!audio || audio.readyState < HTMLMediaElement.HAVE_METADATA || !snapshot) {
      onExternalPlaybackBlocked?.('공용 음원이 준비된 뒤 다시 눌러주세요.');
      return { ok: false, reason: 'not-ready' };
    }

    const correction = getSharedAudioPlaybackCorrection({
      currentTimeSeconds: audio.currentTime,
      forceSeek:
        forceSeek ||
        snapshot.command === SHARED_AUDIO_PLAYBACK_COMMANDS.SEEK ||
        snapshot.command === SHARED_AUDIO_PLAYBACK_COMMANDS.RESET,
      serverTimeMs: Date.now() + Number(clockOffsetMs || 0),
      snapshot,
    });
    const normalizedRate =
      normalizeSharedAudioPlaybackRate(snapshot.playbackRate) || 1;
    const targetTime = clampAudioTime(
      correction.targetTimeSeconds,
      audio.duration,
    );

    cancelCountIn();
    isApplyingExternalPlaybackRef.current = true;
    audio.playbackRate = normalizedRate;
    setPlaybackRate(normalizedRate);
    if (correction.shouldSeek) {
      audio.currentTime = targetTime;
      setCurrentTime(targetTime);
      notifyTimelineMeasure(targetTime);
    }

    try {
      if (!snapshot.isPlaying) {
        audio.pause();

        if (allowPlay && prepareWhenPaused) {
          const wasMuted = audio.muted;

          try {
            audio.muted = true;
            await audio.play();
            audio.pause();
            audio.currentTime = targetTime;
          } finally {
            audio.muted = wasMuted;
          }
          setCurrentTime(targetTime);
          isExternalPlaybackUnlockedRef.current = true;
        }

        setIsPlaying(false);
        setPlaybackError('');
        return { ok: true, playing: false };
      }

      if (!allowPlay && !isExternalPlaybackUnlockedRef.current) {
        onExternalPlaybackBlocked?.(
          '브라우저 재생 정책상 수업 따라가기 시작을 한 번 눌러야 합니다.',
        );
        return { ok: false, reason: 'gesture-required' };
      }

      if (audio.paused) await audio.play();
      isExternalPlaybackUnlockedRef.current = true;
      setPlaybackError('');
      return { ok: true, playing: true };
    } catch {
      isExternalPlaybackUnlockedRef.current = false;
      const message =
        '브라우저 재생 정책으로 자동재생이 차단되었습니다. 수업 따라가기 시작을 눌러주세요.';

      setPlaybackError(message);
      onExternalPlaybackBlocked?.(message);
      return { ok: false, reason: 'autoplay-blocked' };
    } finally {
      isApplyingExternalPlaybackRef.current = false;
    }
  }

  applyExternalPlaybackRef.current = applyExternalPlayback;

  useImperativeHandle(forwardedRef, () => ({
    applyExternalPlayback: (...args) =>
      applyExternalPlaybackRef.current?.(...args),
  }));

  function updateCountInEnabled(nextIsEnabled) {
    isCountInEnabledRef.current = nextIsEnabled;
    setIsCountInEnabled(nextIsEnabled);

    if (!nextIsEnabled && isCountInActiveRef.current) {
      playAudioImmediately();
    }
  }

  useEffect(() => {
    if (timelineAnchorMeasureNumber > 0) {
      setTimelineAnchorMeasureInput(String(timelineAnchorMeasureNumber));
      setTimelineAnchorInputError('');
    }
  }, [timelineAnchorMeasureNumber]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) return;

    audio.playbackRate = playbackRate;
  }, [playbackRate, sourceUrl]);

  useEffect(() => {
    cancelCountIn();
    isExternalPlaybackUnlockedRef.current = false;
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setPlaybackError('');
  }, [sourceUrl]);

  useEffect(() => {
    setGlobalBpmInput(String(globalBpm || countInBpm || 120));
  }, [countInBpm, globalBpm, sourceUrl]);

  useEffect(
    () => () => {
      const audio = audioRef.current;

      if (audio && !audio.paused && playbackStateCallbackRef.current) {
        playbackStateCallbackRef.current({
          anchorPositionSeconds: audio.currentTime || 0,
          command: SHARED_AUDIO_PLAYBACK_COMMANDS.PAUSE,
          isPlaying: false,
          playbackRate: audio.playbackRate || 1,
        });
      }
      cancelCountIn(false);
      audioContextRef.current?.close?.().catch(() => {});
    },
    [],
  );

  useEffect(() => {
    if (!isPlaying) return undefined;

    function updateCurrentTime() {
      if (audioRef.current) {
        const nextTime = audioRef.current.currentTime;

        if (isEditorVisible) setCurrentTime(nextTime);
        notifyTimelineMeasure(nextTime);
      }
      animationFrameRef.current = window.requestAnimationFrame(updateCurrentTime);
    }

    animationFrameRef.current = window.requestAnimationFrame(updateCurrentTime);

    return () => window.cancelAnimationFrame(animationFrameRef.current);
  }, [isEditorVisible, isPlaying]);

  useEffect(() => {
    notifyTimelineMeasure(audioRef.current?.currentTime || 0);
  }, [measureMarkers, sourceUrl, timelineFollowEnabled]);

  useEffect(() => {
    if (!seekRequest || duration <= 0) return;

    seekToTimeRef.current?.(seekRequest.timeSeconds, {
      playAfterSeek: Boolean(seekRequest.playAfterSeek),
    });
  }, [duration, seekRequest]);

  useEffect(() => {
    if (!externalPlaybackLocked || !externalPlaybackSnapshot || duration <= 0) {
      return;
    }

    applyExternalPlaybackRef.current?.(externalPlaybackSnapshot);
  }, [
    duration,
    externalPlaybackLocked,
    externalPlaybackSnapshot,
    externalPlaybackSyncVersion,
    serverClockOffsetMs,
  ]);

  useEffect(() => {
    if (
      !externalPlaybackLocked ||
      !externalPlaybackSnapshot?.isPlaying ||
      duration <= 0
    ) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      applyExternalPlaybackRef.current?.(externalPlaybackSnapshot);
    }, SHARED_AUDIO_DRIFT_CHECK_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [duration, externalPlaybackLocked, externalPlaybackSnapshot]);

  const displayedCountInTiming = getCurrentCountInTiming();
  const canEditPersonalTimeline = showPracticeTools && !externalPlaybackLocked;
  const shouldShowFirstMeasureAnchorEditor = showPracticeTools;
  const shouldShowTimelineAnchorEditor = Boolean(
    !showPracticeTools && onTimelineAnchorSet,
  );
  const storedFirstMeasureAnchorSeconds =
    personalFirstMeasureAnchorSeconds ?? firstMeasureAnchorSeconds;
  const canEditFirstMeasureAnchor = Boolean(
    !externalPlaybackLocked &&
      onFirstMeasureAnchorChange &&
      !(canUseTeacherTimelineAnchor && useTeacherTimelineAnchor),
  );

  function setCurrentPositionAsTimelineAnchor() {
    const measureNumber = Number(timelineAnchorMeasureInput);

    if (
      !Number.isInteger(measureNumber) ||
      measureNumber < 1 ||
      measureNumber > timelineAnchorMeasureCount
    ) {
      setTimelineAnchorInputError(
        timelineAnchorMeasureCount > 0
          ? `기준 마디는 1부터 ${timelineAnchorMeasureCount} 사이의 정수로 입력해주세요.`
          : '먼저 마디 정보를 등록하거나 불러와주세요.',
      );
      return;
    }

    setTimelineAnchorInputError('');
    onTimelineAnchorSet?.({
      measureNumber,
      positionSeconds: Number(currentTime.toFixed(3)),
    });
  }

  return (
    <div className="local-audio-player">
      <strong className="local-audio-file-name" title={fileName}>
        {fileName}
      </strong>
      <audio
        controls={!externalPlaybackLocked}
        key={sourceUrl}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
        onEnded={(event) => {
          setIsPlaying(false);
          setCurrentTime(event.currentTarget.duration || currentTime);
          notifyTimelineMeasure(event.currentTarget.duration || currentTime);
          notifyPlaybackState(
            SHARED_AUDIO_PLAYBACK_COMMANDS.PAUSE,
            event.currentTarget,
          );
        }}
        onError={() =>
          setPlaybackError('이 기기에서 재생할 수 없는 음원 형식입니다.')
        }
        onLoadedMetadata={() => {
          setPlaybackError('');
          setDuration(audioRef.current?.duration || 0);
          seekToStartOffset();
        }}
        onPause={(event) => {
          setIsPlaying(false);
          notifyTimelineMeasure(event.currentTarget.currentTime);
          if (!isApplyingExternalPlaybackRef.current) {
            notifyPlaybackState(
              SHARED_AUDIO_PLAYBACK_COMMANDS.PAUSE,
              event.currentTarget,
            );
          }
        }}
        onPlay={(event) => {
          if (externalPlaybackLocked || isApplyingExternalPlaybackRef.current) {
            setIsPlaying(true);
            return;
          }

          if (!showPracticeTools) {
            setIsPlaying(true);
            notifyPlaybackState(
              SHARED_AUDIO_PLAYBACK_COMMANDS.PLAY,
              event.currentTarget,
            );
            return;
          }

          if (isCountInPlaybackRef.current) {
            isCountInPlaybackRef.current = false;
            setIsPlaying(true);
            return;
          }

          if (!isCountInEnabledRef.current) {
            setIsPlaying(true);
            return;
          }

          event.currentTarget.pause();
          setIsPlaying(false);
          startCountIn();
        }}
        onRateChange={(event) => {
          setPlaybackRate(event.currentTarget.playbackRate || 1);
          if (!isApplyingExternalPlaybackRef.current) {
            notifyPlaybackState(
              SHARED_AUDIO_PLAYBACK_COMMANDS.RATE,
              event.currentTarget,
            );
          }
        }}
        onSeeked={(event) => {
          setCurrentTime(event.currentTarget.currentTime);
          if (!isApplyingExternalPlaybackRef.current) {
            notifyPlaybackState(
              SHARED_AUDIO_PLAYBACK_COMMANDS.SEEK,
              event.currentTarget,
            );
          }
        }}
        onTimeUpdate={(event) => {
          setCurrentTime(event.currentTarget.currentTime);
          notifyTimelineMeasure(event.currentTarget.currentTime);
        }}
        preload="metadata"
        ref={audioRef}
        src={sourceUrl}
      >
        이 브라우저는 오디오 재생을 지원하지 않습니다.
      </audio>
      {externalPlaybackLocked && (
        <small className="shared-audio-follow-status">
          수업 따라가기: 재생 위치와 속도는 Teacher가 제어합니다.
        </small>
      )}
      <div className="local-audio-editor" hidden={!isEditorVisible}>
        {canEditPersonalTimeline && (
          <>
            <div className={`audio-count-in ${isCountInActive ? 'active' : ''}`}>
              <label className="audio-count-in-toggle">
                <input
                  checked={isCountInEnabled}
                  onChange={(event) =>
                    updateCountInEnabled(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>예비박</span>
              </label>
              <strong>
                {!isCountInEnabled
                  ? 'OFF'
                  : countInBeat
                    ? `${countInBeat} / ${displayedCountInTiming.beats}`
                    : `BPM ${displayedCountInTiming.bpm} · ${displayedCountInTiming.beats}박`}
              </strong>
            </div>
            <label className="audio-timeline-follow-toggle">
              <input
                checked={timelineFollowEnabled}
                onChange={(event) =>
                  onTimelineFollowEnabledChange?.(event.target.checked)
                }
                type="checkbox"
              />
              <span>음원 따라가기</span>
            </label>
          </>
        )}
        <AudioWaveform
          audioFile={audioFile}
          currentTime={currentTime}
          duration={duration}
          isVisible={isEditorVisible}
          isInteractionDisabled={externalPlaybackLocked}
          measureMarkers={measureMarkers}
          onSeek={externalPlaybackLocked ? null : seekToTime}
          startOffsetSeconds={startOffsetSeconds}
          targetMeasureId={targetMeasureId}
        />
        <div className="local-audio-options">
          <label>
            재생속도
            <select
              disabled={externalPlaybackLocked}
              onChange={(event) => updatePlaybackRate(event.target.value)}
              value={playbackRate}
            >
              {LOCAL_AUDIO_PLAYBACK_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {rate}x
                </option>
              ))}
            </select>
          </label>
          {canEditPersonalTimeline && (
            <button onClick={seekToStartOffset} type="button">
              오프셋으로 이동
            </button>
          )}
        </div>
        {showPracticeTools && (
          <section className="audio-global-tempo-editor">
            <div className="audio-measure-marker-header">
              <strong>개인 전체 템포</strong>
              <span>이 기기만 적용</span>
            </div>
            <div className="audio-global-tempo-actions">
              <input
                aria-label="개인 전체 템포 BPM"
                disabled={externalPlaybackLocked || useTeacherTempo}
                inputMode="decimal"
                min="1"
                onChange={(event) => setGlobalBpmInput(event.target.value)}
                step="1"
                type="number"
                value={globalBpmInput}
              />
              <button
                disabled={
                  externalPlaybackLocked || useTeacherTempo || !onGlobalBpmApply
                }
                onClick={() => onGlobalBpmApply?.(globalBpmInput)}
                type="button"
              >
                전체 적용
              </button>
            </div>
            <label className="audio-timeline-preference-toggle">
              <input
                checked={useTeacherTempo}
                disabled={externalPlaybackLocked}
                onChange={(event) =>
                  onUseTeacherTempoChange?.(event.target.checked)
                }
                type="checkbox"
              />
              <span>선생님 템포 사용</span>
            </label>
            <small>
              {useTeacherTempo
                ? 'Teacher의 전체 템포와 마디별 BPM 예외를 사용합니다.'
                : '개인 전체 템포와 현재 마디 개인 예외를 사용합니다.'}
            </small>
          </section>
        )}
        {canEditPersonalTimeline && (
          <>
            <button
              disabled={!duration}
              onClick={() =>
                onStartOffsetChange?.(Number(currentTime.toFixed(3)))
              }
              type="button"
            >
              현재 위치를 재생 시작점으로 지정
            </button>
          </>
        )}
        {shouldShowTimelineAnchorEditor && (
          <section className="audio-timeline-anchor-editor">
            <div className="audio-measure-marker-header">
              <strong>음원 마디 기준점</strong>
              <span>현재 위치: {formatAudioTime(currentTime)}</span>
            </div>
            <label className="audio-timeline-anchor-input">
              <span>기준 마디</span>
              <input
                aria-label="음원 기준 마디"
                inputMode="numeric"
                max={timelineAnchorMeasureCount || undefined}
                min="1"
                onChange={(event) => {
                  setTimelineAnchorMeasureInput(event.target.value);
                  setTimelineAnchorInputError('');
                }}
                step="1"
                type="number"
                value={timelineAnchorMeasureInput}
              />
              <span>마디</span>
            </label>
            {timelineAnchorInputError && (
              <small className="audio-timeline-anchor-error">
                {timelineAnchorInputError}
              </small>
            )}
            <div className="audio-timeline-anchor-summary">
              <span>
                기준 마디:{' '}
                {timelineAnchorMeasureNumber > 0
                  ? timelineAnchorMeasureNumber
                  : '미지정'}
              </span>
              <span>
                기준 시간:{' '}
                {timelineAnchor
                  ? formatAudioTime(timelineAnchor.positionSeconds)
                  : '미지정'}
              </span>
              <span>
                계산된 1마디 시작:{' '}
                {timelineAnchorFirstMeasureSeconds < 0
                  ? '음원 시작 이전'
                  : timelineAnchorFirstMeasureSeconds === null ||
                      timelineAnchorFirstMeasureSeconds === undefined
                  ? '계산 불가'
                  : formatAudioTime(timelineAnchorFirstMeasureSeconds)}
              </span>
            </div>
            {timelineAnchorFirstMeasureSeconds < 0 && (
              <small className="audio-timeline-anchor-error">
                현재 기준점과 템포 정보로 계산하면 1마디가 음원 시작 이전이
                됩니다. 기준 마디, 템포와 박자를 확인해주세요.
              </small>
            )}
            <small>
              입력한 기준 마디와 각 마디의 BPM/Beats로 앞뒤 시작 시간을
              계산합니다.
            </small>
            <div className="audio-measure-marker-actions">
              <button
                disabled={!duration || timelineAnchorMeasureCount === 0}
                onClick={setCurrentPositionAsTimelineAnchor}
                type="button"
              >
                현재 위치를 기준 마디 시작으로 지정
              </button>
              <button
                disabled={!timelineAnchor}
                onClick={() => seekToTime(timelineAnchor?.positionSeconds)}
                type="button"
              >
                기준 위치로 이동
              </button>
              <button
                disabled={!timelineAnchor}
                onClick={() => onTimelineAnchorClear?.()}
                type="button"
              >
                지정 해제
              </button>
            </div>
          </section>
        )}
        {shouldShowFirstMeasureAnchorEditor && (
          <section className="audio-first-measure-anchor-editor">
            <div className="audio-measure-marker-header">
              <strong>1마디 시작 위치</strong>
              <span>
                {firstMeasureAnchorSeconds === null ||
                firstMeasureAnchorSeconds === undefined
                  ? '미지정'
                  : formatAudioTime(firstMeasureAnchorSeconds)}
              </span>
            </div>
            {canUseTeacherTimelineAnchor && (
              <label className="audio-timeline-preference-toggle">
                <input
                  checked={useTeacherTimelineAnchor}
                  disabled={externalPlaybackLocked}
                  onChange={(event) =>
                    onUseTeacherTimelineAnchorChange?.(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>선생님 마디 기준 사용</span>
              </label>
            )}
            <small>
              {canUseTeacherTimelineAnchor && useTeacherTimelineAnchor
                ? 'Teacher가 선택 마디에 지정한 기준으로 전체 타임라인을 계산합니다.'
                : showPracticeTools
                  ? '이 기기와 현재 음원에만 개인 기준을 저장합니다.'
                  : '공용 음원의 수업 기준으로 Student에게 전달됩니다.'}
            </small>
            <div className="audio-measure-marker-actions">
              <button
                disabled={!duration || !canEditFirstMeasureAnchor}
                onClick={() =>
                  onFirstMeasureAnchorChange?.(
                    Number(currentTime.toFixed(3)),
                  )
                }
                type="button"
              >
                현재 위치를 1마디로 지정
              </button>
              <button
                disabled={
                  externalPlaybackLocked ||
                  firstMeasureAnchorSeconds === null ||
                  firstMeasureAnchorSeconds === undefined
                }
                onClick={() => seekToTime(firstMeasureAnchorSeconds)}
                type="button"
              >
                1마디로 이동
              </button>
              <button
                disabled={
                  !canEditFirstMeasureAnchor ||
                  storedFirstMeasureAnchorSeconds === null ||
                  storedFirstMeasureAnchorSeconds === undefined
                }
                onClick={() => onFirstMeasureAnchorChange?.(null)}
                type="button"
              >
                지정 해제
              </button>
            </div>
          </section>
        )}
        {canEditPersonalTimeline && targetMeasureNumber !== 1 && (
          <section className="audio-measure-marker-editor">
            <div className="audio-measure-marker-header">
              <strong>
                {targetMeasureNumber
                  ? `${targetMeasureNumber}마디 음원 위치`
                  : '마디 음원 위치'}
              </strong>
              <span>
                {measureMarkerTimeSeconds !== null
                  ? `${formatAudioTime(measureMarkerTimeSeconds)} · 직접 지정`
                  : measureTimelineTimeSeconds !== null
                    ? `${formatAudioTime(measureTimelineTimeSeconds)} · 자동 계산`
                    : '미지정'}
              </span>
            </div>
            <small>
              악보의 마디 박스를 누른 뒤 파형에서 정확한 위치를 맞춰주세요.
            </small>
            <div className="audio-measure-marker-actions">
              <button
                disabled={!duration || !targetMeasureId}
                onClick={() =>
                  onMeasureMarkerChange?.(
                    targetMeasureId,
                    Number(currentTime.toFixed(3)),
                  )
                }
                type="button"
              >
                현재 위치 지정
              </button>
              <button
                disabled={measureTimelineTimeSeconds === null}
                onClick={() => seekToTime(measureTimelineTimeSeconds)}
                type="button"
              >
                마디 위치로 이동
              </button>
              <button
                disabled={measureMarkerTimeSeconds === null || !targetMeasureId}
                onClick={() => onMeasureMarkerRemove?.(targetMeasureId)}
                type="button"
              >
                지정 해제
              </button>
            </div>
          </section>
        )}
        {canEditPersonalTimeline && (
          <section className="audio-measure-timing-editor">
            <div className="audio-measure-marker-header">
              <strong>
                {targetMeasureNumber
                  ? `${targetMeasureNumber}마디 개인 템포`
                  : '현재 마디 개인 템포'}
              </strong>
              <span>
                {useTeacherTempo
                  ? '선생님 템포 적용 중'
                  : hasPersonalMeasureTiming
                    ? '개인 예외'
                    : '개인 전체 템포'}
              </span>
            </div>
            <div className="audio-measure-timing-inputs">
              <label>
                BPM
                <input
                  disabled={!targetMeasureId || useTeacherTempo}
                  min="1"
                  onChange={(event) =>
                    onMeasureTimingChange?.(targetMeasureId, {
                      beats: countInBeats,
                      bpm: event.target.value,
                    })
                  }
                  step="1"
                  type="number"
                  value={countInBpm}
                />
              </label>
              <label>
                Beats
                <input
                  disabled={!targetMeasureId || useTeacherTempo}
                  min="1"
                  onChange={(event) =>
                    onMeasureTimingChange?.(targetMeasureId, {
                      beats: event.target.value,
                      bpm: countInBpm,
                    })
                  }
                  step="1"
                  type="number"
                  value={countInBeats}
                />
              </label>
            </div>
            <button
              disabled={!targetMeasureId || !hasPersonalMeasureTiming}
              onClick={() => onMeasureTimingReset?.(targetMeasureId)}
              type="button"
            >
              현재 마디 개인 설정 해제
            </button>
            <small>이 기기의 현재 PDF와 음원 조합에만 저장됩니다.</small>
          </section>
        )}
      </div>
      {playbackError && <small className="audio-error">{playbackError}</small>}
    </div>
  );
});

export default LocalAudioPlayer;
