// patternInsights.js — 측정값 → '자세·움직임 패턴 경향' 해석 자료 (2026-10)
//
// 원칙
//  · 진단하지 않는다. 문구는 모두 "~경향이 관찰됩니다 / ~하는 경우가 많습니다" 수준.
//  · 근육 상태(짧음/약함)는 영상으로 확인한 것이 아니라 교과서가 설명하는 일반 패턴이다.
//  · 모든 항목에 출처(책+위치)와 근거 수준을 붙인다. 쪽수는 책 텍스트에서 찾은 위치 기준이라 ±1쪽 오차가 있을 수 있다.
//  · 패턴이 나타나는 조건은 리포트에 이미 표시된 지표 판정(주의/위험)을 그대로 쓴다 — 별도 임계값을 새로 만들지 않는다.
//  · 트레이너가 확인한 뒤 회원에게 전달하는 자료다(화면에 '트레이너 확인용' 표시).
//  · 앱이 직접 재지 못하는 패턴(예: 골반 앞기울임, 요추 전만)은 넣지 않는다.

export const EVIDENCE = Object.freeze({
  textbook: '교과서 기술',
  concept: '임상 개념(Janda 등, 연구 검증은 제한적)',
  data: '건강인 측정 자료',
});

const MAGEE = 'Magee, Orthopedic Physical Assessment';
const NASM = 'NASM, Essentials of Corrective Exercise Training';
const MYERS = '근막경선 해부학(Myers, Anatomy Trains 번역서)';
const KENDALL = 'Kendall류 자세와 통증치료에 있어서 근육의 기능과 검사(번역서)';

