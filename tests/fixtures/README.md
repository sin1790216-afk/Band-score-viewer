# 좌표 테스트 fixture

이 디렉터리에는 실제 사용자 PDF나 JSON이 없다.

- `measures-explicit-basis.json`: `coordinateWidth`와 `coordinateHeight`가 있는 합성 데이터
- `measures-legacy-no-basis.json`: 좌표 기준 metadata가 없는 합성 legacy 데이터

두 파일은 좌표 변환의 자동 테스트만을 위한 최소 데이터다. 실제 악보 배치나 기존
수업 데이터가 정확히 복원된다는 근거로 사용하지 않는다. 실제 iPad 검증 전에는
대표 수업 PDF와 해당 JSON을 별도로 확보해야 한다.

`npm run fixture:pdf`는 브라우저 smoke test용 2페이지 합성 PDF를 `/tmp`에 만든다.
이 PDF 역시 실제 수업 fixture가 아니다.
