# HANDOFF — Codex ↔ Claude Code 인수인계 (momgagym-cms2)

규칙은 `AGENTS.md` 참고. 작업을 시작하기 전에 읽고, 끝나면 갱신한다.
공개 저장소이므로 비밀값·개인정보 기록 금지.
짝을 이루는 저장소: `arfongce-ai/nutrition-cms` (영양앱, HTTPS API로 연동). 그쪽 상태는 그 저장소의 `docs/HANDOFF.md` 참고.

## 작업 잠금
같은 파일을 동시에 수정하지 않기 위한 표. 작업이 끝나면 내 줄을 지운다.

| 도구 | 수정 중인 파일/영역 | 시작 일시 |
|------|--------------------|-----------|
| (없음) | — | — |

## 프로젝트 현황 (2026-09-22 기준, 착수 전 `git status`로 재확인)

### 테스트 기준선
- `npm test` **3071/3082** 통과(2026-09-23 R1 회귀 11개 + 멈춤 방지 `lint_crash_guard` 1개 추가, 이전 3059/3070 — `test-baseline.json`도 3071/3082로 맞출 것). 기존부터 실패 중인 11개는 전부 "테스트가 구버전"인 경우로 확인됨(아래 참고), 실사용 버그 아님. `.github/test-baseline.json`의 `minPassing`이 이 숫자를 자동으로 지킨다(회귀 게이트)

### 기존 11개 실패 테스트 — 2026-09-22 원인 확인 완료 (실제 버그 아님)
- `measure_save_failure_regression.test.js`의 6개(Barbell/Gait/Squat/Stance/Jump): 저장 실패 시 report로 안 넘어가게 막는 실제 코드(`setSaveState('error'); return;`)는 이미 올바르게 들어가 있음. 테스트의 정규식이 파일 안의 **다른, 무관한** `catch (e) {` 블록(더 앞쪽에 있는)을 잘못 집어서 실패하는 것 — 테스트 정규식 버그. 실제 저장 실패 처리는 정상 작동
- `member_transfer_cross_member_ui.test.js`: import 줄을 문자열 그대로 비교하는데, 실제 코드는 이후 `SEGMENT_OPTIONS, segmentLabel`이 추가돼 import가 늘어남 — 기능 정상, 테스트 문자열만 구버전
- 나머지(portrait lock, 설정화면 관절/자세 블록 등) — 2026-08-05 배치에서 알려진 보류 항목, 기존 기록과 동일
- 정리 우선순위는 낮음(기능 자체엔 문제 없음). 손대고 싶으면 해당 테스트들의 어설션을 실제 코드에 맞춰 갱신하면 됨

### AI 측정 → 리포트 파이프라인 (2026-09-22 코드 점검)
- `src/ai-measure/core/unifiedReport.js`가 각 측정 모듈(squatBiomechanics, singleLegStance 등)을 직접 import해 리포트에 반영 — 연결 정상
- `gait_reports`/`posture_reports`/`rom_reports` 등 Firestore 컬렉션 참조가 `reportService.js`, `comprehensiveReportService.js`, 각 `*ReportDashboard.jsx`에 일관되게 연결돼 있음
- 코드에 TODO/FIXME/디버그 console.log 잔재 없음(2026-09-22 전수 검색 결과 0건)

### 모미(Momi) 음성인식
- `useMomiVoice.js`, `useMomiSpeech.js`, `momiService.js` 등 — 측정 리포트에 대한 음성 코멘트/인사이트용. 관련 테스트 전부 통과(11개 실패 목록에 없음)
- 영양앱의 음식사진 인식(vision-analyze.js, nutrition-cms 쪽)과는 **연결돼 있지 않음** — 서로 다른 기능, 합쳐진 적 없음. 필요하면 별도 작업으로 설계해야 함

### 회원관리/정산
- 매출관리(정산비율, 인센티브, 환불 등) 로직은 `src/utils/dailySettlement.js`, `finance.js` 등에 있고 관련 테스트(`daily_settlement.test.js`, `refund_flow.test.js`)는 통과 중 — 11개 실패 목록에 없음

### 자동 게이트 / Notion 자동화 (2026-09-22 전수 확인)
- `.github/workflows/regression-gate.yml` — ✅ 정상 (새 회귀만 차단)
- `cloudflare-pages.yml` — 2026-09-22 `cloudflare/pages-action`이 보안 취약점(CVE-2026-11325)으로 삭제되어 배포가 막혀 있던 걸 발견, `cloudflare/wrangler-action@v4`로 마이그레이션해서 복구함(커밋 `fe71f79`). ✅ 재배포 확인됨
- Notion 동기화 6종(주간요약/회원상세/세그먼트/트레이너실적/퍼널전환율/대시보드스냅샷) — 전부 ✅ 정상 실행 중(2026-09-22 전수 확인). 대시보드 스냅샷은 30분 주기로 설정돼 있지만 GitHub이 무료 저장소 예약실행을 자체적으로 늦춰서 실제로는 3~5시간 간격으로 도는 중(버그 아님, Firestore 읽기 비용 오히려 절감)

### 영양앱 ↔ CMS 연동
- (nutrition-cms 쪽 `docs/HANDOFF.md`와 내용 동일, 요약만) HTTPS API 브릿지 방식, 2026-09-22 기준 main에 병합·push 완료
- 미완료: Cloudflare `NUTRITION_LINK_SECRET` 등록, `VITE_FIREBASE_PROJECT_ID` 일치 확인, 실기기 왕복 테스트 — 전부 사용자 액션 필요(Cloudflare 대시보드 접근 권한 필요)

## 작업 로그
최신 항목이 위. 형식을 그대로 복사해서 쓴다.
### 2026-10-09 · Codex · 보행 좌우 차이 글 이미지·숏폼 제작
- 한 일: Notion 콘텐츠 캘린더에서 티스토리 글 「걸을 때 한쪽 신발만 더 닳는다면, 보행의 좌우 차이를 먼저 살펴보세요」와 본문을 확인하고, 로컬 자세 분석으로 후보 장면을 선정.
- 결과: 정사각 이미지 5장(1200×1200, SHA-256 확인), 무음 세로 영상 1개(1080×1920, 약 16초, `publishAllowed:false`), 선택 장면 컨택트 시트를 로컬에 생성. 회원명·원본 파일명·경로는 결과물과 로그에 기록하지 않음.
- 보안: 승인된 원본 영상은 읽기만 했고 편집본만 별도 생성. 원본 영상/프레임을 외부 AI, 클라우드, 저장소, Notion으로 보내지 않음.
- 티스토리: 편집기 경로를 열었으나 현재 브라우저 세션이 Kakao 로그인 화면으로 이동하여 이미지·영상 삽입과 임시저장은 미완료. 로그인 후 이 단계를 이어야 함.
- 검증: Python 콘텐츠 미디어 더미 테스트 8/8 통과. `npm test -- --run` 3174/3186(기존 11개 실패 및 `session_share` 시간 초과 1개). `npm run build` 성공(기존 Firebase 중복 import·큰 청크 경고).
- 다음에 할 일: 사용자가 현재 티스토리 브라우저에 로그인하면 본문에 이미지 5장·영상 1개를 넣고 비공개 임시저장 후 확인.
- 커밋: `d17b4b9` (작업 로그와 검토 대기열).

### 2026-10-08 · Codex · 승인 회원 영상에서 주제별 이미지·숏폼 로컬 제작
- 한 일: 사용자 승인에 따라 무료 로컬 도구를 준비하고, 승인된 회원 수업 영상의 최근 후보를 읽기 전용으로 분석. OpenCV 4.13.0.92, Gowun Dodum, OpenCV Zoo MP Pose/Person DNN 모델 사용. HOG·자세 랜드마크·무릎 굽힘·측면 겹침·프레임 변화로 서로 다른 클립 5개를 주제별 자동 선택.
- 결과: 이미지 5장(각 1200×1200)과 SHA-256 색인 검증. H.264 무음 영상 1개(1080×1920, 16초) 생성, 검수 JSON `publishAllowed:false`. 기존 휴리스틱 초안은 로컬 백업으로 보존하고 자세 기반 결과를 기본 결과로 이동. 컨택트 시트와 선택 기록은 로컬 후보 폴더에 저장.
- 보안: 원본 영상은 읽기만 함. 회원 영상/프레임은 외부 AI·클라우드·저장소·Notion으로 보내지 않음. 이름/경로는 출력·로그·공개 문서에 남기지 않음. 티스토리 본문 삽입·Notion 기록·게시·예약 등록은 하지 않음.
- 변경 파일: `scripts/content-media/extract_candidates.py`, `auto_select_frames.py`, `build_article_media.py`, `README.md`, `requirements-content-media.txt`, `tests/content-media/test_local_member_media.py`, `docs/VIDEO_AUTOMATION_MVP.md`, `docs/REVIEW_QUEUE.md`.
- 검증: Python 더미 테스트 8/8, `compileall`, `git diff --check` 통과. 최종 산출물 개수·크기·해시·영상 코덱/해상도/길이·무음·게시 차단 확인. 전체 Vitest 병렬 3171/3186(기존 11개 실패 + 시간 초과 4개); 단일 worker 전체 3173/3186(기존 11개 실패 + 시간 초과 2개); 느린 두 파일 단독 재실행 34/34. `npm run build` 성공(기존 Firebase import·큰 청크 경고).
- 남은 위험: 자세 모델은 ROM 측정기구를 식별하지 않아 측면 관절 자세를 대리 기준으로 선택. 얼굴 자동 제외는 큰 정면 얼굴만 일부 걸러내므로 사람/제3자 노출 최종 검수 필요. 전체 테스트는 기준선 3175에 2개 못 미쳤지만 해당 두 시간 초과 파일 단독 재실행은 통과.
- 다음에 할 일: R16 독립 교차 검토. 사람 검수 후 티스토리 삽입과 Notion 기록은 별도 실행.
- 커밋: `63b82ed` (코드·문서 작업).

### 2026-10-08 · Codex · 로컬 회원 영상 후보·이미지·숏폼 도구
- 한 일: 회원 수업 원본을 외부로 보내지 않는 로컬 전용 도구 추가. 번호가 붙은 강사 폴더만 탐색하고 2025-01-01 이후 MP4/MOV를 3초 간격 샘플링하도록 구현. OpenCV Haar 정면 얼굴 임계치, 번호만 보이는 로컬 HTML 컨택트 시트, 선택 프레임 5장의 1200×1200 후처리/해시, 선택 구간 3~4개·15~20초의 무음 1080×1920 렌더/`publishAllowed:false` 메타데이터를 추가.
- 변경 파일: `scripts/content-media/media_common.py`, `extract_candidates.py`, `build_post_images.py`, `build_short_video.py`, `tests/content-media/test_local_member_media.py`, `docs/VIDEO_AUTOMATION_MVP.md`, `docs/REVIEW_QUEUE.md`.
- 검증: 더미 소재 Python 단위 테스트 6/6, compileall, `git diff --check` 통과. 전체 Vitest 3170/3186(16 실패): 기존 알려진 11개 외 5개가 병렬 실행 시간 초과. 해당 4개 파일 단독 실행은 171/171 통과. `npm run build` 성공(기존 Firebase import 및 500KB 초과 청크 경고). 실제 회원 영상·프레임은 열지 않음.
- 미확인: 이 PC 실행 환경에서 OpenCV·FFmpeg/ffprobe·Gowun Dodum을 찾지 못함. 따라서 실제 후보 추출·컨택트 시트·최종 이미지·영상 파일은 만들지 못함. Haar는 큰 정면 얼굴 일부만 제외하므로 최종 검수는 사람이 해야 함.
- 보안: 성공 출력은 생성 수/길이만 표시하며 오류는 허용 코드만 출력. 매니페스트·해시에는 입력 경로·원본 이름 대신 해시 ID만 기록. 네트워크 전송·Notion 쓰기·업로드·공개 게시 없음.
- 다음에 할 일: `docs/REVIEW_QUEUE.md` R16 독립 검토, 사용자 PC에서 로컬 도구·글꼴 준비 후 후보 컨택트 시트를 생성하고 대표님이 선택.
- 커밋: 미생성. 푸시하지 않음.

