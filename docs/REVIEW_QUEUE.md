# REVIEW_QUEUE — Codex 검토 대기열

위에서부터 1개씩 검토합니다. 절차는 `docs/REVIEW_LOOP.md`.

- 상태: ⏳대기 · 🔍검토중 · ⚠️발견있음(사용자 결정 대기) · ✅보완완료 · 👌이상없음
- "Claude 검증" = Claude가 작업 당시 실제로 돌린 확인 수준. **테스트 미실행** 항목은 반드시 `npm test`/`npm run build`로 재확인.
- 줄 번호는 2026-09-23 `main`(`b000371`) 기준. 어긋나면 함수명으로 찾기.
- 새 항목은 맨 아래에 추가, 급한 건 맨 위로. 형식은 문서 끝 참고.

---

## R16 · 회원 수업 영상 로컬 이미지·숏폼 검수 도구 · 2026-10-08 · ⏳대기

- 작성: Codex, 브랜치 `codex/local-member-media-assets`
- 대상: `scripts/content-media/`, `tests/content-media/`, `docs/VIDEO_AUTOMATION_MVP.md`
- 확인할 것
  1. 번호 폴더만 탐색, 날짜·제외 폴더 규칙, 심볼릭 링크/정션 거부, 원본 읽기 전용인지
  2. 로그·컨택트 시트·매니페스트·해시 파일에 회원 폴더명이나 원본 경로가 없는지
  3. 얼굴 임계치, 정확히 5개 선택, 1200 정사각 이미지, 덮어쓰기 방지
  4. 영상 구간 수·15~20초·1080×1920·음성 제외·`publishAllowed:false` 및 `--dry-run`
  5. 더미 테스트, 전체 npm 기준선, 빌드
- Codex 테스트: Python 더미 테스트 6/6 통과. 전체 Vitest 3170/3186(기존 11개 실패와 병렬 시간 초과 5개); 해당 추가 시간 초과가 난 4개 파일 단독 실행 171/171 통과. 빌드 성공(기존 경고). 실제 원본 프레임·영상은 사용하지 않음.
- 미검증: OpenCV, FFmpeg/ffprobe, Gowun Dodum 미설치 상태. 실제 영상 추출·렌더 및 컨택트 시트는 미생성.
- 다음: Codex 구현을 독립 검토하고, 사용자 PC에서 로컬 종속성을 준비한 후 승인된 대상 영상으로 후보 추출.

## R15 · 매일 Gemini 이미지 로컬 최종화 · 2026-10-07 · ✅보완완료

- 작성: Codex, 브랜치 `codex/daily-image-finalizer`
- 대상: `scripts/content-image/finalize_images.py`, `scripts/content-image/register-finalizer-task.ps1`, `scripts/content-video/postprocess_images.py`, `tests/content-image/test_finalize_images.py`, `.gitignore`, `docs/VIDEO_AUTOMATION_MVP.md`
- 확인할 것
  1. Notion 요청이 읽기 전용 data source query POST 및 페이지 댓글 GET으로 제한되고 페이지네이션·오류·리다이렉트가 fail-closed인지, 토큰/경로가 출력되지 않는지
  2. 로컬 작업표에 지정된 정확히 5개 파일만 최근 24시간 범위에서 복사하고 무관한 다운로드·원본은 건드리지 않는지
  3. 잘못된 계획·문구/위치·4:3·텍스트 넘침·기존 `final` 재실행 경계가 안전한지
  4. PowerShell 등록이 기본 미리보기이며 명시적 `-Register` 외에는 작업을 만들지 않는지
  5. Python 테스트·전체 `npm test` 기준선·빌드 결과를 독립 재실행
