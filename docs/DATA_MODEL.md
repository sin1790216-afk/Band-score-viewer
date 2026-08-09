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

Teacher의 `audioSettings`는 서버가 메모리에 최신값을 보관해 새 Student에도 전달한다. Student
개인 설정은 Teacher PDF 또는 개인 PDF의 document key별로 브라우저 `localStorage`에 저장하며,
Project State와 Socket 데이터에는 합치지 않는다.

Student가 직접 선택한 로컬 음원 파일은 데이터 모델에 저장하지 않는다. 현재 Student 화면의
런타임 `File`과 Object URL로만 재생하며, 역할 또는 PDF가 바뀌면 해제한다. 따라서 음원 bytes,
파일 경로, 재생속도와 분석한 파형 peak는 JSON, `.bsv`, `localStorage`, Socket에 포함되지 않는다.
파형에서 지정한 시작 위치만 기존 `startOffsetSeconds`로 저장한다.

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

BPM, Beats, lyric, stable ID와 normalized 좌표는 measures가 유일한 원본이다. `.bsv` v1은
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
