import { describe, it, expect } from 'vitest';
import { buildAiReport, menuGroupKey, plausibleVelocity } from '../services/reportService.js';

describe('plausibleVelocity — 물리적으로 불가능한 속도값 방어', () => {
  it('정상 범위(0~5m/s) 값은 그대로 통과시킨다', () => {
    expect(plausibleVelocity(0.98)).toBe(0.98);
    expect(plausibleVelocity(0)).toBe(0);
    expect(plausibleVelocity(4.9)).toBe(4.9);
  });

  it('물리적으로 불가능한 값(5m/s 초과)은 null 처리한다(측정 정직성 — 틀린 값을 그대로 보여주지 않음)', () => {
    expect(plausibleVelocity(536.33)).toBeNull();
    expect(plausibleVelocity(-536)).toBeNull();
  });

  it('숫자가 아니거나 없는 값은 그대로 통과시킨다(다른 곳에서 처리)', () => {
    expect(plausibleVelocity(null)).toBeNull();
    expect(plausibleVelocity(undefined)).toBeUndefined();
  });
});

describe('menuGroupKey — 파워점프/RSI, VBT/1RM(역도) 세분화', () => {
  it('점프는 RSI 여부에 따라 jump_rsi / jump_power 로 나뉜다', () => {
    expect(menuGroupKey({ menu: 'jump', data: { jumpType: 'reactive' } })).toBe('jump_rsi');
    expect(menuGroupKey({ menu: 'jump', data: { rsi: { rsi: 0.9 } } })).toBe('jump_rsi');
    expect(menuGroupKey({ menu: 'jump', data: { heightCm: 30 } })).toBe('jump_power');
  });

  it('바벨 리프팅은 1RM(역도) 여부에 따라 lifting_onerm / lifting_vbt 로 나뉜다', () => {
    expect(menuGroupKey({ menu: 'lifting', data: { mode: 'onerm' } })).toBe('lifting_onerm');
    expect(menuGroupKey({ menu: 'lifting', data: { metrics: { oneRM: 120 } } })).toBe('lifting_onerm');
    expect(menuGroupKey({ menu: 'lifting', data: { mode: 'vbt', metrics: { meanVelocity: 0.8 } } })).toBe('lifting_vbt');
  });

  it('그 외 메뉴는 원본 menu 값을 그대로 그룹 키로 쓴다', () => {
    expect(menuGroupKey({ menu: 'posture', data: {} })).toBe('posture');
    expect(menuGroupKey({ menu: 'rom', data: {} })).toBe('rom');
    expect(menuGroupKey({})).toBe('etc');
  });
});

describe('buildAiReport — 파워점프/RSI, VBT/1RM 세션이 섞여 있어도 그룹이 분리된다', () => {
  it('파워점프와 RSI 세션은 서로 다른 groupKey/byMenu 버킷으로 나뉜다(회차 목록이 섞이지 않음)', () => {
    const sessions = [
      { menu: 'jump', recordedAt: '2026-07-01', data: { heightCm: 30, peakPower: 2500 } },
      { menu: 'jump', recordedAt: '2026-07-02', data: { jumpType: 'reactive', rsi: { rsi: 0.6 }, heightCm: 18 } },
      { menu: 'jump', recordedAt: '2026-07-03', data: { heightCm: 32, peakPower: 2600 } },
    ];
    const { menuSummaries, byMenu } = buildAiReport(sessions);
    const power = menuSummaries.find(m => m.groupKey === 'jump_power');
    const rsi = menuSummaries.find(m => m.groupKey === 'jump_rsi');
    expect(power.title).toBe('파워점프');
    expect(rsi.title).toBe('RSI 반응점프');
    expect(power.count).toBe(2);
    expect(rsi.count).toBe(1);
    expect(byMenu.jump_power.every(s => s.data.jumpType !== 'reactive')).toBe(true);
    expect(byMenu.jump_rsi.every(s => s.data.jumpType === 'reactive')).toBe(true);
    // 등급/차트 판정 등 기존 로직 호환용 원본 menu 는 둘 다 'jump' 그대로 유지.
    expect(power.menu).toBe('jump');
    expect(rsi.menu).toBe('jump');
  });

  it('VBT와 1RM(역도) 세션도 서로 다른 groupKey 로 나뉜다', () => {
    const sessions = [
      { menu: 'lifting', recordedAt: '2026-07-01', data: { mode: 'vbt', metrics: { meanVelocity: 0.9 } } },
      { menu: 'lifting', recordedAt: '2026-07-02', data: { mode: 'onerm', metrics: { oneRM: 120 } } },
    ];
    const { menuSummaries } = buildAiReport(sessions);
    const vbt = menuSummaries.find(m => m.groupKey === 'lifting_vbt');
    const onerm = menuSummaries.find(m => m.groupKey === 'lifting_onerm');
    expect(vbt.title).toBe('VBT');
    expect(onerm.title).toBe('1RM · 역도');
    expect(vbt.count).toBe(1);
    expect(onerm.count).toBe(1);
  });

  it('자세 측정 요약은 실제 저장 경로(analysis.frontal.*)에서 값을 읽는다', () => {
    const sessions = [{
      menu: 'posture', recordedAt: '2026-07-01',
      data: { analysis: { frontal: { shoulderHeightDiffMm: 12, pelvisHeightDiffMm: 6 } } },
    }];
    const { menuSummaries, postureSeries } = buildAiReport(sessions);
    expect(menuSummaries[0].metric).toContain('12mm');
    expect(menuSummaries[0].metric).toContain('6mm');
    expect(postureSeries.shoulder).toEqual([{ date: '2026-07-01', value: 12 }]);
  });

  it('ROM 측정 요약은 실제 저장 필드(summary.max_rom)에서 값을 읽는다', () => {
    const sessions = [{
      menu: 'rom', recordedAt: '2026-07-01',
      data: { summary: { max_rom: 118, symmetry_index_score: 92 } },
    }];
    const { menuSummaries } = buildAiReport(sessions);
    expect(menuSummaries[0].metric).toContain('118°');
  });
});

