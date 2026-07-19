# 알려진 문제와 운영 제약

## 한 페이지 보기 렌더 경합

한 페이지 보기에서 Socket 페이지 수신, `react-pdf` Page 교체, 렌더 완료, overlay 표시가 근접한 시점에 발생한다. 코드가 `renderedPageNumber`와 현재 measure 페이지를 확인해 이전 페이지 하이라이트를 막고 있지만, 실제 Safari/Chrome 및 회전 상황에서 지속 검증이 필요하다. PDF 렌더 파이프라인 분리 전까지 변경 시 가장 먼저 회귀 테스트한다.

## 좌표 호환 경로

과거에는 `syncState.pageRenderWidth`를 Student scale 기준으로 사용해 좌표가 이중 확대되는 문제가 있었다. 현재 논리 syncState에서는 해당 값을 제거하고 각 기기의 `.pdf-canvas-stack` DOM을 기준으로 계산한다. 과거 JSON 중 `coordinateWidth/coordinateHeight`가 없는 데이터는 기준 크기를 추론하므로 다양한 구형 파일에서 확인이 필요하다.

## 초기 레이아웃

역할 선택 화면 도입 전에는 새 기기가 Teacher 레이아웃을 먼저 만들면서 stale PDF frame을 재사용할 수 있었다. 현재는 역할 선택 전 PDF DOM을 만들지 않아 이 위험이 줄었지만, 역할 전환과 PDF 출처 전환 시 렌더 상태 정리 검증은 계속 필요하다.

## 네트워크와 서버

- 기관 Wi-Fi의 AP isolation, 방화벽 또는 포트 정책이 기기 간 4000 포트 통신을 차단할 수 있다.
- 서버 상태는 메모리에만 있으므로 서버 재시작 시 PDF, measures, syncState가 사라진다.
- 현재 Room, 접속 코드, Teacher 인증, 다중 수업 분리는 구현되어 있지 않다.
- Student 개인 PDF는 Teacher 악보와 페이지 크기·줄바꿈·마디 배치가 다르면 하이라이트가 맞지 않을 수 있다.
