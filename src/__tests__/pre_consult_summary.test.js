import { describe, it, expect } from 'vitest';
import { buildPreConsultSummary } from '../services/preConsultSummary.js';

const NOW = Date.parse('2026-10-19T00:00:00Z');
const sprint = (id, at, rt, extra = {}) => ({ id, type: 'sprint', title: '스프린트', date: at.slice(0, 10), at, payload: { reactionTimeMs: rt, ...extra }, ...extra.entry });

describe('buildPreConsultSummary', () => {
  it('기록이 없으면 empty', () => {
    expect(buildPreConsultSummary([], { now: NOW }).empty).toBe(true);
    expect(buildPreConsultSummary([{ type: 'body', at: '2026-01-01' }], { now: NOW }).empty).toBe(true);
  });
  it('이전 대비 개선/주의를 나눈다', () => {
    const up = buildPreConsultSummary([sprint('b', '2026-10-10T00:00:00Z', 200), sprint('a', '2026-09-10T00:00:00Z', 280)], { now: NOW });
    expect(up.improved.map((r) => r.label).length).toBeGreaterThan(0);
    const down = buildPreConsultSummary([sprint('b', '2026-10-10T00:00:00Z', 290), sprint('a', '2026-09-10T00:00:00Z', 200)], { now: NOW });
    expect(down.worsened.length).toBeGreaterThan(0);
  });
  it('트레이너 확인 전 항목과 확인 완료 항목을 구분한다', () => {
    const s = buildPreConsultSummary([
      { ...sprint('b', '2026-10-10T00:00:00Z', 200), trainerReview: { status: 'confirmed' } },
      sprint('a', '2026-09-10T00:00:00Z', 280),
    ], { now: NOW });
    expect(s.unreviewed.map((x) => x.id)).toEqual(['a']);
  });
  it('인식률이 낮은 기록을 표시한다', () => {
    const e = { ...sprint('a', '2026-10-10T00:00:00Z', 200), payload: { reactionTimeMs: 200, recognition: { ratio: 0.4 } } };
    const s = buildPreConsultSummary([e], { now: NOW });
    expect(s.lowQuality[0].pct).toBe(40);
  });
  it('60일 이상 지난 종류를 공백으로 알린다', () => {
    const s = buildPreConsultSummary([sprint('a', '2026-07-01T00:00:00Z', 200)], { now: NOW });
    expect(s.stale[0].days).toBeGreaterThanOrEqual(60);
    expect(s.daysSinceLatest).toBe(s.stale[0].days);
  });
});