export const PATTERN_LIBRARY = Object.freeze([
  {
    key: 'forward_head_upper_crossed',
    measures: { posture: 'forwardHead' },
    title: '머리가 앞으로 나온 자세 · 상부 교차 경향',
    observation: '머리가 어깨선보다 앞에 놓이는 경향이 보입니다. 이런 자세가 오래 이어지면 목 앞쪽 깊은 근육은 약해지고 어깨 주변 근육은 짧아지는 경우가 많습니다.',
    shortMuscles: ['상부 승모근', '견갑거근', '큰가슴근·작은가슴근', '흉쇄유돌근'],
    weakMuscles: ['깊은 목 굴곡근', '능형근', '전거근', '하부 승모근'],
    suggestions: ['짧아진 근육은 스트레칭, 약해진 근육은 강화하는 방향으로 구성', '장시간 앉아 있거나 화면을 보는 자세 습관 점검', '구체적인 운동은 트레이너가 회원 상태에 맞게 선택'],
    caution: '두통·팔 저림·방사통이 있으면 운동 전에 전문가 상담을 권합니다.',
    sources: [
      { book: MAGEE, where: '3장 경추 p.163–164, Fig 3-16 (상부 교차 증후군)' },
      { book: NASM, where: '6장 p.122 (머리가 앞으로 이동: 상부 승모근·흉쇄유돌근·견갑거근 과활성, 깊은 목 굴곡근 저활성)' },
    ],
    fascialLink: { text: '나선선의 가지선(가슴띠)이 머리 앞쪽 자세와 함께 긴장된다고 설명됩니다.', where: '6장 나선선 p.~180 (전방머리 자세와 가슴띠)' },
    evidence: 'concept',
  },
  {
    key: 'shoulder_level_difference',
    measures: { posture: 'shoulderHeightDiff' },
    title: '좌우 어깨 높이 차이 경향',
    observation: '좌우 어깨 높이에 차이가 보입니다. 우세측 어깨가 약간 낮은 것은 흔한 정상 변이입니다. 한쪽이 눈에 띄게 올라가 있다면 그쪽 목·어깨 근육의 긴장이 원인인 경우가 있습니다.',
    shortMuscles: ['(올라간 쪽) 상부 승모근', '(올라간 쪽) 견갑거근'],
    weakMuscles: [],
    suggestions: ['어깨가 올라간 쪽의 목·어깨 긴장 이완', '가방 메는 쪽·팔 쓰는 습관 확인', '다음 회차에도 같은 자세·거리로 찍어 변화 확인'],
    caution: '갑작스러운 변화나 통증이 동반되면 전문가 상담을 권합니다.',
    sources: [{ book: MAGEE, where: '3장 경추 p.163 (어깨 높이: 우세측이 약간 낮음, 손상 쪽은 상부 승모근·견갑거근으로 올라갈 수 있음)' }],
    fascialLink: { text: '외측선(몸 옆면)은 좌우 옆면의 균형을 맡는 선으로 설명되며, 좌우 높이 차이를 볼 때 함께 살펴볼 수 있습니다.', where: '5장 외측선 p.~147' },
    evidence: 'textbook',
  },
  {
    key: 'lateral_pelvic_level',
    measures: { posture: 'pelvisHeightDiff', jump: 'pelvicImbalance' },
    title: '좌우 골반 높이 차이 경향',
    observation: '좌우 골반 높이에 차이가 보입니다. 다리 길이 차이나 한쪽 고관절 주변 근육의 길이 차이와 함께 나타나는 경우가 있습니다. 작은 차이는 일반인에게도 흔합니다.',
    shortMuscles: ['(올라간 쪽 반대) 중둔근·대퇴근막장근', '허리 옆 근육(요방형근)'],
    weakMuscles: ['(내려간 쪽) 중둔근'],
    suggestions: ['줄자로 실제 다리 길이 차이 확인(영상만으로 판단하지 않기)', '엉덩이 옆 근육의 좌우 길이·힘 확인', '다음 회차에도 같은 조건으로 비교'],
    caution: '허리·엉덩이 통증이 함께 있으면 전문가 상담을 권합니다.',
    sources: [
      { book: KENDALL, where: '골반 측면 경사 설명(높은 쪽 고관절 내전·외전근 신장, 반대쪽 외전근·대퇴근막장근 단축)' },
      { book: MAGEE, where: '10장 고관절 p.~725 (다리 길이 차이 1~1.3cm는 정상), 15장 자세 평가' },
    ],
    fascialLink: { text: '외측선(몸 옆면)은 좌우 옆면의 균형을 맡는 선으로 설명되며, 좌우 높이 차이를 볼 때 함께 살펴볼 수 있습니다.', where: '5장 외측선 p.~147' },
    evidence: 'textbook',
  },
  {
    key: 'pelvic_drop_gait',
    measures: { gait: 'pelvicDrop' },
    title: '걸을 때 골반이 내려가는 경향',
    observation: '한 발로 버틸 때 반대쪽 골반이 내려가는 움직임이 보입니다. 엉덩이 옆 근육(중둔근)의 힘이 부족할 때 흔히 나타나는 패턴으로 설명됩니다.',
    shortMuscles: [],
    weakMuscles: ['중둔근(고관절 외전근)'],
    suggestions: ['한 발 서기·옆으로 걷기 등 중둔근 강화 운동', '통증이 있으면 먼저 원인 확인', '이전 회차와 비교해 변화 확인'],
    caution: '엉덩이·허리 통증이 있으면 전문가 상담을 권합니다.',
    sources: [{ book: MAGEE, where: '14장 보행 p.1003–1004 (Trendelenburg 보행: 반대쪽 골반 하강=중둔근 약화)' }],
    evidence: 'textbook',
  },
  {
    key: 'gait_side_difference',
    measures: { gait: 'kneeSymmetry' },
    title: '걸을 때 좌우 무릎 움직임 차이 경향',
    observation: '좌우 무릎 움직임에 차이가 보입니다. 한쪽에 통증이나 약화가 있으면 그쪽 보폭·체중 싣는 시간이 짧아지는 패턴이 설명되어 있습니다.',
    shortMuscles: [],
    weakMuscles: [],
    suggestions: ['통증·불편한 쪽이 있는지 확인', '한 다리 운동 시 좌우 수행 차이 점검', '같은 조건으로 재측정해 일관성 확인'],
    caution: '통증이 있으면 전문가 상담을 권합니다.',
    sources: [{ book: MAGEE, where: '14장 보행 p.1007 (통증성 보행: 아픈 쪽 보폭·입각 시간 감소)' }],
    evidence: 'textbook',
  },
  {
    key: 'rom_side_difference',
    measures: { rom: 'asymmetry' },
    title: '관절 가동범위 좌우 차이 경향',
    observation: '좌우 가동범위 차이가 보입니다. 건강한 성인의 엉덩관절·무릎·발목은 좌우 평균 차이가 거의 없어(약 0.4° 이내), 눈에 띄는 차이는 확인해 볼 만한 신호입니다. 다만 기준 값 자체는 참고용입니다.',
    shortMuscles: [],
    weakMuscles: [],
    suggestions: ['제한이 있는 쪽의 근육 길이·관절 움직임 확인', '통증 동반 여부 확인', '같은 방법으로 재측정해 변화 확인'],
    caution: '통증·저림이 있거나 갑자기 생긴 제한이면 전문가 상담을 권합니다.',
    sources: [
      { book: 'Acta Orthopaedica, 건강인 엉덩관절·무릎·발목 ROM 좌우 비교(약 100명)', where: '좌우 평균 차이 -0.3~+0.4°, 유의차 없음' },
      { book: MAGEE, where: '측정 시 건측과 비교 원칙' },
    ],
    evidence: 'data',
  },
  {
    key: 'deceleration_control',
    measures: { sprint: 'decelTime' },
    title: '멈추는 데 시간이 오래 걸리는 경향',
    observation: '방향을 바꾸거나 멈추는 구간의 감속에 시간이 많이 걸리는 경향이 보입니다. 감속에는 근육이 늘어나면서 힘을 내는 능력(원심성 힘)이 중요하다고 설명됩니다.',
    shortMuscles: [],
    weakMuscles: ['대퇴사두근·둔근의 원심성(늘어나며 버티는) 힘'],
    suggestions: ['천천히 내려가며 버티는 하체 운동', '멈추는 동작 연습(체중 받아내기)', '같은 거리 설정으로 회차 비교'],
    caution: '',
    sources: [{ book: 'Training for Sports Speed and Agility: An Evidence-Based Approach', where: '방향전환·감속은 원심성 근력 요구가 큼(p.~2267 부근 서술)' }],
    evidence: 'textbook',
  },
]);

const ACTIVE = new Set(['caution', 'risk']);

/**
 * @param {string} measure 'posture'|'gait'|'jump'|'sprint'|'rom'
 * @param {Array}  keyMetrics unifiedReport.extractKeyMetrics 결과
 * @returns {Array} 조건에 맞는 패턴(관찰 지표 정보 포함)
 */
export function buildPatternInsights(measure, keyMetrics = []) {
  const byKey = new Map((keyMetrics || []).map((m) => [m.key, m]));
  const out = [];
  for (const p of PATTERN_LIBRARY) {
    const metricKey = p.measures?.[measure];
    if (!metricKey) continue;
    const m = byKey.get(metricKey);
    if (!m || !ACTIVE.has(m.status?.key)) continue;
    out.push({ ...p, trigger: { key: metricKey, label: m.label, value: m.value, unit: m.unit, status: m.status.key } });
  }
  return out;
}
