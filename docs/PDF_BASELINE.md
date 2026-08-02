# PDF 좌표 기준 동작

## Fixture 상태

저장소에는 실제 수업에서 사용한 PDF 또는 measure JSON이 없다. `tests/fixtures`의
JSON은 좌표 코드 검증용 합성 데이터이며 실제 악보 정합성을 보증하지 않는다.

실제 기기 승인 전에는 최소한 다음 자료가 필요하다.

- 2페이지 이상의 실제 수업 PDF와 해당 JSON
- `coordinateWidth/coordinateHeight`가 있는 JSON
- 좌표 기준 metadata가 없는 구형 JSON
- Teacher PDF와 같은 배치의 학생 개인 PDF

## 현재 좌표 흐름

1. Teacher가 PDF page surface를 클릭한다.
2. `ScoreViewer`가 pointer pixel을 현재 `.pdf-canvas-stack` width/height로 나누어
   canonical point로 변환한다.
3. `App`은 canonical `x/y/width/height`를 생성하거나 drag/resize delta로 갱신한다.
4. JSON 불러오기는 좌표와 BPM/Beats/lyric을 정규화하고, 저장은 canonical measures를
   기록한다.
5. Teacher 편집은 전체 measures 배열을 `measures:update`로 전송한다.
6. Student는 같은 measures를 받고 자신의 현재 `.pdf-canvas-stack` 크기로 다시 변환한다.
7. overlay는 `.pdf-canvas-stack` 내부에서 absolute 좌표로 표시된다.

P0.1 조사 당시에는 명시적 `coordinateWidth/coordinateHeight`가 저장 기준이었고
`baseWidth/baseHeight`, `pageWidth/pageHeight`도 호환 metadata로 읽었다. 기준 metadata가
없는 데이터는 같은 페이지의 `max(x + width)`와 `max(y + height)` 및 현재 Teacher
render 크기에 따라 자동 migration되어 viewport 의존 결과가 발생할 수 있었다.

P1.1 이후에는 모든 유효한 좌표를 `normalized-page-v1`로 변환한다. 명시적 저장 기준은
정확히 나누어 변환하고, 기준 없는 데이터는 measure 범위만 사용해
`legacy-bounds-unverified`로 격리한다. 현재 DOM은 legacy 변환에 사용하지 않는다.

P1.2 이후에는 PDF가 로드된 뒤 목표 page를 정하고, 해당 PDF/page/layout/width의
`surfaceIdentity`와 일치하는 `onRenderSuccess`가 실제 canvas geometry를 확인한 뒤에만
overlay를 표시한다. 강제 effect 갱신용 `renderSyncVersion`은 사용하지 않는다.

## 기준 기능 체크리스트

- [ ] Teacher PDF 표시와 페이지 이동
- [ ] Student Teacher PDF 자동 수신과 페이지 동기화
- [ ] Student 개인 PDF 표시
- [ ] 등록모드의 전체 마디, 선택, 생성, 드래그, resize, 삭제
- [ ] 연주모드의 현재 마디 highlight와 자동 스크롤
- [ ] 확대모드와 한 페이지 보기
- [ ] Teacher, Student, Vocal 역할 전환
- [ ] JSON import/export와 BPM, Beats, 여러 줄 lyric 보존
- [ ] 자동재생, Repeat, 페이지 경계 이동
- [ ] PDF A에서 PDF B로 교체할 때 이전 measure 제거

자동 테스트는 순수 좌표 변환과 JSON fixture만 검증한다. PDF canvas 위치, Safari 렌더
순서, 화면 회전, 실제 악보 정합성은 데스크톱 브라우저와 실제 iPad에서 별도 확인한다.
