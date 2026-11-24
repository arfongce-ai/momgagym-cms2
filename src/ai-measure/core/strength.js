// ai-measure/core/strength.js
// 근력 추정 공식 (순수 함수, 단위 테스트 가능)

export const LIFTS = [
  { key: 'bench',    label: '벤치프레스' },
  { key: 'squat',    label: '스쿼트' },
  { key: 'deadlift', label: '데드리프트' },
];

// ───────── 검증된 1RM 추정 공식들 ─────────
// 출처: Haff & Dumke, Laboratory Manual for Exercise Physiology (2018).
//  w = 든 무게(kg), r = 반복 횟수(RTF). 각 공식은 1RM(kg)을 반환.
export const RM_FORMULAS = [
  { key: 'epley',    label: 'Epley',     fn: (w, r) => w * (1 + r / 30) },
  { key: 'brzycki',  label: 'Brzycki',   fn: (w, r) => w * 36 / (37 - r) },
  { key: 'adams',    label: 'Adams',     fn: (w, r) => w / (1 - 0.02 * r) },
  { key: 'brown',    label: 'Brown',     fn: (w, r) => (r * 0.0338 + 0.9849) * w },
  { key: 'mayhew',   label: 'Mayhew',    fn: (w, r) => w / (0.522 + 0.419 * Math.exp(-0.055 * r)) },
  { key: 'oconner',  label: "O'Conner",  fn: (w, r) => 0.025 * (w * r) + w },
  { key: 'reynolds', label: 'Reynolds',  fn: (w, r) => w / (0.551 * Math.exp(-0.0723 * r) + 0.4847) },
  // [교재 8.x 추가 2026-11-24] 교재(Haff & Dumke) 벤치·레그프레스 표의 나머지 두 식. 평균에는 넣지 않고(refOnly) 비교용으로만 보여 준다.
  //  · Berger: 교재 표기 그대로(1/(1.0261−0.00262×r)). 10회 미만에서는 든 무게보다 작게 나와 '제외'가 뜬다 — 인쇄 오류 가능성이 있어 평균에서 뺐다(원문 확인 못 함).
  //  · Cummings&Finn: 교재 본문(단계 23)엔 1.175 계수가 없고 자료 기록지엔 있다 → 기록지 쪽(1.175×든 무게)을 썼다.
  { key: 'berger',   label: 'Berger',    refOnly: true, fn: (w, r) => w / (1.0261 - 0.00262 * r) },
  { key: 'cummings', label: 'Cummings·Finn', refOnly: true, fn: (w, r) => 1.175 * w + 0.839 * r - 4.29787 },
];

// ───────── 교재 반복최대(RM) 테스트 계획 ─────────
//  Haff & Dumke 실험 11.6/11.7: 테스트 세트 = 1RM의 87%. 준비 세트 3개는 테스트 세트 무게의 50%·70%·90%로 6회씩, 세트 사이 3분 휴식.
//  테스트 세트는 가능한 만큼(실패까지) 반복. 10회 미만이면 종료·기록, 10회를 넘으면 2.5~5% 올려 3분 쉰 뒤 다시.
export const RM_TEST_PCT = 87;
export const RM_WARMUP_PCTS = [50, 70, 90];
export const RM_WARMUP_REPS = 6;
export const RM_REST_SEC = 180;
const roundTo = (x, step = 2.5) => Math.round(x / step) * step;
export function rmTestPlan(oneRm) {
  const base = Number(oneRm);
  if (!Number.isFinite(base) || base <= 0) return null;
  const testKg = roundTo(base * RM_TEST_PCT / 100);
  return {
    oneRm: base,
    testKg,
    sets: [
      ...RM_WARMUP_PCTS.map((pct, i) => ({ key: `w${i + 1}`, label: `준비 ${i + 1}세트`, pct, kg: roundTo(testKg * pct / 100), reps: RM_WARMUP_REPS, restSec: RM_REST_SEC })),
      { key: 'test', label: '테스트 세트', pct: RM_TEST_PCT, kg: testKg, reps: null, restSec: RM_REST_SEC },
    ],
  };
}
// 테스트 세트 결과 → 다음 행동. 10회 미만(10회 포함)이면 종료, 초과면 2.5~5% 증량 후 재시도.
export function rmNextStep(weightKg, reps) {
  const w = Number(weightKg), r = Number(reps);
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(r) || r < 1) return null;
  if (r <= 10) return { done: true, note: `${r}회 — 10회 이내라 이 기록으로 1RM을 예측합니다.` };
  return { done: false, lowKg: roundTo(w * 1.025, 0.5), highKg: roundTo(w * 1.05, 0.5), note: `${r}회 — 10회를 넘었습니다. 3분 쉬고 2.5~5% 올려 다시 하세요.` };
}

const r1 = (x) => Math.round(x * 10) / 10;

