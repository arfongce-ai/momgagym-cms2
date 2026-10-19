// scripts/measure-topics/core.mjs — 익명 집계 순수 로직 (Firestore/Notion 의존 없음)
//
// CMS 소스(src/…)는 확장자 없는 import 때문에 GitHub Actions 순수 Node에서 깨지므로
// 기준범위를 여기에 인라인한다. src/ai-measure/core/unifiedReport.js 의 METRIC_DEFINITIONS 와
// 어긋나지 않는지는 src/__tests__/measure_topics_core.test.js 가 검사한다.
//
// 내부 용도라 숫자는 정확하게 낸다(인원 수 그대로, 비율 반올림만).
// 다만 회원 id·이름·날짜·개별 수치는 결과에 넣지 않는다(회원 실명 노출 금지 규칙).
// minMembers 는 기본 1(제한 없음). 필요하면 환경변수 MIN_MEMBERS 로 올릴 수 있다.

export const MIN_MEMBERS = 1;

// key: unifiedReport 의 metric key / label: 후보 문구용 쉬운 이름 / abs: 절댓값 비교
function cadenceOf(p) {
  const v = Number(p?.metrics?.cadence ?? p?.cadence);
  return Number.isFinite(v) && v > 0 ? v : NaN; // NaN 이면 비교가 모두 false → 구분 불가 기록은 제외
}

export const TOPIC_METRICS = {
  jump: [
    { key: 'jumpHeight', label: '점프 높이', paths: ['heightCm'], good: [40, 100] },
    // 착지 무릎 각도는 검증된 정상범위가 없어(Krosshaug 2016) 주제 후보에서 제외했다.
    // 좌우 착지 대칭은 검증된 기준이 없어 주제 후보에서 제외했다.
    { key: 'pelvicImbalance', label: '골반 좌우 균형', paths: ['biomech.pelvicImbalance'], good: [0, 4] },
    { key: 'rsi', label: '반응 점프 지수', paths: ['rsi.rsi'], good: [2, 10] },
  ],
  posture: [
    { key: 'forwardHead', label: '머리 앞쪽 위치', paths: ['analysis.sagittal.forwardHeadMm', 'sagittal.forwardHeadMm'], good: [0, 20] },
    { key: 'shoulderHeightDiff', label: '어깨 높이 차이', paths: ['analysis.frontal.shoulderHeightDiffMm', 'frontal.shoulderHeightDiffMm'], good: [0, 8], abs: true },
    { key: 'pelvisHeightDiff', label: '골반 높이 차이', paths: ['analysis.frontal.pelvisHeightDiffMm', 'frontal.pelvisHeightDiffMm'], good: [0, 8], abs: true },
    { key: 'centerOfGravity', label: '체중 중심 치우침', paths: ['analysis.cog.offsetPct', 'cog.offsetPct'], good: [0, 12] },
    { key: 'asymmetry', label: '좌우 비대칭', paths: ['analysis.asymmetry.averageAsi', 'asymmetry.averageAsi'], good: [0, 10] },
  ],
  gait: [
    // 걷기/달리기는 케이던스 140 기준으로 나눠 따로 본다(src/ai-measure/core/gaitMode.js 와 동일, 테스트가 확인).
    { key: 'cadenceWalk', label: '걷기 케이던스', paths: ['metrics.cadence', 'cadence'], good: [100, 130], when: (p) => cadenceOf(p) < 140 },
    { key: 'cadenceRun', label: '달리기 케이던스', paths: ['metrics.cadence', 'cadence'], good: [160, 180], when: (p) => cadenceOf(p) >= 140 },
    { key: 'stanceWalk', label: '걷기 지지 시간 비율', paths: ['metrics.stancePct', 'stancePct'], good: [55, 65], when: (p) => cadenceOf(p) < 140 },
    { key: 'pelvicDrop', label: '골반 처짐', paths: ['metrics.pelvicDropAbs', 'pelvicDropAbs', 'metrics.pelvicDrop.avg'], good: [0, 4] },
    { key: 'kneeSymmetry', label: '좌우 무릎 대칭', paths: ['metrics.kneeSymmetry', 'kneeSymmetry'], good: [92, 100] },
    { key: 'verticalOscillation', label: '상하 움직임', paths: ['metrics.verticalOscillation', 'verticalOscillation'], good: [4, 9] },
  ],
  sprint: [
    { key: 'reactionTime', label: '반응 시간', paths: ['reactionTimeMs'], good: [0, 220], bounds: [50, 2000] }, // 반응 2초 초과·50ms 미만은 측정 오류/테스트 값으로 보고 제외
    { key: 'decelTime', label: '감속 시간', paths: ['deceleration.decelTimeMs'], good: [0, 400] },
  ],
  rom: [
    { key: 'asymmetry', label: '관절 가동 좌우 차이', paths: ['summary.symmetry_index_score', 'symmetry_index_score'], good: [0, 8] }, // romThresholds.js 와 같은 기준
  ],
  one_rm: [
    { key: 'velocityLoss', label: '바벨 속도 저하', paths: ['metrics.velocityLoss', 'velocityLoss', 'vbt.velocityLoss'], good: [0, 15] },
  ],
  vbt: [
    { key: 'velocityLoss', label: '바벨 속도 저하', paths: ['metrics.velocityLoss', 'velocityLoss', 'vbt.velocityLoss'], good: [0, 15] },
  ],
};

// 후보 중 '거의 전원이 범위 밖'인 항목은 회원 문제라기보다 기준(범위·단위)이 실제 데이터와 안 맞는 신호다.
// 이런 후보는 Notion에 쓰지 않고 로그에 '기준 재확인 필요'로만 남긴다.
export const REVIEW_PCT = 90;
export const REVIEW_MIN_MEMBERS = 3;

