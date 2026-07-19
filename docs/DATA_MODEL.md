# 데이터 모델

## 현재 measure

JSON 파일은 measure 객체 배열이다. 기존 핵심 필드는 유지된다.

```js
{
  page: 1,
  x: 120,
  y: 180,
  width: 140,
  height: 90,
  bpm: 120,
  beats: 4,
  lyric: "",
  coordinateWidth: 900,
  coordinateHeight: 1273
}
```

- `page`: 1부터 시작하는 PDF 페이지 번호
- `x`, `y`, `width`, `height`: 해당 measure의 저장 좌표 기준 값
- `bpm`, `beats`: 자동재생 시간 계산 값. 누락되거나 유효하지 않으면 각각 120, 4로 정규화
- `lyric`: 여러 줄을 포함할 수 있는 문자열. 누락되면 빈 문자열로 정규화
- `coordinateWidth`, `coordinateHeight`: 새로 등록하거나 편집한 measure가 사용하는 좌표 기준 크기

기존 JSON에 좌표 기준 크기가 없으면 현재 코드는 같은 페이지 measure의 범위와 현재 렌더 DOM을 이용해 기준을 추론한다. `baseWidth/baseHeight`, `pageWidth/pageHeight`도 과거 데이터 호환 후보로 읽는다. JSON 저장은 현재 measures 배열 전체를 그대로 기록한다.

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

