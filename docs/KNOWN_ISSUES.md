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
- `http://Teacher-Mac-IP` 같은 LAN 주소는 보안 연결이 아니므로 브라우저에 따라 PWA 설치와 서비스 워커가 제한된다. 온라인 배포에서는 HTTPS가 필요하다.
- 서버 상태는 메모리에만 있으므로 서버 재시작 시 PDF, measures, syncState가 사라진다.
- 현재 Room, 접속 코드, Teacher 인증, 다중 수업 분리는 구현되어 있지 않다.
- 현재 Socket.IO는 같은 Wi-Fi 수업을 위해 모든 origin을 허용하며 역할 인증도 없다. 따라서 같은 서버에 연결할 수 있는 클라이언트는 동기화 상태를 변경할 수 있다. 공개 배포 전에는 Teacher 인증, 수업별 Room, 허용 origin 제한과 요청 빈도 제한이 필수다.
- PDF 전송 한도는 100MB이며 서버 상태는 메모리에 저장된다. 인증과 요청 빈도 제한이 없는 현재 구조를 인터넷에 그대로 공개하면 메모리 고갈 공격에 취약하다.
- Student 개인 PDF는 Teacher 악보와 페이지 크기·줄바꿈·마디 배치가 다르면 하이라이트가 맞지 않을 수 있다.

## 보안 검증 범위

- 정적 파일 서버는 `dist` 밖의 경로를 거부하고 PDF/measures/sync Socket payload의 기본 형식과 크기를 검증한다.
- PDF.js worker는 외부 CDN이 아니라 빌드에 포함된 로컬 파일을 사용한다.
- Content Security Policy, Teacher 인증, Room 격리, rate limit과 HTTPS 배포 설정은 아직 구현되지 않았다.

## .bsv v1 파일 크기

- v1은 PDF를 JSON 안의 base64로 저장하므로 원본보다 약 33% 커지고 encode/decode 중 추가 메모리를 사용한다.
- `byteLength`, base64 형식과 PDF signature는 검증하지만 v1에는 전체 파일 checksum이 없다.
- 큰 PDF와 iPad Safari의 파일 저장/열기는 실제 기기에서 확인해야 한다.
- 향후 schemaVersion migration으로 ZIP 또는 binary asset container를 도입할 수 있지만 아직 구현하지 않았다.
- v1 확정 전 개발본에서 저장한 ID 없는 `.bsv`는 현재 검증에서 거부된다. 기존 measure 배열 JSON은 ID가 없어도 import할 수 있다.
