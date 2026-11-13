// 2026-11-13 — AI분석 홈 화면: 15개 측정을 비슷한 것끼리 묶어서 보여준다(번호도 묶음 순서).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MEASURE_MENUS, MEASURE_GROUPS, groupMeasureMenus } from '../ai-measure/registry';

describe('측정 메뉴 묶음', () => {
  it('모든 메뉴가 정확히 한 묶음에 들어가고 빠지는 메뉴가 없다', () => {
    const ids = new Set(MEASURE_GROUPS.map((g) => g.id));
    MEASURE_MENUS.forEach((m) => expect(ids.has(m.group), `${m.id} 묶음 없음`).toBe(true));
    const grouped = groupMeasureMenus().flatMap((e) => e.menus);
    expect(grouped).toHaveLength(MEASURE_MENUS.length);
    expect(new Set(grouped.map((m) => m.id)).size).toBe(MEASURE_MENUS.length);
  });
  it('묶음 안은 번호 순이고 번호가 묶음 순서대로 매겨졌다', () => {
    groupMeasureMenus().forEach(({ menus }) => {
      const nos = menus.map((m) => m.no);
      expect([...nos].sort((a, b) => a - b)).toEqual(nos);
    });
    expect(MEASURE_MENUS.map((m) => m.no).sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    // 번호는 묶음 순서대로 다시 매겼다(2026-11-13).
    const idsByNo = [...MEASURE_MENUS].sort((a, b) => a.no - b.no).map((m) => m.id);
    expect(idsByNo).toEqual(['body', 'posture', 'rom', 'gait', 'sprint', 'jump', 'broadjump', 'lifting', 'stance', 'squat', 'cardio', 'compare', 'imaging', 'record', 'timer']);
  });
  it('화면에 보이는 번호가 묶음 순서와 같다(1부터 15까지 끊김 없이)', () => {
    const shown = groupMeasureMenus().flatMap((e) => e.menus.map((m) => m.no));
    expect(shown).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });
  it('비슷한 측정끼리 묶였다', () => {
    const idsOf = (gid) => groupMeasureMenus().find((e) => e.group.id === gid).menus.map((m) => m.id);
    expect(idsOf('move')).toEqual(['gait', 'sprint']);
    expect(idsOf('power')).toEqual(['jump', 'broadjump']);
    expect(idsOf('strength')).toEqual(['lifting', 'stance', 'squat']);
    expect(idsOf('tool')).toEqual(['compare', 'imaging', 'record', 'timer']);
  });
  it('홈 화면이 묶음별로 그린다', () => {
    const hub = readFileSync('src/ai-measure/AiMeasureHub.jsx', 'utf8');
    expect(hub).toContain('groupMeasureMenus()');
    expect(hub).toContain('measure-group-');
  });
});
