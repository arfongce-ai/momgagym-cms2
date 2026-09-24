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
