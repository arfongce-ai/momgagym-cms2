# Claude 인계 — PR2 Notion 연동 및 이미지 후처리 (2026-10-06)

## 작업 상태

- 저장소: `arfongce-ai/momgagym-cms2`
- 작업 브랜치: `codex/notion-content-pr2`
- 현재 원격 반영 기준: `4348f53` (`docs: record PR2 verification limits`)
- PR #3(PR1)은 `main`에 병합됨(`4397d3f`). PR2 구현은 `c61e3b0`에 있음.
- GPT 이미지 생성 프롬프트 작성은 이번 인계 범위에서 제외.

## Codex가 검증한 결과

- PR1/PR2 집중 Vitest: 42/42 통과.
- 전체 `npm test -- --run`: 3172/3183 통과. 기존 기록된 11개 실패만 확인. 별도 첫 실행에서 `session_share` 한 건 시간초과했으나 단독 재실행 14/14, 전체 재실행 통과.
- 이미지 후처리 더미 테스트: 3/3 통과. 이 PC에는 Gowun Dodum이 없어 시스템 맑은 고딕을 시험 전용 대체 폰트로 사용함. 운영 글꼴로 검증한 결과는 아님.
- `npm run build`: 성공. 기존 Firebase 동적/정적 import 및 큰 chunk 경고.
- FFmpeg 9.0.1 및 ffprobe 확인.
- 금지 상태/외부 게시/API 업로드 동작은 추가하지 않음. 실제 회원 영상·사진은 열거나 전송하지 않음.

## 확인이 필요한 점과 현재 차단 사유

1. **실 Notion 왕복 미실행**
   - 필수 환경변수 4개(`NOTION_CONSENT_READ_TOKEN`, `NOTION_CONSENT_DATA_SOURCE_ID`, `NOTION_CONTENT_CALENDAR_TOKEN`, `NOTION_CONTENT_CALENDAR_DATA_SOURCE_ID`)가 이 실행 환경에 없고 `content-video/config.local.json`도 없음. 값은 저장소에 기록하지 말 것.
   - 이전 스키마 읽기 결과에서 캘린더에 기존 `콘텐츠 유형`, `제작 상태`, `채널`, `클립 ID`, `Drive 링크`만 확인됨. PR2가 요구하는 `동의 참조값`, `대본`, `시작 초`, `끝 초`, `결과 해시`, `마지막 처리 시각`, `오류 요약`은 아직 없었음. `검수 결과 링크`를 `Drive 링크`와 합칠지도 미결정.
   - 동의 데이터 소스의 스키마와 Integration 공유 권한은 미확인.
   - 사용자/대표님이 두 토큰을 별도 로컬 환경변수로 등록하고 필요한 속성을 만든 후, 행 데이터/본문을 불필요하게 읽지 않는 범위에서 스키마 확인 및 1회 테스트 행 왕복을 진행할 것. `검수 상태`, `최종 게시 승인`, `게시 승인`, `게시완료` 쓰기 금지 유지.

2. **실제 이미지 5장 및 최종 후처리 미완료**
   - 사용자가 지정한 이미지 폴더가 없고 원본 `01.png`~`05.png`를 찾지 못해 실제 `final` 파일과 SHA-256 색인을 생성하지 못함.
   - Gowun Dodum 글꼴도 이 PC에 없음. 글꼴 설치는 사용자 승인 없이 진행하지 말 것.
   - 사용자 제공 원본 5장과 글꼴이 준비되면 `scripts/content-video/postprocess_images.py`를 실행해 1080×1080 `final/01.png`~`05.png` 및 `hashes.json`을 확인할 것. 현재 테스트의 맑은 고딕 결과를 운영 승인으로 간주하지 말 것.

3. **실제 영상 렌더 미실행**
   - 로컬 렌더 설정, 동의 매니페스트, 승인 클립 매니페스트가 없어 `npm run video:review` 미실행.
   - 동의가 확인된 편집대상 복사본만 PC 안에서 처리하고 원본·프레임을 저장소, Notion, 외부 AI로 전송하지 말 것. 게시 허용은 계속 `false`.

## Claude에게 요청하는 후속 작업

1. `docs/REVIEW_LOOP.md`, `AGENTS.md`, `docs/HANDOFF.md`를 읽고 PR2 커밋 `c61e3b0`을 교차 검토한다.
2. 발견사항은 수정 전에 `docs/HANDOFF.md`에 먼저 기록한다. 사용자가 진행을 지시하기 전에는 코드 보완 커밋을 만들지 않는다.
3. 실 Notion·이미지·영상 검증은 위 자격정보, 수동 속성, 승인된 로컬 소재가 준비되지 않은 상태에서는 통과로 표시하지 않는다.
4. 검토 결과와 실제로 실행한 테스트/빌드 명령을 구분해 보고한다. 사용자가 업로드하는 방식이므로 원격 브랜치에 직접 추가 푸시하지 않는다.
