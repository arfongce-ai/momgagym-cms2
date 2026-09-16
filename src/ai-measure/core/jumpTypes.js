// ai-measure/core/jumpTypes.js
// ════════════════════════════════════════════════════════════════════════
//  점프 세부 종류(jumpSubType) 메타데이터 — 라벨·코드·계산 엔진을 한 곳에 모음.
//  [2026-08-10 신규] "파워 점프" → CMJ 이름 변경 + SJ/DJ/SLJ 추가.
//
//  기존 jumpType('power'|'reactive')은 "어느 계산 엔진(파이프라인)을 쓰는지"를
//  뜻하는 내부 저장값이고, 과거에 저장된 모든 회원 리포트가 이 값 기준이라
//  절대 바꾸지 않는다(하위호환). 화면에 보이는 세부 종류(CMJ/SJ/DJ/SLJ/RSI)는
//  이 새 jumpSubType로 구분한다 — 비유하면 jumpType은 "어떤 엔진을 쓰는 차인지"
//  (가솔린/전기), jumpSubType은 "그 차의 구체적 모델명"인 셈이다.
//
//  엔진(계산 파이프라인)은 둘뿐이다:
//   · power    — calcJump: 체공시간 → 높이/파워 (단발 최대점프. CMJ·SJ·SLJ)
//   · reactive — computeRSIFromFlights: 체공/접지 비율 (반응 탄성. DJ·RSI)
//  같은 엔진을 쓰는 종류끼리는 실제 검출·계산 로직이 100% 동일하고, 종류별로
//  다른 건 안내 문구·필요 점프 횟수·저장되는 라벨뿐이다.
// ════════════════════════════════════════════════════════════════════════