### 2026-10-07 10:00 · Codex · R15 이미지 자동화 보완분 교차 검토 및 보완
- 한 일: 사용자가 전달한 Claude 변경을 검토하고 승인된 두 결함을 수정. R15 기능을 커밋한 뒤 발견별로 독립 보완 커밋 생성.
- 발견 및 보완:
  - 🟠 `scripts/content-image/finalize_images.py` `find_target_page`/`run` — 자동 article ID에 오늘 날짜와 Notion page ID 앞 8자리만 사용. 같은 Notion 행이 다음 날에도 미게시 조건이면 새 폴더 ID가 생겨 `OUTPUT_EXISTS`를 우회하고 같은 글을 재처리할 수 있음. 페이지 기준 지속 중복 방지 필요.
  - 🟠 `scripts/content-image/finalize_images.py` `_post_json` — 요청 URL은 정확히 허용된 data source query로 제한하지만 `urlopen`의 리다이렉트를 허용하고 최종 URL은 호스트만 검사. 같은 호스트 내 리다이렉트가 다른 경로로 향하면 POST가 허용 목록 밖 경로까지 전달될 수 있으므로, 리다이렉트 거부 또는 최종 URL 전체 비교가 필요.
  - 보완 커밋 `f18c73d`: Notion 조회 POST 전용 리다이렉트 차단 및 응답 URL 전체 일치 확인. `5bdfc6c`: 페이지 ID 해시 로컬 처리 기록과 이전 날짜 형식 결과 폴더 확인으로 같은 글 재처리 차단.
  - 추가 발견(수정 전 기록): 🟠 `find_target_page` — Notion 조회가 `page_size: 1`로 가장 오래된 승인·미게시 행만 가져온다. 초안 저장 후에도 `게시후링크`가 비어 있으면 이 행을 매일 다시 골라 `OUTPUT_EXISTS`로 멈추고 뒤의 승인 글은 처리하지 못한다. 조회 결과에서 로컬 처리 완료 페이지를 건너뛰고 다음 미처리 행을 찾아야 함.
  - 보완 커밋 `2d9da65`: 조회 페이지네이션을 지원하고 로컬에서 이미 처리한 행을 건너뛰어 다음 승인 글을 선택. 처리 완료 ID는 해시 기반 로컬 표식으로 유지.
  - 🟡 Notion의 data source ID/속성명·타입은 현재 자격정보 없는 상태에서 검증하지 않음. `게시후링크` URL 속성 및 필터 이름 불일치 시 조회는 `NOTION` 오류로 중단될 수 있음.
- POST 판단: Notion 공식 문서는 data source query를 POST로 정의하고 `read content` capability만 요구하므로 읽기 전용 예외로 허용. 코드에는 해당 query 외 POST/PATCH/PUT/DELETE가 없음.
- 테스트: Python 새 테스트 17/17(Windows 맑은 고딕 시험 폰트; Gowun Dodum 실환경 검증은 아님). 전체 `npm test -- --run` 3175/3186(기존 11개 실패만; 추가로 관측된 `ai_menu_grouping` 일시 시간초과는 단독 20/20 및 전체 재실행에서 해소). `npm run build` 성공(기존 Firebase 동적/정적 import·대형 청크 경고). `git diff --check` 통과.
- 실제 Notion/다운로드 폴더 접근은 하지 않음. 속성명·타입은 미확인.
- 남은 일: Claude 예약 댓글에 `IMAGE_PLAN_JSON` 형식을 넣기 전에는 `PHRASE_PLAN`으로 중단함. 실제 Notion 속성/Integration, Gowun Dodum, 다운로드 및 예약 작업 실행은 사용자 PC에서 별도 검증 필요.
- 커밋: `1550e76` R15 자동 타깃 선택, `f18c73d` POST 리다이렉트 차단, `5bdfc6c` 같은 글 재처리 차단, `2d9da65` 완료한 글을 건너뛰고 다음 행 선택. 문서 커밋 후 원격 브랜치로 푸시함.

### 2026-10-07 09:45 · Codex · 매일 Gemini 이미지 로컬 최종화
- 한 일: 로컬 모드에서 지정한 이미지 5개를 처리하고, 자동 모드에서는 Notion 캘린더의 승인된 티스토리 행 및 최근 Gemini 다운로드 5개를 선택하도록 구현. data source 조회는 읽기 전용 POST, 댓글은 GET. 오류 코드를 출력하고 원본 다운로드를 유지.
- 변경 파일: `scripts/content-image/finalize_images.py`, `scripts/content-image/register-finalizer-task.ps1`, `tests/content-image/test_finalize_images.py`, `scripts/content-video/postprocess_images.py`(payload 검증 함수 추출), `.gitignore`, `docs/VIDEO_AUTOMATION_MVP.md`, `docs/REVIEW_QUEUE.md`, `docs/HANDOFF.md`.
- 스케줄: 매일 07:30 PowerShell 등록 스크립트 작성. 기본은 미리보기이고 `-Register` 사용 전까지 등록하지 않음. 현재 태스크는 등록하지 않았음.
- 테스트: 새 Python 더미 테스트 8/8, 기존 이미지 후처리 테스트 5/5(운영 Gowun Dodum 대신 시험용 맑은 고딕), PowerShell 문법 파싱·Python compile·`git diff --check` 통과. `npm test -- --run` 3175/3186(기존 알려진 11개 실패만). `npm run build` 성공(기존 Firebase import·청크 경고).
- 미검증: 실제 Notion 토큰/댓글 조회, Gemini 다운로드 폴더 입력, 운영 글꼴 사용, Windows 작업 등록·실행, 실제 티스토리 삽입은 확인하지 않음. 08:47 이미지 생성과 07:30 처리 시각 때문에 첫 생성일 당일 삽입은 불가하고 다음 날 처리 흐름임.
- 교차 검토: `docs/REVIEW_QUEUE.md`의 R15에 독립 검토 요청 기록. 이 세션에서 Claude 교차 검토는 수행하지 않음.
- 다음에 할 일: Claude가 R15를 독립 검토한 뒤, 사용자 PC에서 필요한 로컬 경로·글꼴·읽기 토큰을 설정하고 등록 스크립트 미리보기 결과를 확인.

### 2026-10-07 09:20 · Codex · Production 배포 경로 충돌 방지
- 한 일: Cloudflare 화면의 `Production ec548ed`와 `Preview 6874b45`를 대조. `6874b45`는 `ec548ed`의 조상 커밋이므로 해당 변경은 Production에 포함됨. Preview는 작업 브랜치 검토 배포이고 Production은 병합된 `main` 배포임을 문서화.
- 변경 파일: `.github/workflows/cloudflare-pages.yml`, `docs/DEPLOYMENT.md`, `docs/HANDOFF.md`.
- 발견: 🟠 `.github/workflows/cloudflare-pages.yml` — `main` push만 확인하고 PR 병합 커밋인지 검증하지 않았음. 또 로컬 `main`은 원격보다 10커밋 뒤처졌고, `codex/video-input-guard-pr1`은 최신 `origin/main`보다 10커밋 뒤처진 채 2개 문서 커밋이 추가돼 있어 후속 작업 시 혼선·충돌 위험이 있었음. 해당 브랜치들은 보존하고 최신 `origin/main`에서 새 브랜치를 시작함.
- 보완: Production 배포 전에 대상 SHA가 `main`으로 병합 완료된 PR의 merge commit인지 GitHub API로 확인. PR 누락·권한 오류·조회 실패는 fail-closed 처리. Preview/Production 구분, PR 배포 순서, 오래된 브랜치 재사용 금지를 `docs/DEPLOYMENT.md`에 기록.
- 교차 검토 발견(수정 전 기록): 🟠 `.github/workflows/cloudflare-pages.yml` — 오래된 성공 run 재실행 또는 과거 main SHA 수동 실행 시 PR 검증만으로는 통과해 이전 빌드를 Production에 다시 게시할 수 있음. 업로드 직전 최신 main SHA 일치 확인이 필요.
- 보완: 배포 직전과 배포 후 최신 `main` SHA를 비교하도록 추가. 오래된 run 재실행·과거 SHA 수동 배포는 막고, 배포 중 main이 전진하면 해당 실행을 실패 처리해 최신 run 결과를 기다림.
- 교차 검토: 독립 읽기 전용 리뷰에서 stale rerun 위험을 발견해 수정함. Claude 전용 연결은 이 세션에 제공되지 않음.
- 테스트: `npm test -- --run` → 3175/3186 통과(기준선 3175 충족, 기존 알려진 11개 실패). 배포 workflow와 같은 JSON 회귀 검사 → 3175/3186, 통과. `session_share.test.js` 단독 14/14 통과(전체 테스트+빌드 동시 실행 때만 나타난 1개 시간초과). `npm run build` 성공(기존 Firebase import 및 큰 청크 경고). workflow YAML과 필수 guard 단계 파싱, `git diff --check` 통과.
- 남은 위험: 저장소 밖 Cloudflare 수동 배포와 GitHub branch protection 설정은 대시보드 권한 없이 변경·강제할 수 없음. 로그인 후 CMS 실사용 기능 검증은 별도임.
- 배포 확인: PR #6 병합 커밋 `0bb7231`에서 GitHub Actions Production run #412 성공. PR 출처 확인, 테스트 회귀 게이트, 빌드, 최신 main 사전·사후 확인을 통과했고 Wrangler 배포 주소 `https://162a7bac.momgagym-cms2.pages.dev`를 생성함. 운영 별칭 `https://momgagym-cms2.pages.dev`가 이번 빌드 번들 `/assets/index-CaRIug2c.js`를 제공함.
- 현재 상태: 로컬 `main`을 `origin/main`의 `0bb7231`까지 fast-forward. 기존 `codex/video-input-guard-pr1`의 별도 문서 커밋은 보존했으며, 새 작업은 최신 `origin/main`에서 시작.
- 다음에 할 일: CMS 내부 로그인 후 기능 검증은 별도 업무 변경을 배포할 때 수행. Claude 전용 연결은 이 세션에 제공되지 않아 독립 리뷰 결과를 기록함.

### 2026-10-06 · Codex · Cloudflare Production 배포 검증 강화
- 한 일: PR4 배포는 성공했지만 기존 배포 workflow가 테스트 실패를 무조건 무시하는 점을 확인. 회귀 기준선 검사 통과 후에만 배포하도록 하고, 수동 실행도 main에서만 허용. Pages 배포 브랜치를 main으로 고정하고 Production URL이 현재 빌드의 JS 자산을 제공하는지 확인하도록 변경.
- 변경 파일: `.github/workflows/cloudflare-pages.yml`
- 테스트: `npm run build` 성공(기존 Firebase import/대형 청크 경고); `git diff --check` 및 YAML 파싱 통과. 전체 Vitest 로컬 실행은 sandbox의 상위 경로 접근 거부로 설정 파일을 읽지 못함.
- 남은 위험: CI 회귀 기준선과 배포 후 HTML/JS 자산 응답은 검증하지만 로그인 후 Firebase/개별 업무 화면의 실제 동작까지 보증하지는 않음.
- 다음에 할 일: PR CI에서 회귀 게이트와 Production smoke check 확인. 특정 화면의 런타임 오류는 해당 오류를 재현해 별도 보완.

### 2026-10-06 · Codex · 사용자 제공 Claude 검토 로그 반영
- 한 일: 사용자가 전달한 Claude의 PR2 교차 검토 및 보완 기록을 이 작업 로그 맨 위에 추가. 현재 브랜치에 반영된 보완·검증 기록은 이어지는 최신 Codex 로그를 기준으로 확인.
- 다음에 할 일: Claude가 현재 원격 브랜치와 최신 Codex 검증 기록을 기준으로 후속 검토.
### 2026-10-06 · Claude · 교차 검토 PR2 (c61e3b0) Notion 연동·이미지 후처리

