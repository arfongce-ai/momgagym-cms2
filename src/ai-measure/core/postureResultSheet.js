// [자세 결과시트 UI 2026-11-15]
// motiphysio·exbody 결과지처럼 "항목별 눈금 막대 + 먼저 볼 3가지"를 그리기 위한
// 순수 계산 모듈. 새 측정값은 만들지 않는다 — postureMath.js가 이미 계산해 둔
// 값을 꺼내 postureClinical.js·POSTURE_THRESHOLDS와 똑같은 기준으로 단계만 매긴다
// (같은 값이 화면 위치마다 다른 판정을 받지 않도록 기준을 새로 정의하지 않음).
import { POSTURE_THRESHOLDS } from './postureMath';
import { genderThreshold, qAngleDeviation, worseAbsMm, buildMuscleMap } from './postureClinical';

export const SHEET_LEVEL = Object.freeze({ normal: 'normal', caution: 'caution', risk: 'risk' });
const RANK = { risk: 2, caution: 1, normal: 0 };

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function pickView(perView, keys) {
  for (const k of keys) if (perView?.[k]) return perView[k];
  return null;
}

export function levelOf(value, caution, risk) {
  if (value == null) return null;
  if (value >= risk) return SHEET_LEVEL.risk;
  if (value >= caution) return SHEET_LEVEL.caution;
  return SHEET_LEVEL.normal;
}

// 지표 정의 — region 은 postureClinical.buildRegionDiagnoses 의 key 와 같다
// (근육 경향은 buildMuscleMap 을 그대로 재사용해 문구를 한 곳에서만 관리).
const DEFS = [
  {
    key: 'forward_head', label: '거북목', view: '측면', unit: 'mm', region: 'head_neck',
    plain: '귀가 어깨선보다 앞으로 나온 거리',
    read: (pv) => {
      const side = pickView(pv, ['left', 'right']);
      const v = num(side?.sagittal?.forwardHeadMm);
      return v == null ? null : { value: Math.abs(v) };
    },
    thresholds: () => POSTURE_THRESHOLDS.forwardHeadMm,
  },
  {
    key: 'kyphosis', label: '굽은 등', view: '측면', unit: '°', region: 'shoulder_back',
    plain: '귀-어깨-골반을 이은 선이 곧은 선(180°)에서 굽은 정도',
    read: (pv) => {
      const side = pickView(pv, ['left', 'right']);
      const v = num(side?.sagittal?.kyphosisProxyDeg);
      return v == null ? null : { value: Math.max(0, 180 - v) };
    },
    thresholds: () => POSTURE_THRESHOLDS.kyphosisDevDeg,
  },
  {
    key: 'shoulder_height', label: '어깨 높이 차이', view: '정면·후면', unit: 'mm', region: 'shoulder_back',
    plain: '좌우 어깨 높이 차이',
    read: (pv) => {
      const p = worseAbsMm(num(pv.front?.frontal?.shoulderHeightDiffMm), num(pv.back?.frontal?.shoulderHeightDiffMm));
      return p.value == null ? null : { value: Math.abs(p.value), source: p.source };
    },
    thresholds: () => POSTURE_THRESHOLDS.shoulderDiffMm,
  },
  {
    key: 'pelvis_height', label: '골반 높이 차이', view: '정면·후면', unit: 'mm', region: 'pelvis_spine',
    plain: '좌우 골반 높이 차이',
    read: (pv) => {
      const p = worseAbsMm(num(pv.front?.frontal?.pelvisHeightDiffMm), num(pv.back?.frontal?.pelvisHeightDiffMm));
      return p.value == null ? null : { value: Math.abs(p.value), source: p.source };
    },
    thresholds: (sex) => genderThreshold('pelvisDiffMm', sex),
  },
  {
    key: 'trunk_pitch', label: '몸통 앞뒤 기울기', view: '측면', unit: '°', region: 'pelvis_spine',
    plain: '몸통이 수직선에서 앞뒤로 기운 정도',
    read: (pv) => {
      const side = pickView(pv, ['left', 'right']);
      const v = num(side?.sagittal?.pelvicPitchProxyDeg);
      return v == null ? null : { value: Math.abs(v) };
    },
    thresholds: () => [POSTURE_THRESHOLDS.trunkPitchDeg.cautionAbove, POSTURE_THRESHOLDS.trunkPitchDeg.riskAbove],
  },
  {
    key: 'hip_plumb', label: '골반 앞뒤 위치', view: '측면', unit: 'mm', region: 'pelvis_spine',
    plain: '발목 수직선보다 고관절이 앞뒤로 벗어난 거리',
    read: (pv) => {
      const side = pickView(pv, ['left', 'right']);
      const v = num(side?.sagittal?.anklePlumbHipDeviationMm);
      return v == null ? null : { value: Math.abs(v) };
    },
    thresholds: () => POSTURE_THRESHOLDS.ankleHipPlumbMm,
  },
  {
    key: 'knee_plumb', label: '무릎 앞뒤 위치', view: '측면', unit: 'mm', region: 'foot_leg',
    plain: '발목 수직선보다 무릎이 앞뒤로 벗어난 거리',
    read: (pv) => {
      const side = pickView(pv, ['left', 'right']);
      const v = num(side?.sagittal?.anklePlumbKneeDeviationMm);
      return v == null ? null : { value: Math.abs(v) };
    },
    thresholds: () => POSTURE_THRESHOLDS.ankleKneePlumbMm,
  },
  {
    key: 'q_angle', label: '무릎 안쪽·바깥쪽 휨', view: '정면·후면', unit: '°', region: 'foot_leg',
    plain: '고관절-무릎-발목 선이 곧은 선에서 휜 정도(Q각 참고값)',
    read: (pv) => {
      const f = qAngleDeviation(pv.front?.frontal?.qAngleProxyDeg);
      const b = qAngleDeviation(pv.back?.frontal?.qAngleProxyDeg);
      if (f == null && b == null) return null;
      return { value: Math.max(f ?? -Infinity, b ?? -Infinity) };
    },
    thresholds: (sex) => genderThreshold('qAngleDevDeg', sex),
  },
];

