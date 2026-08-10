import { useEffect, useRef, useState } from 'react';

import {
  createWaveformPeaks,
  formatAudioTime,
  getPinchWaveformState,
  getWaveformDraggedTime,
  getWaveformPointerTime,
  getWaveformVisibleDuration,
  LOCAL_AUDIO_WAVEFORM_MAX_ZOOM,
  LOCAL_AUDIO_WAVEFORM_MIN_ZOOM,
  normalizeWaveformZoom,
} from '../utils/audioPlayback.js';

const WAVEFORM_HEIGHT = 120;
const WAVEFORM_PEAK_COUNT = 4_096;

function decodeAudioFile(audioFile) {
  const OfflineAudioContextConstructor =
    window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  const context = OfflineAudioContextConstructor
    ? new OfflineAudioContextConstructor(1, 1, 44_100)
    : AudioContextConstructor
      ? new AudioContextConstructor()
      : null;

  if (!context) {
    return Promise.reject(new Error('Web Audio API is unavailable'));
  }

  return audioFile
    .arrayBuffer()
    .then(
      (arrayBuffer) =>
        new Promise((resolve, reject) => {
          context.decodeAudioData(arrayBuffer, resolve, reject);
        }),
    )
    .finally(() => {
      context.close?.().catch(() => {});
    });
}

