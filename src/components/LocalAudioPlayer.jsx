import { useEffect, useRef, useState } from 'react';

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

export default function LocalAudioPlayer({
  audioFile,
  countInBeats,
  countInBpm,
  fileName,
  isEditorVisible,
  measureMarkerTimeSeconds,
  onMeasureMarkerChange,
  onMeasureMarkerRemove,
  onStartOffsetChange,
  seekRequest,
  sourceUrl,
  startOffsetSeconds,
  targetMeasureId,
  targetMeasureNumber,
}) {
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const animationFrameRef = useRef(0);
  const countInRunRef = useRef({ nodes: [], timerIds: [], version: 0 });
  const isCountInActiveRef = useRef(false);
  const isCountInEnabledRef = useRef(true);
  const isCountInPlaybackRef = useRef(false);
  const seekToTimeRef = useRef(null);
  const [countInBeat, setCountInBeat] = useState(0);
  const [isCountInActive, setIsCountInActive] = useState(false);
  const [isCountInEnabled, setIsCountInEnabled] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [playbackError, setPlaybackError] = useState('');

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
  }

  function seekToTime(nextTime, { playAfterSeek = false } = {}) {
    const audio = audioRef.current;

    if (!audio || audio.readyState < HTMLMediaElement.HAVE_METADATA) return;

    const clampedTime = clampAudioTime(nextTime, audio.duration);

    if (playAfterSeek) audio.pause();
    cancelCountIn();
    audio.currentTime = clampedTime;
    setCurrentTime(clampedTime);
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

  function updateCountInEnabled(nextIsEnabled) {
    isCountInEnabledRef.current = nextIsEnabled;
    setIsCountInEnabled(nextIsEnabled);

    if (!nextIsEnabled && isCountInActiveRef.current) {
      playAudioImmediately();
    }
  }

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) return;

    audio.playbackRate = playbackRate;
  }, [playbackRate, sourceUrl]);

  useEffect(
    () => () => {
      cancelCountIn(false);
      audioContextRef.current?.close?.().catch(() => {});
    },
    [],
  );

  useEffect(() => {
    if (!isPlaying || !isEditorVisible) return undefined;

    function updateCurrentTime() {
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime);
      }
      animationFrameRef.current = window.requestAnimationFrame(updateCurrentTime);
    }

    animationFrameRef.current = window.requestAnimationFrame(updateCurrentTime);

    return () => window.cancelAnimationFrame(animationFrameRef.current);
  }, [isEditorVisible, isPlaying]);

  useEffect(() => {
    if (!seekRequest || duration <= 0) return;

    seekToTimeRef.current?.(seekRequest.timeSeconds, {
      playAfterSeek: Boolean(seekRequest.playAfterSeek),
    });
  }, [duration, seekRequest]);

  const displayedCountInTiming = getCurrentCountInTiming();

  return (
    <div className="local-audio-player">
      <strong className="local-audio-file-name" title={fileName}>
        {fileName}
      </strong>
      <audio
        controls
        key={sourceUrl}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
        onEnded={() => setIsPlaying(false)}
        onError={() =>
          setPlaybackError('이 기기에서 재생할 수 없는 음원 형식입니다.')
        }
        onLoadedMetadata={() => {
          setPlaybackError('');
          setDuration(audioRef.current?.duration || 0);
          seekToStartOffset();
        }}
        onPause={() => setIsPlaying(false)}
        onPlay={(event) => {
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
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        preload="metadata"
        ref={audioRef}
        src={sourceUrl}
      >
        이 브라우저는 오디오 재생을 지원하지 않습니다.
      </audio>
      <div className={`audio-count-in ${isCountInActive ? 'active' : ''}`}>
        <label className="audio-count-in-toggle">
          <input
            checked={isCountInEnabled}
            onChange={(event) => updateCountInEnabled(event.target.checked)}
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
        {isCountInActive && (
          <button onClick={() => playAudioImmediately()} type="button">
            예비박 건너뛰기
          </button>
        )}
      </div>
      <AudioWaveform
        audioFile={audioFile}
        currentTime={currentTime}
        duration={duration}
        isVisible={isEditorVisible}
        measureMarkerTimeSeconds={measureMarkerTimeSeconds}
        onSeek={seekToTime}
        startOffsetSeconds={startOffsetSeconds}
      />
      <div className="local-audio-options">
        <label>
          재생속도
          <select
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
        <button onClick={seekToStartOffset} type="button">
          오프셋으로 이동
        </button>
      </div>
      <button
        disabled={!duration}
        onClick={() => onStartOffsetChange?.(Number(currentTime.toFixed(3)))}
        type="button"
      >
        현재 위치를 시작점으로 지정
      </button>
      <section className="audio-measure-marker-editor">
        <div className="audio-measure-marker-header">
          <strong>
            {targetMeasureNumber ? `${targetMeasureNumber}마디 음원 위치` : '마디 음원 위치'}
          </strong>
          <span>
            {measureMarkerTimeSeconds === null
              ? '미지정'
              : formatAudioTime(measureMarkerTimeSeconds)}
          </span>
        </div>
        <small>악보의 마디 박스를 누른 뒤 파형에서 정확한 위치를 맞춰주세요.</small>
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
            disabled={measureMarkerTimeSeconds === null}
            onClick={() => seekToTime(measureMarkerTimeSeconds)}
            type="button"
          >
            지정 위치로 이동
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
      {playbackError && <small className="audio-error">{playbackError}</small>}
    </div>
  );
}
