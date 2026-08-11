# 프로젝트 맥락

Band Score Viewer는 밴드 수업에서 선생님의 진행 위치를 여러 화면에 공유하는 악보 뷰어다. 새 기능보다 실제 수업 중 끊김 없는 동작과 기존 수업 데이터 보존을 우선한다. 현재는 로컬 네트워크 수업 도구이며, 안정화 이후 온라인 배포와 상업용 확장을 고려한다.

## 사용자 역할

- Teacher: PDF와 JSON을 열고 마디를 등록·선택·이동·크기 조절·삭제한다. BPM, 박자 수, 가사를 편집하고 수동 이동 또는 자동재생을 제어한다.
- Student: Teacher가 공유한 PDF 또는 기기에서 직접 연 개인 PDF를 읽기 전용으로 본다. Teacher의 현재 페이지와 마디를 따라간다.
- Vocal: PDF 없이 현재 마디가 속한 가사 Phrase 전체를 크게, 다음 Phrase를 작게 보여준다.

최초 접속 시 역할 선택 화면이 나오며, 역할을 선택하기 전에는 PDF DOM을 렌더하지 않는다.

## 현재 수업 기능

- Teacher가 연 PDF, measures, `pageNumber`, `measureIndex`를 Socket.IO로 동기화한다.
- Student 개인 PDF는 서버에 업로드하지 않는다. 정확한 하이라이트를 위해 Teacher PDF와 페이지 구성 및 마디 배치가 같아야 한다.
- 각 measure는 `bpm`, `beats`, 여러 줄 `lyric`을 가질 수 있다.
- 자동재생은 현재 measure의 `(60 / bpm) * beats * 1000`만큼 기다린 뒤 다음 마디로 이동하며 Repeat를 지원한다.
- Student는 기존 확대모드와 페이지 전체를 맞추는 한 페이지 보기를 전환할 수 있다.
- 가사 편집기는 measure별 textarea이며, Vocal View는 PDF lyric baseline 변경과 빈 lyric을 기본 경계로 사용하고 같은 baseline의 큰 상대 수평 공백에서 Phrase를 추가 분리한다. 원본 줄바꿈은 유지한다.
- Teacher는 프로젝트에 외부 음원 링크와 시작 오프셋(초)을 기록해 Student에 공유할 수 있다. Student는 공유 음원을 보거나 현재 PDF별 개인 음원 설정으로 전환할 수 있다. 개인 설정에서는 기기의 MP3/M4A 등 로컬 음원을 재생하고, 확대 가능한 파형을 드래그하거나 두 손가락으로 확대해 위치를 조절할 수 있다. Student는 개인 음원의 기준 마디 시간을 stable measure ID에 연결하고, 이후 마디는 BPM/Beats로 계산해 로컬 하이라이트와 페이지를 이동할 수 있다. 마디별 개인 BPM/Beats는 계산과 예비박에 우선 적용되며 Teacher 데이터와 Socket 상태는 변경하지 않는다.
- Teacher는 로컬 음원 하나를 현재 수업의 공용 자산으로 등록할 수 있다. Student는 공용 음원에서 `수업 따라가기`와 `개인 연습`을 선택한다. 수업 따라가기는 Teacher의 play/pause/seek/재생속도를 따르고, 개인 연습과 Student 개인 음원은 기기에서 독립적으로 조작한다.
- Teacher의 `전체 템포`는 모든 `measure.bpm`을 명시적으로 갱신하고, 선택 마디 BPM은 이후 예외값으로 다시 편집할 수 있다. Student의 `개인 전체 템포`는 현재 PDF·음원 timeline의 로컬 설정만 바꾼다.
- Teacher는 공용 음원 패널에서 기준 마디 번호를 직접 입력해 현재 음원 위치를 그 마디의 시작점으로 지정할 수 있다. 입력값은 PDF의 선택/현재 마디와 독립적이다. 앞뒤 마디 시작 시간은 각 measure의 BPM/Beats로 계산하며, Student는 공용 음원에서 Teacher의 tempo map과 마디 기준을 각각 선택해 사용한다. 개인 음원의 직접 marker 구조는 그대로 유지한다.
