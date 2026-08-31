// ai-measure/core/measurementComparison.js
// ════════════════════════════════════════════════════════════════════════
//  [전/후 변화 요약 2026-08-31] 자세측정(PostureReport.jsx)에서 처음 만든
//  "이전 측정 대비 변화" 계산 로직을 다른 측정 종류(ROM·보행·점프·리프팅·
//  SLST·스쿼트)에서도 재사용하기 위해 공용 모듈로 뺐다. 판단 로직은 여기
//  한 곳에만 — 각 리포트 화면은 자기 지표 목록만 만들어 넘기면 된다.
// ════════════════════════════════════════════════════════════════════════

/**
 * 지표 하나의 전/후 변화 행을 계산한다.
 * @param {string} label 화면에 보일 지표명
 * @param {number} prevRaw 이전 측정값
 * @param {number} curRaw 현재 측정값
 * @param {string} unit 단위 문자열(표시용)
 * @param {'higherBetter'|'lowerBetter'|'closerZeroBetter'|'closerTargetBetter'} mode
 *   higherBetter: 점수처럼 높을수록 좋음
 *   lowerBetter: 그대로 낮을수록 좋음
 *   closerZeroBetter: 좌우 편차·기울기 등 0에 가까울수록 좋음(절대값으로 비교)
 *   closerTargetBetter: 보행 케이던스처럼 "정상범위 중앙값"에 가까울수록 좋음
 *     (target 필요 — 정상범위가 0이 아닌 특정 구간인 지표용, RANGES.good 평균 등)
 * @param {number} [target] mode==='closerTargetBetter'일 때 기준값
 */
export function computeChangeRow(label, prevRaw, curRaw, unit, mode, target) {
  if (typeof curRaw !== 'number' || !Number.isFinite(curRaw)) return null;
  if (typeof prevRaw !== 'number' || !Number.isFinite(prevRaw)) return null;
  const toComparable = (v) => {
    if (mode === 'closerZeroBetter') return Math.abs(v);
    if (mode === 'closerTargetBetter') return Math.abs(v - (target ?? 0));
    return v;
  };
  const prevVal = mode === 'closerTargetBetter' ? prevRaw : toComparable(prevRaw);
  const curVal = mode === 'closerTargetBetter' ? curRaw : toComparable(curRaw);
  // closerTargetBetter는 표시값(prevVal/curVal)은 원래 값 그대로 보여주고,
  // 방향 판정에만 "목표까지의 거리"를 쓴다 — 그래야 화면에 실제 측정값이 보인다.
  const prevDist = mode === 'closerTargetBetter' ? Math.abs(prevRaw - (target ?? 0)) : toComparable(prevRaw);
  const curDist = mode === 'closerTargetBetter' ? Math.abs(curRaw - (target ?? 0)) : toComparable(curRaw);
  const diff = Math.round((curVal - prevVal) * 10) / 10;
  const distDiff = curDist - prevDist;
  let direction = 'same';
  if (Math.abs(mode === 'closerTargetBetter' ? distDiff : diff) >= 0.1) {
    const better = mode === 'higherBetter' ? diff > 0
      : mode === 'closerTargetBetter' ? distDiff < 0
      : diff < 0;
    direction = better ? 'improved' : 'worsened';
  }
  return { key: label, label, prevVal, curVal, diff, unit, direction };
}

/**
 * 이미 계산된 변화 행 배열로 "지난 측정(날짜) 대비 …" 한 줄 요약 문장을 만든다.
 * @param {Array} rows computeChangeRow 결과 배열(null 은 미리 걸러도 되고 안 걸러도 됨)
 * @param {string} previousDate YYYY-MM-DD (없으면 문장에서 생략)
 */
export function summarizeChanges(rows, previousDate) {
  const valid = (rows || []).filter(Boolean);
  if (!valid.length) return null;

  const improved = [...valid].filter((r) => r.direction === 'improved').sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const worsened = [...valid].filter((r) => r.direction === 'worsened').sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const fmt = (r) => `${r.label} ${r.diff > 0 ? '+' : ''}${r.diff}${r.unit}`;
  const parts = [];
  if (improved.length) parts.push(`${improved.slice(0, 2).map(fmt).join(', ')} 개선`);
  if (worsened.length) parts.push(`${worsened.slice(0, 2).map(fmt).join(', ')}은(는) 주의 필요`);
  const narrative = parts.length
    ? `지난 측정(${previousDate || '이전'}) 대비 ${parts.join(' · ')}`
    : '지난 측정과 비교해 뚜렷한 변화는 관찰되지 않았습니다.';

  return { rows: valid, narrative, previousDate };
}

/** 리포트 문서에서 날짜 문자열(YYYY-MM-DD)을 뽑는 공용 헬퍼. */
export function reportDateOnly(report) {
  return String(report?.measuredAt || report?.createdAt || report?.recordedAt || '').slice(0, 10);
}
