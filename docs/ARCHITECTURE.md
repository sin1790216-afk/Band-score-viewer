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

Teacher 변경은 `sync:update`, `pdf:update`, `measures:update`, `audio:update`로 서버에 전달된다. 서버는 최신 PDF, measures, Teacher 음원 설정과 syncState를 메모리에 보관하고 새 연결에 PDF -> measures -> audio -> syncState 순서로 전송한다. Room, 인증, 영속 저장소는 아직 없다.
사용자가 Teacher 역할을 선택하면 현재 Teacher 로컬 페이지와 마디를 다시 발행해 서버에 남아
있던 과거 위치를 교체한다. Teacher 화면이 활성화된 동안 수신한 과거 sync 위치는 로컬
Teacher 위치를 덮지 않는다.

Teacher의 `수업 종료`는 `session:reset`을 보내 서버 메모리의 PDF, measures와 syncState를
초기화한다. 접속 중인 화면도 같은 이벤트를 적용하며, 이후 접속한 Student에게는 이전
악보를 보내지 않는다. Student 개인 PDF와 브라우저 로컬 필기는 공유 세션 밖의 데이터라
삭제하지 않는다.

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

디지털 PDF 마디 자동인식은 오선 검출 영역에서 수평 오선과 세로 barline 후보를 찾는다.
후보 세로선에 staff spacing 대비 충분한 길이와 두께의 옆방향 ink가 직접 붙으면 note
stem으로 제외한다. 최종 Measure 세로 범위는 검출 영역과 분리하며, 인접 system 사이의
중간 경계를 공유해 코드·오선·가사 영역을 함께 포함한다. 결과 좌표는 기존과 같은
canonical `x/y/width/height`로 저장된다.

## 프론트엔드 책임 경계

프론트엔드 상태는 다음 소유권으로 구분한다.

- Project State (`src/state/projectState.js`): Teacher PDF 파일명 metadata, 외부 음원 링크/start offset과 stable ID가 있는 canonical measures를 소유한다. 새 마디·JSON·Socket 유입 경계에서 ID를 한 번 준비하고, reducer의 CRUD와 BPM/Beats/lyric 보정은 기존 ID를 보존한다. 기존 배열 JSON import/export 형식은 유지한다.
- Session State (`src/state/sessionState.js`): Teacher의 논리 페이지·마디, 자동재생/Repeat 상태와 수신한 논리 `syncState`를 소유한다.
- Local View State (`src/App.jsx`): 역할 선택, Student 개인 PDF와 보기 방식, 학생 필기, 선택/드래그/8방향 resize 표시 상태, 파일 input, Object URL과 render reset처럼 해당 기기에서만 의미가 있는 상태를 소유한다.

`src/App.jsx`는 이 상태들의 UI 이벤트와 파일·Socket·타이머 부수효과를 조율한다. `src/components/ScoreViewer.jsx`는 `displayPageNumber` 하나를 입력받아 `react-pdf` 렌더, canvas/overlay DOM, 좌표 변환, 렌더 완료 상태, 크기 관찰과 자동 스크롤을 담당한다.

Student 필기는 `ScoreViewer`의 현재 PDF surface에서 pointer 좌표를 `0..1` 범위로
정규화하고, 같은 canvas stack 위의 전용 SVG overlay에 렌더한다. 필기 데이터는 PDF 출처와
파일 identity별로 브라우저 `localStorage`에만 저장하며 Socket, measure JSON, `.bsv`에는
포함하지 않는다. 필기 모드를 시작하면 현재 sync 페이지와 마디를 학생 로컬 탐색 상태로
복사하고 자동 스크롤을 멈춘다. Socket의 최신 syncState는 계속 수신하며, 필기를 끝내면
별도 요청 없이 최신 Teacher 페이지와 마디를 다시 표시한다.

## 프로젝트 파일

`src/project/bsvSchema.js`는 `.bsv`의 format/schemaVersion, measure ID의 유효성·고유성과 v1 필드를 검증하고 향후
migration의 진입점을 제공한다. `src/project/bsvCodec.js`는 Project State와 PDF Blob을
versioned JSON으로 encode하고, import 시 모든 필드와 PDF bytes를 검증한 준비 결과를 만든다.
App은 준비가 모두 성공한 뒤에만 Project State, PDF URL과 초기 Session을 적용하고 기존
`pdf:update`, `measures:update`, `sync:update` 흐름으로 공유한다.

음원 링크와 start offset은 `.bsv` Project State에 저장하고 별도 `audio:state` 이벤트로
Student에 공유한다. 논리 `syncState`에는 포함하지 않는다. Student 개인 링크와 offset은 PDF
identity별 브라우저 로컬 데이터이며 Socket이나 `.bsv`로 보내지 않는다. 로컬 음원 파일은
`LocalAudioPlayer`가 브라우저 Object URL로 재생하고 역할/PDF 전환 시 해제한다. 파일 bytes와
재생속도와 파형 peak는 영속 저장하거나 공유하지 않는다. 로컬 audio와 파형 컴포넌트는
설정 패널의 표시 여부와 분리해 패널을 닫아도 재생 상태를 유지한다. 모바일 파일 선택 중 페이지가 재생성될 때만
`sessionStorage`의 일회성 표시로 Student 음원 패널을 복구하며 파일 자체는 다시 선택해야 한다.
Student 개인 타임라인은 PDF document identity와 로컬 음원 identity 조합 아래에
`measureId + timeSeconds` marker와 선택적인 개인 BPM/Beats를 `localStorage`로 저장한다. 이 데이터는
JSON, `.bsv`, Socket에 포함하지 않는다. 첫 직접 marker 이후의 마디 시작 시간은 각 마디의 개인
BPM/Beats 또는 Teacher measure 값을 이용해 메모리에서 계산하며, 뒤의 직접 marker는 새 기준점이 된다.
음원 따라가기가 켜진 동안 플레이어는 현재 시간 이전의 가장 최근 유효 marker가 바뀔 때만 App에 measure
ID를 전달하고, Student의 로컬 표시 페이지/하이라이트만 바꾼다.
Teacher의 논리적 `pageNumber`/`measureIndex`와 Socket 상태는 수정하지 않는다.
로컬 재생은 HTML media element를 유지하되 Web Audio oscillator로 한 마디 예비박을 예약한다. 처음 재생,
일시정지 후 재개, marker 마디 클릭 모두 예비박을 거치며 첫 박은 다른 주파수로 accent한다. 개인 BPM/Beats가
있으면 예비박에 우선 사용하고, 없으면 Teacher measure 값을 사용한다.

과거 effect 강제 재실행에 사용하던 `renderSyncVersion`은 제거했다. 현재는 동일한
`surfaceIdentity`의 document/page render 완료 여부가 overlay 표시와 자동 스크롤의
명시적 조건이다.

현재 navigation과 선택/편집 이벤트는 호환성을 위해 계속 배열 `measureIndex`를 사용한다.
stable ID는 저장과 React key의 기준이며, Socket navigation을 `measureId`로 전환하는 작업은
별도 realtime protocol 단계에서 진행한다.