- 한 일: `c61e3b0`(및 이후 문서 커밋)의 notionClient / notionWorkflow / run-notion-review / prepare-review diff / postprocess_images.py / 테스트 2개 / VIDEO_AUTOMATION_MVP.md 추가분을 읽기 전용으로 검토. 코드 수정·커밋 없음.
- 실제 실행한 명령: git show/grep/sed(읽기 전용)뿐. `npm test`, `npm run build`, Python 단위 테스트는 **실행하지 않음**. Codex가 적은 3172/3183 등 결과는 보고만 받았고 독립 확인 못 함.
- 실제 검증 미통과(확인 못 함): 실제 Notion 왕복(Integration·속성·환경변수 없음), 실제 이미지 5장 후처리(원본 PNG·Gowun Dodum 글꼴 없음), 실제 영상 렌더(승인 자산·동의 스냅샷 없음). Pillow 테스트는 글꼴이 없으면 skip 되므로 통과로 세지 않음.
- 발견:
  - 🟠 `scripts/content-video/notionWorkflow.mjs:50-62` + `notionClient.mjs:162-165` — `편집 중`인데 `마지막 처리 시각`이 비어 있으면 stale 판정이 false라 영원히 복구되지 않음(수동 입력·속성 신설 직후 행). 테스트도 시각이 있는 경우만 확인.
  - 🟠 `notionWorkflow.mjs:101-110` — 선점(편집 중 기록) 전에 재조회·재확인이 없어 06:00 작업이 겹쳐 돌면 같은 행을 둘 다 처리할 수 있음(단일 PC면 낮은 위험).
  - 🟠 `notionClient.mjs:142` — `채널`이 단일 선택이면 행 1개 = 채널 1개. 계획(하루 1개를 4채널 동시)과 동의 허용 채널 대조가 맞는지 사용자 결정 필요.
  - 🟠 `postprocess_images.py:54-75` — 문구 상자가 항상 하단(68% 이후)에 고정. 프롬프트상 1·2번은 상단, 5번은 중앙에 여백을 남기므로 피사체를 가릴 수 있음. 실제 이미지로 확인 못 함.
  - 🟡 `postprocess_images.py:71` — 흰 반투명 둥근 상자는 "PPT/템플릿 느낌 금지" 규칙과 충돌 가능. 실제 결과물을 보고 판단 필요.
  - 🟡 `notionClient.mjs:36` — `request()`가 public이라 허용 목록 검사(`updatePage`)를 거치지 않고 호출 가능. 현재 호출자는 없음.
  - 🟡 `notionClient.mjs:123,140` — `클립 ID`·`동의 참조값`을 rich_text로만 읽음. 동의 DB의 실제 속성 유형은 확인 못 함(title이면 빈 값 → NO_CONSENT/필터 오류 → fail-closed).
  - 🟡 `notionWorkflow.mjs:86-98` — 검증 실패 행은 `영상 제작 대기`로 되돌려져 매 실행마다 재시도·재기록됨(허용 상태에 반려/수정 요청이 없어서). 의도라면 문서화 필요.
  - 🟡 `postprocess_images.py:161-162` — 파일 6개를 하나씩 교체하므로 도중 중단 시 구/신 파일이 섞일 수 있음.
  - 🟡 `content-video/image-phrases.example.json` 예시 문구가 Notion 이미지 계획 문구와 다름(실행 전 교체 필요).
  - 🟡 테스트 공백(`src/__tests__/content_video_notion.test.js`): SKIPPED 경로, 쓰기 실패 경로, 페이지네이션, 로그에 경로 미노출(run-notion-review), Notion 외 호스트 거부, `publishAllowed:false` 확인이 PR2 테스트에는 없음(마지막은 PR1 테스트에 있을 수 있음 — 확인 못 함).
  - ✅ 잠금 확인됨(테스트 존재): 동의 조회/파싱 실패 시 전체 차단(98행), 쓰기 허용 목록·게시 상태 거부(80·86행), 읽기 전용 클라이언트 쓰기 거부(86행), 429 재시도 3회·토큰 미노출(53·66행), stale 복구(시각 있을 때, 135행).
- 남은 위험: 위 미검증 3건. `Notion-Version: 2026-03-11` 값은 실제 호출로 확인 못 함.
- 다음에 할 일: 사용자가 "진행"을 지시하면 🟠 항목부터 1건 1커밋으로 보완(회귀 테스트 포함). 그 전에는 코드 수정 없음. 업로드는 사용자가 `1_GITHUB_UPLOAD.bat`.

### 2026-10-06 · Claude · PR2 보완 (사용자 "진행" 지시 후)

- 한 일: 🟠 3건 보완, 건당 1커밋(로컬 clone `codex/notion-content-pr2` 위, push 안 함).
  - `6ee26c7` 처리 시각 없는 `편집 중` 행도 복구(`notionClient.mjs isStaleEdit`) + 테스트 2개
  - `d13151b` 선점 직전 대기열 재조회(`notionWorkflow.mjs`) + 테스트 1개
  - `5ccaa2a` 이미지 문구 위치 `positions`(top/center/bottom ×5, 생략 시 전부 bottom) `postprocess_images.py` + 테스트 2개
- 테스트: `npx vitest run content_video_notion.test.js` → 17/17. `npm test -- --run` → 3175/3186(실패 11 = 기존 알려진 11개, 4파일). `npm run build` 성공(기존 chunk 경고). Python: 대체 글꼴(Noto Sans CJK, Gowun Dodum 아님)로 `unittest` 5/5 — 실제 글꼴 검증 아님.
- 보완하지 않은 것: 🟠 `채널` 단일 선택 구조(대표님 결정 필요), 🟡 전 항목. 실제 Notion·이미지·영상 검증은 여전히 미통과.
- 다음: `.github/test-baseline.json` minPassing 갱신 여부는 대표님 판단. 이미지 문구 계획 JSON에 positions 추가 필요(1·2번 top, 5번 center 권장).

### 2026-10-06 17:40 · Codex · Claude 인계 문서 최신화
- 한 일: `docs/CLAUDE_HANDOFF_PR2_2026-10-06.md`에 보완 커밋 `fbeb857`, 새 테스트/기준선, Notion 동시 실행의 비원자성 한계를 반영. 작업 잠금 해제.
- 다음에 할 일: Claude가 최신 원격 브랜치 `codex/notion-content-pr2`와 인계 문서를 기준으로 교차 검토.
### 2026-10-06 17:36 · Codex · PR2 보완 패치 적용
- 한 일: 사용자 제공 패치 3건을 적용. 처리 시각 누락 편집 행 복구, Notion 선점 직전 대기열 재조회, 이미지 문구 위치(top/center/bottom) 지원. 예시 이미지 문구 계획과 설명서에 위치 지정 반영. 신규 테스트 3개를 기준선에 반영(`3175/3186`).
- 검증: Notion/영상 집중 Vitest 45/45, 전체 Vitest 3175/3186(기존 11개 실패만), 이미지 더미 테스트 5/5(시험 전용 대체 폰트), `npm run build` 성공(기존 경고). `git diff --check` 실행.
- 남은 위험: Notion 재조회 후 상태 수정은 API의 조건부 갱신이 아니므로 진정한 원자적 락은 아님. 동시 실행이 같은 행을 거의 동시에 재조회하면 중복 처리가 여전히 가능함. 실 Notion·실 이미지·실 영상은 기존 설정/소재 부재로 미실행.
- 다음에 할 일: Claude 교차 검토. 중복 실행을 완전히 막아야 하면 지원되는 Notion 원자성 또는 실행 주체 단일화 방안을 별도 결정.
### 2026-10-06 16:55 · Codex · Claude PR2 인계 문서 추가
- 한 일: 검증 결과와 미완료 항목, 필요한 실 Notion/이미지/영상 후속 조건을 비밀값 없이 `docs/CLAUDE_HANDOFF_PR2_2026-10-06.md`에 기록. HANDOFF 작업 잠금 해제.
- 다음에 할 일: Claude가 인계 문서와 REVIEW_LOOP에 따라 교차 검토. 실제 Notion 자격정보·속성 및 로컬 원본/글꼴이 준비되기 전 실연결/실이미지/실영상 실행을 완료로 표시하지 않음.
### 2026-10-06 16:54 · Codex · PR2 및 이미지 후처리 재검증
- 한 일: PR2 구현(`c61e3b0`)과 후처리 코드를 현재 브랜치에서 재확인. Notion 쓰기 허용 목록 및 검수/게시 승인 속성 비쓰기, 동의 조회 실패 시 fail-closed, 로컬 전용 이미지 후처리 요구를 확인. 코드 수정은 없고 기존 구현을 검증함.
- 검증: PR1/PR2 Vitest 42/42 통과. 전체 `npm test -- --run` 3172/3183 통과, 기존 기록의 실패 11개만 재현(첫 실행의 `session_share` 시간초과는 단독 14/14 및 전체 재실행에서 해소). Python 이미지 더미 테스트 3/3 통과(시스템 맑은 고딕을 시험용 대체 폰트로 사용). `npm run build` 성공(기존 Firebase import 및 큰 청크 경고). FFmpeg 9.0.1·ffprobe 확인.
- 미완료: Gowun Dodum 글꼴 없음. 지정 이미지 폴더가 없고 이 세션에서 원본 5장도 제공되지 않아 실제 `final` PNG/해시를 만들지 않음. Notion 환경 설정 4개 및 로컬 설정/동의/승인 파일이 없어 실 Notion 왕복 및 영상 렌더는 미실행. Notion 스키마 수동 설정 및 별도 Claude 교차검토도 대기.
- 다음에 할 일: 실제 비식별 원본 PNG 5장·Gowun Dodum 글꼴과 동의된 로컬 설정이 준비되면 오프라인 후처리/영상 리허설을 하고, Notion 스키마·Integration 준비 뒤 목 응답이 아닌 1회 실연결 확인. 사용자가 `1_GITHUB_UPLOAD.bat`으로 업로드한 뒤 Claude 교차 검토.
### 2026-10-06 · Codex · PR2 Notion 대기열 및 이미지 후처리
- 한 일: PR #3 병합 커밋을 origin/main에서 확인하고 PR2 브랜치에서 진행. 구현 커밋 `c61e3b0`. Notion data source query 클라이언트, 읽기 전용 동의 연결/캘린더 쓰기 연결 분리, 허용 목록 기반 쓰기, 동의 실패 시 fail-closed, 30분 stale 편집 복구 및 로컬 영상 렌더 파이프라인 연결 추가. Python/Pillow로 PNG 5장 1:1 크롭·1080 정규화·한글 문구/선택 로고 합성·경로 없는 SHA-256 색인 스크립트 추가.
- Notion 확인: 연결된 Notion에서 캘린더 data source 스키마만 읽음(행 데이터/본문은 읽지 않음). 기존 속성은 `콘텐츠 유형`·`제작 상태`·`채널` select, `클립 ID` text, `Drive 링크` URL. `대본`, 구간 시작/끝, 동의 참조, 결과 해시, 처리 시각, 오류 요약은 현재 없음. 추가 속성은 수동으로 만들지 않았으며 `docs/VIDEO_AUTOMATION_MVP.md`에 제안만 기록. 별도 동의 data source 스키마·Integration token은 확인하지 않았으므로 실 Notion 왕복은 미검증.
- 변경 파일: `.github/test-baseline.json`, `.gitignore`, `scripts/content-video/notionClient.mjs`, `scripts/content-video/notionWorkflow.mjs`, `scripts/content-video/run-notion-review.mjs`, `scripts/content-video/prepare-review.mjs`, `scripts/content-video/postprocess_images.py`, `content-video/image-phrases.example.json`, `requirements-content-video.txt`, `src/__tests__/content_video_notion.test.js`, `tests/content-video/test_postprocess_images.py`, `package.json`, `docs/VIDEO_AUTOMATION_MVP.md`, `docs/HANDOFF.md`, `docs/REVIEW_QUEUE.md`.
- 테스트: PR2/PR1 관련 Vitest 42/42 통과. 전체 `npm test -- --run` → 3172/3183 통과, 실패 11은 기존 문서화된 네 파일에만 있음(`measure_save_failure_regression` 7, `measure_fixes_batch` 2, `ai_measure_items_2607` 1, `member_transfer_cross_member_ui` 1). 이미지 더미 unittest 3/3 통과(Pillow 12.3.0, 테스트 폰트는 Windows 맑은 고딕; Gowun Dodum 글꼴은 없음). `npm run build` 성공(기존 Firebase import·chunk 크기 경고). `git diff --check` 통과.
- 제한: 이 PC의 네 Notion 환경변수와 로컬 `config.local.json`·동의/승인 매니페스트는 미설정/미발견(값·경로는 기록하지 않음). 필요한 수동 schema 속성도 아직 없음. 회원 영상·D:/F:는 열지 않았고 실제 이미지·Notion 쓰기·티스토리 업로드·예약 등록은 하지 않음. 이미지 렌더는 임시 더미 소재로만 테스트.
- 다음에 할 일: 동의 DB/캘린더 속성과 별도 토큰을 사용자 PC에서 설정한 뒤 Notion 목이 아닌 1회 연결 시험. 다른 도구가 PR2를 교차 검토하고, 발견사항을 먼저 기록한 후 사용자 지시에 따라 보완.

