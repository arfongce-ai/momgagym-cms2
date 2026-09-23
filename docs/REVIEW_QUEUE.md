# REVIEW_QUEUE — Codex 검토 대기열

위에서부터 1개씩 검토합니다. 절차는 `docs/REVIEW_LOOP.md`.

- 상태: ⏳대기 · 🔍검토중 · ⚠️발견있음(사용자 결정 대기) · ✅보완완료 · 👌이상없음
- "Claude 검증" = Claude가 작업 당시 실제로 돌린 확인 수준. **테스트 미실행** 항목은 반드시 `npm test`/`npm run build`로 재확인.
- 줄 번호는 2026-09-23 `main`(`b000371`) 기준. 어긋나면 함수명으로 찾기.
- 새 항목은 맨 아래에 추가, 급한 건 맨 위로. 형식은 문서 끝 참고.

---

## R1 · 매출관리 개요 — 선생님별 월 매출(입금 기준) · 2026-09-16 · ✅보완완료

- 커밋: `85d87fa`, `3b49846`, `6141755` (08-26~27 `c2d9075`, `10641af`는 이 작업으로 대체됨)
- 대상: `src/services/finance.js` `computeMonthRates()` 174~225 / `src/pages/Revenue.jsx` `monthConfirmedRates` 299, `depositBreakdown` 312~320
- 테스트: `overview_deposit_revenue.test.js`, `overview_trainer_breakdown.test.js`, `sales_ref_payout.test.js`
- Claude 검증: 관련 테스트 159개 통과, eslint 0
- 규칙: 개요의 선생님별 금액 = 그 달 결제일(`paidAt`) 기준 순매출 × 그 달 확정 정산비율. 그 달 결제가 없는 선생님은 목록에서 빠짐. 손익 요약 "트레이너 정산"·"순익"(`settlePayout`, Revenue.jsx:291)은 종전대로.
- 확인할 것
  1. **필터 불일치 (Claude 사전 점검에서 발견)** — 상단 순매출은 `Revenue.jsx:173`에서 `isUnpaid`만 제외하고 환불액을 따로 차감(185~186). 선생님별 매출은 `finance.js:184`에서 `isRefunded`·`isMonthly` 결제를 통째로 제외. → 환불·월 결제가 있는 달에 "합계 = 상단 순매출"(주석 Revenue.jsx:310, 418 / finance.js:221)이 깨지는지 재현 테스트로 확인. 의도된 차이인지는 사용자 결정.
  2. 반올림 — 공동 담당 분할(finance.js:190~198) 후 선생님별 `Math.round`(finance.js:222). 나누어떨어지지 않는 금액(예: 3명 균등 분할)에서 합계가 원 단위로 어긋나는지. 현재 테스트(overview_deposit_revenue.test.js:55~57)는 나누어떨어지는 금액만 사용.
  3. 담당 정보가 없는 결제(split·trainerIds·trainerSessions 모두 없음)와 `trainers` 목록에 없는 선생님 몫이 합계에서 조용히 빠지는지.
  4. 대체된 08-26 코드의 잔여·죽은 코드 여부.

- Codex 보완(2026-09-23): 월 결제는 담당 선생님 매출에 포함, 환불 결제의 잔액·미귀속/목록 외 담당분은 센터 귀속으로 화면 제외. 3인 분할 반올림 잔액 배분.
- 확인할 것 4: 대체된 08-26 코드의 잔여·죽은 코드는 현재 `Revenue.jsx`에서 찾지 못함; `computeMonthRates`는 여전히 사용 중.
- 검증: R1 기존 테스트 11/11 통과, 전체 `npm test` 3059/3070(기준선 충족, 기존 실패 11), `npm run build` 통과. 상세는 HANDOFF 작업 로그.

## R2 · 스케줄 회차 재정렬 + 신체정보 최신 정렬 + 측정이력 삭제 실패 처리 · 2026-09-02 · ⏳

