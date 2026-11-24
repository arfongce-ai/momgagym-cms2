import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MEASURE_HOWTO, HOWTO_SNOOZE_MS, getMeasureHowTo, isHowToSnoozed, snoozeHowTo, shouldShowHowTo,
} from '../ai-measure/core/measureHowTo';

const makeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

describe('측정 방법 팝업 (2026-11-24)', () => {
  it('registry 의 모든 측정 id 에 안내가 있다', () => {
    const src = readFileSync('src/ai-measure/registry.js', 'utf8');
    const ids = [...src.matchAll(/^\s{4}id: '([a-z_]+)'/gm)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(16);
    for (const id of new Set(ids)) {
      // 'jump' 처럼 그룹(MEASURE_GROUPS)의 id 와 겹치는 값은 제외 — 그룹 id 는 들여쓰기가 2칸이라 위 정규식에 안 걸린다.
      expect(getMeasureHowTo(id), id).not.toBeNull();
      expect(MEASURE_HOWTO[id].steps.length).toBeGreaterThan(0);
    }
  });
  it('일주일간 보지 않기: 누른 직후~7일 안에는 숨기고, 7일이 지나면 다시 뜬다', () => {
    const st = makeStorage();
    const t0 = 1_700_000_000_000;
    expect(shouldShowHowTo(st, 'jump', t0)).toBe(true);
    snoozeHowTo(st, 'jump', t0);
    expect(shouldShowHowTo(st, 'jump', t0 + 1000)).toBe(false);
    expect(shouldShowHowTo(st, 'jump', t0 + HOWTO_SNOOZE_MS - 1)).toBe(false);
    expect(shouldShowHowTo(st, 'jump', t0 + HOWTO_SNOOZE_MS + 1)).toBe(true);
  });
  it('메뉴별로 따로 숨긴다', () => {
    const st = makeStorage();
    snoozeHowTo(st, 'jump', 1000);
    expect(isHowToSnoozed(st, 'jump', 2000)).toBe(true);
    expect(isHowToSnoozed(st, 'gait', 2000)).toBe(false);
  });
  it('저장소가 없거나 고장 나도 오류 없이 "보이는" 쪽으로 동작한다', () => {
    expect(shouldShowHowTo(null, 'jump')).toBe(true);
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(shouldShowHowTo(broken, 'jump')).toBe(true);
    expect(() => snoozeHowTo(broken, 'jump')).not.toThrow();
    expect(shouldShowHowTo(null, 'unknown_menu')).toBe(false);
  });
  it('허브가 측정 화면에서 팝업을 렌더한다', () => {
    const s = readFileSync('src/ai-measure/AiMeasureHub.jsx', 'utf8');
    expect(s).toContain("import MeasureHowToPopup from './menus/MeasureHowToPopup'");
    expect(s).toContain('<MeasureHowToPopup menuId={active.id} />');
  });
});
