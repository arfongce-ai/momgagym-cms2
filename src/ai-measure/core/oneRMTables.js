// ai-measure/core/oneRMTables.js
// ════════════════════════════════════════════════════════════════════════
//  1RM 훈련 부하 처방 기준표 (순수 데이터·함수)
//  출처: 「NSCA-CPT, CSCS 대비 트레이닝의 정수」 제17장 저항훈련을 위한 프로그램 설계
//   · 표 17.7  %1RM ↔ 최대반복횟수
//   · 표 17.8  1RM·훈련부하 추정 = 표 17.7 의 % 를 부하에 곱한 값 → 코드에서 계산(표를 옮겨 적지 않는다)
//   · 표 17.9  훈련 목표별 부하(%1RM)·목표 반복횟수
//   · 표 17.10 운동 부하 증가 예
//  기존 strength.js 의 RM_PERCENT_TABLE(Strength Training 2nd Ed. 표 5.1)과 같은 값이며,
//  교재 표 17.7 에 있는 11회=70% 가 빠져 있어 함께 보강했다.
// ════════════════════════════════════════════════════════════════════════

export const ONERM_TABLE_SOURCE = 'NSCA-CPT·CSCS 대비 트레이닝의 정수 표 17.7·17.9·17.10';

/** 표 17.7: 최대반복횟수 → %1RM */
export const PCT_BY_REPS = {
  1: 100, 2: 95, 3: 93, 4: 90, 5: 87, 6: 85, 7: 83, 8: 80, 9: 77, 10: 75, 11: 70, 12: 67, 15: 65,
};

/** 표 17.9: 훈련 목표별 부하와 목표 반복횟수. min/max 가 null 이면 그쪽은 제한 없음. */
export const TRAINING_GOALS = [
  { key: 'strength', label: '근력', pctMin: 85, pctMax: null, repsMin: null, repsMax: 6,
    pctText: '85% 이상', repsText: '6회 이하', note: '근력 부하는 주요 운동에만 적용합니다. 보조 운동은 8RM보다 무겁게 하지 않습니다.' },
  { key: 'power_single', label: '순발력(1회 수행 종목)', pctMin: 80, pctMax: 90, repsMin: 1, repsMax: 2,
    pctText: '80~90%', repsText: '1~2회', note: '클린·스내치 같은 역도 파생 동작 기준입니다. 이 반복 횟수는 %1RM-반복 관계와 일치하지 않습니다.' },
  { key: 'power_multi', label: '순발력(다반복 종목)', pctMin: 75, pctMax: 85, repsMin: 3, repsMax: 5,
    pctText: '75~85%', repsText: '3~5회', note: '클린·스내치 같은 역도 파생 동작 기준입니다. 이 반복 횟수는 %1RM-반복 관계와 일치하지 않습니다.' },
  { key: 'hypertrophy', label: '근비대', pctMin: 67, pctMax: 85, repsMin: 6, repsMax: 12,
    pctText: '67~85%', repsText: '6~12회', note: '' },
  { key: 'endurance', label: '근지구력', pctMin: null, pctMax: 67, repsMin: 12, repsMax: null,
    pctText: '67% 이하', repsText: '12회 이상', note: '' },
];

/** 표 17.10: 훈련 부하를 올릴 때의 증량 폭(kg). 5~10회 × 3세트 프로그램 기준. */
export const LOAD_INCREASE = {
  weak: { label: '작음·약함·훈련이 부족함', upper: [1, 2], lower: [2, 4] },
  strong: { label: '큼·강함·잘 훈련됨', upper: [2, 4], lower: [4, 7], openEnded: true },
};

const ROUND_KG = 2.5;
const roundKg = (x, step = ROUND_KG) => Math.round(x / step) * step;

/** 반복횟수 → %1RM (표에 없는 횟수는 null) */
export function pctForReps(reps) {
  const v = PCT_BY_REPS[Number(reps)];
  return v == null ? null : v;
}

/** %1RM → 해당하는 최대반복횟수(표에서 가장 가까운 %, 같은 거리면 적은 횟수) */
export function repsForPct(pct) {
  const p = Number(pct);
  if (!Number.isFinite(p)) return null;
  let best = null;
  for (const [reps, v] of Object.entries(PCT_BY_REPS)) {
    const d = Math.abs(v - p);
    if (!best || d < best.d || (d === best.d && Number(reps) < best.reps)) best = { reps: Number(reps), d };
  }
  return best ? best.reps : null;
}

/** 표 17.8 계산판: 추정 1RM → 반복횟수별 %와 무게(kg, 소수 1자리) */
export function weightByRepsTable(oneRM) {
  const w = Number(oneRM);
  if (!(w > 0)) return [];
  return Object.entries(PCT_BY_REPS).map(([reps, pct]) => ({
    reps: Number(reps), pct, kg: Math.round((w * pct) / 10) / 10,
  }));
}

/** 표 17.8 역방향: 든 무게와 반복횟수로 1RM 추정(= 무게 ÷ %). 표에 없는 횟수는 null. */
export function oneRMFromTable(weightKg, reps) {
  const pct = pctForReps(reps);
  const w = Number(weightKg);
  if (pct == null || !(w > 0)) return null;
  return Math.round((w / pct) * 1000) / 10;
}

/** 목표별 훈련 부하 처방(표 17.9 × 추정 1RM). kg 는 2.5kg 단위로 반올림한다. */
export function trainingPrescription(oneRM, { step = ROUND_KG } = {}) {
  const w = Number(oneRM);
  if (!(w > 0)) return [];
  return TRAINING_GOALS.map((g) => {
    const kgLow = g.pctMin != null ? roundKg((w * g.pctMin) / 100, step) : null;
    const kgHigh = g.pctMax != null ? roundKg((w * g.pctMax) / 100, step) : null;
    let kgText;
    if (kgLow != null && kgHigh != null) kgText = `${kgLow}~${kgHigh}kg`;
    else if (kgLow != null) kgText = `${kgLow}kg 이상`;
    else kgText = `${kgHigh}kg 이하`;
    return { key: g.key, label: g.label, pctText: g.pctText, repsText: g.repsText, kgLow, kgHigh, kgText, note: g.note };
  });
}

/** 부하 증가 폭 문구. level: 'weak'|'strong', region: 'upper'|'lower' */
export function loadIncreaseText(level, region) {
  const row = LOAD_INCREASE[level];
  if (!row || !row[region]) return '';
  const [a, b] = row[region];
  return `${a}~${b}${row.openEnded ? '+' : ''}kg`;
}