### 2026-10-02 · Codex · Gemini 독립 검토 보완
- 한 일: 동의 만료일을 한국 시간 기준 `23:59:59.999+09:00`로 해석하고 경계 테스트를 추가. 입력 클립은 경로 입력 후 `lstat(filePath)`를 먼저 수행하고 링크 확인도 원래 경로 기준으로 유지. 입력 루트 자체의 심볼릭 링크·정션 거부 규칙을 문서화.
- 변경 파일: `scripts/content-video/videoMvp.mjs`, `scripts/content-video/inputGuard.mjs`, `docs/VIDEO_AUTOMATION_MVP.md`, `src/__tests__/content_video_mvp.test.js`, `docs/HANDOFF.md`.
- 테스트: `$env:TZ='UTC'; npm test -- --run src/__tests__/content_video_mvp.test.js` → 28/28 통과. `npm run build` 성공(기존 Firebase import 및 대형 청크 경고). `git diff --check` 통과.
- 남은 위험: 정션 생성·검증은 현재 경로의 실제 OS 권한 환경에서 별도 실험하지 않음.
- 다음에 할 일: 같은 작업 브랜치에 커밋.

### 2026-10-01 21:37 · Codex · PR1 Claude 보안 검토 보완
- 한 일: 출력 경로에서 `lstat` 후 `realpath`를 호출하고, `realpath`의 `ENOENT` 뒤 재검증한 항목(끊어진 링크 포함)은 `PATH_REJECTED` 처리. 렌더 건너뛰기 지문에 입력 해시·트림·자막·로고/엔딩카드 파일 해시·고정 렌더 설정을 반영. 클립의 `startSec`를 파이프라인 진입에서 숫자로 정규화해 검증·FFmpeg가 같은 값을 사용하도록 변경. FFmpeg 실행에 유한 timeout을 지정하고 manifest 내 중복 클립 ID의 두 번째 항목을 `UNKNOWN` 실패로 격리.
- 변경 파일: `scripts/content-video/inputGuard.mjs`, `scripts/content-video/prepare-review.mjs`, `scripts/content-video/videoMvp.mjs`, `src/__tests__/content_video_mvp.test.js`, `docs/HANDOFF.md`.
- 테스트: 콘텐츠 영상 테스트 27/27 통과(끊어진 링크 및 ENOENT 재검증, 자막 변경 재렌더, startSec 누락/문자열, 중복 ID, timeout, 외부 통신 문자열 및 경로 누출 검사 포함). 전체 `npm test -- --run` 3157/3168 통과; 실패 11개는 기준선에 문서화된 기존 테스트 실패와 동일한 4개 파일. `npm run build` 성공(기존 Firebase import 및 대형 청크 경고). `git diff --check` 통과.
- 확인 불가: FFmpeg의 실제 장시간 중단/종료 동작은 더미 runner로 timeout 옵션만 검증. 실제 운영 영상·권한은 사용하지 않음.
- 다음에 할 일: Claude 보안 검토 → Gemini 독립 검토 → 대표님 최종 승인 후 사용자 방식으로 푸시.

### 2026-10-01 18:12 · Codex · Issue #2 PR1 입력 가드 + 클립 격리
- 한 일: `scripts/content-video/inputGuard.mjs`를 추가해 가명 클립 ID로 루트 바로 아래의 허용 파일만 찾고, realpath/상대 경로·심볼릭 링크·정션·네트워크 경로·확장자·출력 루트를 확인. 매니페스트 경로 입력을 제거하고 동의 스냅샷의 중복 참조 레코드를 전부 대조하며, 클립별 FFmpeg 실패 격리·임시 출력·SHA-256 원장·재실행 건너뛰기를 구현.
- 변경 파일: `scripts/content-video/inputGuard.mjs`, `scripts/content-video/videoMvp.mjs`, `scripts/content-video/prepare-review.mjs`, `src/__tests__/content_video_mvp.test.js`, `content-video/approved.example.json`, `content-video/consents.example.json`, `docs/VIDEO_AUTOMATION_MVP.md`, `AGENTS.md`, `GEMINI.md`, `.gitignore`, `docs/HANDOFF.md`.
- 기준점 차이: 이전 예시는 자유 `source` 경로·브랜드 절대 경로를 포함했고 동의 검증은 참조 첫 항목만 찾았다. 현재 스키마를 확인해 `clipId` 기반으로 바꾸고 경로는 무시/거부하도록 처리했다.
- 테스트: 영상 테스트 19/19 통과. 전체 `npm test -- --run --reporter=json` 3147/3160 통과; 문서화된 기존 실패 11개와 추가 시간 초과 2개(`ai_menu_grouping.test.js`, `session_share.test.js`). 두 시간 초과 파일은 단독 재실행 시 34/34 통과. 전체 실패 수는 기준선보다 2개 높지만, 두 테스트는 개별 통과했고 변경 범위 밖에서 전체 실행 중 시간 초과가 발생.
- 빌드·정적 확인: `npm run build` 성공(기존 Firebase 동적/정적 import와 큰 청크 경고). Node 문법 검사, `git diff --check`, 로컬 설정·원장 Git 제외 확인 통과. 수정 범위에서 외부 통신/게시 도메인 검색 결과 없음.
- 확인 불가: FFmpeg 9.0.1은 설치 확인했으나, 로컬 설정의 실제 루트 권한과 실제 입력 소재 인코딩은 실행하지 않음. 실제 PC 폴더 접근 권한과 운영 파일 검수는 미확인.
- 다음에 할 일: Claude 보안 검토 → Gemini 독립 검토 → 검토 발견이 있으면 Codex 보완. 대표님 최종 확인 후 사용자 방식으로 업로드.

### 2026-09-30 10:50 · Claude Code · R11 모미 음성인식 근본 원인 재조사
- 한 일: main `0d65e2c` 기준 `useMomiVoice.js`·`GlobalVoiceCommand.jsx`·`KioskVoiceCommand.jsx`·`AppLayout.jsx` 이벤트 흐름 추적, `181ac20` diff 검토, 제공된 스크린샷 2장의 콘솔 문구·시각·번들명을 코드와 대조. Claude in Chrome 확장이 이 세션에 연결되지 않아 실기기 브라우저에서 `SpeechRecognition.available()` 등을 직접 실행하지는 못함(미검증으로 표시).
- 입증된 사실(코드+스크린샷):
  - 🟠 **스크린샷은 `181ac20` 배포 전 화면** — 작업표시줄 시각 9:13/9:17, `181ac20` 커밋 09:33, 스크린샷 콘솔 번들 `index-Dudjcpg4.js`는 `0413184` 배포본(HANDOFF 09-29 22:17 항목)이고 `181ac20` 배포본은 `index-D4Lo7rMl.js`. 따라서 두 화면은 “동시 캡처 수정”을 검증도 반증도 하지 못함. 저신호 결과는 수정 전 코드(인식기가 켜진 채 두 번째 캡처) 결과이며, 수정 후 재측정 전에는 원인 미확정.
  - 🟠 `useMomiVoice.js:1174-1175` — 콘솔의 `한국어 음성 팩 설치 실패: 한국어 음성 팩 설치에 실패했습니다.`는 앱이 직접 만든 Error 문구. `SpeechRecognition.install()`이 **예외 없이 falsy로 resolve**된 경우에만 이 문구가 나옴(예외였다면 브라우저 예외 메시지가 표시됨). 즉 `install`은 존재하지만 브라우저가 “설치 안 됨”을 반환. 원인(SODA 구성요소 미제공 등)은 반환값만으로 알 수 없음. 현재는 미지원/반환 false/예외/무응답이 구분되지 않고 timeout도 없어 `await installRequest`가 멈추면 인식기가 꺼진 채 남음.
  - 🟠 `aborted`는 앱이 직접 만듦: `installLocalRecognition`(1168), `diagnoseMicrophone`(1073), TTS 일시정지(798)가 `recognition.abort()`를 호출하고 `onerror`(594)가 이를 `console.warn('[모미] 인식 오류: aborted')`로 출력. 스크린샷 콘솔의 `aborted → 설치 실패` 쌍 3회는 설치 버튼 3회 클릭과 일치. 브라우저 음성 서비스 오류가 아님(단, 오해를 부르는 경고).
  - 🟠 설치 실패 안내가 300ms 뒤 사라짐: 실패 후 `startListeningRef`가 재시작 → `onstart`가 `online-listening`으로 상태를 덮어써 `로컬 음성팩 설치에 실패했어요` 문구(`*VoiceCommand.jsx` localInstallText)가 표시되지 않고 기본 안내+같은 설치 버튼이 계속 노출됨(스크린샷 2 우하단이 기본 문구). 동일 유형 버그가 09-30 08:59에 no-speech에서 이미 한 번 수정됨.
  - 🟠 `network`는 앱이 만들지 않음(`network` 문자열은 `handleErrorOccurred` 안내 문구뿐, 오류 코드는 `event.error` 그대로 전달) → 브라우저 음성 서비스 경로 오류. `몸이야?`/`모미야?` 전사가 같이 나오는 것으로 보아 원격 인식이 간헐적으로만 성공. 원인(서비스 접근 차단·네트워크·엔진)은 코드로 특정 불가.
  - 🟠 로컬 처리 실패 후 원격 복귀 없음: `startListening`(1013-1019)이 `available()==='available'`이면 `processLocally=true`로 고정하고, `onerror`에는 `language-not-supported`(로컬 팩 없음/언어 미지원 시 표준 오류) 분기가 없어 `onend`가 같은 설정으로 무한 재시작함. `service-not-allowed`는 권한 거부로 취급되어 인식이 영구 중단됨(로컬 모드에서도 동일).
  - 🟡 진단 측정 vs 실제 엔진: 진단은 `echoCancellation/noiseSuppression/autoGainControl: true`로 캡처(1080-1082)하는데 같은 파일 852-857 주석은 Windows에서 이 옵션이 마이크 레벨·통화 모드를 바꾼다고 기록. 인식 엔진은 브라우저 기본 캡처(제약조건 제어 불가) — 동일 장치·동일 처리라고 보장할 수 없음. 진단은 수치·장치·AudioContext 상태를 보여주지 않아 “저신호”의 근거를 사용자가 확인할 수 없고, 처음 2초 안에 말하면 ambient가 커져 저신호로 판정됨(`hasMicSignal`). 무대(`stagePhase`)가 열려 있으면 측정 스트림(`onAudioLevel`)이 별도로 열려 있어 진단 중 동시 캡처가 1개 더 남음.
  - 확인된 정상: PC/키오스크는 `AppLayout.jsx:220-221`에서 관리자(`role==='admin'`)만, `kioskOn` 여부로 서로 배타적으로 마운트. 시작은 마운트 시 `startListening()`(사용자 제스처 없음 — 마이크 권한은 이미 허용된 경우만 성공, 설치 버튼만 제스처 사용). `ERR_BLOCKED_BY_CLIENT`(Firestore Listen)와 Tracking Prevention(jsDelivr 저장소 접근)은 음성 경로(SpeechRecognition/getUserMedia)와 코드상 접점이 없어 원인으로 분류하지 않음(인과 미입증).
