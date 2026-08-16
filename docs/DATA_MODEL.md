# 데이터 모델

## 현재 measure

JSON 파일은 measure 객체 배열이다. 기존 핵심 필드는 유지된다.

```js
{
  id: "measure-...",
  page: 1,
  x: 0.12,
  y: 0.18,
  width: 0.14,
  height: 0.09,
  bpm: 120,
  beats: 4,
  lyric: "",
  navigationEndings: [],
  navigationMarkers: [{ type: "repeat-start" }],
  coordinateSpace: "normalized-page-v1",
  coordinateStatus: "validated",
  coordinateWidth: 1,
  coordinateHeight: 1
}
```

- `id`: 프로젝트 안에서 고유하며 생성 후 바뀌지 않는 문자열 ID
- `page`: 1부터 시작하는 PDF 페이지 번호
- `x`, `y`, `width`, `height`: PDF 페이지 전체를 `1 x 1`로 본 정규화 좌표
- `bpm`, `beats`: 자동재생 시간 계산 값. 누락되거나 유효하지 않으면 각각 120, 4로 정규화
- `lyric`: 여러 줄을 포함할 수 있는 문자열. 누락되면 빈 문자열로 정규화
- `navigationMarkers`: 해당 물리 마디에 붙는 수동 악보 이동 표식. 현재
  `repeat-start`, `repeat-end`, `segno`, `dal-segno`를 지원하며 누락되면 빈 배열로 정규화
- `navigationEndings`: 반복 시작 마디가 소유하는 Generic Volta 범위. 누락되면 빈 배열로 정규화
- `coordinateSpace`: 현재 canonical 좌표 형식
- `coordinateStatus`: 좌표 변환 신뢰 상태
- `coordinateWidth`, `coordinateHeight`: 기존 JSON 필드 호환을 위해 정규화 기준인 `1`을 유지

기존 JSON에 `id`가 없으면 import 시 새 ID를 한 번 생성한다. 기존의 유효하고 고유한 ID는
정규화와 편집에서 보존하고, 중복되거나 비어 있는 ID만 유입 경계에서 교체한다. JSON 저장은
기존 measure 배열 구조를 유지하면서 ID를 함께 기록한다.

기존 `coordinateWidth/coordinateHeight`, `baseWidth/baseHeight`,
`pageWidth/pageHeight`가 있으면 해당 기준으로 canonical 좌표로 변환한다. 기준 metadata가
없는 JSON은 현재 DOM을 사용하지 않고 같은 페이지 legacy measure의 최대 범위만 사용하며
`legacy-bounds-unverified`로 표시한다. 이 경로는 기기마다 달라지지 않지만 실제 PDF 기준을
확정할 수 없으므로 실제 수업 데이터 검증이 필요하다. JSON 저장은 canonical measures
배열을 기록한다.

런타임의 Project State는 `{ metadata, pdfMetadata, audioSettings, measures }`로 구성된다.
`metadata`는 제목과 생성/수정 시각을, `pdfMetadata`는 PDF 파일명과 MIME type을 가진다.
`audioSettings`는 외부 음원 URL과 0 이상인 시작 오프셋(초)을 저장한다.

```js
audioSettings: {
  url: "https://example.com/track",
  startOffsetSeconds: 12.5
}
```

이 설정은 measure 배열 JSON에 포함하지 않으므로 기존 JSON 형식은 그대로 유지된다.

## Navigation과 Playback Step

Ending은 `ending1`, `ending2` 같은 고정 필드가 아니라 다음 collection 항목으로 저장한다.

```js
{
  id: "ending-...",
  type: "volta",
  startMeasureId: "measure-...",
  endMeasureId: "measure-...",
  passes: [1],
  repeatStartMeasureId: "measure-...",
  repeatEndMeasureId: "measure-...",
  source: "manual",
  confidence: 1
}
```

한 마디 Ending도 시작과 끝 ID가 같은 range다. Repeat section과 모든 범위는 배열 index가 아닌
stable measure ID로 연결한다. 수동 입력은 `manual/1` provenance를 사용하고, 향후 PDF 자동인식은
같은 구조에 `detected` source를 기록할 수 있다. PlaybackResolver는 provenance와 무관하게 이
canonical model만 사용한다.

