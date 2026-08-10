import assert from 'node:assert/strict';
import test from 'node:test';

import { getLocalAudioStartTime } from '../src/utils/audioPlayback.js';
import {
  applyStudentAudioTimelineBpm,
  createAudioTimelineAnchor,
  createLocalAudioIdentity,
  createStudentAudioTimelineKey,
  getAudioTimelineAnchorMeasureIndex,
  getAudioTimelineFirstMeasureStartSeconds,
  getAudioTimelineMarkersFromAnchor,
  getAudioTimelinePlaybackMarkers,
  getAudioTimelinePlaybackTimings,
  getAudioTimelineMarkerAtTime,
  getEffectiveAudioTimelineMarkers,
  getMeasureTimelineTiming,
  getMeasureTimelineTime,
  getStudentAudioTimelineMarkers,
  getStudentAudioTimelineTimings,
  loadStudentAudioTimelineLibrary,
  removeStudentAudioTimelineMarker,
  removeStudentAudioTimelineTiming,
  saveStudentAudioTimelineLibrary,
  setFirstMeasureTimelineAnchor,
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

test('one explicit marker calculates following measure times from BPM and Beats', () => {
  const measures = [
    { beats: 4, bpm: 120, id: 'measure-1' },
    { beats: 4, bpm: 60, id: 'measure-2' },
    { beats: 3, bpm: 90, id: 'measure-3' },
    { beats: 4, bpm: 120, id: 'measure-4' },
  ];

  assert.deepEqual(
    getEffectiveAudioTimelineMarkers({
      markers: [{ measureId: 'measure-1', timeSeconds: 10 }],
      measures,
      timings: [],
    }),
    [
      { measureId: 'measure-1', source: 'explicit', timeSeconds: 10 },
      { measureId: 'measure-2', source: 'calculated', timeSeconds: 12 },
      { measureId: 'measure-3', source: 'calculated', timeSeconds: 16 },
      { measureId: 'measure-4', source: 'calculated', timeSeconds: 18 },
    ],
  );
});

test('personal timing and later explicit markers reset the calculated timeline', () => {
  const measures = [
    { beats: 4, bpm: 120, id: 'measure-1' },
    { beats: 4, bpm: 60, id: 'measure-2' },
    { beats: 3, bpm: 90, id: 'measure-3' },
    { beats: 4, bpm: 120, id: 'measure-4' },
  ];
  const markers = getEffectiveAudioTimelineMarkers({
    markers: [
      { measureId: 'measure-1', timeSeconds: 10 },
      { measureId: 'measure-3', timeSeconds: 20 },
    ],
    measures,
    timings: [{ beats: 4, bpm: 120, measureId: 'measure-2' }],
  });

  assert.deepEqual(markers, [
    { measureId: 'measure-1', source: 'explicit', timeSeconds: 10 },
    { measureId: 'measure-2', source: 'calculated', timeSeconds: 12 },
    { measureId: 'measure-3', source: 'explicit', timeSeconds: 20 },
    { measureId: 'measure-4', source: 'calculated', timeSeconds: 22 },
  ]);
  assert.equal(getAudioTimelineMarkerAtTime(markers, 19.999)?.measureId, 'measure-2');
  assert.equal(getAudioTimelineMarkerAtTime(markers, 20)?.measureId, 'measure-3');
});

test('effective timeline stays empty until a valid explicit marker exists', () => {
  const measures = [
    { beats: 4, bpm: 120, id: 'measure-1' },
    { beats: 4, bpm: 120, id: 'measure-2' },
  ];

  assert.deepEqual(
    getEffectiveAudioTimelineMarkers({ markers: [], measures, timings: [] }),
    [],
  );
  assert.deepEqual(
    getEffectiveAudioTimelineMarkers({
      markers: [{ measureId: 'missing-measure', timeSeconds: 5 }],
      measures,
      timings: [],
    }),
    [],
  );
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

test('student global BPM stays local, preserves anchors, and recalculates the timeline', () => {
  const timelineKey = 'teacher:score.pdf|local-audio:lesson.wav:100:10';
  const teacherMeasures = [
    { beats: 4, bpm: 120, id: 'measure-1' },
    { beats: 3, bpm: 90, id: 'measure-2' },
    { beats: 4, bpm: 100, id: 'measure-3' },
  ];
  const teacherSnapshot = structuredClone(teacherMeasures);
  let library = setStudentAudioTimelineMarker(null, timelineKey, {
    measureId: 'measure-1',
    timeSeconds: 10,
  });

  library = setStudentAudioTimelineTiming(library, timelineKey, {
    beats: 5,
    bpm: 80,
    measureId: 'measure-2',
  });
  library = applyStudentAudioTimelineBpm(
    library,
    timelineKey,
    teacherMeasures,
    126,
  );

  const markers = getStudentAudioTimelineMarkers(library, timelineKey);
  const timings = getStudentAudioTimelineTimings(library, timelineKey);
  const effectiveMarkers = getEffectiveAudioTimelineMarkers({
    markers,
    measures: teacherMeasures,
    timings,
  });

  assert.deepEqual(teacherMeasures, teacherSnapshot);
  assert.deepEqual(markers, [
    { measureId: 'measure-1', timeSeconds: 10 },
  ]);
  assert.deepEqual(
    timings.map(({ beats, bpm, measureId }) => ({ beats, bpm, measureId })),
    [
      { beats: 4, bpm: 126, measureId: 'measure-1' },
      { beats: 5, bpm: 126, measureId: 'measure-2' },
      { beats: 4, bpm: 126, measureId: 'measure-3' },
    ],
  );
  assert.deepEqual(effectiveMarkers, [
    { measureId: 'measure-1', source: 'explicit', timeSeconds: 10 },
    { measureId: 'measure-2', source: 'calculated', timeSeconds: 11.905 },
    { measureId: 'measure-3', source: 'calculated', timeSeconds: 14.286 },
  ]);
});

test('Teacher tempo preference preserves the project tempo map and personal timings', () => {
  const teacherMeasures = [
    { beats: 4, bpm: 126, id: 'measure-1' },
    { beats: 4, bpm: 140, id: 'measure-2' },
    { beats: 3, bpm: 126, id: 'measure-3' },
  ];
  const personalTimings = [
    { beats: 4, bpm: 100, measureId: 'measure-1' },
    { beats: 4, bpm: 100, measureId: 'measure-2' },
    { beats: 3, bpm: 90, measureId: 'measure-3' },
  ];
  const anchor = [{ measureId: 'measure-1', timeSeconds: 10 }];

  const teacherTempoTimeline = getEffectiveAudioTimelineMarkers({
    markers: anchor,
    measures: teacherMeasures,
    timings: getAudioTimelinePlaybackTimings(personalTimings, true),
  });
  const personalTempoTimeline = getEffectiveAudioTimelineMarkers({
    markers: anchor,
    measures: teacherMeasures,
    timings: getAudioTimelinePlaybackTimings(personalTimings, false),
  });

  assert.deepEqual(teacherTempoTimeline, [
    { measureId: 'measure-1', source: 'explicit', timeSeconds: 10 },
    { measureId: 'measure-2', source: 'calculated', timeSeconds: 11.905 },
    { measureId: 'measure-3', source: 'calculated', timeSeconds: 13.619 },
  ]);
  assert.deepEqual(personalTempoTimeline, [
    { measureId: 'measure-1', source: 'explicit', timeSeconds: 10 },
    { measureId: 'measure-2', source: 'calculated', timeSeconds: 12.4 },
    { measureId: 'measure-3', source: 'calculated', timeSeconds: 14.8 },
  ]);
  assert.equal(personalTimings[1].bpm, 100);
  assert.equal(teacherMeasures[1].bpm, 140);
});

test('measure 1, 2, and 3 anchors calculate both sides of the timeline', () => {
  const measures = [
    { beats: 4, bpm: 120, id: 'measure-1' },
    { beats: 3, bpm: 60, id: 'measure-2' },
    { beats: 3, bpm: 90, id: 'measure-3' },
    { beats: 5, bpm: 150, id: 'measure-4' },
  ];
  const cases = [
    {
      anchor: { measureId: 'measure-1', measureIndex: 0, positionSeconds: 1 },
      expectedTimes: [1, 3, 6, 8],
    },
    {
      anchor: { measureId: 'measure-2', measureIndex: 1, positionSeconds: 4 },
      expectedTimes: [2, 4, 7, 9],
    },
    {
      anchor: { measureId: 'measure-3', measureIndex: 2, positionSeconds: 7 },
      expectedTimes: [2, 4, 7, 9],
    },
  ];

  cases.forEach(({ anchor, expectedTimes }) => {
    const markers = getAudioTimelineMarkersFromAnchor({
      anchor,
      measures,
      timings: [],
    });

    assert.deepEqual(
      markers.map((marker) => marker.timeSeconds),
      expectedTimes,
    );
    assert.equal(
      markers.find((marker) => marker.source === 'anchor')?.measureId,
      anchor.measureId,
    );
  });
});

test('visible measure numbers create stable anchors independently from the current score measure', () => {
  const measures = Array.from({ length: 20 }, (_, index) => ({
    beats: 4,
    bpm: 120,
    id: `measure-${index + 1}`,
  }));
  const currentScoreMeasureNumber = 17;

  [1, 2, 3, 20].forEach((measureNumber) => {
    const anchor = createAudioTimelineAnchor({
      measureNumber,
      measures,
      positionSeconds: 5.2144,
    });

    assert.deepEqual(anchor, {
      measureId: `measure-${measureNumber}`,
      measureIndex: measureNumber - 1,
      positionSeconds: 5.214,
    });
  });
  assert.equal(
    createAudioTimelineAnchor({
      measureNumber: 3,
      measures,
      positionSeconds: 5.214,
    }).measureIndex,
    2,
  );
  assert.equal(currentScoreMeasureNumber, 17);
});

test('timeline anchor rejects invalid visible measure numbers', () => {
  const measures = Array.from({ length: 20 }, (_, index) => ({
    id: `measure-${index + 1}`,
  }));

  [0, -1, 21, 1.5, '', 'not-a-number'].forEach((measureNumber) => {
    assert.equal(
      createAudioTimelineAnchor({
        measureNumber,
        measures,
        positionSeconds: 5,
      }),
      null,
    );
  });
});

test('negative first-measure calculation is reported without clamping', () => {
  const measures = [
    { beats: 4, bpm: 120, id: 'measure-1' },
    { beats: 4, bpm: 120, id: 'measure-2' },
    { beats: 4, bpm: 120, id: 'measure-3' },
  ];
  const anchor = createAudioTimelineAnchor({
    measureNumber: 3,
    measures,
    positionSeconds: 2,
  });
  const markers = getAudioTimelineMarkersFromAnchor({
    anchor,
    measures,
    timings: [],
  });

  assert.equal(
    getAudioTimelineFirstMeasureStartSeconds({
      anchor,
      measures,
      timings: [],
    }),
    -2,
  );
  assert.deepEqual(markers, [
    { measureId: 'measure-2', source: 'calculated', timeSeconds: 0 },
    { measureId: 'measure-3', source: 'anchor', timeSeconds: 2 },
  ]);
});

test('timeline anchor prefers stable measure ID and supports measure timing overrides', () => {
  const measures = [
    { beats: 4, bpm: 120, id: 'measure-1' },
    { beats: 4, bpm: 120, id: 'measure-2' },
    { beats: 4, bpm: 120, id: 'measure-3' },
  ];
  const anchor = {
    measureId: 'measure-3',
    measureIndex: 0,
    positionSeconds: 8,
  };
  const markers = getAudioTimelineMarkersFromAnchor({
    anchor,
    measures,
    timings: [
      { beats: 2, bpm: 60, measureId: 'measure-2' },
    ],
  });

  assert.equal(getAudioTimelineAnchorMeasureIndex(anchor, measures), 2);
  assert.deepEqual(
    markers.map((marker) => marker.timeSeconds),
    [4, 6, 8],
  );
});

test('general timeline anchor remains independent from transport start offset', () => {
  const markers = getAudioTimelineMarkersFromAnchor({
    anchor: {
      measureId: 'measure-2',
      measureIndex: 1,
      positionSeconds: 10,
    },
    measures: [
      { beats: 4, bpm: 120, id: 'measure-1' },
      { beats: 3, bpm: 90, id: 'measure-2' },
      { beats: 4, bpm: 60, id: 'measure-3' },
    ],
    timings: [],
  });

  assert.equal(getLocalAudioStartTime(7.5, 60), 7.5);
  assert.deepEqual(
    markers.map((marker) => marker.timeSeconds),
    [8, 10, 12],
  );
});

test('Teacher and personal first-measure anchors swap without double-applying offset', () => {
  const measures = [
    { beats: 4, bpm: 120, id: 'measure-1' },
    { beats: 4, bpm: 120, id: 'measure-2' },
  ];
  const personalMarkers = [
    { measureId: 'measure-1', timeSeconds: 3 },
    { measureId: 'measure-2', timeSeconds: 20 },
  ];
  const teacherMarkers = setFirstMeasureTimelineAnchor(
    personalMarkers,
    'measure-1',
    12.35,
  );
  const teacherTimeline = getEffectiveAudioTimelineMarkers({
    markers: teacherMarkers.filter((marker) => marker.measureId !== 'measure-2'),
    measures,
    timings: [],
  });
  const transportStartTime = getLocalAudioStartTime(7.5, 60);

  assert.equal(transportStartTime, 7.5);
  assert.equal(getMeasureTimelineTime(personalMarkers, 'measure-1'), 3);
  assert.equal(getMeasureTimelineTime(teacherMarkers, 'measure-1'), 12.35);
  assert.deepEqual(teacherTimeline, [
    { measureId: 'measure-1', source: 'explicit', timeSeconds: 12.35 },
    { measureId: 'measure-2', source: 'calculated', timeSeconds: 14.35 },
  ]);
  assert.equal(
    getMeasureTimelineTime(
      setFirstMeasureTimelineAnchor(teacherMarkers, 'measure-1', null),
      'measure-1',
    ),
    null,
  );
});

test('audio source preference keeps personal anchor unless Teacher anchor is explicitly selected', () => {
  const personalMarkers = [
    { measureId: 'measure-1', timeSeconds: 3 },
    { measureId: 'measure-2', timeSeconds: 5 },
  ];

  const personalSourceMarkers = getAudioTimelinePlaybackMarkers({
    firstMeasureId: 'measure-1',
    markers: personalMarkers,
    teacherFirstMeasureAnchorSeconds: 12.35,
    useTeacherFirstMeasureAnchor: false,
  });
  const teacherSourceMarkers = getAudioTimelinePlaybackMarkers({
    firstMeasureId: 'measure-1',
    markers: personalMarkers,
    teacherFirstMeasureAnchorSeconds: 12.35,
    useTeacherFirstMeasureAnchor: true,
  });
  const updatedTeacherSourceMarkers = getAudioTimelinePlaybackMarkers({
    firstMeasureId: 'measure-1',
    markers: personalMarkers,
    teacherFirstMeasureAnchorSeconds: 15,
    useTeacherFirstMeasureAnchor: true,
  });

  assert.equal(getMeasureTimelineTime(personalSourceMarkers, 'measure-1'), 3);
  assert.equal(getMeasureTimelineTime(teacherSourceMarkers, 'measure-1'), 12.35);
  assert.equal(
    getMeasureTimelineTime(updatedTeacherSourceMarkers, 'measure-1'),
    15,
  );
  assert.equal(getMeasureTimelineTime(personalMarkers, 'measure-1'), 3);
});
