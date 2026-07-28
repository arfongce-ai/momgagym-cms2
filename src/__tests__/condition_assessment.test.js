import { describe, it, expect } from 'vitest';
import { CONDITION_TUNING, evaluateCondition } from '../ai-measure/core/conditionAssessment.js';

describe('conditionAssessment — 오늘의 컨디션 체크인 판정', () => {
  it('아무 값도 없으면 무효(valid:false)로 처리하고 unknown을 반환한다', () => {
    const r = evaluateCondition({});
    expect(r.valid).toBe(false);
    expect(r.status).toBe('unknown');
    expect(r.reason).toBe('no_entry');
  });

  it('공백 문자열만 있는 메모는 미입력으로 취급한다', () => {
    const r = evaluateCondition({ memo: '   ' });
    expect(r.valid).toBe(false);
  });

  it('통증·피로도가 모두 낮으면 normal이다', () => {
    const r = evaluateCondition({ fatigue: 2, painNrs: 1 });
    expect(r.valid).toBe(true);
    expect(r.status).toBe('normal');
    expect(r.flags).toEqual([]);
    expect(r.painFlag).toBe(false);
  });

  it('메모만 있어도 유효한 체크인으로 저장된다(normal)', () => {
    const r = evaluateCondition({ memo: '오늘 컨디션 좋아요' });
    expect(r.valid).toBe(true);
    expect(r.status).toBe('normal');
    expect(r.memo).toBe('오늘 컨디션 좋아요');
  });

  it(`통증 NRS ${CONDITION_TUNING.painCautionAt}(경계값)부터 caution이다`, () => {
    const below = evaluateCondition({ painNrs: CONDITION_TUNING.painCautionAt - 1 });
    const at = evaluateCondition({ painNrs: CONDITION_TUNING.painCautionAt });
    expect(below.status).toBe('normal');
    expect(at.status).toBe('caution');
    expect(at.flags).toContain('pain_moderate');
  });

  it(`통증 NRS ${CONDITION_TUNING.painRiskAt}(경계값)부터 risk이고 painFlag가 true다`, () => {
    const at = evaluateCondition({ painNrs: CONDITION_TUNING.painRiskAt });
    expect(at.status).toBe('risk');
    expect(at.flags).toContain('pain_high');
    expect(at.painFlag).toBe(true);
  });

  it('통증이 주의 구간(4~6)이면 painFlag는 true이지만 status는 risk가 아니다', () => {
    const r = evaluateCondition({ painNrs: 5 });
    expect(r.status).toBe('caution');
    expect(r.painFlag).toBe(true);
  });

  it(`피로도만 ${CONDITION_TUNING.fatigueCautionAt} 이상이면 caution까지만 올라가고 risk는 되지 않는다`, () => {
    const r = evaluateCondition({ fatigue: 5 });
    expect(r.status).toBe('caution');
    expect(r.flags).toContain('fatigue_elevated');
  });

  it('통증 risk + 피로도 caution이 동시에 있으면 worse()로 risk가 최종 상태다', () => {
    const r = evaluateCondition({ fatigue: 5, painNrs: 8 });
    expect(r.status).toBe('risk');
    expect(r.flags).toEqual(expect.arrayContaining(['pain_high', 'fatigue_elevated']));
  });

  it('폼에서 오는 문자열 숫자("7" 등)도 정상적으로 판정한다', () => {
    const r = evaluateCondition({ fatigue: '2', painNrs: '7' });
    expect(r.valid).toBe(true);
    expect(r.fatigue).toBe(2);
    expect(r.painNrs).toBe(7);
    expect(r.status).toBe('risk');
  });

  it('빈 문자열 필드는 null로 정규화되고 판정에서 제외된다', () => {
    const r = evaluateCondition({ fatigue: '', painNrs: '3', memo: '' });
    expect(r.fatigue).toBeNull();
    expect(r.painNrs).toBe(3);
    expect(r.memo).toBeNull();
  });
});
