import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { buildInterpretation } from '../ai-measure/core/interpretation';
import { buildSummaryData } from '../ai-measure/core/unifiedReport';

const mk = (status, key = 'pelvicDrop') => ({
  title: '보행', reportType: 'gait', overallScore: 70, status, statusLabel: '주의',
  keyMetrics: [
    { key, label: '골반 흔들림', value: 8, displayValue: '8', unit: '%', status: { key: status, rank: status === 'normal' ? 0 : 1 }, range: { good: [0, 5], warn: [0, 10] } },
    { key: 'cadence', label: '걸음 수', value: 110, displayValue: '110', unit: 'SPM', status: { key: 'normal', rank: 0 }, range: { good: [100, 130], warn: [90, 140] } },
  ],
  recommendations: ['엉덩이 옆 근육 운동을 해보세요.'],
});

describe('interpretation 1117', () => {
  it('상세: 지표마다 설명·판정 문장', () => {
    const it = buildInterpretation(mk('caution'));
    expect(it.detail.metrics).toHaveLength(2);
    expect(it.detail.metrics[0].what).toContain('골반');
    expect(it.detail.metrics[0].judge).toContain('주의');
    expect(it.detail.caution).toContain('진단이 아닙니다');
  });
  it('쉬운 버전: 전문용어·위험 단어 없음, 잘한 점/신경 쓸 점', () => {
    const it = buildInterpretation(mk('risk'));
    const text = JSON.stringify(it.easy);
    expect(text).not.toMatch(/위험|CoG|BoS|RSI|VO2|SPM/);
    expect(it.easy.lines.some((l) => l.startsWith('잘한 점'))).toBe(true);
    expect(it.easy.lines.some((l) => l.startsWith('더 신경 쓸 점'))).toBe(true);
  });
  it('기준 없는 지표는 등급 없이 값·변화로 읽는다', () => {
    const s = mk('unknown'); s.status = 'unknown';
    const it = buildInterpretation(s);
    expect(it.detail.metrics[0].judge).toContain('등급은 내지 않고');
  });
  it('요약 없으면 null', () => { expect(buildInterpretation(null)).toBeNull(); });
  it('심폐지구력 요약도 해석된다', () => {
    const s = buildSummaryData({ kind: 'cardio_test', protocolId: 'curved_2400', basis: 'curved', result: { durationSec: 600, distanceM: 2400 }, estimates: {} }, { reportType: 'cardio' });
    expect(() => buildInterpretation(s)).not.toThrow();
  });
  it('상세 리포트 페이지가 해석 블록을 받는다', () => {
    const prim = fs.readFileSync('src/components/report/UnifiedReportPrimitives.jsx', 'utf8');
    expect(prim).toContain('InterpretationSection');
    for (const f of ['Gait', 'Squat', 'Stance', 'Sprint', 'Lifting']) {
      expect(fs.readFileSync(`src/ai-measure/menus/${f}ReportDashboard.jsx`, 'utf8')).toContain('interpretationSummary');
    }
    for (const f of ['PostureReport', 'RomReport', 'JumpReportDashboard']) {
      expect(fs.readFileSync(`src/ai-measure/menus/${f}.jsx`, 'utf8')).toContain('interpretationSummary');
    }
    expect(fs.readFileSync('src/components/report/CardioReportSheet.jsx', 'utf8')).toContain('interpretationSummary');
  });
});