export const JUMP_SUBTYPES = {
  cmj: {
    code: 'CMJ', label: 'CMJ (반동점프)', chipLabel: '⚡ CMJ',
    engine: 'power', view: 'front', singleLeg: false,
    guideTitle: '반동점프(CMJ)란?',
    guideBody: '선 자세에서 빠르게 살짝 앉았다가(반동) 곧바로 최대한 높이 수직으로 뛰는 점프입니다. 팔은 자연스럽게 쓰되, 매번 같은 방식으로 뛰어야 비교가 정확합니다. 제자리에서 수직으로 뛰고 같은 자리에 착지하세요.',
    tip: '정면 촬영 추천 · 점프 높이·좌우 착지 대칭 중심 분석',
  },
  sj: {
    code: 'SJ', label: 'SJ (스쿼트점프)', chipLabel: '🏋️ SJ',
    engine: 'power', view: 'front', singleLeg: false,
    guideTitle: '스쿼트점프(SJ)란?',
    guideBody: '무릎을 굽혀 앉은 자세(반동 없이)에서 2~3초 정지했다가, 곧바로 최대한 높이 수직으로 뛰는 점프입니다. CMJ와 달리 "반동(빠른 하강)"을 쓰지 않아 다리 자체의 순수한 힘을 봅니다. 앉은 자세에서 살짝이라도 움찔하면 반동이 섞여 정확도가 떨어집니다.',
    tip: '정면 촬영 추천 · 반동 없이 앉은 자세에서 정지 후 점프',
  },
  slj: {
    code: 'SLJ', label: 'SLJ (한발 점프)', chipLabel: '🦵 SLJ',
    engine: 'power', view: 'front', singleLeg: true,
    guideTitle: '한발 점프(SLJ)란?',
    guideBody: '한쪽 다리로만 서서 그 다리로만 뛰고 그 다리로만 착지하는 점프입니다. 반대쪽 다리는 편하게 살짝 들어 올려두세요. 좌우 다리를 각각 측정해 힘 차이(불균형)를 비교하는 데 씁니다. 균형이 흔들리기 쉬우니 천천히, 안전한 곳에서 진행하세요.',
    tip: '정면 촬영 추천 · 테스트할 다리를 먼저 선택하세요',
  },
  dj: {
    code: 'DJ', label: 'DJ (드롭점프)', chipLabel: '📦 DJ',
    engine: 'reactive', view: 'side', minCycles: 2,
    guideTitle: '드롭점프(DJ)란?',
    guideBody: '낮은 박스·계단(20~30cm 권장)에서 내려서듯 떨어져 착지한 뒤, 땅에 닿자마자 최대한 빠르고 높게 다시 뛰어오르는 점프입니다. 착지~재도약 사이 지면에 닿는 시간을 최대한 짧게 하는 게 핵심입니다. 1회만 측정하며, 이 앱은 카메라로 박스 높이 자체를 재지는 못해 착지 후 접지시간·RSI만 기록합니다.',
    tip: '측면 촬영 필수 · 박스에서 내려와 착지 즉시 재도약 1회',
  },
  rsi: {
    code: 'RSI', label: 'RSI (반응 탄성)', chipLabel: '🔁 RSI',
    engine: 'reactive', view: 'side',
    guideTitle: '반응 탄성 점프(RSI) 측정법',
    guideBody: '제자리에서 연속 3회 이상 빠르게 점프하세요(포고 점프). 착지 후 지면에 닿는 시간을 최대한 짧게, 곧바로 다시 높이 뛰는 게 핵심입니다. RSI = 체공시간 ÷ 접지시간(무단위)으로, 접지가 짧고 높이 뛸수록 값이 높습니다.',
    tip: '측면 촬영 추천 · 연속 3회 이상 · 접지 짧게 · 고속영상(240fps) 권장',
  },
  // [제자리멀리뛰기 추가 2026-09-16] 기존 5종은 전부 '수직' 점프(체공시간→높이)라
  // engine이 power|reactive 둘뿐이었다. SBJ(Standing Broad Jump)는 수평 이동거리를
  // 재는 완전히 다른 측정이라 engine='horizontal' 세 번째 계산 파이프라인을 새로
  // 둔다(jumpBiomechanics.js BroadJumpTracker 참고) — 이착지(비행) 검출 자체는
  // 기존 power 엔진과 동일한 발목 y 신호를 재사용하고, 다른 건 "체공시간→높이" 대신
  // "이착지 사이 발목 x 변위→거리"로 바꾼 것뿐이다.
  sbj: {
    code: 'SBJ', label: 'SBJ (제자리멀리뛰기)', chipLabel: '📏 SBJ',
    engine: 'horizontal', view: 'side', singleLeg: false,
    guideTitle: '제자리멀리뛰기(SBJ)란?',
    guideBody: '두 발을 모아 출발선에 맞춰 선 다음, 팔과 무릎 반동을 이용해 최대한 멀리 앞으로 뛰어 두 발로 착지하는 점프입니다. 착지 후 뒤로 손을 짚거나 넘어지면 그 지점까지가 기록에 영향을 줄 수 있으니 균형을 잡고 서서 마무리하세요. 좌우가 아니라 앞뒤 이동을 재는 측정이라 반드시 옆에서(측면) 촬영해야 합니다.',
    tip: '측면 촬영 필수 · 출발선에 발을 맞추고, 이동 경로 전체(착지 지점까지)가 화면에 다 들어와야 함',
  },
  // [한발멀리뛰기 추가 2026-09-16] SBJ(양발)와 계산 엔진은 100% 동일
  // (engine:'horizontal', BroadJumpTracker의 발목 x 변위→거리) — 다른 건
  // "한 발로만" 뛴다는 것(singleLeg:true, SLJ와 동일한 다리선택 UI 재사용)과
  // 방향 3가지뿐이다. 방향에 따라 카메라 위치가 달라진다:
  //  · 정면(forward) — SBJ와 동일하게 "옆에서" 촬영(측면 view) → 이동거리가
  //    화면의 가로(x)축과 일치.
  //  · 안쪽/바깥쪽(medial/lateral) — 좌우 이동이라 "정면에서"(view:'front')
  //    촬영해야 화면의 가로(x)축과 일치한다(옆에서 찍으면 좌우 이동이 카메라
  //    쪽/반대쪽 깊이 방향이 돼 2D 포즈로는 잴 수 없음). 계산 자체는 손 안 댐 —
  //    "어느 방향으로 서서 찍는지"만 다르고 같은 x축 변위 로직을 그대로 씀.
  shjf: {
    code: 'SHJ-F', label: '한발멀리뛰기 (정면)', chipLabel: '🦶 정면',
    engine: 'horizontal', view: 'side', singleLeg: true,
    guideTitle: '한발멀리뛰기 · 정면(SHJ-F)이란?',
    guideBody: '한쪽 다리로만 서서 그 다리로만 앞으로 뛰고 그 다리로만 착지하는 제자리멀리뛰기입니다. 반대쪽 다리는 편하게 들어 올려두고, 착지 후 균형을 잃고 손을 짚거나 반대 발이 먼저 닿으면 그 지점까지가 기록에 영향을 줍니다. SBJ와 같은 방식으로 반드시 옆에서(측면) 촬영하세요.',
    tip: '측면 촬영 필수 · 테스트할 다리를 먼저 선택 · 착지까지 화면에 다 들어와야 함',
  },
  shjm: {
    code: 'SHJ-M', label: '한발멀리뛰기 (안쪽)', chipLabel: '🦶 안쪽',
    engine: 'horizontal', view: 'front', singleLeg: true,
    guideTitle: '한발멀리뛰기 · 안쪽(SHJ-M)이란?',
    guideBody: '한쪽 다리로 서서 몸 안쪽(반대쪽 다리 방향)으로 최대한 멀리 뛰어 같은 다리로 착지합니다. 좌우 이동을 재는 측정이라 정면(카메라를 마주보고 서는 방향)에서 촬영해야 합니다. 균형·고관절 안정성을 보는 측정이라 무리하지 말고 편한 범위에서 진행하세요.',
    tip: '정면 촬영 필수 · 테스트할 다리를 먼저 선택 · 안쪽(반대 다리 쪽)으로 도약',
  },
  shjl: {
    code: 'SHJ-L', label: '한발멀리뛰기 (바깥쪽)', chipLabel: '🦶 바깥쪽',
    engine: 'horizontal', view: 'front', singleLeg: true,
    guideTitle: '한발멀리뛰기 · 바깥쪽(SHJ-L)이란?',
    guideBody: '한쪽 다리로 서서 몸 바깥쪽(반대쪽 다리와 먼 방향)으로 최대한 멀리 뛰어 같은 다리로 착지합니다. 좌우 이동을 재는 측정이라 정면(카메라를 마주보고 서는 방향)에서 촬영해야 합니다. 균형·고관절 안정성을 보는 측정이라 무리하지 말고 편한 범위에서 진행하세요.',
    tip: '정면 촬영 필수 · 테스트할 다리를 먼저 선택 · 바깥쪽으로 도약',
  },
};