function summarizeFormulaStats(formulas, average) {
  const values = (Array.isArray(formulas) ? formulas : [])
    .filter(f => !f.refOnly)
    .map(f => Number(f.value))
    .filter(v => Number.isFinite(v));
  const n = values.length;
  const avg = Number(average);
  if (!n || !Number.isFinite(avg)) {
    return {
      count: 0,
      min: null,
      max: null,
      spreadKg: null,
      spreadPct: null,
      sdKg: null,
      cvPct: null,
      confidenceInterval: { low: null, high: null },
      confidenceLevel: 'unknown',
    };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min;
  const variance = values.reduce((sum, v) => sum + ((v - avg) ** 2), 0) / n;
  const sd = Math.sqrt(variance);
  const sem = n > 1 ? sd / Math.sqrt(n) : 0;
  const margin = n > 1 ? 1.96 * sem : 0;
  const spreadPct = avg > 0 ? (spread / avg) * 100 : null;
  const cvPct = avg > 0 ? (sd / avg) * 100 : null;
  const confidenceLevel = spreadPct == null
    ? 'unknown'
    : spreadPct <= 5 ? 'high'
      : spreadPct <= 10 ? 'medium'
        : 'low';

  return {
    count: n,
    min: r1(min),
    max: r1(max),
    spreadKg: r1(spread),
    spreadPct: spreadPct == null ? null : r1(spreadPct),
    sdKg: r1(sd),
    cvPct: cvPct == null ? null : r1(cvPct),
    confidenceInterval: {
      low: r1(Math.max(0, avg - margin)),
      high: r1(avg + margin),
    },
    confidenceLevel,
  };
}

/**
 * 1RM 추정. 든 무게(weight)와 반복횟수(reps)로 최대 1회 무게를 추정.
 * 검증된 여러 공식을 동시에 계산하고 평균(대표값)을 낸다.
 * reps=1 이면 그 무게가 곧 1RM.
 * @returns {{ average:number, formulas:Array<{key,label,value}>,
 *             epley:number, brzycki:number }}
 */
export function estimate1RM(weight, reps) {
  const w = Number(weight), r = Number(reps);
  if (r === 1) {
    const formulas = RM_FORMULAS.map(f => ({ key: f.key, label: f.label, value: w, ...(f.refOnly ? { refOnly: true } : {}) }));
    const average = r1(w);
    const stats = summarizeFormulaStats(formulas, average);
    return {
      average,
      formulas,
      epley: r1(w),
      brzycki: r1(w),
      stats,
      confidenceInterval: stats.confidenceInterval,
      formulaSpreadKg: stats.spreadKg,
      formulaSpreadPct: stats.spreadPct,
    };
  }
  const formulas = RM_FORMULAS.map(f => {
    let v = f.fn(w, r);
    // 1RM 추정치는 반드시 든 무게(w) 이상이어야 한다. 분모 0/음수 등으로
    // 비물리적 값이 나오면(예: Brzycki 의 r≥37) 평균을 왜곡하지 않도록 제외 표시.
    const ok = isFinite(v) && v >= w;
    return { key: f.key, label: f.label, value: ok ? r1(v) : null, excluded: !ok, ...(f.refOnly ? { refOnly: true } : {}) };
  });
  const used = formulas.filter(f => f.value != null && !f.refOnly);
  const avg = used.length
    ? used.reduce((s, f) => s + f.value, 0) / used.length
    : w;
  const get = (k) => formulas.find(f => f.key === k)?.value;
  const average = r1(avg);
  const stats = summarizeFormulaStats(formulas, average);
  return {
    average,
    formulas,
    epley: get('epley'),
    brzycki: get('brzycki'),
    stats,
    confidenceInterval: stats.confidenceInterval,
    formulaSpreadKg: stats.spreadKg,
    formulaSpreadPct: stats.spreadPct,
  };
}

/**
 * 목표 1RM 대비 특정 %강도의 훈련 무게 (2.5kg 단위 반올림).
 */
export function workingWeight(oneRM, pct) {
  return Math.round((oneRM * pct / 100) / 2.5) * 2.5;
}

// 1RM 측정 기준 횟수 (동규님 지침: 3회·5회)
export const REP_PRESETS = [3, 5];

// 반복횟수 ↔ %1RM 표준표 (Strength Training 2nd Ed., Table 5.1)
//  무거운 부하(10회 이내)에서 추정 정확도가 높다.
export const RM_PERCENT_TABLE = {
  1: 100, 2: 95, 3: 93, 4: 90, 5: 87, 6: 85,
  7: 83, 8: 80, 9: 77, 10: 75, 11: 70, 12: 67, 15: 65,
};

/** 특정 반복횟수에 해당하는 %1RM (표에 없으면 보간) */
export function repPercent(reps) {
  const r = Number(reps);
  if (RM_PERCENT_TABLE[r] != null) return RM_PERCENT_TABLE[r];
  // 선형 보간(표 범위 밖이면 가장 가까운 값)
  const keys = Object.keys(RM_PERCENT_TABLE).map(Number).sort((a, b) => a - b);
  if (r <= keys[0]) return RM_PERCENT_TABLE[keys[0]];
  if (r >= keys[keys.length - 1]) return RM_PERCENT_TABLE[keys[keys.length - 1]];
  for (let i = 0; i < keys.length - 1; i++) {
    if (r >= keys[i] && r <= keys[i + 1]) {
      const t = (r - keys[i]) / (keys[i + 1] - keys[i]);
      return Math.round(RM_PERCENT_TABLE[keys[i]] + t * (RM_PERCENT_TABLE[keys[i + 1]] - RM_PERCENT_TABLE[keys[i]]));
    }
  }
  return 100;
}

/**
 * 추정 1RM 으로부터 표준표 기반 3회·5회 목표 무게(참고용).
 * 회원마다 실제값은 다르므로 측정 기록을 우선한다.
 */
export function repTargets(oneRM, reps = REP_PRESETS) {
  return reps.map(r => ({
    reps: r,
    pct: repPercent(r),
    weight: Math.round((oneRM * repPercent(r) / 100) / 2.5) * 2.5,
  }));
}
