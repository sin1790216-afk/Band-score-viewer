# 데이터 모델

## 현재 measure

JSON 파일은 measure 객체 배열이다. 기존 핵심 필드는 유지된다.

```js
{
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

- `page`: 1부터 시작하는 PDF 페이지 번호
- `x`, `y`, `width`, `height`: PDF 페이지 전체를 `1 x 1`로 본 정규화 좌표
- `bpm`, `beats`: 자동재생 시간 계산 값. 누락되거나 유효하지 않으면 각각 120, 4로 정규화
- `lyric`: 여러 줄을 포함할 수 있는 문자열. 누락되면 빈 문자열로 정규화
- `coordinateSpace`: 현재 canonical 좌표 형식
- `coordinateStatus`: 좌표 변환 신뢰 상태
- `coordinateWidth`, `coordinateHeight`: 기존 JSON 필드 호환을 위해 정규화 기준인 `1`을 유지

기존 `coordinateWidth/coordinateHeight`, `baseWidth/baseHeight`,
`pageWidth/pageHeight`가 있으면 해당 기준으로 canonical 좌표로 변환한다. 기준 metadata가
없는 JSON은 현재 DOM을 사용하지 않고 같은 페이지 legacy measure의 최대 범위만 사용하며
`legacy-bounds-unverified`로 표시한다. 이 경로는 기기마다 달라지지 않지만 실제 PDF 기준을
확정할 수 없으므로 실제 수업 데이터 검증이 필요하다. JSON 저장은 canonical measures
배열을 기록한다.

런타임의 Project State는 `{ pdfMetadata: { fileName }, measures }`로 구성되지만, 이는 내부
상태 소유권을 구분하기 위한 구조다. JSON 저장 형식은 project wrapper가 아닌 기존 measure
배열을 그대로 유지한다.

## 현재 syncState

```js
{
  fileName: "score.pdf",
  pageNumber: 1,
  measureIndex: 0
}
```

렌더 폭이나 scale은 포함하지 않는다.

## 향후 project 초안

`.bsv`는 아직 구현되지 않았다. 향후에는 버전이 있는 project 컨테이너가 PDF 참조/파일, measures, 곡 메타데이터와 재생 설정을 묶는 구조를 검토한다. 기존 measure 배열 JSON은 계속 불러올 수 있어야 하며, 확정 전까지 이 초안을 저장 형식으로 간주하지 않는다.
