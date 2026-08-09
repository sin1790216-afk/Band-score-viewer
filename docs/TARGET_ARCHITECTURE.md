# Band Score Viewer 목표 아키텍처와 전환 계획

작성 기준: 2026-08-05 현재 `refactor/pdf-render-pipeline` 브랜치와 작업 트리

이 문서는 제품의 장기 구조를 한 번에 구현하기 위한 설계서가 아니다. 목표 경계를 먼저
고정하고, 현재 정상 동작을 보존하면서 검증 가능한 STEP으로 이동하기 위한 기준이다.

## 1. 결정

- 현재 저장소를 폐기하거나 전면 재작성하지 않는다.
- 전체 제품 구조는 미리 설계하되 구현은 하나의 사용자 흐름이 끝까지 동작하는 STEP으로 나눈다.
- 좌표 변환, PDF render lifecycle, Project/Session reducer, 기존 JSON 호환과 `.bsv` codec은
  유지하고 발전시킨다.
- 새 상태 관리 라이브러리나 서버 프레임워크를 먼저 도입하지 않는다. 현재 React reducer와
  Socket.IO로 책임 경계를 만든 뒤 실제 필요가 확인될 때 선택한다.
- 미래 기능을 위해 `.bsv` v1에 빈 필드를 미리 넣지 않는다. 변경은 `schemaVersion` migration으로
  처리한다.

## 2. 변하지 않는 상태 경계

### Project State

곡을 닫았다가 다시 열어도 남아야 하는 데이터다.

- 프로젝트 metadata
- 악보 asset metadata
- 마디의 안정적인 ID와 순서
- 마디별 BPM, Beats, lyric
- PDF 페이지 위 normalized region
- 향후 파트, 음원 asset, timeline marker

Project State만 `.bsv` 저장 대상이다. 브라우저의 Blob URL은 Project State가 아니라 Runtime
Asset State에 둔다.

### Session State

한 번의 수업 동안 Teacher가 제어하고 Student/Vocal이 공유하는 논리 상태다.

- 현재 프로젝트 revision
- 현재 page
- 현재 measure ID
- 재생 상태와 반복 구간
- navigation revision
- 향후 Room과 Teacher ownership

현재의 `measureIndex`는 배열 위치이므로 영속 identity가 아니다. 전환 기간에는 호환 필드로
사용할 수 있지만 목표 프로토콜은 `measureId`를 기준으로 한다.

### Local View State

한 기기에서만 의미가 있으며 Socket이나 `.bsv`로 공유하지 않는 상태다.

- Teacher/Student/Vocal 화면 선택
- Student 개인 PDF와 보기 방식
- 확대, 한 페이지 보기와 스크롤
- 선택, drag, resize 중간 상태
- 파일 input, Blob/Object URL, render reset
- 향후 개인 annotation의 편집 중 상태

### Runtime Asset State

파일 데이터와 브라우저 resource lifecycle을 담당한다.

- Teacher PDF Blob
- Student 개인 PDF Blob
- Object URL 생성과 revoke
- 향후 audio Blob과 decoded metadata

현재 이 책임은 대부분 `App.jsx`의 ref와 함수에 있다. Project State에 Blob이나 Object URL을
넣지 않고 별도 hook/service로 옮긴다.

## 3. 목표 도메인 모델

### 가까운 목표: 단일 악보 프로젝트

현재 `.bsv` v1의 단일 PDF 구조는 유지한다. 다만 v1을 확정하기 전에 각 measure에 변하지
않는 문자열 `id`를 부여한다.

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

- ID는 마디 추가 또는 외부 데이터 import 경계에서 한 번 생성한다.
- 기존 ID는 normalization, 편집, Socket 수신 과정에서 절대 다시 만들지 않는다.
- legacy JSON에 ID가 없으면 Teacher가 import할 때 생성하고 이후 JSON/`.bsv`에 보존한다.
- 화면에 보이는 마디 번호는 우선 배열 순서에서 계산한다. 반복기호, pickup, `12A` 같은 요구가
  확인되면 별도 `label`을 추가한다.

### 장기 목표: 파트별 악보와 오디오

파트 기능을 구현할 때는 한 객체에 음악적 마디와 화면 좌표를 계속 섞지 않는다.

```text
Project
├── ScoreAsset[]       Teacher score, Guitar, Bass, Keyboard ...
├── Measure[]          음악적 마디 ID, 순서, BPM/Beats, lyric
├── MeasureRegion[]    measureId + scoreId + page + normalized rect
├── AudioAsset[]
└── TimelineMarker[]   measureId + audio time
```