- Codex 검증: Python 더미 테스트 17/17(시험용 맑은 고딕), 전체 Vitest 3175/3186(기존 실패 11), `npm run build` 통과. 실제 Notion 호출·다운로드 폴더·작업 등록은 미실행.
- Codex 수정은 검토자가 HANDOFF에 발견을 먼저 기록하고 사용자 지시에 따라 보완.
- Claude 보완(2026-10-07): ① `--job` 없이 자동 실행 — 최근 24시간 `Gemini*` 이미지가 정확히 5개일 때만 진행 ② Notion 달력에서 승인·미게시 티스토리 행을 발행예정일 순으로 선택 ③ `NO_TARGET` 추가. data source query POST는 Notion의 read-content 전용 기능이며 API 속성 쓰기가 아님.
- 남은 일: Claude 예약 작업의 Notion 댓글에 `IMAGE_PLAN_JSON` 줄(문구·positions JSON)을 넣어야 이 스크립트가 읽을 수 있음(현재 평문 댓글).
- Codex 보완 커밋: `f18c73d` — query POST 리다이렉트 거부 및 응답 URL 전체 검사. `5bdfc6c` — 페이지 ID 기반 처리 기록과 이전 날짜 결과 폴더 확인, 재처리 시 `OUTPUT_EXISTS`. `2d9da65` — 처리한 글을 Notion 후보 목록에서 건너뛰고 다음 승인 글을 선택(페이지네이션 포함).
- Notion 공식 문서는 data source query를 HTTP POST로 정의하며 `read content` capability를 요구한다. 그러므로 조회 POST 예외는 승인 가능하다. [Notion Query a data source](https://developers.notion.com/reference/query-a-data-source)
- 최종 검증: Python 17/17(시험용 맑은 고딕), 전체 Vitest 3175/3186(기존 실패 11개), 빌드 통과. 실제 Notion 연결·스키마, Gowun Dodum 운영 글꼴, Downloads 및 예약 작업은 미검증.
- 남은 연동: Claude 예약 댓글에 `IMAGE_PLAN_JSON` 및 `positions` JSON을 기록해야 이 스크립트가 문구를 읽는다. 현재 댓글이 평문이면 `PHRASE_PLAN`으로 fail-closed 중단.

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
- Claude 교차확인(2026-09-23): 반올림 해결·확인할 것 4 동의. 추가 보완 — ① 화면 문구 "합계 = 입금금액과 일치" → "환불·담당 미지정분은 센터 귀속으로 제외"(`Revenue.jsx:445,449`) ② 월 결제를 정산비율 판정에서 제외(`finance.js:202-208`, 보완 전과 비율 차이 0건 — 무작위 500세트) ③ 실행형 회귀 테스트 `review_R1_attribution.test.js` 11개(기준선 파일 `.github/test-baseline.json` 3071/3082 상향은 원격 쓰기 금지 폴더라 사용자 수정). `npm run build` 통과. 상세는 HANDOFF 작업 로그.

## R9 · 월정액 결제의 트레이너 정산 제외 규칙 미작동 의심 (센터 이익) · 2026-09-23 · ⏳ (대표님 결정: 다음 차례로 우선 확인)

- 발견: Claude(R1 교차확인 중). 코드 수정 없음 — 확인 먼저
- 대상: `src/services/finance.js` `buildTrainerLots` 417, `computeSessionSettlement` 611~615(주석 "월정액 결제(isMonthly)는 트레이너 정산에서 제외 → 센터 수익으로만 합산") / 결제 저장: `src/components/members/MemberDetail.jsx` `handleAddPayment` 536~, `src/pages/Revenue.jsx` 결제 수정 632·672, `src/utils/memberImport.js` 130~132·`payloadOf` 148~161 / Notion: `scripts/trainer-stats/sync.mjs:152`, `scripts/dashboard-snapshot/sync.mjs:135`
- 사실: 저장소 이력 전체에서 결제에 `isMonthly`를 저장하는 코드가 없음(테스트에서만 사용) → 위 제외 규칙이 실데이터에 한 번도 적용되지 않았을 가능성. CSV 가져오기는 월정액 결제에도 `trainerIds`를 채움
- 영향 가능성: 월정액 회원(`member.monthly.active`) 결제에 담당 트레이너가 지정되고, 같은 트레이너에게 세션 등록분도 있으면 legacy lot 결제액에 섞여 회당 단가·정산액이 올라갈 수 있음(`buildLegacyLots` 388~396)
- 확인할 것
  1. 실제 Firestore `payments`에 월정액 회원 결제가 있는지, `trainerIds`·`isMonthly`가 어떻게 들어가 있는지(사용자 확인 필요 — 이름·금액 기록 금지, 건수만)
  2. 그런 결제가 정산 탭 단가·지급액에 섞이는지 실행형 재현 테스트로 확인
  3. 해결 방향은 사용자 결정: (가) 월정액 결제 저장 시 `isMonthly: true` 저장 + 기존 데이터 보정 (나) 회원 `monthly.active` 기준으로 판정 — 이미 지급·박제된 과거 정산에 소급 영향 주의
  4. 결정 후 R1 개요 표시(월 결제 포함)와 정산(제외) 규칙이 서로 맞는지 재확인

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

## R10 · 1RM 카메라 오류(setVideoSavedMsg) 수정 + 멈춤 방지 테스트 · 2026-09-23 · ⏳

- 커밋: 사용자 업로드 커밋(R1 교차확인 보완과 같은 커밋)
- 대상: `src/ai-measure/menus/OneRMEstimate.jsx:102-105` / `src/__tests__/lint_crash_guard.test.js`
- 테스트: `lint_crash_guard.test.js` — src 전체 no-undef·react/jsx-no-undef·react-hooks/rules-of-hooks 오류 0건
- Claude 검증: `npm test` 3071/3082(기존 실패 11), `npm run build` 통과, `npm run lint` 오류 4→1(남은 1건은 `unifiedReport.js:109,326` peakVelocity 중복 키 — 기존, 범위 밖)
- 규칙: `ae7049f`가 지운 상태 선언을 setter만 복구 — 화면·저장 동작 변화 없음
- 확인할 것
  1. 1RM 추정 화면에서 카메라 열기·측정 시작·60초 자동 종료가 오류 없이 되는지(실기기)
  2. 같은 날 버튼 제거 커밋(`VbtMeasure.jsx`, `LiftingMeasure.jsx`, `LiftingResultSheet.jsx`)에 남은 참조가 없는지 — lint 가드로 1차 확인됨
  3. lint 가드 실행 시간(약 7초)이 부담되면 대상 폴더를 줄일지

## R11 · 모미 음성 인식률·명령 지연 개선 + 관리자 전용 마운트 · 2026-09-29 · ✅보완완료

- 커밋: 관리자 전용 `70f245c` / 인식률·지연 개선은 이번 커밋(해시는 `git log --oneline -3`로 확인)
- 대상: `src/hooks/useMomiVoice.js` (`WAKE_WORD_VARIANTS` unshift, `wakeInterimRef`, `onend` 복구, TTS 12초 고착 방지, `FINAL_RESULT_SETTLE_MS`) / `src/components/common/KioskVoiceCommand.jsx`·`GlobalVoiceCommand.jsx` `handleCommand`의 `ackTimer` / `src/services/voiceCommandService.js` `/api/voice-command` 12초 타임아웃 / `src/components/layout/AppLayout.jsx:218` `user?.role === 'admin'` 조건
- 테스트: `momi_recognition_boost_2609.test.js`(신규), `momi_voice.test.js`, `momi_speech.test.js`, `kiosk_voice_command.test.js`, `kiosk_nav_filter.test.js`
- Claude 검증: `npm test` 3095/3106(기존 실패 11 그대로, 새 실패 0), eslint 오류 0, `npm run build` 통과. **실기기(키오스크 노트북 Chrome) 음성 테스트 미실행**
- 규칙: "모미야" 호출 인식률↑, 명령 실행 지연↓, 서버 무응답 시 이후 명령이 영구 무시되지 않게. 모미는 관리자 로그인에서만 마운트.
- 확인할 것
  1. **오탐 위험** — 임시(interim) 결과에서 웨이크워드를 기억했다가(4초) 확정 문장에 웨이크가 없어도 명령으로 실행함(`useMomiVoice.js` `wakeMatch` 직전 분기). 웨이크워드를 부르지 않은 주변 대화가 4초 창 안에 명령으로 실행될 수 있는지, 4초가 적절한지.
  2. `onend` 복구에서 `recognition.onresult`에 가짜 이벤트를 넣는 방식이 `pendingReplyRef`(awaitReply 대기 중) 흐름과 충돌하지 않는지.
  3. 자모 유사도 정규식(`fuzzyMatchWakeWord`)이 "소미야/보미야" 같은 사람 이름 호명에도 반응하는 문제는 **미수정** — 관리자 전용으로 노출은 줄었으나 남아 있음. 좁힐지 사용자 결정.
  4. `not-allowed`(마이크 거부) 시 `onend`가 무조건 재시작해 오류가 반복되는 문제 **미수정**(`useMomiVoice.js` onend 재시작 조건).
  5. 테스트가 소스 문자열 위주라 "약함" — 실제 SpeechRecognition 모의 객체로 실행형 테스트를 추가할 수 있는지.
  6. 트레이너 계정으로 로그인된 키오스크에서는 모미가 안 뜸 — 운영상 문제 없는지 사용자 확인.

- Codex 검토(2026-09-29): 🔴 `KioskVoiceCommand.jsx`·`GlobalVoiceCommand.jsx`에서 `ackTimer`를 `try` 내부 `const`로 선언하고 `finally`에서 참조해 ReferenceError 발생; busy/handling 잠금 해제가 중단됨. 🟠 `not-allowed` 시 자동 재시작 위험은 미해결. 테스트 3095/3106(기존 11 실패), R11 관련 156/156, 빌드 통과. 상세·수정 제안은 HANDOFF 최신 로그.
- Codex 보완 완료(2026-09-29): acknowledgement 잠금 해제, interim 오탐 제한, 권한 거부 후 재시작 중단, 응답 본문 포함 12초 API 제한 수정. R11 관련 164/164, 전체 3100/3111(기존 실패 11), 빌드 통과. 실기기 키오스크 확인은 배포 후 진행.
- Codex 실기기 후속 검토(2026-09-30): 마이크 진단이 SpeechRecognition과 동시에 두 번째 `getUserMedia()` 캡처를 열어 저신호로 오판할 수 있음. 답변 처리 중 진단을 막고, 측정 전 인식 중지·측정 후 청취 재개를 구현함. R11 관련 32/32, 전체 3111/3122(기존 실패 11), 빌드 통과. 아직 배포 전이며, 별도 노트북에서 재검증 필요. 한국어 팩 `install()` 실패와 `network` 오류는 이 진단 동시 캡처 문제와 분리된 후속 조사 대상.
- Codex 후속 보완(2026-09-29): 관리자 마운트를 키오스크/PC 경로별로 분리. 퍼지 자모·이름성 웨이크워드를 제거하고 발화 첫머리의 호출만 인정; 단독 호출 및 후속 대기는 `모미야`/`모미`, 대기창은 5초로 제한. 실기기 검증은 배포 후 진행.
- Codex 후속 보완(2026-09-29): 반복 `no-speech` 원인을 추적해 기존 소음 억제 트랙이 시각 미터에만 연결되어 있음을 확인. Chromium 135+에서는 필터가 설정된 실제 오디오 트랙을 SpeechRecognition에 전달하고, 다른 브라우저는 기본 입력으로 유지. 관련 테스트 168/168, 전체 3104/3115(기존 실패 11), ESLint 및 빌드 통과. 배포 후 체육관 소음 환경에서 확인 필요.
- Codex 근본 원인 재검토(2026-09-29): 오디오 트랙 전달 변경만으로는 ASR 엔진의 `no-speech`를 해결하지 못해 기본 마이크 파이프라인으로 되돌림. Chrome의 한국어 온디바이스 처리 가용성 확인·설치 흐름을 추가했으며, 최초 안내가 `no-speech`에 의해 사라지던 UI 상태 버그도 수정. 확인 답변 대기 중 설치로 인한 인식 중단을 막음. 관련 7개 파일 178/178, 변경 파일 ESLint 및 빌드 통과. 전체 테스트 결과 및 배포 후 실기기 확인은 HANDOFF 최신 로그 참고.
- Codex 실기기 진단 보완(2026-09-29): 새 배포에서도 `no-speech`가 지속되는 스크린샷을 확인. 관리자 화면에 5초 로컬 마이크 파형 검사(주변 기준 2초 + 말하기 3초)를 추가해 마이크 입력 부족과 브라우저 ASR 무응답을 나눔. 원본 음성 저장·전송은 없음. 관련 7개 파일 182/182, 전체 테스트 3110/3121(기존 실패 11), ESLint 및 빌드 통과. 실기기 검사 결과는 다음 단계.
- Codex UI 진단 표시 보완(2026-09-30): 재시작 직후 `no-speech` 상태가 listening 상태로 덮여 진단 버튼이 숨겨지던 문제를 수정. 진단 경고를 다음 텍스트 결과까지 유지. 관련 7개 파일 182/182 및 빌드 통과. 전체 테스트는 알려진 실패 11건과 추가 시간초과 11건(음성 관련 대상 테스트 통과).
- Claude 근본 원인 재조사(2026-09-30): 스크린샷이 `181ac20` 배포 전 화면임을 확인(시각·번들명). 설치 실패는 `install()`의 false 반환, `aborted`는 모미의 자체 abort, 실패 안내 300ms 뒤 덮임, 로컬→원격 복귀 없음을 코드로 입증해 수정. 진단 페이지 `/mic-test` 확장. 전체 3135/3146(기존 11 동일), 빌드 통과. 가짜 SpeechRecognition 실행형 테스트 추가. 실기기 확인 대기. 상세는 HANDOFF 최신 로그.

---

## R13 · PR1 입력 가드·클립 격리 검토 · 2026-10-05 · ✅ 병합
- PR: [#3](https://github.com/arfongce-ai/momgagym-cms2/pull/3), `codex/video-input-guard-pr1` → `main`, 병합 커밋 `4397d3f`
- 대상: `scripts/content-video/inputGuard.mjs`, `prepare-review.mjs`, `videoMvp.mjs` 및 테스트
- 테스트 당시 기록: 전체 npm test 3158/3169, 알려진 네 파일에서 11개 실패; 새 실패 파일 없음. 이후 main에서 전체 테스트를 다시 실행해 기준선을 현재 3183개로 확인함(기존 실패 11).
- 확인: PR #3 병합 후 PR2 착수 조건 충족.

## R14 · PR2 Notion 영상 대기열 연동 + 오프라인 이미지 후처리 · 2026-10-06 · ⏳
- 커밋: `c61e3b0`
- 대상: `scripts/content-video/notionClient.mjs`, `notionWorkflow.mjs`, `run-notion-review.mjs`, `prepare-review.mjs`, `postprocess_images.py`, 관련 Vitest/Python 더미 테스트
- 검증: PR1/PR2 Vitest 42/42, 전체 npm test 3172/3183(기존 실패 11건은 위 R13에 적힌 기존 네 파일만), `.github/test-baseline.json`을 이 통과 수/총 테스트 수로 갱신, Python 이미지 더미 3/3, `npm run build` 통과(기존 경고)
- Notion 점검(읽기 전용 스키마): 현재 캘린더에 대본·시작/끝 초·동의 참조·결과 해시·마지막 처리 시각·오류 요약 속성이 없음. 별도 동의 data source/Integration 설정은 미검증. 실 Notion 왕복 없음.
- Claude/Gemini 교차 검토 대기: API/data source 쿼리, 읽기 전용 동의 토큰 분리, 쓰기 허용 목록, fail-closed, stale edit 복구, 경로·PII 비노출, 이미지 크롭 및 텍스트 넘침.
- 사용자 수동 작업 제안: 필요한 Notion 속성 추가, `검수 결과 링크`는 기존 `Drive 링크` 재사용 여부 결정. `이미지 폴더 확인`, `티스토리 초안 번호`는 옵션으로 제안만(코드에서 생성 안 함).

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