// 화면에 보여줄 순서(선택 칩·가이드 카드 등에서 공통으로 사용).
export const JUMP_SUBTYPE_ORDER = ['cmj', 'sj', 'dj', 'slj', 'rsi', 'sbj', 'shjf', 'shjm', 'shjl'];

// [한발멀리뛰기 추가 2026-09-16] '제자리멀리뛰기' 탭(registry.js의 broadjump)에서
// 고를 수 있는 세부 종류만 모은 부분집합 — SBJ(양발) + 한발멀리뛰기 3방향.
// engine이 전부 'horizontal'인 것과 정확히 일치한다(JUMP_SUBTYPE_ORDER 순서 유지).
export const BROAD_JUMP_SUBTYPES = JUMP_SUBTYPE_ORDER.filter((k) => JUMP_SUBTYPES[k].engine === 'horizontal');

// [SLJ 좌우 비대칭 2026-08-11] 다리 코드('left'|'right') → 표시 라벨.
// JumpAnalysisHub.jsx(다리 선택 버튼)와 JumpReportDashboard.jsx(리포트 표시·
// 비대칭 비교)가 같이 쓴다 — 라벨을 두 곳에 따로 적어두면 나중에 하나만
// 바뀌는 사고가 나므로 한 곳에 모음.
export const LEG_LABEL = { left: '왼발', right: '오른발' };

const DEFAULT_REACTIVE_MIN_CYCLES = 3; // reactiveJump.js RSI_TUNING.minCycles 기존값과 일치시킴

/**
 * 저장된 데이터(과거 데이터 포함)에서 세부 종류를 판정한다.
 * jumpSubType 필드가 있으면 그대로 쓰고, 없으면(2026-08-10 이전 과거 데이터)
 * jumpType/rsi 유무로 cmj|rsi 둘 중 하나로 추론한다(하위호환 — 그때는 이 둘뿐이었음).
 */
export function resolveJumpSubType(data) {
  if (!data) return 'cmj';
  if (data.jumpSubType && JUMP_SUBTYPES[data.jumpSubType]) return data.jumpSubType;
  return (data.jumpType === 'reactive' || data.rsi) ? 'rsi' : 'cmj';
}

/** 세부 종류 → 계산 엔진('power'|'reactive'|'horizontal'). 모르는 값이면 안전하게 'power'. */
export function engineOf(subType) {
  const e = JUMP_SUBTYPES[subType]?.engine;
  if (e === 'reactive') return 'reactive';
  if (e === 'horizontal') return 'horizontal';
  return 'power';
}

/** 세부 종류 → 이 종류를 측정하는 데 필요한 최소 점프 횟수(진행률 표시·버튼 활성화용). */
export function requiredJumpsFor(subType) {
  const meta = JUMP_SUBTYPES[subType];
  if (!meta) return 1;
  if (meta.engine !== 'reactive') return 1;
  return meta.minCycles || DEFAULT_REACTIVE_MIN_CYCLES;
}

/** 세부 종류 → RSI_TUNING.minCycles 대신 쓸 override(reactive 엔진 전용). 없으면 null(기존값 사용). */
export function minCyclesOverrideFor(subType) {
  const meta = JUMP_SUBTYPES[subType];
  if (!meta || meta.engine !== 'reactive') return null;
  return meta.minCycles || null;
}

/** 세부 종류 표시 라벨(모르는 값·미지정이면 CMJ로 안전 폴백). */
export function labelOf(subType) {
  return JUMP_SUBTYPES[subType]?.label || JUMP_SUBTYPES.cmj.label;
}