- 커밋: `b3bfb1e`
- 대상: `src/demoData.js` `updateSchedule` 970~1007, `isAutoRenumberEligible` 652, `renumberSessionAtBooking` 700 / `src/components/members/MemberDetail.jsx:1613` / `src/components/ai/MemberMeasureHistory.jsx` `handleDelete` 176~
- Claude 검증: **테스트 미실행** (코드 확인만)
- 확인할 것
  1. 예약 날짜·시작시간·트레이너 변경 시 회차가 날짜순으로 재정렬되고, 차감 안 된 예약·수동 수정값·취소건은 제외되는지 (기존 `schedule_double_booking`, `store.test.js` + 신규 케이스)
  2. 트레이너 변경 시 `demoData.js:1005`는 **새** 트레이너 쪽만 재정렬 — 이전 트레이너 쪽 남은 예약 회차가 어긋나지 않는지, 의도인지
  3. 같은 날짜 신체정보 2건 → 나중 기록이 "최신" 배지를 받는지
  4. 측정이력 삭제 실패(`success:false`) 시 안내 후 `load()`로 실제 상태 재반영되는지

## R3 · 결과리포트 "이전 측정 대비 변화" 7종 + 카카오 공유 캡처 · 2026-08-31 · ⏳

- 커밋: `b752568`, `018b35b`, `da3abe2`, `c92143e`
- 대상: `src/ai-measure/core/measurementComparison.js` (23 `computeChangeRow`, 54 `summarizeChanges`, 72 `reportDateOnly`) / `src/components/report/ChangeSummaryPanel.jsx` / `src/components/report/VideoCompareUpload.jsx` / `src/ai-measure/menus/PostureReport.jsx` (공통 모듈로 리팩터링) / `src/pages/Report.jsx` `ShareCaptureReport` 720~
- Claude 검증: **테스트·빌드 미실행** (코드 리뷰만)
- 확인할 것
  1. 이전 기록이 없는 회원 → 패널이 에러 없이 숨겨지는지
  2. "직전 기록"이 같은 회원·같은 종류·현재보다 이전 날짜만 고르는지. 한발 점프 좌/우, 리프팅 종목/모드가 섞여 비교되지 않는지
  3. PostureReport 리팩터링 전후 결과 동일("순수 리팩터링" 주장 검증 — `git show b752568`의 옛 계산식 대비 실행형 테스트)
  4. 공유 캡처 5종(자세·ROM·보행·점프·리프팅)에 `previousReport`가 실제 전달되는지
  5. `npm run build` 통과

## R4 · 한다리서기(SLST) 화면 멈춤 + 보행·러닝 관절각도 · 2026-08-27 · ⏳

- 커밋: `9d8afd0`, `00c60fb`
- 대상: `src/ai-measure/menus/StanceLiveAnalysis.jsx` (303 `usePoseEngine`, 339~ / 485 "이 다리 건너뛰기") / `StanceAnalysisHub.jsx` / `src/ai-measure/AiMeasureHub.jsx` / `src/ai-measure/core/gaitBiomechanics.js` `AngleAccumulator` 448 / `GaitRunningAnalysis.jsx` 213~ / `GaitReportDashboard.jsx` 187~192
- Claude 검증: **테스트·빌드 미실행**
- 확인할 것
  1. 인식 실패 후 재시도 시 카메라 스트림·포즈 엔진이 중복 생성되지 않는지(정리 누락 → 발열·멈춤)
  2. 한쪽 다리 "건너뛰기" 시 리포트 생성, 양쪽 모두 없으면 무효 처리
  3. `AngleAccumulator` 좌/우 분리 후 기존 avg/rom 필드 호환 — 구버전 리포트(left/right 없음)가 대시보드에서 "0도"로 오표시되지 않는지

## R5 · CMS UI 3건 — 대시보드 메뉴 위치 / "근골격계 영상 확인" 메뉴명 / 등록 후 수납 탭 · 2026-08-26 · ⏳