Measure 배열은 PDF의 물리 순서를 유지하며 반복 방문을 위해 복제하지 않는다. 자동재생은
`navigationMarkers`에서 파생한 별도 Playback run을 사용한다. 각 step은 다음 최소 정보를 가진다.

```js
{
  measureId: "measure-...",
  measureIndex: 2,
  repeatSectionId: "repeat:measure-start:measure-end",
  repeatPass: 2,
  visitIndex: 4,
  visitCount: 2,
  enteredBy: "repeat"
}
```

`visitCount`는 동일 물리 마디의 재방문을 구분하고 `repeatPass`는 해당 Repeat section의 현재
pass를 나타낸다. Ending의 최대 pass가 반복 횟수를 결정하며, 현재 pass에 속하지 않는 Ending
range는 전체를 건너뛴다. Repeat pass, Repeat End와 D.S. 실행 이력, 전체곡 반복 cycle은 재생
Session에만 존재하고 JSON이나 `.bsv`에 저장하지 않는다.

Teacher의 `audioSettings`는 서버가 메모리에 최신값을 보관해 새 Student에도 전달한다. Student
개인 설정은 Teacher PDF 또는 개인 PDF의 document key별로 브라우저 `localStorage`에 저장하며,
Project State와 Socket 데이터에는 합치지 않는다.

Student가 직접 선택한 로컬 음원 파일은 데이터 모델에 저장하지 않는다. 현재 Student 화면의
런타임 `File`과 Object URL로만 재생하며, 역할 또는 PDF가 바뀌면 해제한다. 따라서 음원 bytes,
파일 경로, 재생속도와 분석한 파형 peak는 JSON, `.bsv`, `localStorage`, Socket에 포함되지 않는다.
파형에서 지정한 시작 위치만 기존 `startOffsetSeconds`로 저장한다.

Teacher Shared Audio도 Project State나 `.bsv`가 아닌 현재 서버 세션 자산이다. Socket metadata는
`{ assetId, fileName, mimeType, byteLength, revision, assetPath, timelineAnchor }`이며 binary는 HTTP endpoint가
제공한다. `timelineAnchor`는 다음 구조다.

```json
{
  "measureId": "measure-...",
  "measureIndex": 2,
  "positionSeconds": 5.214
}
```

`measureId`가 현재 measures에 있으면 이를 기준으로 하며, `measureIndex`는 stable ID가 없던 기존 1마디 데이터의 호환 경로다. 과거 `firstMeasureAnchorSeconds`는 읽거나 legacy Socket event를 받을 때 0번 measure anchor로 변환한다. 중복된 1마디 절대 시각은 저장하지 않고 전체 시작 시간은 anchor와 measure BPM/Beats로 계산한다. 서버 재시작·수업 종료·Teacher 제거 시 자산이 사라진다. 최신 playback snapshot은
`{ assetId, revision, isPlaying, anchorPositionSeconds, playbackRate, anchorServerTimeMs, sequence, command }`
형태로 서버 메모리에만 저장되며 프로젝트 파일에는 포함되지 않는다.

곡 전체 BPM은 별도 schema 필드를 추가하지 않고 모든 measure의 `bpm`에 적용한다. 새 마디에 사용할
Project 기본 BPM은 런타임 값이며 JSON/.bsv import 시 가장 많이 사용된 measure BPM에서 구한다.
Student 개인 전체 BPM은 아래 `timings`에만 저장되어 Project measure를 변경하지 않는다.

Student 개인 마디 타임라인은 프로젝트 measure를 수정하지 않고 별도 로컬 데이터로 저장한다.

```json
{
  "markers": [
    {
      "measureId": "measure-...",
      "timeSeconds": 12.345
    }
  ],
  "timings": [
    {
      "measureId": "measure-...",
      "bpm": 90,
      "beats": 3
    }
  ]
}
```

타임라인은 PDF document identity와 로컬 음원 파일 identity 조합으로 구분한다. 같은 PDF라도 다른
음원 파일에는 기존 marker와 개인 템포를 적용하지 않는다. 두 데이터는 JSON, `.bsv`, Socket에
포함하지 않으며 `timings`가 없는 기존 로컬 타임라인은 빈 개인 템포 목록으로 읽는다.

