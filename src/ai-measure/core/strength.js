// ai-measure/core/strength.js
// 근력 추정 공식 (순수 함수, 단위 테스트 가능)

export const LIFTS = [
  { key: 'bench',    label: '벤치프레스' },
  { key: 'squat',    label: '스쿼트' },
  { key: 'deadlift', label: '데드리프트' },
];

/**
 * 1RM 추정. 든 무게(weight)와 반복횟수(reps)로 최대 1회 무게를 추정.
 *  - Epley:   1RM = w * (1 + reps/30)
 *  - Brzycki: 1RM = w * 36 / (37 - reps)
 * reps=1 이면 그 무게가 곧 1RM.
 * @returns {{ epley:number, brzycki:number, average:number }}
 */
export function estimate1RM(weight, reps) {
  if (reps === 1) {
    return { epley: weight, brzycki: weight, average: weight };
  }
  const epley = weight * (1 + reps / 30);
  const brzycki = weight * 36 / (37 - reps);
  const r1 = (x) => Math.round(x * 10) / 10;
  return {
    epley: r1(epley),
    brzycki: r1(brzycki),
    average: r1((epley + brzycki) / 2),
  };
}

/**
 * 목표 1RM 대비 특정 %강도의 훈련 무게 (2.5kg 단위 반올림).
 */
export function workingWeight(oneRM, pct) {
  return Math.round((oneRM * pct / 100) / 2.5) * 2.5;
}
