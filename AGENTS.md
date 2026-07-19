# Band Score Viewer 개발 원칙

## 우선순위

- 실제 수업 안정성이 새 기능보다 우선이다.
- 기존 JSON 데이터와의 호환성을 유지한다.
- 큰 작업은 검증 가능한 단계로 나누고 한 단계씩 완료한다.
- 작업 전에 영향 범위와 회귀 위험을 설명한다.
- 관련 없는 코드, 스타일, 설정은 수정하지 않는다.
- Git 커밋은 사용자가 명시적으로 요청할 때만 수행한다.

## 변경 및 검증

- 기존 Teacher, Student, Vocal 흐름과 PDF/Socket 동기화를 먼저 확인한다.
- 작업 후 `npm run lint`와 `npm run build`를 실행한다.
- 브라우저 검증이 필요한 변경은 데스크톱과 실제 학생 기기에서 함께 확인한다.
- 좌표 문제를 임의의 픽셀 offset으로 가리지 않는다. DOM 구조, 좌표 기준, 상태 흐름, PDF 렌더 순서를 바로잡는다.

## PDF 좌표와 동기화

- 렌더 크기, canvas 크기, scale 같은 기기별 표현 상태를 Socket 동기화 데이터에 넣지 않는다.
- Socket은 `pageNumber`, `measureIndex` 같은 논리 상태를 전달한다.
- 각 기기는 현재 렌더링된 자체 PDF canvas/overlay DOM 크기를 기준으로 좌표를 계산한다.
- measure 좌표는 저장 기준에서 현재 PDF DOM으로 한 번만 변환한다. 이미 변환된 값에 scale을 다시 적용하지 않는다.
- PDF 렌더 완료와 유효한 DOM 크기를 확인한 뒤 하이라이트와 스크롤을 계산한다.

## CSS 규칙

- CSS에서 `!important`를 절대로 사용하지 않는다.
- 특히 `width`, `height`, `left`, `top`, `position`, `transform`, `scale`, `overflow`, `display`, `z-index`를 `!important`로 강제하지 않는다.
- CSS 강제 덮어쓰기 대신 PDF Page와 overlay의 공통 부모 구조, 좌표 계산, 상태 흐름, 렌더 순서를 수정한다.

