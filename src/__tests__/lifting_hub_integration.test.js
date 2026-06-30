import { describe, it, expect } from 'vitest';
import { MEASURE_MENUS } from '../ai-measure/registry';
import { inferReportType, extractKeyMetrics } from '../ai-measure/core/unifiedReport';
import { buildLiftingPayload } from '../ai-measure/core/lifting';

describe('바벨 리프팅 통합 탭 · registry', () => {
  it('lifting 통합 탭이 단일 ready 메뉴로 등록된다', () => {
    const lifting = MEASURE_MENUS.find(m => m.id === 'lifting');
    expect(lifting).toBeTruthy();
    expect(lifting.status).toBe('ready');
    expect(lifting.component).toBeTruthy();
    expect(lifting.title).toContain('바벨');
  });

  it('흩어졌던 vbt·onerm 개별 메뉴는 통합으로 제거된다', () => {
    expect(MEASURE_MENUS.find(m => m.id === 'vbt')).toBeUndefined();
    expect(MEASURE_MENUS.find(m => m.id === 'onerm')).toBeUndefined();
  });

  it('기존 다른 측정 탭들은 유지된다(회귀 방지)', () => {
    for (const id of ['posture', 'rom', 'jump', 'gait']) {
      expect(MEASURE_MENUS.find(m => m.id === id)?.status).toBe('ready');
    }
  });
});

describe('바벨 리프팅 통합 페이로드 · inferReportType 분류', () => {
  it('mode=onerm → one_rm', () => {
    const p = buildLiftingPayload({ mode: 'onerm', exerciseType: 'bench_press', source: 'manual', metrics: { oneRM: 120 } });
    expect(inferReportType(p)).toBe('one_rm');
  });

  it('mode=vbt → vbt', () => {
    const p = buildLiftingPayload({ mode: 'vbt', exerciseType: 'squat', source: 'live', metrics: { meanVelocity: 0.6 } });
    expect(inferReportType(p)).toBe('vbt');
  });

  it('mode=lifting(역도) → vbt 계열로 묶임', () => {
    const p = buildLiftingPayload({ mode: 'lifting', exerciseType: 'snatch', source: 'live', metrics: { meanVelocity: 1.2 } });
    expect(inferReportType(p)).toBe('vbt');
    expect(p.exerciseType).toBe('snatch');
  });

  it('새 metrics.* 경로에서 핵심 수치를 추출한다', () => {
    const p = buildLiftingPayload({
      mode: 'vbt', exerciseType: 'squat', source: 'upload',
      metrics: { meanVelocity: 0.62, peakVelocity: 1.1, rangeOfMotion: 45, confidenceScore: 0.9 },
      metadata: { weight: 100, isCalibrated: true },
    });
    const metrics = extractKeyMetrics(p, 'vbt');
    const keys = metrics.map(m => m.key);
    expect(keys).toContain('meanVelocity');
    expect(keys).toContain('peakVelocity');
  });

  it('1RM 페이로드에서 oneRM 수치를 metrics.*에서 읽는다', () => {
    const p = buildLiftingPayload({ mode: 'onerm', exerciseType: 'squat', source: 'manual', metrics: { oneRM: 140 } });
    const metrics = extractKeyMetrics(p, 'one_rm');
    expect(metrics.find(m => m.key === 'oneRM')).toBeTruthy();
  });

  it('addSession 래퍼({menu,data}) 구조에서도 올바른 타입으로 미러링된다', () => {
    // AiMeasureHub는 측정 페이로드를 { menu, data: payload } 로 감싸 저장한다.
    // inferReportType 이 data 를 언랩해 분류해야 통합 리포트에 미러링된다.
    const vbtSession = { menu: 'lifting', data: buildLiftingPayload({ mode: 'vbt', exerciseType: 'squat', source: 'live', metrics: { meanVelocity: 0.6 } }) };
    expect(inferReportType(vbtSession)).toBe('vbt');
    const onermSession = { menu: 'lifting', data: buildLiftingPayload({ mode: 'onerm', exerciseType: 'bench_press', source: 'manual', metrics: { oneRM: 100 } }) };
    expect(inferReportType(onermSession)).toBe('one_rm');
    const liftSession = { menu: 'lifting', data: buildLiftingPayload({ mode: 'lifting', exerciseType: 'snatch', source: 'upload', metrics: { meanVelocity: 1.5 } }) };
    expect(inferReportType(liftSession)).toBe('vbt');
  });

  it('신체정보 등 비측정 세션은 general(미러링 제외)로 유지된다', () => {
    expect(inferReportType({ menu: 'body', data: { height: 170, weight: 70 } })).toBe('general');
  });
});