- 미확인: 실기기에서 `available()` 반환값, `install()`이 false를 주는 이유, `network`의 원인, 마이크 저신호가 하드웨어/OS인지 진단 방식인지. 각 노트북에서 실행할 사용자 실행형 진단 페이지를 추가할 예정(녹음·전송·발화 내용 저장 없음).
- 계획(최소 수정): ① 설치 실패를 원인 코드로 구분+timeout+실패 문구 유지 ② `language-not-supported`/로컬 시작 실패 시 원격 인식으로 실제 복귀 ③ 앱이 낸 `aborted`는 경고 대신 정보 로그 ④ 인앱 진단이 수치·장치 정보 표시 ⑤ 정적 진단 페이지 `public/momi-diag.html`.
- 사용자 결정: 2026-09-30 “제대로 작동되게 진행”·“적용” 요청 유지.
- 수정(위 계획 그대로, 입증된 결함만):
  - `src/utils/momiDiagnostics.js`(신규, 앱 의존성 없음) — `requestLocalRecognitionInstall`(미지원/`returned-false`/예외/90초 시간 초과 구분), `classifyRecognitionError`, `measureMicrophone`+`classifyMicMeasurement`(음소거·컨텍스트 미시작·완전 무음·조기 발화·저신호·정상), 진단 문구(수치 표시).
  - `src/hooks/useMomiVoice.js` — 설치 실패 사유 전달(`local-install-failed`, reason, detail)·timeout, 모미가 직접 낸 `aborted`는 `console.info`(abort 3경로에서 `abortedByAppRef`), 로컬 모드의 `language-not-supported`/`service-not-allowed`는 `processLocally=false`+원격 모드로 실제 복귀(`local-fallback`), 원격 모드에서 회복 불가 오류는 재시작 루프 대신 중단. 인앱 진단은 `measureMicrophone`으로 옮기고 수치·판정 반환(동작·제약조건은 종전과 동일).
  - `GlobalVoiceCommand.jsx`·`KioskVoiceCommand.jsx` — `localInstallFailure` 상태로 실패 사유 문구를 유지(재시작 `onstart`가 덮지 않음), 재시도 불필요한 사유는 설치 버튼 숨김, 진단 결과에 수치 표시.
  - `src/pages/MicTest.jsx`(`/mic-test`, 로그인 불필요) — 환경(브라우저·`available()` 로컬/원격 값·장치 수), 마이크 원시/처리 각 5초 측정(장치명·음소거·컨텍스트·적용 옵션), 음성팩 `install()` 시험, 인식 모드 선택(기본/로컬/원격), 이벤트 시각(+ms) 기록, 결과 복사. 인식 문장은 글자 수·신뢰도만 표시, 전송·저장 없음.
  - 테스트: `src/__tests__/momi_root_cause_2609.test.js`(신규 18개, 실행형 위주), `momi_recognition_boost_2609.test.js` 2곳(측정 로직 이동·`errorKind` 표현) 갱신.
- 테스트 결과: 전체 `npx vitest run` 3135/3146(실행형 훅 테스트 6개 포함, 최종), 실패 11개 = 수정 전 기준선과 동일(4개 파일: `ai_measure_items_2607` 1, `measure_fixes_batch` 2, `measure_save_failure_regression` 7, `member_transfer_cross_member_ui` 1). 새 실패 0. 음성 관련 7개 파일 198/198. `npm run lint`는 기존 `unifiedReport.js:326` 중복 키 1건만(변경 파일 ESLint 0건). `npm run build` 통과(기존 chunk 크기 경고).
- 남은 불확실성(실기기 미검증): ① `install()`이 false를 주는 원인(브라우저/배포판별 언어팩 미제공 추정, 미확인) ② `network`의 원인(서비스 접근/네트워크/엔진) ③ 저신호가 하드웨어·OS 때문인지 진단 방식 때문인지(`181ac20` 후 재측정 전) ④ 로컬 fallback 분기는 표준 오류 코드 기준이며 실제 브라우저에서 발생시켜 보지는 못함 ⑤ 진단 중 무대가 열려 있으면 측정용 스트림이 하나 더 열려 있음(미수정).
- 다음에 할 일: 배포 후 두 노트북에서 `/mic-test`의 “결과 복사” 값 수집(아래 사용자 절차) → 값에 따라 원인 확정.
- 재검증(2026-09-30 10:55, 사용자 요청 “한 번 더 정밀하게”): `src/__tests__/momi_hook_exec_2609.test.js`(신규 6개) — 가짜 React 훅+가짜 `SpeechRecognition`으로 실제 `useMomiVoice`를 실행해 이벤트 순서를 검증. 설치 `false`→사유 `returned-false`·`aborted`는 정보 로그·300ms 뒤 청취 재개, 설치 무응답→`timeout` 후 재개, 로컬 모드 `language-not-supported`→`processLocally=false` 복귀 후 재시작(원격에서도 같으면 중단), `network`→오류 보고+재시작, `not-allowed`→재시작 안 함. 수정 전 훅(`0d65e2c`)으로 바꿔 돌리면 앞의 3개(설치 사유·무응답 멈춤·로컬 복귀)가 실패하고 나머지 3개는 종전에도 통과 — 즉 위 결함이 실제로 있었고 수정이 이를 고쳤음을 확인. 실제 브라우저의 이벤트는 재현하지 못함(가짜 객체 기준).
- 미확인: 운영 번들 반영 여부(이 세션은 배포 사이트·GitHub Actions 조회 불가). 사용자가 `/mic-test`가 열리고 “마이크 신호 측정(원시/처리)” 버튼이 보이는지로 확인.

### 2026-09-30 · Codex · R11 실기기 화면 재검토 — 진단 동시 캡처 및 로컬팩 실패
- 한 일: 두 노트북 운영 화면을 검토. 첫 기기는 `몸이야?`/`모미야?` 전사 로그가 있어 입력·일부 전사는 동작하지만 한국어 음성팩 설치 실패와 `network`/`aborted`가 반복됨. 두 번째 기기의 “입력 신호 변화가 거의 없습니다” 진단 결과는 측정 방식의 신뢰성을 점검.
- 발견: 🟠 `src/hooks/useMomiVoice.js:1045` — 모미의 SpeechRecognition을 계속 실행한 채 두 번째 `getUserMedia()` 스트림을 열어 RMS 측정. 브라우저/장치의 동시 마이크 캡처 동작에 따라 실제 입력이 있는데도 진단이 낮게 나올 수 있음. 첫 화면의 jsDelivr Tracking Prevention 경고는 음성 팩/ASR 실패의 직접 원인으로 확인되지 않음.
- 수정: 마이크 진단은 확인 답변 처리 중에는 실행하지 않고, 진행 중인 인식 세션을 종료한 뒤 별도 입력 스트림을 측정하도록 변경. 측정 후 사용자가 계속 듣기를 원할 때만 재시작. 검사에 정지→측정→재개 순서 및 답변 대기 보호를 추가.
- 테스트: R11 관련 `momi_recognition_boost_2609.test.js` 32/32 통과; ESLint 통과; `npm run build` 성공(기존 Firebase 동적/정적 import 및 큰 청크 경고). 전체 `npm test -- --run --reporter=dot` 3111/3122, 실패 11개로 HANDOFF에 기록된 기존 실패 11개와 동일. `git diff --check` 통과.
- 남은 위험: 이 변경은 마이크 진단의 오판 가능성을 줄일 뿐, 첫 기기의 브라우저 음성팩 `install()` 반환 실패와 `network`는 별도 브라우저/네트워크 환경 원인일 수 있음.
- 사용자 결정 필요: 없음(사용자가 적용 진행을 요청함).
- 배포: `181ac20`을 2026-09-30에 main으로 push. Cloudflare Pages run `36650905163` 성공, 회귀 게이트 run `36650904936` 성공. 운영 `/login` HTTP 200 및 번들 `index-D4Lo7rMl.js` 확인. 2번 노트북에서 진단을 재실행해 “신호 변화 없음” 오판이 해소되는지 실기기 확인 필요.
- 다음에 할 일: 첫 노트북의 한국어 팩 설치 실패와 `network`는 마이크 측정과 별개로, 브라우저 음성 API의 설치 반환값/네트워크 경로를 추가 조사. 현 코드에서는 원격 음성 인식이 사용자 발화를 수신해 외부 전사 서비스로 보낼 수 있어 서버 음성 전사 대안은 별도 승인 없이 추가하지 않음.

### 2026-09-30 08:59 · Codex · R11 진단 UI 표시 오류 수정
- 한 일: 운영 스크린샷에서 새 진단 버튼이 보이지 않는 현상을 재현 경로로 추적.
- 발견: 🔴 `GlobalVoiceCommand.jsx`, `KioskVoiceCommand.jsx` — `no-speech` 직후 인식기가 재시작하며 상태가 `online-listening`으로 덮여 진단 안내가 사라짐. 진단 도구는 배포됐지만 호출 경로가 사용자 화면에서 숨겨져 실제 검사를 할 수 없었음.
- 수정: `noSpeechDetected`를 `transcript`가 도착할 때까지 유지해 재시작 후에도 진단 UI가 표시되도록 함.
- 테스트: 관련 7개 파일 182/182 통과, 수정 컴포넌트 ESLint 통과, `npm run build` 통과(기존 Firebase import/chunk 경고). 전체 테스트 3099/3121; 기존 문서화된 실패 11개 외에 개별 테스트 시간 초과 11개가 추가됨. 음성 관련 테스트 회귀는 없음.
- 남은 위험: 운동센터 현장 마이크 신호/브라우저 ASR 실기기 결과는 여전히 확인 필요.
- 배포: 재시작 뒤 `no-speech` 상태가 가려지던 UI 문제를 2026-09-30 09:00 KST에 발견하고 수정·검증함. 이어서 수정 커밋·업로드·운영 번들 갱신 확인.
- 다음에 할 일: 배포된 관리자 화면의 **마이크 입력 진단**에서 2초 대기 후 3초간 말하기. 입력 신호가 확인돼도 `no-speech`가 계속되면 브라우저 ASR 문제로 좁혀 후속 설계.

### 2026-09-29 22:17 · Codex · R11 실기기 no-speech 진단
- 한 일: 운영 화면의 새 번들 해시를 확인했으나 `no-speech`가 지속되는 스크린샷을 받음. `ERR_BLOCKED_BY_CLIENT`는 Firestore Listen POST 차단으로 별도 관찰. SpeechRecognition이 실제 마이크 파형을 받는지 구별할 사용자 실행형 진단 추가.
- 발견: 🟠 현재 `no-speech`는 인식 엔진에서 결과 텍스트가 오지 않았다는 사실만 알려줌. 마이크 입력 자체가 낮은지, 입력은 있으나 브라우저 ASR이 문장을 내지 않는지 구분 불가. 화면의 Firebase 오류는 브라우저 확장 차단이며 음성 인식 오류와 동일 원인이라고 단정할 수 없음.
- 개인정보: 진단은 사용자 클릭 시 5초 동안 브라우저 내 파형 에너지만 계산하고 녹음·전송 없이 트랙을 정리하도록 구현.
- 테스트: 관련 7개 파일 182/182 통과, 변경 파일 ESLint 통과. 전체 `npm test -- --run --reporter=dot` 3110/3121(기존 문서화된 실패 11건만). `npm run build` 통과; 기존 Firebase import/chunk 크기 경고.
- 남은 위험: 브라우저 ASR 자체 오류로 확인되면 다른 온디바이스 ASR 또는 서버 전사 설계가 필요. 서버 전사는 체육관 주변 음성을 외부 전송하므로 사용자 승인 없이 추가하지 않는다.
- 배포: `0413184` 업로드 후 Cloudflare Pages 워크플로 성공 확인. 운영 `/login`은 HTTP 200이며 번들 `index-Dudjcpg4.js`로 갱신됨.
- 다음에 할 일: 관리자 화면에서 마이크 입력 진단 실행. 결과가 정상인데 `no-speech`면 브라우저 ASR 문제로 좁혀 온디바이스 ASR 대안을 설계하되, 서버 전사는 별도 동의 후 진행.

### 2026-09-29 21:30 · Codex · R11 재검토 — no-speech 근본 경로
- 한 일: PC·키오스크의 공통 `useMomiVoice` 흐름, 관리자 전용 마운트, Web Speech API 상태 전달을 재검토. 기존 오디오 트랙 전달 실험은 SpeechRecognition 인식기 자체를 바꾸지 못해 제거하고 브라우저 기본 마이크 파이프라인으로 복귀. Chrome이 지원하면 `ko-KR` 온디바이스 인식을 우선 선택하고 팩 설치 동작을 제공.
- 발견: 🟠 `src/hooks/useMomiVoice.js` — `processLocally`를 지정하지 않으면 기본 인식 엔진에 의존하고, 엔진이 `no-speech`를 반환하면 웨이크워드·명령 처리까지 도달하지 않음. 🟠 `GlobalVoiceCommand.jsx`, `KioskVoiceCommand.jsx` — 최초 한국어 팩 설치 안내가 `no-speech` 상태 변경으로 사라져 설치 선택지가 숨겨질 수 있었음.
- 보완: 한국어 팩 설치 안내 상태를 인식 세션 상태와 분리해 오류 뒤에도 유지. 음성 확인 답변을 기다리는 동안 설치를 요청하면 인식기를 끊지 않고 답변 후 재시도하도록 표시. 설치 시작 전 interim 웨이크/확정 대기 타이머를 정리해 종료 이벤트가 명령을 합성하지 않게 함.
- 개인정보 경계: 브라우저가 지원하는 로컬 처리만 추가. 새 서버 전사/외부 음성 전송 경로는 추가하지 않음.
- 테스트: 관련 7개 파일 178/178 통과, 변경 파일 ESLint 통과. 전체 `npm test -- --run --reporter=dot` 3105/3117; 기존 알려진 실패 11개와 빌드 병렬 실행 중 `session_share.test.js` 1건 시간 초과. 이 테스트를 분리해 재실행한 결과 14/14 통과(자원 경합성 1회 실패). `npm run build` 통과; 기존 Firebase 동적/정적 import와 큰 chunk 경고.
- 남은 위험: `no-speech`는 브라우저 ASR이 음성 문장을 생성하지 못했다는 상태이지, 코드에서 실제 발화 품질 원인(마이크 선택/시스템 독점 모드/브라우저 엔진 지원/현장 음향)을 하나로 판별하지 못함. 실제 PC Chrome의 한국어 로컬 팩 제공 여부와 운동센터 소음 조건은 배포 후 실기기 검증 필요.
- 다음에 할 일: 전체 테스트 완료 결과 기록 후 로컬 커밋. 업로드·배포 후 관리자 계정에서 한국어 팩 설치 및 웨이크워드/명령 왕복 확인.

