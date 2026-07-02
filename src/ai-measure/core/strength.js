// ai-measure/core/strength.js
// 근력 추정 공식 (순수 함수, 단위 테스트 가능)
import { median } from './lifting';

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
];

const r1 = (x) => Math.round(x * 10) / 10;

/**
 * 개선 7: 반복횟수(reps)가 늘수록 공식 간 추정치가 서로 벌어진다는 사실은
 * 잘 알려져 있다(브르지키·Adams 등 일부 공식은 분모가 0에 가까워지며
 * 특히 불안정해짐 — 이미 위에서 "비물리적 값 제외"로 다루는 것과 같은 현상의
 * 완만한 버전). 특정 공식이 특정 "종목"에 더 정확하다는 주장은 문헌마다
 * 편차가 커 이 프로젝트가 검증된 근거로 채택하기 어렵다고 판단했다 —
 * 대신 통계적으로 방어 가능한 robust(이상치 완화) 평균을 추가한다:
 *  이번 reps에서 그룹 중앙값(median)에서 많이 벗어난 공식일수록 가중치를
 *  낮춘다. 어떤 공식이 "나쁘다"고 미리 정하지 않고, 매 계산마다 그때
 *  중앙값과 먼 공식만 자동으로 덜 반영 — 근거기반 원칙에 더 맞는다.
 */
function robustWeight(value, med) {
  if (!med) return 1;
  const relDist = Math.abs(value - med) / med;
  return 1 / (1 + relDist * 4); // 중앙값에서 25% 벗어나면 가중치 절반 수준
}

/**
 * 1RM 추정. 든 무게(weight)와 반복횟수(reps)로 최대 1회 무게를 추정.
 * 검증된 여러 공식을 동시에 계산하고 평균(대표값)을 낸다.
 * reps=1 이면 그 무게가 곧 1RM.
 * @returns {{ average:number, robustAverage:number, median:number,
 *             formulas:Array<{key,label,value,weight}>, epley:number, brzycki:number }}
 */
export function estimate1RM(weight, reps) {
  const w = Number(weight), r = Number(reps);
  if (r === 1) {
    const formulas = RM_FORMULAS.map(f => ({ key: f.key, label: f.label, value: w, weight: 1 }));
    return { average: r1(w), robustAverage: r1(w), median: r1(w), formulas, epley: r1(w), brzycki: r1(w) };
  }
  const formulas = RM_FORMULAS.map(f => {
    let v = f.fn(w, r);
    // 1RM 추정치는 반드시 든 무게(w) 이상이어야 한다. 분모 0/음수 등으로
    // 비물리적 값이 나오면(예: Brzycki 의 r≥37) 평균을 왜곡하지 않도록 제외 표시.
    const ok = isFinite(v) && v >= w;
    return { key: f.key, label: f.label, value: ok ? r1(v) : null, excluded: !ok };
  });
  const used = formulas.filter(f => f.value != null);
  const avg = used.length
    ? used.reduce((s, f) => s + f.value, 0) / used.length
    : w;
  const med = median(used.map(f => f.value)) ?? avg;
  // robust 가중 평균 — 위 robustWeight()로 이상치 공식의 영향을 완화.
  used.forEach(f => { f.weight = Math.round(robustWeight(f.value, med) * 100) / 100; });
  formulas.forEach(f => { if (f.value == null) f.weight = 0; });
  const wSum = used.reduce((s, f) => s + f.weight, 0);
  const robustAvg = wSum
    ? used.reduce((s, f) => s + f.value * f.weight, 0) / wSum
    : avg;
  const get = (k) => formulas.find(f => f.key === k)?.value;
  return {
    average: r1(avg),
    robustAverage: r1(robustAvg),
    median: med != null ? r1(med) : null,
    formulas,
    epley: get('epley'),
    brzycki: get('brzycki'),
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
  7: 83, 8: 80, 9: 77, 10: 75, 12: 67, 15: 65,
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
