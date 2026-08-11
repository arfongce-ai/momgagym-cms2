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
};

// 화면에 보여줄 순서(선택 칩·가이드 카드 등에서 공통으로 사용).
export const JUMP_SUBTYPE_ORDER = ['cmj', 'sj', 'dj', 'slj', 'rsi'];

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

/** 세부 종류 → 계산 엔진('power'|'reactive'). 모르는 값이면 안전하게 'power'. */
export function engineOf(subType) {
  return JUMP_SUBTYPES[subType]?.engine === 'reactive' ? 'reactive' : 'power';
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