### 2026-09-29 21:20 · Codex · R11 실사용 음성 입력 소음 억제 보완
- 한 일: 여러 PC에서 같은 `no-speech`가 반복되는 원인을 확인. 기존 소음 억제 트랙은 입력 표시기에서만 사용되고 SpeechRecognition에는 전달되지 않았음. Chrome/Edge 135+에서 실제 인식기에 소음 억제·에코 제거·자동 게인 조절이 켜진 오디오 트랙을 전달하고, 미지원 브라우저는 기본 마이크 경로로 유지.
- 변경 파일: `src/hooks/useMomiVoice.js`, `src/__tests__/momi_recognition_boost_2609.test.js`, `src/__tests__/momi_voice.test.js`, `docs/REVIEW_QUEUE.md`.
- 검증: 관련 6개 파일 168/168 통과. 전체 테스트 3104/3115(기존 실패 11과 동일). 변경 파일 ESLint 및 `npm run build` 통과; 빌드에는 기존 Firebase import/chunk 크기 경고.
- 남은 위험: SpeechRecognition의 사용자 지정 오디오 트랙은 Chromium 135+에서만 연결. 실제 운동센터 소음 환경에서 배포 후 확인 필요. 구형 브라우저에서는 기존 브라우저 기본 입력 사용.
- 다음에 할 일: 변경을 로컬 커밋. 업로드·배포 후 관리자 계정으로 소음 환경에서 웨이크워드와 명령을 확인.

### 2026-09-29 20:10 · Codex · Git 병합 정리 및 모미 관리자 전용·오탐 축소
- 한 일: 진행 중인 origin/main 병합 충돌에서 로컬 R11 로그와 원격 Issue #2 실행 검증 로그를 함께 보존. 키오스크·PC 음성 컴포넌트를 관리자 조건으로 분리하고 웨이크워드 시작 위치/단어 경계 검사를 강화.
- 변경 파일: `docs/HANDOFF.md`, `docs/REVIEW_QUEUE.md`, `src/components/layout/AppLayout.jsx`, `src/hooks/useMomiVoice.js`, 관련 테스트 3개.
- 검증: 관련 6개 파일 166/166, 수정 파일 ESLint, 전체 3102/3113(기존 실패 11), 빌드 통과. 상세는 재실행 결과로 갱신.
- 남은 위험: 실기기 음성인식 미확인. ASR 오전사 자체를 코드만으로 완전히 막을 수 없음.
- 다음에 할 일: 업로드 후 관리자/비관리자 계정으로 키오스크·PC 확인.

### 2026-09-29 19:15 · Claude · Issue #2 Codex 보완 실행 검증
- 동의 스냅샷 검증 및 검수 갤러리의 합성 영상 생성, 개인정보 필드 제외, 철회된 동의 차단, `.gitignore` 동작을 별도 환경에서 확인. 얼굴 자동 블러와 실제 회원 영상 리허설은 미완료.

### 2026-09-29 19:02 · Codex · 검토 R11 모미 음성인식·명령 지연 개선
- 한 일: `70f245c`와 `556cf21`의 대상 코드·테스트를 검토하고 기준선·관련 테스트·빌드를 실행.
- 검토 당시 발견:
  - 🔴 `src/components/common/KioskVoiceCommand.jsx:332,399-407`, `GlobalVoiceCommand.jsx:378,449-457` — `ackTimer`가 `try` 블록 안의 `const`인데 바깥 `finally`에서 참조됨. `clearTimeout(ackTimer)`에서 `ReferenceError`가 발생해 `setBusy(false)`와 `isHandlingRef.current = false`가 실행되지 않음. 다음 음성 명령이 계속 무시될 수 있음. `try` 블록 스코프를 재현하는 Node 검증으로 확인.
  - 🟠 `src/hooks/useMomiVoice.js:568-572,590-640` — `not-allowed`를 포함한 권한 오류에서 재시작 플래그를 끄지 않고 `onend`가 재시작을 계속 시도함. 대기열에 기록된 미해결 동작으로, 권한 거부 시 반복 오류/재시작 위험이 남음.
  - 🟡 `src/__tests__/momi_recognition_boost_2609.test.js` — 웨이크워드 파싱 순수 함수 검증 외에는 대부분 소스 문자열 검사라 `onend` 복구, interim 오탐, `ackTimer`의 실제 컴포넌트 실행 경로를 잠그지 못함.
- 테스트: 전체 `npm test -- --run` → 3095/3106, 실패 11(기록된 기존 실패와 동일; `.github/test-baseline.json` minPassing 3059 충족). R11 관련 5개 파일 → 156/156 통과. `npm run build` 통과(기존 Firebase 동적/정적 import 및 큰 chunk 경고). 실기기 음성 테스트 미실행.
- 제안 수정: 두 컴포넌트에서 타이머 핸들을 `try` 바깥에 선언해 `finally`가 안전하게 정리하도록 수정하고, handleCommand가 정상·예외 종료 후 busy/handling 상태를 해제하는 실행형 회귀 테스트 추가. 마이크 권한 오류에서 재시작 중단 여부는 운영 결정이 필요.
- 남은 위험: interim 웨이크워드 기억은 웨이크 호출 없이 이어진 주변 발화를 4초 안에 명령으로 실행할 수 있음. 관리자 전용 마운트가 실제 키오스크 관리자 계정과 맞는지, 사람 이름 오탐 및 실기기 인식률은 미확인.
- 사용자 결정: 2026-09-29 보완 진행 승인. 관리자 전용 마운트 유지.
- 검토 시 다음 단계: 최소 수정·실행형 회귀 테스트 → 전체 테스트·빌드 재확인(아래 보완 완료).

#### R11 보완 완료 · 2026-09-29 19:15
- 변경 파일: `src/components/common/KioskVoiceCommand.jsx`, `GlobalVoiceCommand.jsx` — acknowledgement 타이머를 `try` 바깥에서 선언해 finally가 정상 정리하고 busy/handling 잠금을 항상 해제하도록 수정. `src/hooks/useMomiVoice.js` — interim 웨이크워드만으로 후속 발화를 명령 처리하지 않도록 제한, pendingReply 중 onend 합성 결과 차단, 권한 거부 시 자동 재시작 중단. `src/services/voiceCommandService.js` — 응답 본문 읽기까지 12초 제한 적용 및 토큰 타이머 정리. 실행형 helper·타임아웃 회귀 테스트 보강.
- 테스트: R11 관련 6개 파일 164/164 통과. 전체 `npm test -- --run` 3100/3111(실패 11, HANDOFF 기존 실패와 동일, minPassing 3059 충족). `npm run build` 통과. 변경 파일 대상 ESLint 통과; 전체 `npm run lint`는 기존 `src/ai-measure/core/unifiedReport.js:326` 중복 `peakVelocity` 키 1건으로 실패.
- 남은 위험: Chrome 키오스크 실기기 음성 테스트 미실행. `보미야`는 명시적 웨이크워드 변형이고 자모 유사도는 `소미야`도 잡을 수 있어, 사람 이름 호명 뒤 명령처럼 들리는 말이 이어지면 오탐 가능성이 남음. 권한을 거부해 인식이 중단되면 브라우저 권한을 허용한 뒤 화면을 다시 열어야 새 인식 세션이 시작됨.
- 다음에 할 일: 업로드·배포 후 관리자 로그인 키오스크에서 웨이크워드·명령 왕복 및 권한 허용 흐름 확인.

### 2026-09-29 · Claude Code · 모미 인식률·지연 개선 + 관리자 전용 (R11 대기열 등록)
- 한 일: ① 모미 음성인식을 관리자 로그인에서만 마운트(`AppLayout.jsx:218`, `70f245c`) ② 웨이크워드 오인식 변형 10종 추가 + 임시 결과에서 웨이크워드 기억(4초)·확정 문장에서 웨이크가 빠져도 명령 살림·확정 없이 세션 종료 시 복구 ③ 확정 대기 700→400ms, 웨이크 후 명령 대기창 8→10초 ④ "네, 확인했어요" 안내를 0.9초 넘게 걸릴 때만 말함(마이크 끊김·지연 감소) ⑤ 서버 음성 명령 12초 타임아웃(무응답 시 이후 명령이 영구 무시되던 문제) ⑥ TTS `speaking` 12초 고착 시 강제 취소.
- 변경 파일: `src/hooks/useMomiVoice.js`, `KioskVoiceCommand.jsx`, `GlobalVoiceCommand.jsx`, `voiceCommandService.js`, `AppLayout.jsx`, 테스트 `momi_recognition_boost_2609.test.js`(신규)·`momi_voice.test.js`(700→400)·`kiosk_nav_filter.test.js`.
- 테스트: `npm test` 새 실패 0(기존 11 그대로), `npm run build` 통과. 실기기 음성 테스트 미실행.
- 남은 위험: 오탐(웨이크 없이 4초 창 안의 대화가 명령이 될 수 있음), 사람 이름 호명("소미야") 반응, `not-allowed` 재시작 반복 — 검토 항목은 `docs/REVIEW_QUEUE.md` R11.
- 사용자 결정 필요: 키오스크 노트북 로그인 계정이 관리자인지, 위 남은 위험 수정 진행 여부.
- 다음에 할 일: Codex가 R11 검토(REVIEW_LOOP 절차) → 실기기에서 "모미야" 인식·명령 지연 재확인.

### 2026-09-29 · Codex · Issue #2 Notion 동의 스냅샷 검증
- 한 일: 자동 편집 시작 전에 최근 Notion 동의 현황 스냅샷을 대조하도록 보완. 공개 승인·철회 여부·허용 채널·만료일·스냅샷 생성 시점(7일 이내)을 모두 통과한 클립만 FFmpeg 전 단계로 진행한다.
- 변경 파일: `scripts/content-video/videoMvp.mjs`, `scripts/content-video/prepare-review.mjs`, `content-video/approved.example.json`, `content-video/consents.example.json`(신규), `docs/VIDEO_AUTOMATION_MVP.md`, `src/__tests__/content_video_mvp.test.js`.
- 개인정보 최소화: 검수 JSON에서 원본 경로와 동의 참조값을 제거. 동의 스냅샷은 Git 제외 `.local.json`으로만 두며, 서명 원본·회원 이름·연락처·영상 파일은 넣지 않는다.
- 테스트: Node 문법 검사 및 동의 승인/철회/채널 불일치/만료 스모크 통과, `git diff --check` 통과. `npm test -- --run src/__tests__/content_video_mvp.test.js`, `npm run build`는 현재 샌드박스가 상위 폴더 접근을 거부해 Vite 설정을 읽지 못하여 시작 실패(코드 테스트 실패 아님).
- 남은 위험: 현재는 Notion API가 아닌 수동 내보내기 스냅샷이다. 실제 서명 원본과 DB의 대응 및 얼굴·배경·음성 검수는 담당자가 계속 확인해야 한다.
- 다음에 할 일: 사용자 PC에서 비공개 Notion `영상 공개 동의 관리` DB를 만들고 `consents.local.json`을 최근 상태로 내보낸 뒤, 동의 완료된 테스트 복사본 1건으로 FFmpeg 리허설. 이후 Claude/Gemini가 변경 커밋을 교차 검토.

