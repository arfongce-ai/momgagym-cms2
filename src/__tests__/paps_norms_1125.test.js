import { describe, it, expect } from 'vitest';
import { papsGradeOf, PAPS_NORMS, PAPS_NORM_SOURCE } from '../ai-measure/core/papsNorms';
import { buildPapsRecord, evaluatePapsTest } from '../ai-measure/core/papsTests';

// 값 출처: 학교건강검사규칙 별표 4 (2025.3.10 개정) — 2026 PAPS 기준표(.hwp/.hwpx)
describe('PAPS 공식 등급표 (초3~고3)', () => {
  it('출처는 공식이고 모든 학년·성별 행이 있다', () => {
    expect(PAPS_NORM_SOURCE.status).toBe('official');
    const levels = ['초3', '초4', '초5', '초6', '중1', '중2', '중3', '고1', '고2', '고3'];
    ['sitreach', 'curlup', 'grip', 'standlong'].forEach((t) => ['male', 'female'].forEach((s) => levels.forEach((l) => {
      expect(PAPS_NORMS[t][s][l], `${t} ${s} ${l}`).toHaveLength(4);
    })));
    expect(Object.keys(PAPS_NORMS.pushup.male)).toEqual(['중1', '중2', '중3', '고1', '고2', '고3']);
    expect(Object.keys(PAPS_NORMS.pushupKnee.female)).toEqual(['중1', '중2', '중3', '고1', '고2', '고3']);
  });
  it('윗몸말아올리기 경계값(초4 남: 80/40/22/7)', () => {
    const o = { sex: 'male', grade: '초4' };
    expect(papsGradeOf('curlup', 80, o)).toBe(1);
    expect(papsGradeOf('curlup', 79, o)).toBe(2);
    expect(papsGradeOf('curlup', 40, o)).toBe(2);
    expect(papsGradeOf('curlup', 22, o)).toBe(3);
    expect(papsGradeOf('curlup', 7, o)).toBe(4);
    expect(papsGradeOf('curlup', 6, o)).toBe(5);
  });
  it('앞굽히기·악력 소수 구간, 초5 앞굽히기는 초3~6 공통 값', () => {
    expect(papsGradeOf('sitreach', 8, { sex: 'male', grade: '초5' })).toBe(1);
    expect(papsGradeOf('sitreach', -4, { sex: 'male', grade: '초5' })).toBe(4);
    expect(papsGradeOf('sitreach', -4.1, { sex: 'male', grade: '초5' })).toBe(5);
    expect(papsGradeOf('sitreach', 10, { sex: 'female', grade: '초5' })).toBe(1);
    expect(papsGradeOf('grip', 31, { sex: 'male', grade: '초3' })).toBe(1);
    expect(papsGradeOf('grip', 8.9, { sex: 'male', grade: '초3' })).toBe(5);
  });
  it('팔굽혀펴기: 남=봉 기준, 여=무릎대고 기준, 방식이 다르면 판정하지 않는다', () => {
    expect(papsGradeOf('pushup', 56, { sex: 'male', grade: '고3' })).toBe(1);
    expect(papsGradeOf('pushupKnee', 45, { sex: 'female', grade: '중1' })).toBe(1);
    expect(evaluatePapsTest('pushup', 56, { subject: { sex: 'male', grade: '고3' } }).grade).toBe(1);
    expect(evaluatePapsTest('pushup', 45, { subject: { sex: 'female', grade: '중1' }, variant: 'knee' }).grade).toBe(1);
    expect(evaluatePapsTest('pushup', 45, { subject: { sex: 'female', grade: '중1' } }).grade).toBeNull();
    expect(evaluatePapsTest('pushup', 40, { subject: { sex: 'male', grade: '초5' } }).grade).toBeNull();
  });
  it('표에 없는 학년·성별·값 없음은 판정하지 않는다', () => {
    expect(papsGradeOf('curlup', 30, { sex: '', grade: '초5' })).toBeNull();
    expect(papsGradeOf('curlup', 30, { sex: 'male', grade: '초1' })).toBeNull();
    expect(papsGradeOf('grip', '', { sex: 'male', grade: '초5' })).toBeNull();
  });
  it('하한은 등급이 높을수록 낮아진다(표 입력 오류 방지)', () => {
    Object.values(PAPS_NORMS).forEach((bySex) => Object.values(bySex).forEach((byGrade) => Object.values(byGrade).forEach((row) => {
      expect(row.length).toBe(4);
      for (let i = 1; i < 4; i += 1) expect(row[i]).toBeLessThan(row[i - 1]);
    })));
  });
  it('evaluate·record 에 등급과 공식 출처가 남고, 무효는 등급 없음', () => {
    const subject = { sex: 'female', grade: '초6' }; // 악력 33/22/19/14
    const ev = evaluatePapsTest('grip', 22, { subject });
    expect(ev.grade).toBe(2);
    const rec = buildPapsRecord({ testId: 'grip', value: 22, subject });
    expect(rec.grade).toBe(2);
    expect(rec.gradeSource).toContain('별표 4');
    expect(evaluatePapsTest('grip', 22, { subject, invalid: true }).grade).toBeUndefined();
    expect(buildPapsRecord({ testId: 'grip', value: 22, subject: { sex: 'female', grade: '초1' } }).grade).toBeNull();
  });
});

describe('PAPS 제자리멀리뛰기(SBJ) 등급', () => {
  it('경계값과 성별·학년 분기(초5 남 180.1/159.1/141.1/111.1)', () => {
    expect(papsGradeOf('standlong', 181, { sex: 'male', grade: '초5' })).toBe(1);
    expect(papsGradeOf('standlong', 180, { sex: 'male', grade: '초5' })).toBe(2);
    expect(papsGradeOf('standlong', 111, { sex: 'male', grade: '초5' })).toBe(5);
    expect(papsGradeOf('standlong', 145, { sex: 'female', grade: '초6' })).toBe(2);
    expect(papsGradeOf('standlong', 150, { sex: 'male', grade: '중1' })).toBe(4);
  });
});

describe('PAPS 기준 문구·종합분석 연결', () => {
  it('여 무릎대고 팔굽혀펴기 기준 문구가 비지 않는다', async () => {
    const { papsCriteriaText } = await import('../ai-measure/core/papsTests');
    const rec = buildPapsRecord({ testId: 'pushup', value: 45, variant: 'knee', subject: { sex: 'female', grade: '중1' } });
    expect(rec.grade).toBe(1);
    expect(papsCriteriaText(rec)).toContain('1등급 45회 이상');
  });
});
