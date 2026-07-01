import { describe, it, expect } from 'vitest';
// TrainerSettleCard.save 의 splitRates 판정(시드 스냅샷 기반) 재현
function buildSplitRates(rows, rateEdits, rateSeed) {
  const autoRate = {};
  rows.forEach(r => { autoRate[r.memberId] = r.autoRate ?? r.baseRate ?? r.rate; });
  const clampRate = (v) => { if (v===''||v==null) return null; const n=Number(v); return Number.isFinite(n)?Math.max(0,Math.min(100,n)):null; };
  const splitRates = {};
  Object.entries(rateEdits).forEach(([mid, v]) => {
    const val = clampRate(v);
    if (val == null) return;
    const seed = Number(rateSeed[mid]);
    const auto = Number(autoRate[mid]) || 0;
    const differsFromAuto = val !== auto;
    const seedDiffersAuto = Number.isFinite(seed) && seed !== auto;
    if (differsFromAuto) splitRates[mid] = val;
    else if (seedDiffersAuto && Number(v) === seed) splitRates[mid] = val;
  });
  return splitRates;
}
describe('시드 기반 rate override 저장', () => {
  it('[핵심 회귀] 표시/자동 60을 50으로 → 저장(baseRate가 뭐든 무관)', () => {
    const rows = [{ memberId:'m1', rate:60, autoRate:60, baseRate:60 }];
    const seed = { m1: 60 };
    expect(buildSplitRates(rows, { m1: 50 }, seed)).toEqual({ m1: 50 });
  });
  it('[핵심 회귀] baseRate=50(혼합 트레이너)이라도 60→50 저장된다(예전엔 누락)', () => {
    const rows = [{ memberId:'m1', rate:60, autoRate:60, baseRate:50 }];
    const seed = { m1: 60 };
    // 예전 코드: 50===baseRate(50) → 누락. 새 코드: autoRate(60)과 다름 → 저장.
    expect(buildSplitRates(rows, { m1: 50 }, seed)).toEqual({ m1: 50 });
  });
  it('자동값과 같은 값을 그대로 두면 override 안 만듦', () => {
    const rows = [{ memberId:'m1', rate:60, autoRate:60, baseRate:60 }];
    expect(buildSplitRates(rows, { m1: 60 }, { m1: 60 })).toEqual({});
  });
  it('기존 수동값(50, auto 60)을 유지하면 보존된다', () => {
    const rows = [{ memberId:'m1', rate:50, autoRate:60, baseRate:60 }];
    expect(buildSplitRates(rows, { m1: 50 }, { m1: 50 })).toEqual({ m1: 50 });
  });
  it('기존 수동값(50)을 자동값(60)으로 되돌리면 override 해제', () => {
    const rows = [{ memberId:'m1', rate:50, autoRate:60, baseRate:60 }];
    expect(buildSplitRates(rows, { m1: 60 }, { m1: 50 })).toEqual({});
  });
});
