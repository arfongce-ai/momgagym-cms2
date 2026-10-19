import { describe, it, expect } from 'vitest';
import { mergeMeasureEntries, normalizeConfidence, deriveCoverage, describeEntry } from '../services/measureHistoryService.js';

describe('normalizeConfidence', () => {
  it('0~1 값은 백분율로 바꾼다', () => {
    expect(normalizeConfidence({ confidenceScore: 0.82 })).toEqual({ pct: 82, source: 'confidenceScore' });
  });
  it('0~100 값은 그대로 쓴다', () => {
    expect(normalizeConfidence({ integrated_assessment: { confidenceScore: 74 } }).pct).toBe(74);
  });
  it('세션 래퍼(data) 안의 값도 읽는다', () => {
    expect(normalizeConfidence({ data: { metrics: { confidenceScore: 0.5 } } }).pct).toBe(50);
  });
  it('자세 reliability 는 검출 관절 비율로 계산한다', () => {
    expect(normalizeConfidence({ analysis: { reliability: { validCount: 6, requiredCount: 8 } } }).pct).toBe(75);
  });
  it('신뢰도 필드가 없으면 null', () => {
    expect(normalizeConfidence({ heightCm: 40 }).pct).toBeNull();
    expect(normalizeConfidence(null).pct).toBeNull();
  });
});

describe('mergeMeasureEntries', () => {
  const session = (id, menu, at, extra = {}) => ({ id, menu, menuTitle: menu, recordedAt: at.slice(0, 10), recordedAtFull: at, data: {}, ...extra });

  it('linkedSessionId 로 연결된 전용 리포트는 세션과 한 항목으로 묶인다', () => {
    const entries = mergeMeasureEntries({
      sessions: [session('ai_1', 'gait', '2026-10-01T10:00:00Z')],
      gait: [{ id: 'gait_1', kind: 'gait', linkedSessionId: 'ai_1', createdAt: '2026-10-01T10:00:01Z', metrics: { cadence: 170 } }],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe('session+report');
    expect(entries[0].reportId).toBe('gait_1');
    expect(entries[0].reportCollection).toBe('gait_reports');
  });

  it('세션 없이 전용 컬렉션에만 있는 과거 기록도 목록에 남는다', () => {
    const entries = mergeMeasureEntries({
      posture: [{ id: 'posture_1', kind: 'posture', createdAt: '2026-05-01T00:00:00Z' }],
      rom: [{ id: 'rom_1', kind: 'rom', createdAt: '2026-06-01T00:00:00Z' }],
    });
    expect(entries.map(e => e.id)).toEqual(['rom_1', 'posture_1']);
    expect(entries.every(e => e.source === 'report')).toBe(true);
  });

  it('신체정보 세션(measurements)은 body 타입으로 분류한다', () => {
    const entries = mergeMeasureEntries({
      sessions: [{ id: 'ai_b', recordedAt: '2026-09-01', measurements: { weight: 70 } }],
    });
    expect(entries[0].type).toBe('body');
  });

  it('최신순으로 정렬하고 트레이너 확인값을 항목에 싣는다', () => {
    const review = { status: 'confirmed', note: 'ok', at: '2026-10-02T00:00:00Z' };
    const entries = mergeMeasureEntries({
      sessions: [
        session('ai_old', 'stance', '2026-09-01T00:00:00Z'),
        session('ai_new', 'squat', '2026-10-05T00:00:00Z', { trainerReview: review }),
      ],
    });
    expect(entries.map(e => e.id)).toEqual(['ai_new', 'ai_old']);
    expect(entries[0].trainerReview).toEqual(review);
  });

  it('연결 대상 세션이 없는 linkedSessionId 는 독립 항목으로 취급한다', () => {
    const entries = mergeMeasureEntries({
      gait: [{ id: 'gait_x', kind: 'gait', linkedSessionId: 'ai_missing', createdAt: '2026-10-01T00:00:00Z' }],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe('report');
  });
});

describe('deriveCoverage', () => {
  it('핵심 지표가 얼마나 채워졌는지 비율로 낸다', () => {
    expect(deriveCoverage({}, 'gait', [{}, {}, {}, {}, {}]).pct).toBe(100);
    expect(deriveCoverage({}, 'gait', [{}, {}]).pct).toBe(40);
  });
  it('무효 측정은 0, 정의 없는 종류는 null', () => {
    expect(deriveCoverage({ valid: false }, 'jump', [{}]).pct).toBe(0);
    expect(deriveCoverage({}, 'unknown_type', []).pct).toBeNull();
  });
  it('describeEntry 는 저장된 신뢰도가 없을 때만 충족도로 대신한다', () => {
    const noConf = describeEntry({ type: 'gait', payload: { metrics: { cadence: 170 } } });
    expect(noConf.confidence.source).toBe('derived.coverage');
    const withConf = describeEntry({ type: 'gait', payload: { confidenceScore: 0.9, metrics: { cadence: 170 } } });
    expect(withConf.confidence).toEqual({ pct: 90, source: 'confidenceScore' });
  });
});
