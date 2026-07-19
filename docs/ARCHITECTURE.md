# 현재 아키텍처

## 구성

- 프론트엔드: React 19 + Vite, `react-pdf`, `socket.io-client`
- 실시간 서버: Node HTTP 서버 + Socket.IO
- 개발 연결: 브라우저가 접속한 hostname의 4000 포트를 우선 사용하고, 실패하면 same-origin으로 재시도
- 배포 실행: `server.js`가 빌드된 `dist` 정적 파일과 Socket.IO를 함께 제공할 수 있음

## 상태 흐름

Teacher가 논리 상태의 기준이다. `syncState`는 현재 코드에서 다음 값만 정규화한다.

```js
{
  fileName,
  pageNumber,
  measureIndex,
}
```

Teacher 변경은 `sync:update`, `pdf:update`, `measures:update`로 서버에 전달된다. 서버는 최신 PDF, measures, syncState를 메모리에 보관하고 새 연결에 PDF -> measures -> syncState 순서로 전송한다. Room, 인증, 영속 저장소는 아직 없다.

Student는 `sync:state`의 페이지와 마디를 표시 기준으로 사용한다. Teacher PDF는 Socket 바이너리를 Blob/Object URL로 바꾸어 표시하고, 개인 PDF를 선택한 경우에는 PDF 출처만 로컬 파일로 교체한다. measures와 논리 위치는 계속 Teacher 값을 사용한다.

## PDF 렌더와 좌표

`react-pdf`의 `Page`와 `.overlay`는 `.pdf-canvas-stack` 안에 함께 배치된다. 하이라이트는 현재 기기의 canvas stack DOM 크기와 measure의 저장 좌표 기준을 이용해 `scaleX`, `scaleY`를 로컬에서 계산한다. Teacher의 렌더 폭은 Student에 전달하거나 강제하지 않는다.

`renderedPageNumber`는 요청 페이지가 실제로 렌더 완료됐는지 확인하는 상태다. 렌더 완료 전에는 하이라이트를 표시하지 않으며, `ResizeObserver`와 화면 크기 변경으로 좌표 재계산을 유도한다.

## 현재 책임 집중

`src/App.jsx` 한 파일에 역할 전환, PDF 수명주기, 좌표 변환, 편집, 자동재생, 가사, Socket 이벤트와 진단 로그가 집중되어 있다. 다음 리팩터링에서는 동작을 유지하면서 PDF 렌더 파이프라인과 overlay 좌표 책임을 우선 분리할 예정이다.

