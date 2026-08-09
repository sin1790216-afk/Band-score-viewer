# 현재 아키텍처

## 구성

- 프론트엔드: React 19 + Vite, `react-pdf`, `socket.io-client`
- 실시간 서버: Node HTTP 서버 + Socket.IO
- 개발 연결: 브라우저가 접속한 hostname의 4000 포트를 우선 사용하고, 실패하면 same-origin으로 재시도
- 배포 실행: `server.js`가 빌드된 `dist` 정적 파일과 Socket.IO를 함께 제공할 수 있음
- PWA: production 빌드에서 manifest와 서비스 워커를 등록한다. 서비스 워커는 앱/PDF/Socket 요청을 캐시하지 않으며 새 버전 활성화와 기존 앱 캐시 정리만 담당한다.

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

`react-pdf`의 `Page`와 `.overlay`는 `.pdf-canvas-stack` 안에 함께 배치된다. Measure는
페이지 전체를 `1 x 1`로 본 canonical 좌표를 사용한다. 하이라이트는 canonical 좌표에
현재 기기의 canvas stack DOM width/height를 한 번 곱해 계산한다. Pointer 입력은 같은
surface width/height로 나누어 canonical 좌표로 저장한다. Teacher와 Student는 같은 순수
변환 함수를 사용하며 Teacher의 렌더 폭은 Student에 전달하거나 강제하지 않는다.

PDF lifecycle은 `documentState`, 요청 page, `surfaceIdentity`, `readySurface` 순서로
진행된다. `surfaceIdentity`에는 PDF object URL, page, 역할/보기 방식, render reset,
요청 render width가 포함된다. 현재 identity의 `Page.onRenderSuccess`가 유효한 canvas와
surface geometry를 확인한 경우에만 `readySurface`가 된다. 이전 PDF나 페이지의 완료
callback은 무시되고 overlay와 스크롤은 현재 surface가 ready일 때만 실행된다.

`ResizeObserver`는 viewer 크기를 Page render width에 반영하고, 현재 ready surface의 실제
geometry 변경을 갱신한다. 렌더 크기는 기기 로컬에만 존재한다.

## 프론트엔드 책임 경계

프론트엔드 상태는 다음 소유권으로 구분한다.

- Project State (`src/state/projectState.js`): Teacher PDF 파일명 metadata와 stable ID가 있는 canonical measures를 소유한다. 새 마디·JSON·Socket 유입 경계에서 ID를 한 번 준비하고, reducer의 CRUD와 BPM/Beats/lyric 보정은 기존 ID를 보존한다. 기존 배열 JSON import/export 형식은 유지한다.
- Session State (`src/state/sessionState.js`): Teacher의 논리 페이지·마디, 자동재생/Repeat 상태와 수신한 논리 `syncState`를 소유한다.
- Local View State (`src/App.jsx`): 역할 선택, Student 개인 PDF와 보기 방식, 선택/드래그/resize 표시 상태, 파일 input, Object URL과 render reset처럼 해당 기기에서만 의미가 있는 상태를 소유한다.

`src/App.jsx`는 이 상태들의 UI 이벤트와 파일·Socket·타이머 부수효과를 조율한다. `src/components/ScoreViewer.jsx`는 `displayPageNumber` 하나를 입력받아 `react-pdf` 렌더, canvas/overlay DOM, 좌표 변환, 렌더 완료 상태, 크기 관찰과 자동 스크롤을 담당한다.

## 프로젝트 파일

`src/project/bsvSchema.js`는 `.bsv`의 format/schemaVersion, measure ID의 유효성·고유성과 v1 필드를 검증하고 향후
migration의 진입점을 제공한다. `src/project/bsvCodec.js`는 Project State와 PDF Blob을
versioned JSON으로 encode하고, import 시 모든 필드와 PDF bytes를 검증한 준비 결과를 만든다.
App은 준비가 모두 성공한 뒤에만 Project State, PDF URL과 초기 Session을 적용하고 기존
`pdf:update`, `measures:update`, `sync:update` 흐름으로 공유한다.

과거 effect 강제 재실행에 사용하던 `renderSyncVersion`은 제거했다. 현재는 동일한
`surfaceIdentity`의 document/page render 완료 여부가 overlay 표시와 자동 스크롤의
명시적 조건이다.

현재 navigation과 선택/편집 이벤트는 호환성을 위해 계속 배열 `measureIndex`를 사용한다.
stable ID는 저장과 React key의 기준이며, Socket navigation을 `measureId`로 전환하는 작업은
별도 realtime protocol 단계에서 진행한다.