이 구조는 목표 모델이며 `.bsv` v1에 지금 구현하지 않는다. 파트별 PDF를 시작하는 schema
migration에서 현재 measure의 좌표를 기본 Teacher score의 `MeasureRegion`으로 변환한다.

## 4. 목표 프론트엔드 책임

`App`은 역할별 화면을 조합하고 각 feature가 제공하는 명령을 연결하는 composition root가 된다.
다음 구조는 최종 파일명을 강제하지 않으며, 해당 기능을 수정하는 STEP에서 하나씩 분리한다.

```text
src/
├── app/                 앱 조합과 역할별 route/view
├── domain/              Project/Session 순수 모델과 migration
├── features/
│   ├── project-files/   PDF, JSON, .bsv 열기/저장
│   ├── realtime/        Socket 연결, protocol, snapshot 적용
│   ├── measure-editor/  add/select/drag/resize/lyric
│   ├── navigation/      page/measure 이동과 repeat
│   └── playback/        향후 local audio와 timeline
├── components/
│   └── score-viewer/    PDF surface, overlay, auto-scroll
└── state/               전환 기간의 Project/Session reducer
```

분리 기준은 파일 길이가 아니라 다음 세 가지다.

1. 독립적으로 테스트할 수 있는가.
2. 다른 역할이나 기능에서 재사용되는가.
3. 브라우저 resource 또는 네트워크 lifecycle을 단독으로 소유하는가.

### `App.jsx`에서 분리할 순서

1. 프로젝트 파일 열기/저장과 PDF Blob/Object URL lifecycle
2. Socket 연결 및 수신/송신 adapter
3. 자동 진행 timer
4. measure 편집 pointer state
5. Sidebar, lyric editor와 역할별 화면

한 번에 전부 옮기지 않는다. 다음 기능을 구현하기 위해 필요한 책임 하나만 옮기고 같은 STEP에서
회귀 검증한다.

### `ScoreViewer.jsx`에서 유지할 것

- `surfaceIdentity` 기반 stale callback 차단
- 실제 canvas stack DOM 기준 좌표 변환
- `ResizeObserver` 기반 surface geometry 갱신
- 현재 surface가 ready일 때만 overlay/scroll 허용

향후 overlay 편집이 커질 때 `MeasureOverlay`와 pointer interaction을 분리할 수 있지만 PDF
lifecycle 자체는 새로 작성하지 않는다.

## 5. 목표 Realtime protocol

현재 `pdf:update`, `measures:update`, `sync:update`는 서로 독립적으로 적용되어 짧은 순간 서로
다른 프로젝트의 PDF, measures, navigation이 조합될 수 있다. 다음 protocol은 데이터 크기 때문에
asset과 navigation을 분리하되 revision으로 일관성을 보장한다.

```js
projectState = {
  projectRevision,
  pdfMetadata,
  pdfData,
  measures,
}

navigationState = {
  navigationRevision,
  projectRevision,
  pageNumber,
  measureId,
}
```

- Teacher만 project/navigation 변경을 보낼 수 있다.
- 서버는 revision이 증가하는 update만 적용한다.
- Student는 같은 `projectRevision`의 project를 준비한 뒤 navigation을 적용한다.
- 신규 및 재접속 Student는 최신 project snapshot과 navigation snapshot을 받는다.
- page와 measure는 하나의 navigation update로 전송한다.
- drag/resize 중에는 매 pointer move마다 전체 measures를 방송하지 않고, 로컬 미리보기 후 확정
  update 또는 제한된 전송을 사용한다.
- Room 도입 전에도 protocol과 서버 상태는 `classroomId` 하나를 소유할 수 있는 형태로 만든다.

## 6. 현재 코드 판정

| 영역 | 판정 | 처리 |
| --- | --- | --- |
| normalized coordinate 함수 | 유지 | pure function과 fixture 테스트를 계속 기준으로 사용 |
| PDF render lifecycle | 유지 | 기능 변경 시에만 작은 hook/component로 분리 |
| Project/Session reducer | 유지·확장 | stable ID 보존 완료, revision은 realtime STEP에서 추가 |
| `.bsv` schema/codec | 유지·완료 | stable ID 저장·검증 완료, 실기기 검증 후 v1 확정 |
| `App.jsx` orchestration | 점진 분리 | 파일, Socket, timer, editor 순서로 추출 |
| index 기반 navigation | 교체 | `measureId` 기준으로 전환하고 index는 화면 계산값으로 사용 |
| 3개 독립 Socket update | 교체 | project/navigation revision protocol 도입 |
| 단일 메모리 서버 | MVP까지 유지 | protocol 강화 후 Room/권한/영속성 순서로 확장 |
| 현재 CSS와 화면 | 유지 | PWA STEP 전에는 전면 redesign하지 않음 |
| Node 단위 테스트 | 유지·확장 | domain, codec, protocol reducer 중심으로 추가 |

