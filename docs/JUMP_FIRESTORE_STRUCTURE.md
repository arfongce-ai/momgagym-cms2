# 점프 분석 — Firestore 데이터 구조

## 저장 위치

기존 AI 측정과 동일하게 **`/ai/{autoId}`** 컬렉션에 저장됩니다.
(보행 분석이 `gait_reports` 전용 컬렉션을 따로 두는 것과 달리, 점프는 `ai` 컬렉션을
그대로 쓰되 `data` 안에 전체 리포트를 담습니다. 추후 추이 그래프가 필요하면
보행처럼 `jump_reports` 전용 컬렉션으로 분리할 수 있습니다.)

`aiStore.addSession(memberId, session)` 이 다음 래퍼로 감싸 저장합니다:

```
/ai/{id}
  __mid:          string   // 회원 id (그룹 키)
  menu:           'jump'
  menuTitle:      '점프'
  recordedAt:     '2026-06-23'          // 로컬 날짜(YMD)
  recordedAtFull: ISO 문자열
  data:           { ...아래 리포트 페이로드... }
```

## 리포트 페이로드 (data 필드)

```jsonc
{
  // ── 메타 ──
  "valid": true,                  // 교차검증/sanity 통과 여부
  "reason": "ok",                 // ok | no_jump | cross_mismatch | sanity_fail
  "source": "upload",             // upload | live | manual
  "jumps": 1,                     // 감지된 점프 횟수(최고값 채택)
  "measuredAt": "2026-06-23T...",
  "calibHeightCm": 175,           // 보정에 쓴 회원 키
  "member": { "id": "...", "name": "홍길동" },

  // ── ① 성능 및 파워 ──
  "heightCm": 42.3,               // 점프 높이 (비행시간 기반, 주 결과)
  "flightTimeMs": 587,            // 체공 시간
  "flightTimeSec": 0.587,
  "takeoffVelocity": 2.88,        // 도약 속도 (m/s)
  "peakPower": 3421,              // 최대 파워 (Sayers, 체중 입력 시 / 없으면 null)

  // 교차검증 신뢰도
  "crossCheck": {
    "heightCrossCm": 40.1,        // 골반변위 기반 독립 추정
    "deltaPct": 5.2,              // 두 방식 불일치(%)
    "agree": true                 // null=검증 불가
  },

  // ── ②③ 자세·기술·대칭성 (biomech) ──
  "biomech": {
    "view": "side",               // 'side' | 'back' | 'unknown' (자동 감지)
    "enabled": {                  // 뷰별 지표 활성 여부 (리포트 가이드라인)
      "posture": true,            // 자세/기술 = 측면 전용
      "pelvicDrop": false,        // 골반 불균형 = 정면 전용
      "footSymmetry": true        // 착지 발끝 대칭 = 양 뷰 가능
    },
    // 자세 및 기술 (측면뷰 전용)
    "landingKneeAngle": 128.5,    // 착지 무릎각(좌우 평균) — 핵심
    "landingKneeLeft": 126.0,
    "landingKneeRight": 131.0,
    "trunkLeanStand": 6.2,        // 준비 상체 기울기(도)
    "trunkLeanChange": 9.4,       // 준비→착지 변화(도) — 핵심
    "extensionAlignment": {       // 신전 궤적 정렬도 (Triple Extension 대체)
      "available": true,
      "alignmentScore": 84.0,     // 0~100 (고관절·무릎 함께 펴지는 궤적 정렬)
      "directionConsistency": 91.0, // 신전 방향 일치도(%)
      "hipFinalDeg": 168.2,
      "kneeFinalDeg": 171.5,
      "ankle": { "finalDeg": 142.0, "note": "ref" }, // 참고(발목)
      "quality": "good"           // good | fair | poor
    },
    // 대칭성 및 안정성
    "pelvicImbalance": 2.1,       // 골반 좌우 높이차(%) — 정면뷰 전용
    "footLandingSymmetry": {      // 착지 발끝 대칭 (force plate 대체)
      "available": true,
      "view": "side",
      "primaryAxis": "anteroposterior", // 측면=앞뒤 / 정면=좌우
      "primaryDiffPct": 3.2,      // 핵심 축 차이(%)
      "lateralDiffPct": 1.1,      // 좌우 차이(%)
      "anteroposteriorDiffPct": 3.2, // 앞뒤 차이(%)
      "symmetryPct": 96.8,        // 0~100 (100=완전 대칭)
      "leadFoot": "left"          // 먼저/앞서 착지한 발 (참고)
    }
  },

  // ── 정밀도 (고속영상 분석 시) ──
  "precision": {
    "analyzedFrames": 312,
    "samplingFps": 240,
    "measuredAvgFps": 238,
    "fpsJitterPct": 4,
    "lowConfFrames": 11,
    "lowConfPct": 3.5,
    "cautionWindows": [1234, 1267, ...],  // 저신뢰(블러) 시점 ms
    "captureMode": "slowmo240",
    "durationSec": 3.2
  }
}
```

