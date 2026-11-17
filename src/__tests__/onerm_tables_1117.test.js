import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  PCT_BY_REPS, TRAINING_GOALS, pctForReps, repsForPct, weightByRepsTable, oneRMFromTable,
  trainingPrescription, loadIncreaseText,
} from '../ai-measure/core/oneRMTables';
import { RM_PERCENT_TABLE, repPercent } from '../ai-measure/core/strength';

describe('1RM 교재 표 17.7·17.9·17.10', () => {
  it('표 17.7 값(교재 사진 전사)', () => {
    expect(Object.values(PCT_BY_REPS)).toEqual([100, 95, 93, 90, 87, 85, 83, 80, 77, 75, 70, 67, 65]);
    expect(pctForReps(11)).toBe(70);
    expect(pctForReps(13)).toBeNull();
  });
  it('기존 strength.js 표와 동일(11회 보강)', () => {
    expect(RM_PERCENT_TABLE).toEqual(PCT_BY_REPS);
    expect(repPercent(11)).toBe(70);
  });
  it('표 17.8 계산 = 교재 인쇄값(100·600 부하 행)', () => {
    const row = (w) => weightByRepsTable(w).map((r) => Math.round(r.kg));
    expect(row(100)).toEqual([100, 95, 93, 90, 87, 85, 83, 80, 77, 75, 70, 67, 65]);
    // 600: 1,2,3,4,5,6,7,8,9,10,12,15회 (11회는 교재 표에 열 없음)
    const r600 = weightByRepsTable(600).filter((r) => r.reps !== 11).map((r) => Math.round(r.kg));
    expect(r600).toEqual([600, 570, 558, 540, 522, 510, 498, 480, 462, 450, 402, 390]);
  });
  it('역산: 80kg×8회 → 100kg', () => { expect(oneRMFromTable(80, 8)).toBe(100); expect(repsForPct(85)).toBe(6); });
  it('표 17.9 목표별 처방', () => {
    const rx = Object.fromEntries(trainingPrescription(100).map((g) => [g.key, g]));
    expect(rx.strength.kgText).toBe('85kg 이상');
    expect(rx.strength.repsText).toBe('6회 이하');
    expect(rx.hypertrophy.kgText).toBe('67.5~85kg');
    expect(rx.hypertrophy.repsText).toBe('6~12회');
    expect(rx.endurance.kgText).toBe('67.5kg 이하');
    expect(rx.power_single.pctText).toBe('80~90%');
    expect(rx.power_multi.repsText).toBe('3~5회');
    expect(TRAINING_GOALS).toHaveLength(5);
    expect(trainingPrescription(0)).toEqual([]);
  });
  it('표 17.10 증량 폭', () => {
    expect(loadIncreaseText('weak', 'upper')).toBe('1~2kg');
    expect(loadIncreaseText('weak', 'lower')).toBe('2~4kg');
    expect(loadIncreaseText('strong', 'upper')).toBe('2~4+kg');
    expect(loadIncreaseText('strong', 'lower')).toBe('4~7+kg');
  });
  it('1RM 리포트에 처방 섹션 연결', () => {
    const src = fs.readFileSync('src/ai-measure/menus/LiftingReportDashboard.jsx', 'utf8');
    expect(src).toContain('onerm-prescription');
    expect(src).toContain("mode === 'onerm'");
  });
});