저장되는 `markers`는 사용자가 직접 지정한 기준점뿐이다. 첫 기준점 이후의 마디 시간은 이전 마디의
`(60 / bpm) * beats` 길이를 누적해 런타임에서 계산한다. 개인 `timings`가 있으면 Teacher measure의
BPM/Beats보다 우선하며, 뒤의 직접 marker를 만나면 그 시간부터 다시 계산한다. 계산 marker는 저장하지 않는다.

Student의 `useTeacherTempo`와 `useTeacherTimelineAnchor`는 브라우저 세션의 선택 상태다. 전자는 Teacher measure map과 개인 `timings` 중 계산 입력을 고르고, 후자는 공용 음원에서만 Teacher의 `timelineAnchor`와 source별 개인 marker 중 하나를 고른다. 어느 선택도 Project measure나 로컬 marker/timing을 덮어쓰지 않는다.

## Vocal Phrase 파생 데이터

Vocal Phrase는 저장 모델이 아니며 현재 `measures`에서 결정적으로 계산한다.

```js
{
  startMeasureIndex: 0,
  endMeasureIndex: 1,
  measureIds: ["measure-1", "measure-2"],
  text: "매만지는 바람"
}
```

의미 있는 `measure.lyric`을 Measure 사이 공백으로 연결한다. PDF text geometry의 lyric
baseline 변경과 빈 lyric·placeholder를 Phrase 경계로 사용하며, 같은 baseline에서는
대표 lyric 간격 또는 마디 경계 gap 분포의 중앙값·MAD 대비 비정상적으로 큰 간격에서
추가 분리한다. 원본 lyric과 내부 줄바꿈은 변경하지 않는다.
자동인식된 Measure에는 Phrase 판정용 정규화
`lyricGeometry`가 선택 metadata로 붙으며 Socket, JSON과 `.bsv`에서 보존된다. 이 필드가
없는 기존 데이터도 호환되며 Vocal 표시는 안전하게 한 마디 lyric으로 제한된다. 향후
Measure audio timeline에서 Phrase 시작·종료 시간을 계산할 수 있지만 현재는 시간 필드를
저장하지 않는다.

## 현재 syncState

```js
{
  fileName: "score.pdf",
  pageNumber: 1,
  measureIndex: 0
}
```

렌더 폭이나 scale은 포함하지 않는다.

## .bsv v1

`.bsv`는 다음 versioned JSON document다.

```js
{
  format: "band-score-viewer-project",
  schemaVersion: 1,
  metadata: { title, createdAt, updatedAt },
  project: {
    pdfMetadata: { fileName, mimeType: "application/pdf" },
    audioSettings: { url, startOffsetSeconds },
    measures
  },
  assets: {
    scorePdf: { encoding: "base64", byteLength, data }
  }
}
```

BPM, Beats, lyric, navigation markers/endings, stable ID와 normalized 좌표는 measures가 유일한 원본이다. `.bsv` v1은
모든 measure의 유효하고 고유한 ID를 검증한다. 현재 페이지/마디,
재생·Repeat, 선택/drag 상태, Student 개인 PDF와 보기 방식 같은 Session/Local View 데이터는
저장하지 않는다. 기존 `.bsv`에 `audioSettings`가 없으면 빈 URL과 0초로 보정한다. 기존
measure 배열 JSON과 `.bsv` import 경로는 분리되어 있다.

## Student 로컬 필기

학생 필기는 measure와 분리된 브라우저 로컬 데이터다. PDF 페이지 기준 `0..1` 좌표의 점
목록을 페이지별 stroke로 저장한다.

```js
{
  version: 1,
  documents: {
    "PDF 출처와 파일 identity": [
      { id, page, color, width, points: [{ x, y }] }
    ]
  }
}
```

이 데이터는 현재 기기의 `localStorage`에만 남으며 Teacher/다른 Student로 동기화하지 않고
JSON 또는 `.bsv`에도 저장하지 않는다. Teacher PDF와 학생 개인 PDF는 서로 다른 document
key를 사용한다.