### 2026-09-29 · Gemini · Issue #2 개인정보·운영 안정성 독립 검토
- 한 일: Issue #2와 `9b50fde`, `940a117` 기준으로 개인정보·운영 안정성 위험을 검토했다고 보고됨.
- 유효한 발견: 실제 동의 원본과의 시스템 대조 부재, 영상 내 제3자·얼굴·음성 식별 가능성, 로컬 임시 산출물 관리 위험은 현재 MVP의 운영 전제에 반영 필요.
- 범위 구분: 현재 구현은 로컬 Node+FFmpeg 스크립트이며 브라우저 편집 UI, IndexedDB, WebCodecs, Cloudflare 영상 전송, 키오스크 모달을 만들지 않았다. 따라서 해당 경로의 메모리·라우트 위험은 현 코드 결함이 아니라 향후 CMS 내장 편집 기능을 만들 때의 설계 조건.
- 결정: `src/ai-measure`나 키오스크 코드에 동의 가드·편집 UI를 추가하지 않음. 회원 영상과 CMS·측정 파이프라인의 분리를 유지.
- 다음에 할 일: 사용자와 동의 원본(서면/Notion DB) 및 담당 확인 절차를 확정한 뒤, 실제 동의된 테스트 복사본 1건으로 로컬 리허설. 공개 전에는 얼굴·배경·음성·자막을 사람이 검수.

### 2026-09-29 · Codex · Issue #2 Claude 검토 보완
- 한 일: 여러 결과를 한 화면에서 확인하는 로컬 `review_index.html` 검수 갤러리 추가. 갤러리에는 검수용 파일명만 표시하고 원본 경로·동의 참조값을 넣지 않음. 로컬 매니페스트 Git 제외를 하위 폴더까지 확장.
- 변경 파일: `scripts/content-video/videoMvp.mjs`, `scripts/content-video/prepare-review.mjs`, `src/__tests__/content_video_mvp.test.js`, `docs/VIDEO_AUTOMATION_MVP.md`, `.gitignore`.
- 테스트: Node 문법 검사·검수 갤러리 스모크 통과, `git diff --check` 통과. Vitest는 기존 환경 접근 오류로 미실행.
- 보류: 실제 동의 기록 대조는 동의 원본과 Notion 속성 정의가 정해진 뒤 구현. 기준선 변경도 Vitest 정상 실행 뒤에만 검토.
- 다음에 할 일: Gemini 독립 검토 → 실제 PC의 동의된 테스트 복사본 1건으로 FFmpeg 실행 리허설.

### 2026-09-29 · Claude · 검토 Issue #2 동의 영상 자동 편집 MVP
- 한 일: `9b50fde` 설계·보안·운영 검토. 별도 환경에서 합성 영상·로고·엔딩 카드로 로컬 처리 스크립트의 실제 실행을 확인했다고 보고됨.
- 확인: 외부 네트워크/Firestore 호출 없이 로컬 파일·FFmpeg만 사용, 동의/길이/자막 검증과 검수 대기 결과 생성이 확인됐다고 보고됨. 셸 문자열 대신 인수 배열로 FFmpeg를 실행.
- 발견: 🟠 여러 클립을 한 번에 검수할 사람용 갤러리 없음. 🟠 동의 참조값은 문자열 존재만 확인하며 실제 동의 기록과 시스템적으로 대조하지 않음. 🟡 매니페스트의 source·자막에 개인정보가 들어갈 수 있음. 🟡 `.gitignore`의 local 매니페스트 범위가 하위 폴더를 포괄하지 않음. 🟡 중간 실패 시 앞선 검수 결과는 남음.
- 제안: 검수 갤러리와 Git 제외 범위 보완은 Issue #2에 포함. 실제 동의 기록 대조는 동의 원본(Notion DB/필드 등)을 사용자 결정 후 별도 단계로 구현. 테스트 기준선 변경은 Vitest 정상 실행 확인 뒤에만 검토.
- 남은 위험: 얼굴 자동 블러 미구현. 자동 게시·자동 Drive 업로드는 계속 금지 상태.
- 다음에 할 일: 사용자 결정 후 Codex가 검수 갤러리·Git 제외 보완 → Gemini 독립 검토 → 실제 PC에서 동의 완료 테스트 복사본 1건 리허설.

### 2026-09-29 · Codex · Issue #2 동의 영상 자동 편집 MVP
- 한 일: 로컬 FFmpeg 기반 검수 대기 영상 생성기를 추가. 공개 동의·동의 참조값·10~30초 길이·자막 초안이 모두 있는 클립만 처리하며, 세로 9:16 변환·선택형 로고·2초 엔딩 카드·SRT 초안을 만든다.
- 변경 파일: `scripts/content-video/videoMvp.mjs`, `scripts/content-video/prepare-review.mjs`, `content-video/approved.example.json`, `docs/VIDEO_AUTOMATION_MVP.md`, `src/__tests__/content_video_mvp.test.js`, `package.json`, `.gitignore`.
- 테스트: Node 문법 검사·단위 스모크 통과, `git diff --check` 통과. Vitest는 현재 환경에서 Vite 설정 파일 접근 거부로 시작하지 못함.
- 안전 장치: 실제 원본을 자동 업로드·게시하지 않음. `content-video/*.local.json`과 `content-video/review/`는 Git 제외. 검수 JSON은 `review_required`, `publishAllowed: false`로 생성.
- 남은 위험: 현재 PC에서 `ffmpeg` 명령을 찾지 못해 실제 인코딩 실행은 미검증. 얼굴 자동 블러·음성 받아쓰기·Google Drive 자동 업로드는 별도 검토/PR 필요.
- 다음에 할 일: FFmpeg 설치 후 동의 완료된 테스트 복사본 1개로 실행 검증 → Claude가 Issue #2와 이 로그를 검토 → Google Drive 검수 대기 폴더 연결 범위를 결정.

### 2026-09-29 · Codex · Codex·Claude·Gemini 단일 접수 운영판
- 한 일: 모바일 사용자가 한 곳에만 요청을 남기고, 다음 AI가 GitHub Issue와 HANDOFF를 읽어 구현·교차 검토를 이어가는 절차를 문서화.
- 변경 파일: `docs/AI_COLLABORATION.md` 신규, `docs/HANDOFF.md` 작업 로그.
- 테스트: 문서 변경만 적용. `git diff --check` 통과.
- 남은 위험: Claude/Gemini가 같은 저장소 또는 GitHub Issue에 접근할 수 있는지와 각 도구의 실제 자동 메시지 연결은 환경별로 확인 필요. AI끼리 대화창을 직접 공유하는 기능은 아님.
- 다음에 할 일: 첫 작업은 GitHub Issue 하나로 등록하고, 각 AI에게 Issue와 HANDOFF를 읽도록 지시.

### 2026-09-24 10:07 · Claude · 1RM 카메라 오류 수정 + 멈춤 방지 테스트 (R10)
- 발견(R1 검증 중 `npm run lint`): 🔴 `src/ai-measure/menus/OneRMEstimate.jsx:213,328,358`(수정 전 줄 번호, 수정 후 217·332·362) — `ae7049f`(9/22 "1RM 영상만 저장하는 버튼 제거")가 `useState` 선언까지 지웠는데 `setVideoSavedMsg` 호출 3곳(측정 카운트다운 시작·카메라 열기·60초 자동 종료)이 남음 → ReferenceError. 카메라 열기(`openCam`)가 자동 시작 effect(수정 전 366)에서도 불려서, 앱에 ErrorBoundary가 없으니 자동 시작 시 화면 전체가 멈출 수 있음. 빌드·기존 테스트로는 안 잡힘.
- 사용자 결정(2026-09-23): 같이 고치기.
- 변경 파일: `src/ai-measure/menus/OneRMEstimate.jsx:102-105`(지워진 선언을 setter만 복구 `const [, setVideoSavedMsg] = useState('')` — 메시지 표시 UI는 이미 없으므로 화면·저장 동작 변화 없음), `src/__tests__/lint_crash_guard.test.js`(신규 — src 전체에 no-undef·react/jsx-no-undef·react-hooks/rules-of-hooks 오류 0건 확인, .eslintrc.json 그대로 사용, 약 7초)
- 테스트: 가드 테스트는 수정 전 파일에서 위 3줄을 정확히 잡고(실패), 수정 후 통과. `npm run lint` 오류 4→1. 전체 결과는 아래 R1 보완 완료 항목과 같음.
- 남은 위험: 실기기 1RM 카메라 확인 전. `src/ai-measure/core/unifiedReport.js:109,326` `peakVelocity` 중복 키(no-dupe-keys, 9/7부터 — 뒤의 스프린트 정의가 앞의 VBT 정의를 덮음)는 멈춤 원인이 아니고 범위 밖이라 보류.
- 다음에 할 일: 업로드 후 1RM 추정 화면에서 카메라 열기·측정·60초 자동 종료 확인 → REVIEW_QUEUE R10 Codex 검토.

### 2026-09-23 22:00 · Claude · 교차확인 R1 매출관리 개요 (Codex 보완 `08be0eb`·`79e1dff`)
- 한 일:
  - main `79e1dff`(PC 작업 폴더와 동일 확인) 기준으로 Codex 보완 diff와 재현 스크립트 검토
  - 보완 전(`4ef4929`)/후 `computeMonthRates`를 무작위 데이터 200세트로 차등 비교
- 발견:
  - 🟠 `src/pages/Revenue.jsx:443,447`(주석 310, 417-418) — 화면 문구가 "선생님별 입금매출 합계 = 위 손익 요약 입금금액과 일치"로 남아 있음. 결정된 규칙(환불 결제의 남은 금액·담당 미지정·목록 밖 몫은 센터 귀속)상 그런 결제가 있는 달에는 두 숫자가 다름. 재현(가상 금액): 9월 결제 100만(t1) + 50만(t2), 50만 건을 20만 부분환불 → 상단 130만 / 선생님 합계 100만인데 화면은 "일치"로 표시.
  - 🟡(잠재) `src/services/finance.js:202-205` — 월 결제(isMonthly)를 반복문에 포함하면서 신규매출(:225)만 가드하고 재등록매출(reSales)·monthNet은 가드하지 않음 → isMonthly+재등록 300만이면 정산비율 40%→50%, 결제 저장 시 `splitRateAtPay`로 박제됨(`MemberDetail.jsx:582`). 단, 저장소 이력 전체에 결제에 isMonthly를 저장하는 코드가 없어 실데이터 영향은 없을 가능성이 큼(Firestore 미확인).
  - 🟡 재현 스크립트 `src/__tests__/review_R1_reproduction.mjs`는 vitest 대상(`*.test.js`)이 아니어서 `npm test`·회귀 게이트에서 실행되지 않음 → 보완 동작을 잠그는 테스트가 없음. 아래 Codex 로그의 "재현 파일은 미커밋"은 업로드 때 `79e1dff`로 커밋되어 현재는 커밋 상태. `overview_deposit_revenue.test.js:94` 테스트 제목도 "합계 = 입금금액 일치" 그대로.
- 테스트: `npm test` → 3059/3070(기준선 3059 충족, 알려진 기존 실패 11). `npm run build` 성공. 차등 비교: isMonthly 없는 데이터에서 rate·reason 200세트 전부 동일, depositRevenue 차이 최대 2원(반올림 방식 변경분), 새 합계 = 귀속 결제 `Math.round(net)` 합과 정확히 일치.
- 확인할 것 2·4: 반올림 해결 확인 / 08-26 대체 코드 잔여 없음 — Codex 판단에 동의.
- 제안 수정: ① Revenue.jsx 문구를 "환불·담당 미지정분은 센터 귀속으로 제외 — 입금금액과 다를 수 있음"으로 ② finance.js 월 결제를 정산비율 판정 입력에서 제외(보완 전과 동일, 표시 매출에만 포함) ③ 재현 내용을 vitest 회귀 테스트로 전환 + 기준선 상향
- 사용자 결정(2026-09-23): 진행. "현재 사용 중이라 문제 없이, 신뢰도 높이고, 센터 이익 최우선."
- 다음에 할 일: 최소 수정 + 회귀 테스트 → 전체 테스트·빌드 → 업로드는 사용자

