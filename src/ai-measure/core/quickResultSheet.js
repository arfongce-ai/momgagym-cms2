// [측정 결과시트 공용화 2026-11-15]
// 자세체형 리포트에 붙인 "점수 막대 + 먼저 볼 것 + 항목별 눈금" 화면을 다른 측정
// 리포트에도 쓰기 위한 순수 계산 모듈. 지표·판정은 새로 만들지 않고
// unifiedReport.extractKeyMetrics(카카오 공유·이력 비교와 같은 단일 소스)를 그대로 쓴다.
//  - 판정 범위가 있는 지표 → 눈금 막대
//  - 판정만 있는 지표(스쿼트·한발서기: 판정 모듈이 확정) → 3칸 단계 막대
//  - 기준이 없는 지표(점프 높이·스프린트 기록 등) → 값 + 지난번 대비만(판정 안 함)
import { extractKeyMetrics, inferReportType, METRIC_DEFINITIONS, getLaymanTerm } from './unifiedReport';
import { assessMeasureQuality } from './captureQuality';

export const QUICK_LEVELS = ['normal', 'caution', 'risk'];
const RANK = { risk: 2, caution: 1, normal: 0 };

function num(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function levelFromStatus(status) {
  const k = status?.key;
  return QUICK_LEVELS.includes(k) ? k : null;
}

// { good:[a,b], warn:[c,d] } → 눈금 막대 구간. 한쪽만 기준이면(예: 0부터) 그쪽 여백은 두지 않는다.
export function zonesFromRange(range) {
  if (!range || !Array.isArray(range.good) || !Array.isArray(range.warn)) return null;
  const [g0, g1] = range.good;
  const [w0, w1] = range.warn;
  if (![g0, g1, w0, w1].every((v) => Number.isFinite(v))) return null;
  const lowPad = w0 < g0 ? g0 - w0 : 0;
  const highPad = w1 > g1 ? w1 - g1 : 0;
  const min = w0 - lowPad;
  const max = w1 + highPad;
  const zones = [];
  if (min < w0) zones.push({ from: min, to: w0, level: 'risk' });
  if (w0 < g0) zones.push({ from: w0, to: g0, level: 'caution' });
  zones.push({ from: g0, to: g1, level: 'normal' });
  if (g1 < w1) zones.push({ from: g1, to: w1, level: 'caution' });
  if (w1 < max) zones.push({ from: w1, to: max, level: 'risk' });
  const ticks = [...new Set([w0, g0, g1, w1])];
  return { min, max, zones, ticks };
}

export function markerPct(value, scale) {
  const v = num(value);
  if (v == null || !scale || scale.max === scale.min) return null;
  return Math.max(0, Math.min(100, ((v - scale.min) / (scale.max - scale.min)) * 100));
}

// 좋은 방향: 정의에 명시된 better 우선, 없으면 범위 모양으로 추정.
export function betterDirection(metric) {
  if (metric?.better === 'higher' || metric?.better === 'lower') return metric.better;
  const r = metric?.range;
  if (!r?.good || !r?.warn) return null;
  if (r.good[0] === r.warn[0]) return 'lower';
  if (r.good[1] === r.warn[1]) return 'higher';
  return 'target';
}

function judgeChange(cur, prev, dir, range) {
  if (cur == null || prev == null) return null;
  const delta = Math.round((cur - prev) * 10) / 10;
  if (Math.abs(delta) < 0.1) return { delta: 0, improved: null };
  if (dir === 'lower') return { delta, improved: delta < 0 };
  if (dir === 'higher') return { delta, improved: delta > 0 };
  if (dir === 'target' && range?.good) {
    const mid = (range.good[0] + range.good[1]) / 2;
    return { delta, improved: Math.abs(cur - mid) < Math.abs(prev - mid) };
  }
  return { delta, improved: null };
}

/**
 * @returns {Array<{key,label,description,value,display,unit,level,scale,dir,previous,delta,improved}>}
 */
export function buildQuickItems(report, { reportType, previousReport, metrics } = {}) {
  const type = reportType || inferReportType(report || {});
  let list = metrics;
  if (!list) {
    try { list = extractKeyMetrics(report || {}, type); } catch { list = []; }
  }
  let prevList = [];
  if (previousReport) {
    try { prevList = extractKeyMetrics(previousReport, type); } catch { prevList = []; }
  }
  const prevByKey = Object.fromEntries(prevList.map((m) => [m.key, m]));
  return (list || []).map((m) => {
    const value = num(m.value);
    const prev = prevByKey[m.key] ? num(prevByKey[m.key].value) : null;
    const dir = betterDirection(m);
    const change = judgeChange(value, prev, dir, m.range);
    return {
      key: m.key,
      label: m.label,
      description: m.description || '',
      value,
      display: m.displayValue ?? (value == null ? '-' : String(value)),
      unit: m.unit || '',
      level: levelFromStatus(m.status),
      scale: zonesFromRange(m.range),
      dir,
      previous: prev,
      delta: change ? change.delta : null,
      improved: change ? change.improved : null,
    };
  });
}

export function pickTopItems(items = [], n = 3) {
  return items
    .filter((it) => it.level === 'risk' || it.level === 'caution')
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (RANK[b.it.level] - RANK[a.it.level]) || (a.i - b.i))
    .slice(0, n)
    .map(({ it }, i) => ({ rank: i + 1, ...it }));
}

// ── [측정 오류 줄이기 2026-11-16] 계산 안 된 항목 + 측정 품질 ─────────────
// 값이 없는 항목을 조용히 빼면 "데이터가 안 나왔다"로만 보인다. 판정 기준이 있는 핵심 지표가
// 빠졌으면 이름과 이유를 남겨 다시 찍을 때 무엇을 고칠지 알 수 있게 한다.
// 스프린트는 테스트 종류(5m/10m/505)마다 나오는 지표가 달라 '빠짐'으로 보지 않는다.
const MISSING_SKIP_TYPES = new Set(['sprint', 'squat', 'stance', 'cardio', 'senior', 'paps', 'body', 'general']);
const MISSING_REASON = {
  gait: '발·골반 관절이 충분히 잡히지 않았거나 촬영 방향(측면/후면)이 맞지 않음',
  jump: '골반·무릎이 잡히지 않았거나 정면에서 찍지 않음',
  rom: '좌우 양쪽 동작이 모두 기록되지 않음',
  posture: '해당 관절이 화면에서 충분히 잡히지 않음',
  one_rm: '바벨 속도 반복이 충분히 기록되지 않음',
  vbt: '바벨 속도 반복이 충분히 기록되지 않음',
};

export function buildMissingItems(report, { reportType, presentKeys } = {}) {
  const type = reportType || inferReportType(report || {});
  if (MISSING_SKIP_TYPES.has(type)) return [];
  const defs = METRIC_DEFINITIONS[type] || [];
  const present = new Set(presentKeys || []);
  return defs
    .filter((d) => d.range && !present.has(d.key))
    .map((d) => ({ key: d.key, label: getLaymanTerm(d.key)?.label || d.key, reason: MISSING_REASON[type] || '인식 부족으로 계산되지 않음' }));
}

// 저장된 품질 등급 우선, 옛 기록은 인식률만으로 계산(인식률도 없으면 null → 표시 안 함).
export function resolveReportQuality(report) {
  const r = report && typeof report.data === 'object' && report.data ? { ...report.data, ...report } : report;
  if (!r) return null;
  if (r.quality?.grade) return r.quality;
  if (r.recognition || r.capture) return assessMeasureQuality({ recognition: r.recognition || null, capture: r.capture || null });
  return null;
}