describe('extractSessionMetric — AI측정이력 회차별 상세 목록의 값 추출', () => {
  it('자세 측정: 실제 저장 경로(analysis.frontal.*)에서 값을 읽는다(예전 shoulderTilt 필드는 존재하지 않음)', async () => {
    const { extractSessionMetric } = await import('../pages/Report.jsx');
    const r = extractSessionMetric({
      menu: 'posture',
      data: { analysis: { frontal: { shoulderHeightDiffMm: 15, pelvisHeightDiffMm: 7 } } },
    });
    expect(r.value).toBe(15);
    expect(r.unit).toBe('mm');
    expect(r.label).toContain('7mm');
  });

  it('ROM: 실제 저장 필드(summary.max_rom/left_max_rom/right_max_rom)에서 값을 읽는다', async () => {
    const { extractSessionMetric } = await import('../pages/Report.jsx');
    expect(extractSessionMetric({ menu: 'rom', data: { summary: { max_rom: 120 } } }).value).toBe(120);
    expect(extractSessionMetric({ menu: 'rom', data: { summary: { left_max_rom: 95 } } }).value).toBe(95);
  });

  it('ROM: 값이 전혀 없으면 라벨만 있고 value 는 null(측정 정직성 — 0 등으로 위장하지 않음)', async () => {
    const { extractSessionMetric } = await import('../pages/Report.jsx');
    const r = extractSessionMetric({ menu: 'rom', data: { summary: {} } });
    expect(r.value == null).toBe(true);
    expect(r.label).toBeTruthy();
  });

  it('바벨 리프팅(VBT): 물리적으로 불가능한 속도값은 null 처리한다', async () => {
    const { extractSessionMetric } = await import('../pages/Report.jsx');
    const bad = extractSessionMetric({ menu: 'lifting', data: { mode: 'vbt', metrics: { meanVelocity: 536.33 } } });
    expect(bad.value).toBeNull();
    const good = extractSessionMetric({ menu: 'lifting', data: { mode: 'vbt', metrics: { meanVelocity: 0.9 } } });
    expect(good.value).toBe(0.9);
  });
});

describe('findLinkedReportIndex — 세션↔전용리포트 매칭(측정이력의 "리포트 →" 링크)', () => {
  it('linkedSessionId 가 있으면 그것으로 정확히 매칭한다(measuredAt 불일치와 무관)', async () => {
    const { findLinkedReportIndex } = await import('../pages/Report.jsx');
    const session = { id: 'sess-1', data: { measuredAt: '2026-07-01T09:00:00.000Z' } };
    const list = [
      { linkedSessionId: 'other', measuredAt: '2026-07-01T09:00:00.000Z' },
      { linkedSessionId: 'sess-1', measuredAt: '2026-07-01T09:00:00.001Z' }, // 1ms 어긋나도 링크로 정확히 찾음
    ];
    expect(findLinkedReportIndex(session, list)).toBe(1);
  });

  it('linkedSessionId 가 없는 과거 데이터는 measuredAt 완전일치로 폴백한다', async () => {
    const { findLinkedReportIndex } = await import('../pages/Report.jsx');
    const session = { id: 'sess-2', data: { measuredAt: '2026-06-01T00:00:00.000Z' } };
    const list = [{ measuredAt: '2026-06-01T00:00:00.000Z' }];
    expect(findLinkedReportIndex(session, list)).toBe(0);
  });

  it('아무것도 매칭되지 않으면 -1(오픈 불가로 처리됨)', async () => {
    const { findLinkedReportIndex } = await import('../pages/Report.jsx');
    expect(findLinkedReportIndex({ id: 's', data: {} }, [{ measuredAt: 'x' }])).toBe(-1);
    expect(findLinkedReportIndex(null, [])).toBe(-1);
  });
});
