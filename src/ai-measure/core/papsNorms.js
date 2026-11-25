// ai-measure/core/papsNorms.js
// ════════════════════════════════════════════════════════════════════════
//  PAPS 학년·성별 1~5등급 기준표 (초4~6, 윗몸말아올리기·앉아윗몸앞으로굽히기·악력).
//  · 출처: 대표님이 제공한 표(교육부 PAPS 매뉴얼 기준이라고 표기됨). 공식 원문과 한 줄씩 대조는 못 했다 → 'unverified'.
//    공식 원문 확인 후 틀린 칸이 있으면 이 파일의 숫자만 고치면 된다(판정 로직은 그대로).
//  · 값은 "등급별 하한" 배열 [1등급, 2등급, 3등급, 4등급] (이상이면 해당 등급, 모두 미만이면 5등급).
//    표의 소수 구간 사이 빈틈(예: 19.9~20.0)은 하한 비교라 생기지 않는다.
//  · 표에 없는 학년(초1~3·중·고)·테스트는 판정하지 않는다(임의 준용 금지).
//  · BMI(체지방)는 표가 "약"으로만 적혀 있어 넣지 않았다.
// ════════════════════════════════════════════════════════════════════════
export const PAPS_NORM_SOURCE = { label: '대표님 제공 PAPS 등급표(초4~6)', status: 'unverified' };

// NORMS[testId][sex][grade] = [g1, g2, g3, g4] 하한
export const PAPS_NORMS = {
  curlup: {
    male: { 초4: [40, 28, 18, 9], 초5: [48, 34, 22, 11], 초6: [56, 40, 26, 13] },
    female: { 초4: [34, 23, 14, 7], 초5: [40, 27, 17, 8], 초6: [44, 30, 19, 9] },
  },
  sitreach: {
    male: { 초4: [11.0, 7.0, 2.5, -2.5], 초5: [11.0, 7.0, 2.5, -2.5], 초6: [11.5, 7.5, 2.5, -2.5] },
    female: { 초4: [14.5, 10.5, 6.0, 1.0], 초5: [15.5, 11.5, 7.0, 2.0], 초6: [16.5, 12.5, 8.0, 3.0] },
  },
  grip: {
    male: { 초4: [20.0, 16.5, 13.0, 10.0], 초5: [23.5, 19.5, 15.5, 12.0], 초6: [28.0, 23.0, 18.0, 14.0] },
    female: { 초4: [18.5, 15.0, 12.0, 9.5], 초5: [21.5, 18.0, 14.5, 11.5], 초6: [24.5, 20.5, 16.5, 13.0] },
  },
};

export const PAPS_GRADE_WORD = { 1: '매우 우수', 2: '우수', 3: '보통', 4: '미흡', 5: '매우 미흡' };

export function papsNormRow(testId, sex, grade) {
  return PAPS_NORMS[testId]?.[sex]?.[grade] || null;
}

/** 값 → 1~5등급. 기준이 없으면 null. */
export function papsGradeOf(testId, value, { sex, grade } = {}) {
  const row = papsNormRow(testId, sex, grade);
  const v = Number(value);
  if (!row || value === '' || value == null || !Number.isFinite(v)) return null;
  for (let i = 0; i < row.length; i += 1) if (v >= row[i]) return i + 1;
  return 5;
}

/** 사람이 읽는 기준 한 줄. 예) "초5 남 1등급 48회 이상 · 2등급 34~47 …" */
export function papsNormText(testId, sex, grade, unit = '') {
  const row = papsNormRow(testId, sex, grade);
  if (!row) return '';
  const parts = row.map((lo, i) => `${i + 1}등급 ${lo}${unit} 이상`);
  parts.push(`5등급 ${row[3]}${unit} 미만`);
  return `${grade} ${sex === 'male' ? '남' : '여'}: ${parts.join(' · ')}`;
}