function normalizePerView(perViewAnalysis, analysis) {
  const pv = perViewAnalysis && Object.keys(perViewAnalysis).length ? perViewAnalysis : null;
  if (pv) return pv;
  return analysis ? { front: analysis } : {};
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

// 눈금 막대의 끝값: 위험선 + (위험선-주의선) — 0 ~ 끝값 사이에 표시 위치를 둔다.
export function scaleMax(caution, risk) {
  return risk + Math.max(1, risk - caution);
}

export function markerPct(value, caution, risk) {
  if (value == null) return null;
  const max = scaleMax(caution, risk);
  return Math.max(0, Math.min(100, (value / max) * 100));
}

/**
 * 항목별 결과 목록.
 * @returns {Array<{key,label,view,unit,plain,value,caution,risk,max,level,source,region,tight,weak,previous,delta}>}
 */
export function buildPostureSheetItems({ perViewAnalysis, analysis, sex = null, previous = null } = {}) {
  const pv = normalizePerView(perViewAnalysis, analysis);
  const prevPv = previous ? normalizePerView(previous.perViewAnalysis, previous.analysis) : null;
  const items = [];
  for (const def of DEFS) {
    const got = def.read(pv);
    if (!got) continue;
    const [caution, risk] = def.thresholds(sex);
    const value = round1(got.value);
    const level = levelOf(value, caution, risk);
    const muscles = level === SHEET_LEVEL.normal
      ? { tight: [], weak: [] }
      : buildMuscleMap([{ key: def.region, level }]);
    const prevGot = prevPv ? def.read(prevPv) : null;
    const prevValue = prevGot ? round1(prevGot.value) : null;
    items.push({
      key: def.key,
      label: def.label,
      view: def.view,
      unit: def.unit,
      plain: def.plain,
      region: def.region,
      value,
      caution,
      risk,
      max: scaleMax(caution, risk),
      level,
      source: got.source || null,
      tight: muscles.tight.map((m) => m.name),
      weak: muscles.weak.map((m) => m.name),
      previous: prevValue,
      // 값이 작을수록 좋은 지표만 다루므로 음수 = 좋아짐
      delta: prevValue == null ? null : round1(value - prevValue),
    });
  }
  return items;
}

// 주의·위험 항목을 단계 → 위험선 대비 비율 순으로 정렬해 상위 3개.
export function pickPriorityTop3(items = []) {
  return items
    .filter((it) => it.level === SHEET_LEVEL.risk || it.level === SHEET_LEVEL.caution)
    .map((it) => ({ ...it, _ratio: it.risk ? it.value / it.risk : 0 }))
    .sort((a, b) => (RANK[b.level] - RANK[a.level]) || (b._ratio - a._ratio))
    .slice(0, 3)
    .map(({ _ratio, ...it }, i) => ({ rank: i + 1, ...it }));
}

// 근육 그림 색칠용: 주의·위험 항목이 하나라도 있는 부위(region) 목록.
export function activeRegions(items = []) {
  const set = new Set();
  items.forEach((it) => {
    if (it.level === SHEET_LEVEL.risk || it.level === SHEET_LEVEL.caution) set.add(it.region);
  });
  return [...set];
}

// 촬영 면별 좌표 — 저장된 viewLandmarks 우선, 없으면 화면 전용 스냅샷, 그것도 없으면 대표 1면.
export function collectViewLandmarks({ viewLandmarks, perViewSnapshots, fallback } = {}) {
  const out = {};
  if (viewLandmarks && typeof viewLandmarks === 'object') {
    Object.entries(viewLandmarks).forEach(([k, lm]) => {
      if (Array.isArray(lm) && lm.length >= 29) out[k] = lm;
    });
  }
  if (Array.isArray(perViewSnapshots)) {
    perViewSnapshots.forEach((s) => {
      if (s?.key && !out[s.key] && Array.isArray(s.landmarks) && s.landmarks.length >= 29) out[s.key] = s.landmarks;
    });
  }
  if (!Object.keys(out).length && Array.isArray(fallback) && fallback.length >= 29) out.front = fallback;
  return out;
}

// [빠진 항목 2026-11-16] 계산 안 된 자세 항목과 이유 — 측면/정면을 안 찍은 건지, 찍었는데 인식이 안 된 건지 구분.
const SIDE_KEYS = new Set(['forward_head', 'kyphosis', 'trunk_pitch', 'hip_plumb', 'knee_plumb']);
const SIDE_JOINTS = { forward_head: '귀·어깨', kyphosis: '귀·어깨·골반', trunk_pitch: '어깨·골반', hip_plumb: '골반·발목', knee_plumb: '무릎·발목' };
const FRONT_JOINTS = { shoulder_height: '양쪽 어깨', pelvis_height: '양쪽 골반', q_angle: '골반·무릎·발목' };

export function buildPostureMissing({ perViewAnalysis, analysis, presentKeys = [] } = {}) {
  const pv = normalizePerView(perViewAnalysis, analysis);
  const hasSide = !!(pv.left || pv.right);
  const hasFront = !!(pv.front || pv.back);
  const present = new Set(presentKeys);
  return DEFS.filter((d) => !present.has(d.key)).map((d) => {
    const side = SIDE_KEYS.has(d.key);
    let reason;
    if (side) reason = hasSide ? `측면 사진에서 ${SIDE_JOINTS[d.key]}이(가) 충분히 잡히지 않음` : '측면을 찍지 않음 — 좌측면 또는 우측면 촬영 필요';
    else reason = hasFront ? `${FRONT_JOINTS[d.key]}이(가) 충분히 잡히지 않음` : '정면·후면을 찍지 않음';
    return { key: d.key, label: d.label, reason };
  });
}
