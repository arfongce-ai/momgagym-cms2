// VBT 결과를 "그래서 뭘 하라는 거야?"에 답하는 쉬운 3단 요약으로 바꾼다. (순수 함수, 측정값에서만 도출)
//  ① 결론 한 줄  ② 이 숫자의 뜻  ③ 잘한 점·부족한 점  ④ 다음에 할 일
// 값이 없으면 해당 문장을 만들지 않는다(추측 금지). 문턱은 barbellClinical/lifting 의 기존 기준을 그대로 쓴다.
import { pickMetrics } from './barbellClinical';
import { vbtZonePurpose, exerciseLabel } from './lifting';
import { BARBELL_TUNING } from './barbellBiomechanics';
import { isOlyType } from './olyLiftAnalysis';

const ok = (v) => Number.isFinite(v);

const ZONE_PLAIN = {
  '스피드·파워': { meaning: '가볍고 아주 빠르게 든 상태입니다. 힘보다 "속도"를 기르는 훈련 구간입니다.', next: '스피드·파워가 목표라면 지금 무게가 맞습니다. 목표가 근력이라면 무게를 올리세요.' },
  '근파워': { meaning: '꽤 빠르게 든 상태입니다. 순간적으로 내는 힘(파워)이 가장 잘 나오는 구간입니다.', next: '파워가 목표라면 이 무게로 3~5회씩 빠르게 반복하세요.' },
  '근력·파워': { meaning: '힘과 속도를 같이 쓰는 중간 무게입니다.', next: '근력과 파워를 같이 기르는 데 좋은 무게입니다. 3~6회로 속도를 지키며 하세요.' },
  '근비대·근력': { meaning: '적당히 무거운 무게입니다. 근육을 키우고 기초 근력을 쌓는 구간입니다.', next: '근육 키우기가 목표라면 이 무게로 6~10회, 속도가 많이 느려지기 전에 세트를 끝내세요.' },
  '최대근력': { meaning: '무겁게 들어서 천천히 올라온 상태입니다. 최대근력을 기르는 고중량 구간입니다(느린 것이 정상).', next: '최대근력이 목표라면 1~5회, 세트 사이를 충분히(3분 이상) 쉬세요. 속도 자체를 올리고 싶다면 무게를 20~30% 낮춰 빠르게 드세요.' },
};

export function buildVbtPlainSummary(report = {}) {
  const M = pickMetrics(report);
  const exLabel = exerciseLabel(report.exerciseType);
  const oly = isOlyType(report.exerciseType);
  const good = []; const lack = []; const todo = [];

  const zone = ok(M.meanVelocity) ? vbtZonePurpose(M.meanVelocity) : null;
  const zp = zone ? ZONE_PLAIN[zone.label] : null;
  let meaning = null;
  if (ok(M.meanVelocity) && zp) {
    meaning = oly
      ? `평균속도 ${M.meanVelocity}m/s — 역도(클린·스내치)는 바를 순간적으로 던지듯 올려서 이 속도는 참고용입니다. 속도보다 바가 어디로 움직였는지(궤적)를 먼저 보세요.`
      : `평균속도 ${M.meanVelocity}m/s는 "${zone.label}" 구간입니다. ${zp.meaning}`;
    if (!oly) todo.push(zp.next);
  }

  // 속도 저하(세트 안에서 얼마나 지쳤나)
  if (ok(M.velocityLoss) && M.velocityLoss >= 0) {
    const B = BARBELL_TUNING.velocityLossBands;
    if (M.velocityLoss <= B.fresh) good.push(`세트 동안 속도가 거의 안 떨어졌습니다(${M.velocityLoss}%). 아직 여유가 있다는 뜻이라 무게를 조금 올려도 됩니다.`);
    else if (M.velocityLoss <= B.strength) good.push(`속도가 ${M.velocityLoss}%만 떨어졌습니다. 근력 훈련에 알맞은 피로도입니다.`);
    else if (M.velocityLoss <= B.hypertrophy) { lack.push(`마지막 렙으로 갈수록 속도가 ${M.velocityLoss}% 느려졌습니다(꽤 지침).`); todo.push('파워·스피드가 목표라면 속도가 20% 떨어지기 전에 세트를 끝내세요.'); }
    else { lack.push(`속도가 ${M.velocityLoss}%나 떨어졌습니다. 많이 지친 상태입니다.`); todo.push('다음 세트는 무게를 5~10% 낮추거나 렙 수를 줄이세요.'); }
  }

  // 렙 일관성
  if (ok(M.consistencyCvPct)) {
    if (M.consistencyCvPct <= 12) good.push(`렙마다 속도가 비슷했습니다(편차 ${M.consistencyCvPct}%). 동작이 안정적입니다.`);
    else { lack.push(`렙마다 속도가 들쭉날쭉했습니다(편차 ${M.consistencyCvPct}%). 어떤 렙은 힘주고 어떤 렙은 못 줬다는 뜻입니다.`); todo.push('무게를 약간 낮추고, 매 렙을 같은 리듬(내리기→바로 올리기)으로 하세요.'); }
  }

  // 바 궤적
  const drift = Number(M.barPath?.maxDriftCm); const eff = Number(M.barPath?.avgEfficiency);
  if (ok(drift)) {
    if (drift <= 4) good.push(`바가 거의 수직으로 움직였습니다(좌우 흔들림 ${drift}cm).`);
    else if (drift <= 8) { lack.push(`바가 옆으로 최대 ${drift}cm 벗어났습니다(보통).`); todo.push('바가 몸 가까이에서 올라오도록 겨드랑이를 조이고 시선을 고정하세요.'); }
    else { lack.push(`바가 옆으로 최대 ${drift}cm나 벗어났습니다. 힘이 새고 있습니다.`); todo.push(oly ? '바를 몸 가까이 붙여 당기세요(무릎 지나서도 바가 허벅지에서 멀어지지 않게).' : '바가 몸에서 멀어지지 않게 무게를 낮추고 궤적부터 다시 잡으세요.'); }
  }
  if (ok(eff) && eff > 0 && eff < 0.75) lack.push(`바가 곧게 올라가지 못하고 돌아서 갔습니다(효율 ${Math.round(eff * 100)}%).`);

  // 측정 신뢰도·렙 수
  if (ok(M.reps) && M.reps < 3 && !oly) lack.push(`반복이 ${M.reps}회라 속도 변화를 보기엔 적습니다.`);
  if (ok(M.confidenceScore) && M.confidenceScore < 0.6) { lack.push('측정 신뢰도가 낮습니다(전신이 안 보였거나 촬영 위치가 맞지 않았을 수 있음).'); todo.push('전신이 다 보이게 옆에서(바벨 리프팅은 측면 권장) 다시 촬영하세요.'); }

  const headline = !ok(M.meanVelocity) && !good.length && !lack.length
    ? '요약할 측정값이 부족합니다. 2회 이상 반복해서 다시 측정해 주세요.'
    : lack.length === 0
      ? `${exLabel}: 큰 문제 없이 잘 수행했습니다.`
      : `${exLabel}: ${lack.length}가지를 보완하면 좋습니다.`;

  if (!todo.length && good.length) todo.push('지금 방식 그대로 유지하고, 다음 회차에 같은 조건으로 측정해 변화를 비교하세요.');
  return { headline, meaning, good, lack, todo };
}
