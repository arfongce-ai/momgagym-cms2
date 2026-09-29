# Issue #2 — 동의 영상 자동 편집 MVP

## 범위

- 로컬 PC의 승인 영상만 처리한다. 원본 폴더 전체를 스캔하거나 업로드하지 않는다.
- 입력 목록에는 회원 이름 대신 익명 클립 ID와 동의 기록 참조값만 쓴다.
- 10~30초 구간을 세로 1080×1920 MP4로 바꾸고, 선택한 로고와 2초 엔딩 카드를 붙인다.
- 대본에서 준비한 자막 초안을 SRT 파일로 만든다.
- 결과마다 `review_required`, `publishAllowed: false`를 기록한다. 자동 게시·자동 Drive 업로드는 하지 않는다.

## 실행 전 준비

1. FFmpeg를 로컬 PC에 설치하고 `ffmpeg -version`이 동작하는지 확인한다.
2. `content-video/approved.example.json`을 복사해 `content-video/approved.local.json`으로 만든다. 이 파일은 Git에 올라가지 않는다.
3. 공개 동의가 확인된 복사본만 `source`로 지정한다. 원본·회원 이름·연락처는 넣지 않는다.

## 실행

```powershell
npm run video:review -- --manifest content-video/approved.local.json
```

결과 MP4·SRT·검수 JSON과 `review_index.html`은 `content-video/review/`에 생긴다. `review_index.html`을 브라우저로 열어 여러 클립을 검수한다. 이 페이지에는 원본 경로나 동의 참조값을 표시하지 않는다. 검수자가 승인한 파일만 이후 Google Drive의 게시 대기 폴더로 수동 이동한다.

## 아직 하지 않는 것

- 음성 인식 기반 자동 받아쓰기: 새 유료 AI API 없이 품질을 보장할 수 없어, 현재는 Notion 대본 기반 자막 초안만 쓴다.
- 얼굴 인식·자동 블러: 옆·뒷모습도 식별 가능성이 있어, 공개 전 별도 블러 검토 단계가 필요하다.
- Google Drive 자동 업로드와 채널 자동 게시: 공개 동의·검수 승인·권한 모델을 먼저 확정한 뒤 별도 PR로 추가한다.
