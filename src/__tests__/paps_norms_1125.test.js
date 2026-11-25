import { describe, it, expect } from 'vitest';
import { papsGradeOf, PAPS_NORMS } from '../ai-measure/core/papsNorms';
import { buildPapsRecord, evaluatePapsTest } from '../ai-measure/core/papsTests';

describe('PAPS 등급표 (초4~6, 제공 표 기준)', () => {
  it('경계값: 하한 이상이면 해당 등급, 모두 미만이면 5등급', () => {
    const o = { sex: 'male', grade: '초5' }; // 윗몸말아올리기 48/34/22/11
    expect(papsGradeOf('curlup', 48, o)).toBe(1);
    expect(papsGradeOf('curlup', 47, o)).toBe(2);
    expect(papsGradeOf('curlup', 34, o)).toBe(2);
    expect(papsGradeOf('curlup', 22, o)).toBe(3);
    expect(papsGradeOf('curlup', 11, o)).toBe(4);
    expect(papsGradeOf('curlup', 10, o)).toBe(5);
  });
  it('앞굽히기 음수·악력 소수 구간 빈틈 없이 판정', () => {
    expect(papsGradeOf('sitreach', -2.5, { sex: 'male', grade: '초4' })).toBe(4);
    expect(papsGradeOf('sitreach', -2.6, { sex: 'male', grade: '초4' })).toBe(5);
    expect(papsGradeOf('grip', 19.95, { sex: 'male', grade: '초4' })).toBe(2);
    expect(papsGradeOf('grip', 20, { sex: 'male', grade: '초4' })).toBe(1);
    expect(papsGradeOf('grip', 13.8, { sex: 'female', grade: '초6' })).toBe(4);
  });
  it('표에 없는 학년·성별·테스트는 판정하지 않는다', () => {
    expect(papsGradeOf('curlup', 30, { sex: 'male', grade: '초3' })).toBeNull();
    expect(papsGradeOf('curlup', 30, { sex: '', grade: '초5' })).toBeNull();
    expect(papsGradeOf('pushup', 30, { sex: 'male', grade: '초5' })).toBeNull();
    expect(papsGradeOf('grip', '', { sex: 'male', grade: '초5' })).toBeNull();
  });
  it('하한은 등급이 높을수록 낮아진다(표 입력 오류 방지)', () => {
    Object.values(PAPS_NORMS).forEach((bySex) => Object.values(bySex).forEach((byGrade) => Object.values(byGrade).forEach((row) => {
      expect(row.length).toBe(4);
      for (let i = 1; i < 4; i += 1) expect(row[i]).toBeLessThan(row[i - 1]);
    })));
  });
  it('evaluate·record 에 등급과 출처가 남고, 무효는 등급 없음', () => {
    const subject = { sex: 'female', grade: '초6' };
    const ev = evaluatePapsTest('grip', 21, { subject });
    expect(ev.grade).toBe(2);
    expect(ev.label).toContain('2등급');
    const rec = buildPapsRecord({ testId: 'grip', value: 21, subject });
    expect(rec.grade).toBe(2);
    expect(rec.gradeSource).toContain('제공');
    expect(evaluatePapsTest('grip', 21, { subject, invalid: true }).grade).toBeUndefined();
    expect(buildPapsRecord({ testId: 'grip', value: 21, subject: { sex: 'female', grade: '중1' } }).grade).toBeNull();
  });
});

describe('PAPS 제자리멀리뛰기(SBJ) 등급', () => {
  it('경계값과 성별·학년 분기', () => {
    expect(papsGradeOf('standlong', 173, { sex: 'male', grade: '초5' })).toBe(1);
    expect(papsGradeOf('standlong', 172, { sex: 'male', grade: '초5' })).toBe(2);
    expect(papsGradeOf('standlong', 124, { sex: 'male', grade: '초5' })).toBe(5);
    expect(papsGradeOf('standlong', 148, { sex: 'female', grade: '초6' })).toBe(2);
    expect(papsGradeOf('standlong', 150, { sex: 'male', grade: '중1' })).toBeNull();
  });
});
