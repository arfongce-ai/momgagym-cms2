import { describe, it, expect } from 'vitest';
import { buildInterpretationGuide, GUIDE_STATUS_LEGEND } from '../services/reportService.js';

describe('buildInterpretationGuide — 측정별 판독 설명서', () => {
  it('실제 측정한 유형만 순서대로 포함한다(측정 안 한 유형은 나열하지 않음)', () => {
    const guide = buildInterpretationGuide(['posture', 'jump']);
    expect(guide.map(g => g.type)).toEqual(['posture', 'jump']);
  });

  it('알 수 없는 유형은 조용히 걸러낸다', () => {
    const guide = buildInterpretationGuide(['posture', 'unknown_type']);
    expect(guide.map(g => g.type)).toEqual(['posture']);
  });

  it('중복 유형은 한 번만 포함한다', () => {
    const guide = buildInterpretationGuide(['jump', 'jump', 'body']);
    expect(guide.map(g => g.type)).toEqual(['jump', 'body']);
  });

  it('각 유형에 개요·라벨·지표 설명·훈련 팁이 채워진다', () => {
    const [postureGuide] = buildInterpretationGuide(['posture']);
    expect(postureGuide.typeLabel).toBeTruthy();
    expect(postureGuide.overview.length).toBeGreaterThan(0);
    expect(postureGuide.metrics.length).toBeGreaterThan(0);
    expect(postureGuide.metrics[0].label).toBeTruthy();
    expect(postureGuide.metrics[0].description).toBeTruthy();
    expect(postureGuide.trainingTip).toBeTruthy();
  });

  it('정상 범위가 정의된 지표는 hint 문구를 만든다', () => {
    const [jumpGuide] = buildInterpretationGuide(['jump']);
    const landingKnee = jumpGuide.metrics.find(m => m.key === 'landingKneeAngle');
    expect(landingKnee.hint).toMatch(/정상 범위/);
  });

  it('정상 범위가 없는 지표는 hint가 null이다(수치 기준 없는데 있는 것처럼 보이면 안 됨)', () => {
    const [jumpGuide] = buildInterpretationGuide(['jump']);
    const peakPower = jumpGuide.metrics.find(m => m.key === 'peakPower');
    expect(peakPower.hint).toBeNull();
  });

  it('신체정보는 훈련 팁을 붙이지 않는다(부족/우수 등급 개념이 맞지 않음)', () => {
    const [bodyGuide] = buildInterpretationGuide(['body']);
    expect(bodyGuide.trainingTip).toBeNull();
  });

  it('입력이 비어 있으면 빈 배열을 반환한다', () => {
    expect(buildInterpretationGuide([])).toEqual([]);
    expect(buildInterpretationGuide()).toEqual([]);
  });

  it('등급 범례는 우수/적정/부족 3단계다', () => {
    expect(GUIDE_STATUS_LEGEND.map(s => s.label)).toEqual(['우수', '적정', '부족']);
  });
});
