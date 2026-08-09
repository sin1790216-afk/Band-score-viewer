import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLocalAudioIdentity,
  createStudentAudioTimelineKey,
  getAudioTimelineMarkerAtTime,
  getMeasureTimelineTiming,
  getMeasureTimelineTime,
  getStudentAudioTimelineMarkers,
  getStudentAudioTimelineTimings,
  loadStudentAudioTimelineLibrary,
  removeStudentAudioTimelineMarker,
  removeStudentAudioTimelineTiming,
  saveStudentAudioTimelineLibrary,
  setStudentAudioTimelineMarker,
  setStudentAudioTimelineTiming,
  STUDENT_AUDIO_TIMELINE_STORAGE_KEY,
} from '../src/utils/audioTimeline.js';

test('local audio timeline identity separates different files for the same PDF', () => {
  const firstAudioIdentity = createLocalAudioIdentity({
    lastModified: 10,
    name: 'lesson.wav',
    size: 100,
  });
  const secondAudioIdentity = createLocalAudioIdentity({
    lastModified: 20,
    name: 'lesson.wav',
    size: 100,
  });

  assert.notEqual(firstAudioIdentity, secondAudioIdentity);
  assert.notEqual(
    createStudentAudioTimelineKey('teacher:score.pdf', firstAudioIdentity),
    createStudentAudioTimelineKey('teacher:score.pdf', secondAudioIdentity),
  );
});

test('measure timeline markers update and remove by stable measure ID', () => {
  const timelineKey = 'teacher:score.pdf|local-audio:lesson.wav:100:10';
  let library = setStudentAudioTimelineMarker(null, timelineKey, {
    measureId: 'measure-1',
    timeSeconds: 1.2344,
  });

  library = setStudentAudioTimelineMarker(library, timelineKey, {
    measureId: 'measure-1',
    timeSeconds: 2.3456,
  });
  library = setStudentAudioTimelineMarker(library, timelineKey, {
    measureId: 'measure-2',
    timeSeconds: 8,
  });

  const markers = getStudentAudioTimelineMarkers(library, timelineKey);

  assert.equal(markers.length, 2);
  assert.equal(getMeasureTimelineTime(markers, 'measure-1'), 2.346);
  assert.equal(getMeasureTimelineTime(markers, 'measure-2'), 8);

  library = removeStudentAudioTimelineMarker(library, timelineKey, 'measure-1');
  assert.equal(
    getMeasureTimelineTime(
      getStudentAudioTimelineMarkers(library, timelineKey),
      'measure-1',
    ),
    null,
  );
});

test('student audio timeline round-trips through local storage', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const timelineKey = 'teacher:score.pdf|local-audio:lesson.wav:100:10';
  const library = setStudentAudioTimelineMarker(null, timelineKey, {
    measureId: 'measure-1',
    timeSeconds: 12.5,
  });

  assert.equal(saveStudentAudioTimelineLibrary(storage, library), true);
  assert.deepEqual(loadStudentAudioTimelineLibrary(storage), library);

  values.set(STUDENT_AUDIO_TIMELINE_STORAGE_KEY, '{bad json');
  assert.deepEqual(loadStudentAudioTimelineLibrary(storage), {
    timelines: {},
    version: 1,
  });
});

test('audio time selects the latest marker without depending on array order', () => {
  const markers = [
    { measureId: 'measure-3', timeSeconds: 12 },
    { measureId: 'measure-1', timeSeconds: 2 },
    { measureId: 'measure-2', timeSeconds: 8 },
  ];

  assert.equal(getAudioTimelineMarkerAtTime(markers, 1.999), null);
  assert.deepEqual(getAudioTimelineMarkerAtTime(markers, 2), markers[1]);
  assert.deepEqual(getAudioTimelineMarkerAtTime(markers, 9), markers[2]);
  assert.deepEqual(getAudioTimelineMarkerAtTime(markers, 99), markers[0]);
});

test('personal measure timing is local to an audio timeline and removable', () => {
  const timelineKey = 'teacher:score.pdf|local-audio:lesson.wav:100:10';
  let library = setStudentAudioTimelineTiming(null, timelineKey, {
    beats: 3,
    bpm: 90,
    measureId: 'measure-2',
  });

  assert.deepEqual(
    getMeasureTimelineTiming(
      getStudentAudioTimelineTimings(library, timelineKey),
      'measure-2',
    ),
    { beats: 3, bpm: 90, measureId: 'measure-2' },
  );

  library = setStudentAudioTimelineMarker(library, timelineKey, {
    measureId: 'measure-2',
    timeSeconds: 8,
  });
  assert.equal(
    getStudentAudioTimelineTimings(library, timelineKey).length,
    1,
  );

  library = removeStudentAudioTimelineTiming(library, timelineKey, 'measure-2');
  assert.equal(
    getStudentAudioTimelineTimings(library, timelineKey).length,
    0,
  );
});

test('legacy marker-only timelines receive an empty personal timing list', () => {
  const timelineKey = 'teacher:score.pdf|local-audio:lesson.wav:100:10';
  const normalized = loadStudentAudioTimelineLibrary({
    getItem: () =>
      JSON.stringify({
        timelines: {
          [timelineKey]: {
            markers: [{ measureId: 'measure-1', timeSeconds: 1 }],
          },
        },
        version: 1,
      }),
  });

  assert.deepEqual(normalized.timelines[timelineKey], {
    markers: [{ measureId: 'measure-1', timeSeconds: 1 }],
    timings: [],
  });
});
