# 알려진 문제와 운영 제약

## 한 페이지 보기 렌더 경합

한 페이지 보기에서 Socket 페이지 수신, `react-pdf` Page 교체, 렌더 완료, overlay 표시가
근접한 시점에 발생한다. 현재는 PDF/page/layout/render width로 만든 `surfaceIdentity`와
실제 `onRenderSuccess` 결과가 일치할 때만 overlay를 표시한다. 이전 render callback은
무시되지만 실제 Safari/Chrome의 빠른 페이지 왕복과 화면 회전은 계속 실기기 회귀
테스트가 필요하다.

## 좌표 호환 경로

과거에는 `syncState.pageRenderWidth`를 Student scale 기준으로 사용해 좌표가 이중 확대되는
문제가 있었다. 현재 논리 syncState에서는 해당 값을 제거하고 canonical 좌표와 각 기기의
`.pdf-canvas-stack` DOM을 기준으로 계산한다. 과거 JSON 중 좌표 기준 metadata가 없는
데이터는 현재 DOM이 아닌 measure 범위만으로 변환하고 `legacy-bounds-unverified`로
표시한다. 이 해석은 기기마다 동일하지만 원래 PDF 기준을 증명하지 못하므로 다양한 실제
구형 파일에서 확인이 필요하다.

## 초기 레이아웃

역할 선택 화면 도입 전에는 새 기기가 Teacher 레이아웃을 먼저 만들면서 stale PDF frame을 재사용할 수 있었다. 현재는 역할 선택 전 PDF DOM을 만들지 않아 이 위험이 줄었지만, 역할 전환과 PDF 출처 전환 시 렌더 상태 정리 검증은 계속 필요하다.

## 네트워크와 서버

- 기관 Wi-Fi의 AP isolation, 방화벽 또는 포트 정책이 기기 간 4000 포트 통신을 차단할 수 있다.
- 서버 상태는 메모리에만 있으므로 서버 재시작 시 PDF, measures, syncState가 사라진다.
- 현재 Room, 접속 코드, Teacher 인증, 다중 수업 분리는 구현되어 있지 않다.
- Student 개인 PDF는 Teacher 악보와 페이지 크기·줄바꿈·마디 배치가 다르면 하이라이트가 맞지 않을 수 있다.
