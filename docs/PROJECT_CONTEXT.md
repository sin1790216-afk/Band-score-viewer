# 프로젝트 맥락

Band Score Viewer는 밴드 수업에서 선생님의 진행 위치를 여러 화면에 공유하는 악보 뷰어다. 새 기능보다 실제 수업 중 끊김 없는 동작과 기존 수업 데이터 보존을 우선한다. 현재는 로컬 네트워크 수업 도구이며, 안정화 이후 온라인 배포와 상업용 확장을 고려한다.

## 사용자 역할

- Teacher: PDF와 JSON을 열고 마디를 등록·선택·이동·크기 조절·삭제한다. BPM, 박자 수, 가사를 편집하고 수동 이동 또는 자동재생을 제어한다.
- Student: Teacher가 공유한 PDF 또는 기기에서 직접 연 개인 PDF를 읽기 전용으로 본다. Teacher의 현재 페이지와 마디를 따라간다.
- Vocal: PDF 없이 현재 마디의 가사를 크게, 이후 처음 등장하는 다른 가사를 작게 보여준다.

최초 접속 시 역할 선택 화면이 나오며, 역할을 선택하기 전에는 PDF DOM을 렌더하지 않는다.

## 현재 수업 기능

- Teacher가 연 PDF, measures, `pageNumber`, `measureIndex`를 Socket.IO로 동기화한다.
- Student 개인 PDF는 서버에 업로드하지 않는다. 정확한 하이라이트를 위해 Teacher PDF와 페이지 구성 및 마디 배치가 같아야 한다.
- 각 measure는 `bpm`, `beats`, 여러 줄 `lyric`을 가질 수 있다.
- 자동재생은 현재 measure의 `(60 / bpm) * beats * 1000`만큼 기다린 뒤 다음 마디로 이동하며 Repeat를 지원한다.
- Student는 기존 확대모드와 페이지 전체를 맞추는 한 페이지 보기를 전환할 수 있다.
- 가사 편집기는 measure별 textarea이며, Vocal View는 줄바꿈을 유지한다.
- Teacher는 프로젝트에 외부 음원 링크와 시작 오프셋(초)을 기록해 Student에 공유할 수 있다. Student는 공유 음원을 보거나 현재 PDF별 개인 음원 설정으로 전환할 수 있다. 실제 음원 재생과 마디 연동은 아직 없다.