## 7. 구현 Milestone과 완료 게이트

### M1 — Project Foundation

1. stable Measure ID 추가
2. legacy JSON import 시 ID 생성 및 재저장 보존
3. `.bsv` v1에 ID 저장·검증
4. `.bsv` 저장/열기 desktop 수동 테스트
5. 큰 PDF와 iPad 파일 저장/열기 실기기 테스트

완료 조건: 프로젝트를 닫고 다시 열어도 동일 measure ID, PDF, 좌표, BPM/Beats, 여러 줄 가사가
복원되며 실패한 import가 기존 프로젝트를 바꾸지 않는다.

### M2 — Classroom Realtime Reliability

1. page + measureId 원자적 navigation
2. project/navigation revision
3. reconnect/late join snapshot
4. Teacher ownership의 최소 검증
5. drag/resize update 빈도 제한
6. 8개 client 자동·수동 연결 시험

완료 조건: 빠른 이동, 재접속, 늦은 접속 중에도 Student가 오래된 PDF나 마디를 표시하지 않는다.

### M3 — iPad Delivery

1. PDF worker 로컬 제공
2. manifest와 standalone shell
3. cache version/update 정책
4. 회전, background 복귀, 주소창/viewport 확인
5. Mac Teacher + 여러 iPad Student 수업 시나리오

완료 조건: 설치 또는 standalone 실행 후 핵심 수업 흐름이 반복해서 복구된다.

### M4 — Rehearsal Playback

1. local audio asset lifecycle
2. play/pause/seek/playbackRate
3. measure timeline marker와 audio offset
4. 특정 마디부터 재생
5. 구간 반복
6. anchor timestamp 기반 realtime playback와 drift 보정

완료 조건: Teacher의 재생 위치와 현재 마디가 하나의 timeline에서 계산되고 장시간 재생 후에도
Student 표시가 허용 범위 안에서 유지된다.

### M5 — Parts and Personal Work

1. ScoreAsset/MeasureRegion migration
2. 파트별 PDF mapping
3. 별도 normalized annotation layer
4. 기기 로컬 저장 후 사용자별 저장으로 확장

### M6 — Service Foundation

1. Room과 수업 코드
2. 인증과 역할 권한
3. DB/object storage
4. 서버 재시작 복구, 로그, 백업
5. 학교·사용자 데이터 및 악보/음원 정책

## 8. 모든 STEP의 공통 완료 조건

- STEP 시작 전에 영향 파일, 회귀 위험과 수동 검증 항목을 적는다.
- 기존 정상 기능을 보존하는 테스트를 먼저 확보한다.
- `npm test`, `npm run lint`, `npm run build`, `git diff --check`를 통과한다.
- PDF, Socket, PWA, Audio 변경은 자동 테스트만으로 완료 판정하지 않는다.
- Mac 브라우저 검증 후 관련 STEP에서는 실제 iPad 검증 결과를 기록한다.
- commit과 push는 사용자 승인 전에는 실행하지 않는다.

## 9. 바로 다음 검증 STEP

P2.0 Stable Measure Identity와 `.bsv` v1 구현은 현재 작업 트리에서 완료되었다. 다음은 M1을
닫기 위한 실제 파일·기기 검증이다.

- Mac에서 PDF와 여러 마디를 `.bsv`로 저장하고 다시 열기
- 기존 ID 없는 JSON import 후 ID 생성·재저장 보존 확인
- 큰 PDF가 포함된 `.bsv`를 iPad Safari에서 열기
- `.bsv` import 뒤 접속 중인 Student/Vocal과 늦게 접속한 화면의 snapshot 확인
- 실패한 import가 현재 프로젝트를 바꾸지 않는지 확인

이 검증이 끝난 뒤 M2에서 page와 `measureId`의 원자적 navigation, revision과 reconnect
protocol을 별도 STEP으로 진행한다. 현재 Socket의 `measureIndex` 호환 흐름은 변경하지 않는다.
