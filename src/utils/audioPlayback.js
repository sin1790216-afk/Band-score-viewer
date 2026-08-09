export const LOCAL_AUDIO_FILE_ACCEPT =
  'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.flac';
export const STUDENT_AUDIO_PICKER_RECOVERY_KEY =
  'band-score-viewer.student-audio-picker-recovery.v1';

export const LOCAL_AUDIO_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
export const LOCAL_AUDIO_WAVEFORM_MAX_ZOOM = 32;
export const LOCAL_AUDIO_WAVEFORM_MIN_ZOOM = 1;

const LOCAL_AUDIO_FILE_EXTENSIONS =
  /\.(aac|flac|m4a|mp3|oga|ogg|wav)$/i;

export function isSupportedLocalAudioFile(file) {
  if (!file || typeof file.name !== 'string') return false;

  return (
    (typeof file.type === 'string' && file.type.startsWith('audio/')) ||
    LOCAL_AUDIO_FILE_EXTENSIONS.test(file.name)
  );
}

export function getLocalAudioStartTime(startOffsetSeconds, duration) {
  const rawStartOffset = Number(startOffsetSeconds);
  const safeStartOffset =
    Number.isFinite(rawStartOffset) && rawStartOffset >= 0 ? rawStartOffset : 0;

  return Number.isFinite(duration) && duration >= 0
    ? Math.min(safeStartOffset, duration)
    : safeStartOffset;
}

export function normalizeLocalAudioPlaybackRate(playbackRate) {
  const numericRate = Number(playbackRate);

  return LOCAL_AUDIO_PLAYBACK_RATES.includes(numericRate) ? numericRate : 1;
}

export function clampAudioTime(timeSeconds, duration) {
  const numericTime = Number(timeSeconds);
  const safeTime = Number.isFinite(numericTime) ? Math.max(numericTime, 0) : 0;

  return Number.isFinite(duration) && duration >= 0
    ? Math.min(safeTime, duration)
    : safeTime;
}

export function normalizeWaveformZoom(zoom) {
  const numericZoom = Number(zoom);

  if (!Number.isFinite(numericZoom)) return LOCAL_AUDIO_WAVEFORM_MIN_ZOOM;

  return Math.min(
    Math.max(numericZoom, LOCAL_AUDIO_WAVEFORM_MIN_ZOOM),
    LOCAL_AUDIO_WAVEFORM_MAX_ZOOM,
  );
}

export function getWaveformVisibleDuration(duration, zoom) {
  const numericDuration = Number(duration);

  if (!Number.isFinite(numericDuration) || numericDuration <= 0) return 0;

  return numericDuration / normalizeWaveformZoom(zoom);
}

export function getWaveformPointerTime({
  clientX,
  currentTime,
  duration,
  rectLeft,
  rectWidth,
  visibleDuration,
}) {
  if (!Number.isFinite(rectWidth) || rectWidth <= 0) {
    return clampAudioTime(currentTime, duration);
  }

  const pointerRatio = (clientX - rectLeft) / rectWidth;
  const nextTime =
    currentTime + (pointerRatio - 0.5) * Math.max(visibleDuration, 0);

  return clampAudioTime(nextTime, duration);
}

export function getWaveformDraggedTime({
  currentClientX,
  duration,
  rectWidth,
  startClientX,
  startTime,
  visibleDuration,
}) {
  if (!Number.isFinite(rectWidth) || rectWidth <= 0) {
    return clampAudioTime(startTime, duration);
  }

  const draggedDuration =
    ((currentClientX - startClientX) / rectWidth) *
    Math.max(visibleDuration, 0);

  return clampAudioTime(startTime - draggedDuration, duration);
}

export function createWaveformPeaks(channelData, peakCount = 2_048) {
  const channels = Array.isArray(channelData)
    ? channelData.filter((channel) => channel?.length > 0)
    : [];
  const sampleLength = channels[0]?.length || 0;
  const normalizedPeakCount = Math.max(1, Math.floor(Number(peakCount) || 1));
  const peaks = new Float32Array(normalizedPeakCount);

  if (!sampleLength || channels.length === 0) return peaks;

  let largestPeak = 0;

  for (let peakIndex = 0; peakIndex < normalizedPeakCount; peakIndex += 1) {
    const sampleStart = Math.floor((peakIndex / normalizedPeakCount) * sampleLength);
    const sampleEnd = Math.max(
      sampleStart + 1,
      Math.floor(((peakIndex + 1) / normalizedPeakCount) * sampleLength),
    );
    const sampleStride = Math.max(1, Math.floor((sampleEnd - sampleStart) / 64));
    let peak = 0;

    channels.forEach((channel) => {
      for (
        let sampleIndex = sampleStart;
        sampleIndex < sampleEnd;
        sampleIndex += sampleStride
      ) {
        peak = Math.max(peak, Math.abs(channel[sampleIndex] || 0));
      }
    });

    peaks[peakIndex] = peak;
    largestPeak = Math.max(largestPeak, peak);
  }

  if (largestPeak > 0) {
    for (let peakIndex = 0; peakIndex < peaks.length; peakIndex += 1) {
      peaks[peakIndex] /= largestPeak;
    }
  }

  return peaks;
}

export function formatAudioTime(timeSeconds) {
  const safeTime = clampAudioTime(timeSeconds);
  const totalMilliseconds = Math.round(safeTime * 1_000);
  const minutes = Math.floor(totalMilliseconds / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1_000);
  const milliseconds = totalMilliseconds % 1_000;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
    2,
    '0',
  )}.${String(milliseconds).padStart(3, '0')}`;
}

export function markStudentAudioPickerRecovery(storage) {
  if (!storage?.setItem) return false;

  try {
    storage.setItem(STUDENT_AUDIO_PICKER_RECOVERY_KEY, 'pending');
    return true;
  } catch {
    return false;
  }
}

export function clearStudentAudioPickerRecovery(storage) {
  if (!storage?.removeItem) return false;

  try {
    storage.removeItem(STUDENT_AUDIO_PICKER_RECOVERY_KEY);
    return true;
  } catch {
    return false;
  }
}

export function consumeStudentAudioPickerRecovery(storage) {
  if (!storage?.getItem) return false;

  try {
    const shouldRecover =
      storage.getItem(STUDENT_AUDIO_PICKER_RECOVERY_KEY) === 'pending';

    storage.removeItem?.(STUDENT_AUDIO_PICKER_RECOVERY_KEY);
    return shouldRecover;
  } catch {
    return false;
  }
}
