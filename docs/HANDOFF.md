# HANDOFF — Codex ↔ Claude Code 인수인계 (momgagym-cms2)

규칙은 `AGENTS.md` 참고. 작업을 시작하기 전에 읽고, 끝나면 갱신한다.
공개 저장소이므로 비밀값·개인정보 기록 금지.
짝을 이루는 저장소: `arfongce-ai/nutrition-cms` (영양앱, HTTPS API로 연동). 그쪽 상태는 그 저장소의 `docs/HANDOFF.md` 참고.

## 작업 잠금
같은 파일을 동시에 수정하지 않기 위한 표. 작업이 끝나면 내 줄을 지운다.

| 도구 | 수정 중인 파일/영역 | 시작 일시 |
|------|--------------------|-----------|
| (없음) | | |

## 프로젝트 현황 (2026-09-22 기준, 착수 전 `git status`로 재확인)

### 테스트 기준선
- `npm test` **3059/3070** 통과. 기존부터 실패 중인 11개는 전부 "테스트가 구버전"인 경우로 확인됨(아래 참고), 실사용 버그 아님. `.github/test-baseline.json`의 `minPassing`이 이 숫자를 자동으로 지킨다(회귀 게이트)

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

### YYYY-MM-DD HH:MM · 도구(Codex/Claude Code) · 한 줄 요약
- 한 일:
- 변경 파일:
- 테스트: (명령어 → 결과)
- 남은 위험:
- 다음에 할 일:
