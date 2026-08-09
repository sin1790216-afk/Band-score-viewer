import { useEffect, useRef, useState } from 'react';

import AudioWaveform from './AudioWaveform.jsx';
import {
  clampAudioTime,
  getLocalAudioStartTime,
  LOCAL_AUDIO_PLAYBACK_RATES,
  normalizeLocalAudioPlaybackRate,
} from '../utils/audioPlayback.js';

export default function LocalAudioPlayer({
  audioFile,
  fileName,
  isEditorVisible,
  onStartOffsetChange,
  sourceUrl,
  startOffsetSeconds,
}) {
  const audioRef = useRef(null);
  const animationFrameRef = useRef(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [playbackError, setPlaybackError] = useState('');

  function seekToStartOffset() {
    const audio = audioRef.current;

    if (!audio || audio.readyState < HTMLMediaElement.HAVE_METADATA) return;

    const nextTime = getLocalAudioStartTime(
      startOffsetSeconds,
      audio.duration,
    );

    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  function seekToTime(nextTime) {
    const audio = audioRef.current;

    if (!audio || audio.readyState < HTMLMediaElement.HAVE_METADATA) return;

    const clampedTime = clampAudioTime(nextTime, audio.duration);

    audio.currentTime = clampedTime;
    setCurrentTime(clampedTime);
  }

  function updatePlaybackRate(nextPlaybackRate) {
    const normalizedRate = normalizeLocalAudioPlaybackRate(nextPlaybackRate);

    setPlaybackRate(normalizedRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = normalizedRate;
    }
  }

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) return;

    audio.playbackRate = playbackRate;
  }, [playbackRate, sourceUrl]);

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
        onPlay={() => setIsPlaying(true)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        preload="metadata"
        ref={audioRef}
        src={sourceUrl}
      >
        이 브라우저는 오디오 재생을 지원하지 않습니다.
      </audio>
      <AudioWaveform
        audioFile={audioFile}
        currentTime={currentTime}
        duration={duration}
        isVisible={isEditorVisible}
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
      {playbackError && <small className="audio-error">{playbackError}</small>}
    </div>
  );
}
