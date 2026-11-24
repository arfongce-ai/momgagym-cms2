import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { findEurPair, attachEur, localDayKey } from '../ai-measure/core/eurPairing';

// 한국 시간 낮 12~15시 = UTC 03~06시 → 어느 시간대 PC에서도 같은 날로 읽힌다.
const at = (h, m = 0) => `2026-11-24T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const cmj = { id: 'c1', kind: 'jump', jumpSubType: 'cmj', heightCm: 44, valid: true, measuredAt: at(4) };
const sj = { id: 's1', kind: 'jump', jumpSubType: 'sj', heightCm: 40, valid: true, measuredAt: at(3) };

describe('EUR 짝짓기 (2026-11-24)', () => {
  it('SJ 를 먼저 저장하고 CMJ 를 나중에 저장하면 CMJ 기록에 EUR 1.1 이 붙는다', () => {
    const r = attachEur({ ...cmj, id: undefined }, [sj]);
    expect(r.eur).toBe(1.1);
    expect(r.eurRef).toMatchObject({ cmjHeightCm: 44, sjHeightCm: 40, sjReportId: 's1', basis: 'height' });
  });
  it('반대로 CMJ 가 먼저여도 SJ 기록에 같은 값이 붙는다', () => {
    const r = attachEur({ ...sj, id: undefined, measuredAt: at(5) }, [cmj]);
    expect(r.eur).toBe(1.1);
    expect(r.eurRef.cmjReportId).toBe('c1');
  });
  it('다른 날 기록·무효 기록·재확인 필요 기록은 짝으로 쓰지 않는다', () => {
    const other = { ...sj, measuredAt: '2026-11-20T04:00:00.000Z' };
    expect(findEurPair([other], cmj)).toBeNull();
    expect(findEurPair([{ ...sj, valid: false }], cmj)).toBeNull();
    expect(findEurPair([{ ...sj, needsReview: true }], cmj)).toBeNull();
  });
  it('같은 날 SJ 가 여럿이면 시각이 가장 가까운 것을 쓴다', () => {
    const near = { ...sj, id: 's2', heightCm: 42, measuredAt: at(4, 5) };
    expect(findEurPair([sj, near], cmj).sjReportId).toBe('s2');
  });
  it('CMJ/SJ 가 아니거나 높이가 없으면 null(원본 그대로)', () => {
    expect(findEurPair([sj], { ...cmj, jumpSubType: 'dj' })).toBeNull();
    expect(findEurPair([sj], { ...cmj, heightCm: null })).toBeNull();
    const rep = { ...cmj, jumpSubType: 'rsi' };
    expect(attachEur(rep, [sj])).toBe(rep);
  });
  it('localDayKey 는 잘못된 값에 빈 문자열', () => {
    expect(localDayKey('')).toBe('');
    expect(localDayKey('abc')).toBe('');
  });
  it('저장 직전(JumpAnalysisHub)과 리포트(JumpReportDashboard)에 연결돼 있다', () => {
    const hub = readFileSync('src/ai-measure/menus/JumpAnalysisHub.jsx', 'utf8');
    expect(hub).toContain("from '../core/eurPairing'");
    expect(hub).toContain('attachEur(withRecord, list)');
    const dash = readFileSync('src/ai-measure/menus/JumpReportDashboard.jsx', 'utf8');
    expect(dash).toContain('data-testid="eur-block"');
  });
});