export default function AudioWaveform({
  audioFile,
  currentTime,
  duration,
  isVisible,
  measureMarkers = [],
  onSeek,
  startOffsetSeconds,
  targetMeasureId,
}) {
  const canvasRef = useRef(null);
  const dragStateRef = useRef(null);
  const pinchStateRef = useRef(null);
  const pointerPositionsRef = useRef(new Map());
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [peaks, setPeaks] = useState(null);
  const [waveformError, setWaveformError] = useState('');
  const [waveformStatus, setWaveformStatus] = useState('파형 준비 중');
  const [zoom, setZoom] = useState(1);
  const visibleDuration = getWaveformVisibleDuration(duration, zoom);

  useEffect(() => {
    if (!audioFile) {
      setPeaks(null);
      setWaveformError('');
      setWaveformStatus('파형 준비 중');
      return;
    }

    let isCancelled = false;

    setPeaks(null);
    setWaveformError('');
    setWaveformStatus('파형 분석 중');

    decodeAudioFile(audioFile)
      .then((audioBuffer) => {
        if (isCancelled) return;

        const channels = Array.from(
          { length: audioBuffer.numberOfChannels },
          (_, channelIndex) => audioBuffer.getChannelData(channelIndex),
        );

        setPeaks(createWaveformPeaks(channels, WAVEFORM_PEAK_COUNT));
        setWaveformStatus('');
      })
      .catch(() => {
        if (isCancelled) return;

        setWaveformError(
          '이 음원은 재생할 수 있지만 브라우저에서 파형을 분석하지 못했습니다.',
        );
        setWaveformStatus('');
      });

    return () => {
      isCancelled = true;
    };
  }, [audioFile]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return undefined;

    function measureCanvas() {
      const nextWidth = canvas.getBoundingClientRect().width;

      setCanvasWidth((previousWidth) =>
        Math.abs(previousWidth - nextWidth) < 0.5 ? previousWidth : nextWidth,
      );
    }

    measureCanvas();
    const observer = new ResizeObserver(measureCanvas);

    observer.observe(canvas);

    return () => observer.disconnect();
  }, [isVisible]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || !isVisible || canvasWidth <= 0) return;

    const devicePixelRatio = window.devicePixelRatio || 1;
    const bitmapWidth = Math.max(1, Math.round(canvasWidth * devicePixelRatio));
    const bitmapHeight = Math.round(WAVEFORM_HEIGHT * devicePixelRatio);

    if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
    if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;

    const context = canvas.getContext('2d');

    if (!context) return;

    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, canvasWidth, WAVEFORM_HEIGHT);
    context.fillStyle = '#15171b';
    context.fillRect(0, 0, canvasWidth, WAVEFORM_HEIGHT);

    const centerY = WAVEFORM_HEIGHT / 2;
    context.strokeStyle = '#3b4047';
    context.beginPath();
    context.moveTo(0, centerY + 0.5);
    context.lineTo(canvasWidth, centerY + 0.5);
    context.stroke();

    if (peaks && duration > 0 && visibleDuration > 0) {
      const visibleStart = currentTime - visibleDuration / 2;
      const waveformHeight = WAVEFORM_HEIGHT - 24;

      context.strokeStyle = '#88d9ba';
      context.lineWidth = 1;
      context.beginPath();

      for (let x = 0; x < canvasWidth; x += 1) {
        const timeAtX = visibleStart + (x / canvasWidth) * visibleDuration;

        if (timeAtX < 0 || timeAtX > duration) continue;

        const peakIndex = Math.min(
          peaks.length - 1,
          Math.floor((timeAtX / duration) * peaks.length),
        );
        const amplitude = (peaks[peakIndex] || 0) * (waveformHeight / 2);

        context.moveTo(x + 0.5, centerY - amplitude);
        context.lineTo(x + 0.5, centerY + amplitude);
      }

      context.stroke();

      const offsetX =
        ((Number(startOffsetSeconds) - visibleStart) / visibleDuration) *
        canvasWidth;

      if (offsetX >= 0 && offsetX <= canvasWidth) {
        context.strokeStyle = '#ffbd45';
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(offsetX, 0);
        context.lineTo(offsetX, WAVEFORM_HEIGHT);
        context.stroke();
      }

      measureMarkers.forEach((marker) => {
        const markerX =
          ((Number(marker.timeSeconds) - visibleStart) / visibleDuration) *
          canvasWidth;

        if (!Number.isFinite(markerX) || markerX < 0 || markerX > canvasWidth) {
          return;
        }

        const isTarget = marker.measureId === targetMeasureId;
        const isCalculated = marker.source === 'calculated';

        context.strokeStyle = isTarget
          ? '#ff4f5e'
          : isCalculated
            ? '#647d73'
            : '#4dcc83';
        context.lineWidth = isTarget ? 3 : 1.5;
        context.beginPath();
        context.moveTo(markerX, 0);
        context.lineTo(markerX, WAVEFORM_HEIGHT);
        context.stroke();

        context.fillStyle = isTarget
          ? '#ff8a94'
          : isCalculated
            ? '#a2b3ac'
            : '#8be2ad';
        context.font = 'bold 10px sans-serif';
        context.fillText(String(marker.measureNumber), markerX + 3, 12);
      });
    }

    context.strokeStyle = '#ff4f5e';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(canvasWidth / 2, 0);
    context.lineTo(canvasWidth / 2, WAVEFORM_HEIGHT);
    context.stroke();
  }, [
    canvasWidth,
    currentTime,
    duration,
    isVisible,
    measureMarkers,
    peaks,
    startOffsetSeconds,
    targetMeasureId,
    visibleDuration,
  ]);

  function handlePointerDown(event) {
    if (!duration || !visibleDuration) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointerPositionsRef.current.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
    });

    if (pointerPositionsRef.current.size >= 2) {
      const [firstPointer, secondPointer] = Array.from(
        pointerPositionsRef.current.values(),
      );
      const anchorClientX = (firstPointer.clientX + secondPointer.clientX) / 2;
      const distance = Math.hypot(
        secondPointer.clientX - firstPointer.clientX,
        secondPointer.clientY - firstPointer.clientY,
      );
      const rect = event.currentTarget.getBoundingClientRect();

      dragStateRef.current = null;
      pinchStateRef.current = {
        anchorClientX,
        anchorTime: getWaveformPointerTime({
          clientX: anchorClientX,
          currentTime,
          duration,
          rectLeft: rect.left,
          rectWidth: rect.width,
          visibleDuration,
        }),
        startDistance: Math.max(distance, 1),
        startZoom: zoom,
      };
      return;
    }

    dragStateRef.current = {
      hasMoved: false,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startTime: currentTime,
      visibleDuration,
    };
  }

  function handlePointerMove(event) {
    if (pointerPositionsRef.current.has(event.pointerId)) {
      pointerPositionsRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
    }

    const pinchState = pinchStateRef.current;

    if (pinchState && pointerPositionsRef.current.size >= 2) {
      event.preventDefault();
      const [firstPointer, secondPointer] = Array.from(
        pointerPositionsRef.current.values(),
      );
      const currentDistance = Math.hypot(
        secondPointer.clientX - firstPointer.clientX,
        secondPointer.clientY - firstPointer.clientY,
      );
      const rect = event.currentTarget.getBoundingClientRect();
      const nextWaveformState = getPinchWaveformState({
        anchorClientX: pinchState.anchorClientX,
        anchorTime: pinchState.anchorTime,
        currentDistance,
        duration,
        rectLeft: rect.left,
        rectWidth: rect.width,
        startDistance: pinchState.startDistance,
        startZoom: pinchState.startZoom,
      });

      setZoom(nextWaveformState.zoom);
      onSeek(nextWaveformState.currentTime);
      return;
    }

    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) return;

    event.preventDefault();
    dragState.hasMoved ||= Math.abs(event.clientX - dragState.startClientX) > 2;
    onSeek(
      getWaveformDraggedTime({
        currentClientX: event.clientX,
        duration,
        rectWidth: event.currentTarget.getBoundingClientRect().width,
        startClientX: dragState.startClientX,
        startTime: dragState.startTime,
        visibleDuration: dragState.visibleDuration,
      }),
    );
  }

  function handlePointerUp(event) {
    const wasPinching = Boolean(pinchStateRef.current);

    pointerPositionsRef.current.delete(event.pointerId);
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    if (wasPinching) {
      event.preventDefault();
      pinchStateRef.current = null;
      dragStateRef.current = null;
      return;
    }

    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) return;

    event.preventDefault();
    if (!dragState.hasMoved) {
      const rect = event.currentTarget.getBoundingClientRect();

      onSeek(
        getWaveformPointerTime({
          clientX: event.clientX,
          currentTime: dragState.startTime,
          duration,
          rectLeft: rect.left,
          rectWidth: rect.width,
          visibleDuration: dragState.visibleDuration,
        }),
      );
    }

    dragStateRef.current = null;
  }

  function handlePointerCancel(event) {
    pointerPositionsRef.current.delete(event.pointerId);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragStateRef.current = null;
    pinchStateRef.current = null;
  }

  function handleKeyDown(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    const step = Math.max(visibleDuration / 100, 0.01);

    onSeek(currentTime + direction * step);
  }

  return (
    <div className="audio-waveform-editor">
      <div className="audio-waveform-time">
        <strong>{formatAudioTime(currentTime)}</strong>
        <span>{formatAudioTime(duration)}</span>
      </div>
      <div className="audio-waveform-surface">
        <canvas
          aria-label="음원 파형 탐색"
          aria-valuemax={duration || 0}
          aria-valuemin="0"
          aria-valuenow={currentTime || 0}
          className="audio-waveform-canvas"
          onKeyDown={handleKeyDown}
          onPointerCancel={handlePointerCancel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          ref={canvasRef}
          role="slider"
          tabIndex="0"
        />
        {waveformStatus && (
          <span className="audio-waveform-status">{waveformStatus}</span>
        )}
      </div>
      <label className="audio-waveform-zoom">
        파형 확대
        <input
          aria-label="파형 확대 배율"
          max={LOCAL_AUDIO_WAVEFORM_MAX_ZOOM}
          min={LOCAL_AUDIO_WAVEFORM_MIN_ZOOM}
          onChange={(event) =>
            setZoom(normalizeWaveformZoom(event.target.value))
          }
          step="1"
          type="range"
          value={zoom}
        />
      </label>
      <small>
        파형을 좌우로 드래그해 위치를 조절하고 두 손가락으로 확대·축소합니다.
      </small>
      {waveformError && <small className="audio-error">{waveformError}</small>}
    </div>
  );
}
