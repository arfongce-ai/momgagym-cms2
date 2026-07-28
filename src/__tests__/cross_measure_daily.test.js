import { describe, it, expect } from 'vitest';
import { buildProblemFocus } from '../ai-measure/core/crossMeasureContext.js';
import { evaluateCondition } from '../ai-measure/core/conditionAssessment.js';

// crossMeasureContext.js는 이전까지 테스트가 전혀 없었다(buildCrossMeasureIntegration의
// 위치인자 호출 버그가 발견되지 않은 이유이기도 하다). 여기서는 이번에 추가한
// kind==='daily' 분기만 검증한다 — 다른 kind 분기는 이번 작업 범위 밖.
describe("buildProblemFocus(kind:'daily') — 컨디션 체크인 해석", () => {
  it('오늘 체크인이 없으면(valid:false) severity는 normal, strengths에만 안내가 담긴다', () => {
    const focus = buildProblemFocus('daily', evaluateCondition({}));
    expect(focus.severity).toBe('normal');
    expect(focus.issues).toEqual([]);
    expect(focus.strengths[0]).toContain('아직 없습니다');
  });

  it('통증이 위험 구간이면 severity가 risk로 올라가고 issues[0]에 통증이 먼저 온다', () => {
    const condition = evaluateCondition({ fatigue: 5, painNrs: 8, memo: '무릎이 아파요' });
    const focus = buildProblemFocus('daily', condition);
    expect(focus.severity).toBe('risk');
    expect(focus.issues[0].level).toBe('risk');
    expect(focus.issues[0].text).toContain('통증');
    // 우선순위: 통증 > 피로도 > 메모 순으로 issues에 쌓여야 primaryFinding이 통증이 된다.
    expect(focus.primaryFinding).toContain('통증');
  });

  it('특이 신호가 없으면 strengths에 담기고 severity는 normal을 유지한다', () => {
    const condition = evaluateCondition({ fatigue: 2, painNrs: 1 });
    const focus = buildProblemFocus('daily', condition);
    expect(focus.severity).toBe('normal');
    expect(focus.strengths.length).toBeGreaterThan(0);
  });

  it('메모가 있어도 severity(normal)를 risk/caution 쪽으로 끌어올리지 않는다', () => {
    const condition = evaluateCondition({ memo: '컨디션 좋아요' });
    const focus = buildProblemFocus('daily', condition);
    expect(focus.severity).toBe('normal');
  });
});