## 신뢰 등급 (리포트에 배지로 노출)

| 등급 | 의미 | 해당 지표 |
|------|------|-----------|
| **핵심** | 측면뷰 기준 비교적 신뢰 | 점프높이, 체공, 도약속도, 파워, 착지무릎각, 상체기울기, 신전정렬도, 골반불균형(정면) |
| **참고** | 정확도 한계 | 신전 정렬도의 발목 신전 각도 (BlazePose 발끝 정확도 낮음) |
| **대체** | force plate 대신 영상으로 잴 수 있는 것 | 착지 발끝 대칭성 (좌우 체중 분산을 대체) |

### 뷰별 활성 지표 (자동 감지)

| 촬영 방향 | 활성 지표 |
|-----------|-----------|
| **측면(side)** | 자세·기술(착지무릎각·상체기울기·신전정렬도) + 착지 발끝 대칭(앞뒤) |
| **정면(back)** | 골반 불균형 + 착지 발끝 대칭(좌우) |

> ⚠ **좌우 체중 분산은 측정하지 않습니다.** 카메라로는 어느 발에 몸무게가 더
> 실렸는지 알 수 없습니다. 대신 `footLandingSymmetry`(착지 시 양발 위치 차이)로
> 균형 능력을 평가합니다. 정확한 하중 분산은 지면반력판(force plate)이 필요합니다.

## 체중 데이터 (Sayers 파워 계산)

최대 파워는 Sayers 공식을 쓰며 **체중**이 필요합니다. 체중은 member 객체가 아니라
회원 **신체기록(`body` 컬렉션)**의 최신값에서 가져옵니다.
`resolveBodyMetrics(member)` 가 `store.getBodyRecords(memberId)` 의 가장 최근
기록에서 weight(없으면 키도)를 해석합니다. 체중이 없으면 파워는 `null`(리포트에
"체중 입력 시"로 표시)로 둡니다.

## 과거 리포트 재조회 시 주의

저장 시 리포트는 `aiSession.data` 아래에 들어갑니다. 따라서 이력에서 다시 띄울 때는
`JumpReportDashboard report={aiSession.data}` 로 넘겨야 합니다.
(측정 직후에는 Hub 가 리포트 객체를 직접 넘기므로 그대로 동작합니다.)
```js
// 이력 목록에서 한 건 클릭 시
<JumpReportDashboard report={session.data} onClose={...} />
```

## 추이 그래프(선택, 향후)

회차별 추이가 필요하면 `reportService.js` 패턴으로 `buildJumpReport(aiSessions)` 를
추가해 `series` (날짜→heightCm 등)와 `summary`(최대/최근값)를 만들면 보행 리포트와
동일한 시계열 대시보드를 붙일 수 있습니다.
