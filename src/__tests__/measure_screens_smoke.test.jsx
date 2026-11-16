import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
const mods = import.meta.glob('../ai-measure/menus/*.jsx');
const samples = [undefined, {}, { createdAt: '2026-11-16T00:00:00Z' }, { createdAt: '2026-11-16T00:00:00Z', biomech: {}, trials: [], metrics: {}, items: [], views: {}, result: {}, analysis: {}, quality: {}, capture: {} }, null];
// [2026-11-16] AI분석의 모든 화면이 데이터가 없거나(null) 일부만 있어도 첫 화면에서 죽지 않는지 확인.
const SKIP = /ClinicalFlagCard/; // flag 프롭이 필수인 부품
describe('AI분석 화면 스모크(빈·부분 데이터)', () => {
  for (const [path, load] of Object.entries(mods)) {
    if (SKIP.test(path)) continue;
    it(path, async () => {
      const m = await load();
      const C = m.default;
      if (typeof C !== 'function') return;
      const errs = [];
      for (const r of samples) {
        try { renderToString(<C report={r} result={r} data={r} member={{ id: 'm', name: 't' }} history={[]} reports={[]} onClose={() => {}} />); }
        catch (e) { errs.push(`${JSON.stringify(r)?.slice(0, 40)} → ${String(e.message).slice(0, 140)}`); }
      }
      expect(errs).toEqual([]);
    });
  }
});