export const TYPE_NAME = {
  jump: '점프', posture: '자세', gait: '보행', sprint: '스프린트·민첩성', rom: '관절가동범위', one_rm: '1RM', vbt: '바벨 속도',
};

function getPath(obj, path) {
  let cur = obj;
  for (const k of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

function firstNumber(report, paths) {
  for (const p of paths) {
    const v = getPath(report, p);
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** 문서에서 측정 종류를 정한다(inferReportType 의 지원 종류만 간단히). */
export function inferType(doc) {
  const r = doc && typeof doc.data === 'object' && doc.data ? { ...doc.data, ...doc } : (doc || {});
  const kind = String(r.kind || r.menu || r.reportType || '').toLowerCase();
  if (kind.includes('posture')) return 'posture';
  if (kind.includes('rom')) return 'rom';
  if (kind.includes('gait') || kind.includes('running')) return 'gait';
  if (kind.includes('sprint') || kind.includes('agility')) return 'sprint';
  if (kind.includes('jump') || r.jumpType || r.rsi) return 'jump';
  if (r.mode === 'onerm' || r.metrics?.oneRM != null || kind.includes('1rm')) return 'one_rm';
  if (r.type === 'lifting' || r.mode === 'vbt' || kind.includes('vbt')) return 'vbt';
  if (r.analysis?.frontal || r.analysis?.sagittal) return 'posture';
  if (r.heightCm != null) return 'jump';
  return 'general';
}

export function docTime(doc) {
  return String(doc?.recordedAtFull || doc?.createdAt || doc?.measuredAt || doc?.recordedAt || '');
}

/** 무효 측정은 집계에서 뺀다. */
function isValid(doc) {
  const p = doc && typeof doc.data === 'object' && doc.data ? doc.data : doc;
  // 보행 리포트는 유효 여부를 metrics.valid 에 담는다(최상위 valid 없음) — 같이 확인.
  return !(doc?.valid === false || p?.valid === false || doc?.metrics?.valid === false || p?.metrics?.valid === false);
}

export function outOfRange(value, good, abs = false) {
  const v = abs ? Math.abs(value) : value;
  return v < good[0] || v > good[1];
}

/**
 * docsByMember: Map 또는 객체 { 회원id: [문서…] }. 회원 id 는 집계에만 쓰이고 결과에는 나오지 않는다.
 * 회원×종류마다 가장 최근 유효 기록 1건만 쓴다.
 * 반환: { candidates:[{type,typeName,metricKey,label,members,outPct}], skipped:{…개수만} }
 */
export function aggregateTopics(docsByMember, minMembers = MIN_MEMBERS) {
  const entries = docsByMember instanceof Map ? [...docsByMember.values()] : Object.values(docsByMember || {});
  const acc = {}; // type -> { members:Set-less count, metrics: key -> {label, n, out} }
  let skippedSmall = 0;
  let skippedNone = 0;
  let skippedImplausible = 0;
  for (const docs of entries) {
    const latest = {}; // type -> doc
    for (const d of docs || []) {
      if (!d || !isValid(d)) continue;
      const t = inferType(d);
      if (!TOPIC_METRICS[t]) continue;
      if (!latest[t] || docTime(d) > docTime(latest[t])) latest[t] = d;
    }
    for (const [t, d] of Object.entries(latest)) {
      const payload = d.data && typeof d.data === 'object' ? { ...d.data, ...d } : d;
      acc[t] = acc[t] || { members: 0, metrics: {} };
      acc[t].members += 1;
      for (const m of TOPIC_METRICS[t]) {
        if (m.when && !m.when(payload)) continue;
        const v = firstNumber(payload, m.paths);
        if (v == null) continue;
        if (m.bounds && (v < m.bounds[0] || v > m.bounds[1])) { skippedImplausible += 1; continue; }
        const slot = (acc[t].metrics[m.key] = acc[t].metrics[m.key] || { label: m.label, n: 0, out: 0, values: [] });
        slot.n += 1;
        slot.values.push(v);
        if (outOfRange(v, m.good, m.abs)) slot.out += 1;
      }
    }
  }
  const candidates = [];
  for (const [t, info] of Object.entries(acc)) {
    if (info.members < minMembers) { skippedSmall += 1; continue; }
    for (const [key, s] of Object.entries(info.metrics)) {
      if (s.n < minMembers) { skippedSmall += 1; continue; }
      // 범위 밖 회원이 0명이면 주제로 쓸 거리가 없어 후보에서 뺀다.
      if (s.out === 0) { skippedNone += 1; continue; }
      const outPct = Math.round((s.out / s.n) * 100);
      candidates.push({ type: t, typeName: TYPE_NAME[t], metricKey: key, label: s.label, members: s.n, outCount: s.out, outPct, goodRange: m0(t, key).good, median: median(s.values), needsReview: outPct >= REVIEW_PCT && s.n >= REVIEW_MIN_MEMBERS });
    }
  }
  candidates.sort((a, b) => b.outPct - a.outPct || b.members - a.members);
  return { candidates, skipped: { belowMinMembers: skippedSmall, noneOutOfRange: skippedNone, implausibleValues: skippedImplausible } };
}

function m0(type, key) {
  return TOPIC_METRICS[type].find((m) => m.key === key) || {};
}

function median(values) {
  const a = [...values].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  const v = a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  return Math.round(v * 100) / 100;
}

/** 후보 문구. 진단·치료 단정 표현·AI 표기 없이 수치 기준으로만 쓴다. */
export function topicTitle(c) {
  return `[주제후보] ${c.typeName} ${c.label} — 수치 기준으로 측정 회원 ${c.members}명 중 ${c.outCount}명(${c.outPct}%)이 권장 범위 밖`;
}