- 커밋: `3611f5a`, `9d438ee` (메뉴 순서는 `git log -- src/components/layout/AppLayout.jsx`로 확인)
- 대상: `src/components/layout/AppLayout.jsx:18` / `src/ai-measure/registry.js:151` / `src/ai-measure/menus/ImagingMeasure.jsx` / `src/services/voiceCommandService.js:143~145` / `src/pages/Members.jsx:312`
- Claude 검증: **테스트 미실행**
- 확인할 것
  1. 대시보드 `adminOnly` 유지 — 트레이너 계정에 노출되지 않는지
  2. 음성 키워드 `'영상확인'`이 다른 명령과 부분일치로 충돌하지 않는지
  3. 신규 등록 직후 열리는 수납 탭의 회원 객체가 저장된 값과 같은지

## R6 · 제자리멀리뛰기(SBJ) + 한발 멀리뛰기 3방향 · 2026-09-16~17 · ⏳

- 커밋: `3eaa323`, `b626cab`, `4bbab1c`
- 대상: `src/ai-measure/core/jumpBiomechanics.js`, `jumpTypes.js` / `src/ai-measure/menus/JumpAnalysisHub.jsx`, `JumpPrecisionAnalysis.jsx`, `JumpUploadAnalysis.jsx`, `JumpReportDashboard.jsx` / `registry.js`, `reportService.js`
- 테스트: `broadjump_tab.test.js`, `broadjump_live_hud.test.js`, `broadjump_live_value_consistency.test.js`
- Claude 검증: 전체 테스트 신규 실패 0, `npm run build` 통과
- 확인할 것
  1. 기존 수직 점프 5종(CMJ/SJ/DJ/SLJ/RSI) 결과가 그대로인지
  2. 캘리브레이션이 없거나 실패했을 때 거리값 저장이 막히는지
  3. 거리 환산식이 한 곳에서만 계산되는지(HUD 값 = 저장 값)

## R7 · 근골격계 영상 확인 탭 + 모미 음성명령 연동 · 2026-08-25 · ⏳

- 커밋: `ac64553`, `63b7841`, `3611f5a`
- 대상: `public/imaging-tool.html` / `src/ai-measure/menus/ImagingMeasure.jsx` / `src/ai-measure/AiMeasureHub.jsx` / `functions/api/voice-command.js` (12 `resolveVerifiedRole`, 208 `onRequestPost`) / `src/services/voiceCommandService.js`
- 확인할 것
  1. 업로드한 의료영상이 외부 서버로 전송·저장되지 않는지(브라우저 안에서만 처리)
  2. voice-command 서버 함수가 토큰 검증 뒤에만 역할을 판정하는지

## R8 · Notion 동기화 6종 · 2026-08-25~26 · ⏳ (우선순위 낮음 — 2026-09-22 전부 정상 실행 확인)

- 대상: `scripts/{notion-sync,funnel-sync,trainer-stats,segment-stats,member-detail,dashboard-snapshot}/sync.mjs` / `.github/workflows/notion-*.yml`, `dashboard-snapshot.yml`
- 확인할 것
  1. 회원 상세 동기화(`scripts/member-detail/sync.mjs`)가 최소 필드만 보내는지(연락처 등 제외)
  2. 실패 시 워크플로가 빨간불로 끝나는지(조용히 0건 처리 방지)
  3. 불필요한 Firestore 전체 읽기 여부(무료 한도)

---

## 새 항목 형식 (Claude·Codex 공통)

```
## R? · 기능명 · 날짜 · ⏳
- 커밋: 해시
- 대상: 파일 함수 줄
- 테스트: 관련 테스트 파일
- Claude 검증: 실제로 돌린 것 (미실행이면 "테스트 미실행")
- 규칙: 요구사항 한두 줄
- 확인할 것
  1.
```
