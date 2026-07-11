// ai-measure/core/repFreeze.js
// ════════════════════════════════════════════════════════════════════════
//  반복 기록(렙·점프) 카드 동결 계약 — 측정 정직성의 표시 규칙.
//
//  원칙: "한 번 측정·확정된 반복 카드(#1, #2 …)의 표시값은 이후 어떤
//  재계산에도 바뀌지 않는다." 실시간 화면은 매 프레임 전체 리스트를 다시
//  그리므로, 확정된 항목은 처음 확정된 값으로 고정해야 사용자가 보는 #1·#2
//  숫자가 흔들리지 않는다.
//
//  '확정' 판정: 그 항목보다 뒤 항목이 존재하면(더 이상 최신이 아니면)
//  그 항목의 사이클/구간은 완성된 것으로 보고 동결한다. 최신(마지막) 항목은
//  아직 진행/보정 중일 수 있으므로 동결하지 않는다.
//
//  VBT/1RM 렙은 barbellBiomechanics 의 accumulator 내부에서 동결하고,
//  RSI 점프 카드는 이 유틸로 컴포넌트에서 동결한다 — 동일한 계약을 공유.
// ════════════════════════════════════════════════════════════════════════

/**
 * rows 를 동결 맵과 병합한다.
 *  - 이미 동결된 no 는 저장값을 그대로 반환(불변).
 *  - 아직 최신이 아닌(no < totalCount) 항목은 이번 값으로 동결.
 *  - 최신(마지막) 항목은 동결하지 않고 최신 계산값을 그대로 통과.
 *
 * @param {Array<{no:number}>} rows        표시할 카드 배열(각 항목에 1-기반 no 필요)
 * @param {Map<number, object>} freeze      no → 동결된 카드(가변, 여기서 채워짐)
 * @param {number} totalCount               전체 항목 수(최신 판별용)
 * @returns {Array<object>} 동결이 적용된 카드 배열
 */
export function applyRepFreeze(rows, freeze, totalCount) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    if (row == null || typeof row.no !== 'number') return row;
    const frozen = freeze.get(row.no);
    if (frozen) return frozen;
    const isLatest = row.no >= totalCount;
    if (!isLatest) freeze.set(row.no, row);
    return row;
  });
}