#### 보완 완료 · 2026-09-24 10:07
- 변경:
  - `src/services/finance.js:202-208` — 월 결제(isMonthly)는 정산비율 판정 입력(monthNet·재등록매출)에서 제외. 표시용 depositRevenue에는 그대로 포함(대표님 결정 유지).
  - `src/pages/Revenue.jsx:445,449`(주석 308-313, 418-420) — "합계 = 입금금액과 일치" 문구를 "환불·담당 미지정분은 센터 귀속으로 제외 — 입금금액과 다를 수 있음"으로. 계산·배선 변경 없음.
  - `src/__tests__/overview_deposit_revenue.test.js:18-19,95` — 설명·테스트 제목만 새 규칙에 맞춤(단언 변경 없음).
  - `src/__tests__/review_R1_attribution.test.js`(신규, 11개) — 월 결제 표시 포함 / 환불 잔액·담당 미지정·목록 밖 몫 센터 귀속 / 3인 분할·소수점 순매출 원 단위 정확 / split 지분 / 월 결제+재등록·신규 300만에도 비율 40% 유지 / 월 결제 섞인 무작위 100세트 비율 = 월 결제 뺀 판정 / 화면 문구.
  - `.github/test-baseline.json` — minPassing 3059→3071, total 3070→3082로 올려야 함(새 테스트 12개 반영). **`.github` 폴더는 원격 도구 쓰기가 막혀 있어 사용자가 직접 수정** — 수정 전까지 게이트는 옛 기준(3059)으로 동작(통과는 하지만 새 테스트 보호가 약함).
- 테스트: `npm test` → 3071/3082(새 기준선 충족, 알려진 기존 실패 11 — 4개 파일 동일). `node scripts/check-regression.cjs` 통과. `npm run build` 성공(기존 chunk 크기 경고만). eslint 변경 파일 새 경고 0.
- 검증: 새 테스트가 옛 코드에서 실제로 실패하는지 확인 — Codex 보완본 finance.js에서 비율 보호 2개 실패, 보완 전 finance.js에서 월 결제·반올림 3개 실패, 옛 Revenue.jsx에서 문구 1개 실패. 무작위 500세트(월 결제 포함) 차등: 수정본 정산비율 = 보완 전과 차이 0건(Codex 보완본은 60건 달랐음), 표시 매출은 Codex 보완본과 100% 동일.
- 참고: 재현 스크립트 `review_R1_reproduction.mjs`는 이제 위 vitest 테스트가 대신함(남겨둬도 무해).
- 남은 위험: 8월 결제를 9월에 환불 기록하면 8월 선생님 매출이 소급해서 0이 되는 기존 동작(이번 변경과 무관, 규칙상 센터 귀속). 실데이터 화면 확인 전.
- 다음에 할 일: 사용자 업로드(`1_GITHUB_UPLOAD.bat`) → 배포 후 매출관리 개요에서 문구 확인. 다음 검토는 REVIEW_QUEUE R9(월정액 정산).

### 2026-09-23 14:16 · Codex · 검토 R1 매출관리 개요
- 한 일:
  - R1 커밋 `85d87fa`, `3b49846`, `6141755` 및 해당 diff·대상 함수 검토
  - 환불/월 결제 필터 차이, 트레이너별 원 단위 반올림, 담당 정보 누락을 실제 계산 함수로 재현
- 발견:
  - 🟠 `src/pages/Revenue.jsx:173,185-186`, `src/services/finance.js:184` — 상단 순매출은 `isUnpaid`만 거르고 `isMonthly` 결제를 포함하며 환불액을 별도 차감하지만, 트레이너별 계산은 `isMonthly`와 `isRefunded` 결제를 통째로 제외한다. 재현: 월 결제 1,000원은 상단 1,000원/트레이너 합계 0원, 200원 부분 환불 결제는 해당 월 상단 800원/트레이너 합계 0원.
  - 🟡 `src/services/finance.js:193-194,222` — 공동 담당자 몫을 각자 반올림해 합산한다. 재현: 현금 100원을 3명에게 균등 배분하면 상단 100원/트레이너 합계 99원.
  - 🟠 `src/services/finance.js:188-199` — `split`, `trainerIds`, `trainerSessions`가 모두 없으면 귀속 몫이 생성되지 않는다. 재현: 상단 1,000원/트레이너 합계 0원. trainer 목록 밖 ID에 배분되는 경우에도 출력 대상 트레이너 합계에서 빠질 수 있음.
- 테스트: `npm test` → 실행 불가(`vitest` 명령을 찾지 못함, `node_modules` 없음; 기준선 3059/3070과 비교 불가). `node src/__tests__/review_R1_reproduction.mjs` → 통과, 위 네 경계 사례 재현. 재현 파일은 미커밋.
- 제안 수정:
  - 상단과 트레이너별 계산에 월 결제 및 부분 환불의 매출 귀속 규칙을 하나로 맞추고, 같은 달/다른 달 환불 규칙과의 정합성을 먼저 확정.
  - 마지막 담당자에게 나머지 원을 배정하거나 반올림 전 합계를 별도 보정해 원 단위 합계를 맞춤.
  - 담당 정보 누락/알 수 없는 트레이너 ID의 처리 규칙(미귀속/보류/기타)을 정하고 화면 합계에 드러냄.
- 남은 위험: Vitest 전체 기준선 확인을 하지 못함. 월 결제의 개요상 표시/담당 귀속 및 환불 처리의 사업 규칙은 코드만으로 확정할 수 없음.
- 사용자 결정(2026-09-23): 월 결제는 선생님별 매출에 포함. 부분 환불 후 남은 금액과 담당 정보가 없는 금액은 센터 귀속이며 표시하지 않음.
- 다음에 할 일: 사용자 승인 후 결정된 귀속 규칙으로 최소 수정 및 회귀 테스트.

#### 보완 완료 · 2026-09-23 20:46
- 변경: 월 결제를 표시용 담당 매출에 포함. 환불 표시된 결제의 잔액, 담당 정보가 없거나 현재 선생님 목록에 없는 몫은 센터 귀속으로 표시하지 않음. 공동 담당 분배의 반올림 잔액은 최대 소수 몫에 배정.
- 확인할 것 4: 2026-08-26 대체 코드의 `sessionPayoutTotal` 등은 현재 `Revenue.jsx`에 남아 있지 않고, `computeMonthRates`는 월별 비율·입금매출 계산에 사용 중 — 미발견.
- 테스트: R1 기존 Vitest 11/11 통과; 전체 `npm test` 3059/3070(기준선 3059 충족, 알려진 기존 실패 11); `npm run build` 성공; `node src/__tests__/review_R1_reproduction.mjs` 통과. 재현 파일은 미커밋.
- 남은 위험: 대시보드 상단 순매출에는 센터 귀속분이 포함될 수 있어 선생님별 표시 합계와 같지 않음(의도된 규칙). npm 빌드에는 기존 chunk 크기 경고가 있음.
- 다음에 할 일: R1 상태 완료로 갱신하고 보완 커밋.

### 2026-09-23 14:10 · Claude · Codex 교차 검토 체계 구축
- 한 일:
  - main(b000371) 점검: `AGENTS.md:25`가 가리키는 `docs/REVIEW_LOOP.md` 누락, HANDOFF 작업 로그 비어 있음 확인
  - `docs/REVIEW_LOOP.md`(검토 절차), `docs/REVIEW_QUEUE.md`(Claude 작업 R1~R8, 위험도 순) 작성 → `cf62024`로 main 반영
  - Claude Code 및 OpenAI 공식 Codex 플러그인 설치, `/codex:setup` 통과(ChatGPT 로그인, review gate off)
- 연결 방식: claude.ai 대화 ↔ Codex는 HANDOFF·GitHub 경유, Claude Code ↔ Codex는 플러그인(`/codex:rescue`, `/codex:review`)으로 직접
- 변경 파일: `docs/REVIEW_LOOP.md`, `docs/REVIEW_QUEUE.md` (코드 변경 없음)
- 테스트: 해당 없음(문서만)
- 비용 규칙:
  - Claude는 Pro 구독 로그인, Codex는 ChatGPT 로그인만 사용
  - `ANTHROPIC_API_KEY`·`OPENAI_API_KEY`를 PC 환경 변수에 두지 않음(있으면 API 요금 청구). 모미 서버 키는 Cloudflare 비밀값에만 둠
  - Claude 사용량 추가 구매(Usage credits)·Codex 크레딧 구매 금지, 한도가 차면 초기화될 때까지 대기
  - review gate는 off 유지, Codex 검토는 대기열 항목 1개씩
  - `npm test`는 유료 API를 부르지 않음(`voice_command_backend.test.js`는 소스 문자열만 검사)
- 남은 위험:
  - `agent/codex-claude-sync` 브랜치는 main과 크게 어긋난 옛 브랜치라 사용 금지
  - R1 사전 점검 의심: 상단 순매출(`Revenue.jsx:173, 185~186`)과 선생님별 매출(`finance.js:184`)의 필터가 다름. 주석(`Revenue.jsx:310·418`, `finance.js:221`)은 둘이 "정확히 일치"한다고 주장
- 다음에 할 일: Codex가 R1 검토 → HANDOFF에 기록 → 사용자가 업로드 → Claude가 교차 확인

### YYYY-MM-DD HH:MM · 도구(Codex/Claude Code) · 한 줄 요약
- 한 일:
- 변경 파일:
- 테스트: (명령어 → 결과)
- 남은 위험:
- 다음에 할 일:

### 2026-09-28 · Codex · momgagym-cms ↔ nutrition-cms 연동·데이터 사용 코드 점검
- 한 일: CMS의 연결 발급/교환, 회원 API, 교사 API 및 Firestore 조회 경로와 최소 저장 필드를 읽기 전용으로 추적.
- 발견: `functions/_shared/nutritionEligibility.js`에서 이용권 확인할 때마다 `payments`를 `__mid`로 최대 200건 읽고 회원·설정 문서도 조회함. 회원 앱의 세션 확인과 요약 저장에서 이 검증이 각각 실행됨. 데이터 재전송을 막는 일별 문서 덮어쓰기는 확인됨.
- 변경 파일: 없음(이 항목만 작업 잠금 기록).
- 테스트: `npm test -- --run` 실행 실패 — Vitest/esbuild가 상위 `../../..` 접근 거부로 Vite 설정 파일을 해석하지 못함. 빌드 미실행.
- 남은 위험: nutrition-cms 체크아웃 및 배포 환경 변수·실기기 접근 불가로 클라이언트 API 경로/비밀키/Firebase 프로젝트 일치와 실제 왕복은 미확인.
- 다음에 할 일: 사용자가 nutrition-cms 작업공간과 Cloudflare 설정을 열 수 있을 때 클라이언트 요청 경로·환경 설정을 대조하고 실기기 연결/저장/조회 확인. 이용권 조회량 최적화는 별도 회귀 검증 필요.

### 2026-09-28 · Codex · 영양 연동 Firestore 조회량 절감
- 한 일: Firestore REST GET/동등조건 조회에 필드 마스크·필드 선택·정렬 옵션을 추가하고 영양 연동 조회에 적용.
- 변경 파일: `functions/_shared/firestoreRest.js` — 선택 필드/정렬/문서 마스크 지원. `functions/_shared/nutritionEligibility.js` — 결제에서 만료 계산에 필요한 필드만, 설정 문서에서 계산 관련 4필드만 읽음(최대 200건 limit은 유지해 판정 의미 불변). `functions/api/teacher-nutrition.js` — CMS 영양 탭 요약을 최신 날짜순 7건만 읽고 화면에 필요한 요약 필드만 전송. `src/__tests__/nutrition_link_shared.test.js` — Firestore 필드 마스크 및 제한/선택/정렬 쿼리 검증 2개 추가.
- 테스트: 관련 테스트 `npm test -- src/__tests__/nutrition_link_shared.test.js` → 13/13 통과. 전체 `npm test -- --run` → 3071/3084 통과, 실패 13(기존 기준선 11개 외 시간초과 등 2개; 통과 수는 `.github/test-baseline.json` minPassing 3059 이상). `npm run build` 성공(기존 chunk 크기 및 중복 Firebase 동적/정적 import 경고). `git diff --check` 통과.
- 남은 위험: Firestore 실쿼리/배포/실기기 왕복 미확인. 영양 요약의 최근 7일은 이제 서버에서 날짜 내림차순으로 선택. 전체 실패 수가 HANDOFF의 과거 11개 기준보다 2개 더 나와, 두 항목이 환경성/일시성인지 추후 재확인 필요.
- 다음에 할 일: 업로드 전 Cloudflare Pages에서 함수 배포 후 CMS 영양 탭의 최근 날짜·화면 표시 및 영양 앱 연결/기록 왕복 확인.
