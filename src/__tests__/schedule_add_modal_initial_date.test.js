// src/__tests__/schedule_add_modal_initial_date.test.js
// ════════════════════════════════════════════════════════════════════════
//  요청(2026-08-19): "스케줄 예약에서 날짜를 누르면 해당 날짜에 예약될 수
//  있게 해주세요" — 예전엔 주/월 뷰에서 날짜를 눌러 이동해도(pivot 변경)
//  "+ 예약" 폼(AddModal)은 항상 오늘 날짜로만 열렸다(AddModal 내부에서
//  `const today = fmt(new Date())`로 고정 초기화). 이제 Schedule.jsx가 현재
//  보고 있는 날짜(pivot)를 AddModal에 initialDate로 넘기고, AddModal은 그
//  값으로 폼을 초기화한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../pages/Schedule.jsx', import.meta.url), 'utf8');

describe('Schedule.jsx — "+ 예약" 폼이 현재 보고 있는 날짜로 열린다', () => {
  it('AddModal이 initialDate prop을 받아 폼 초기 날짜로 쓴다(오늘 고정이 아님)', () => {
    expect(src).toMatch(/function AddModal\(\{[^}]*initialDate[^}]*\}\)/);
    expect(src).toMatch(/const today = initialDate \|\| fmt\(new Date\(\)\);/);
  });

  it('Schedule 페이지가 AddModal에 현재 pivot(보고 있는 날짜)을 initialDate로 넘긴다', () => {
    const addModalCall = src.match(/<AddModal[\s\S]*?onClose=\{[^}]*\}\s*\/>/)?.[0] || '';
    expect(addModalCall).toContain('initialDate={pivot}');
  });

  it('주/월 뷰의 날짜 클릭은 여전히 pivot을 갱신한다(그래야 "+ 예약"이 그 날짜로 열림)', () => {
    // 주 뷰 요일 헤더 클릭
    expect(src).toMatch(/onClick=\{\(\)=>\{ setPivot\(date\); setView\('day'\); \}\}/);
    // 월 뷰 날짜 셀 클릭(onDayClick 콜백을 통해 동일하게 pivot 갱신)
    expect(src).toMatch(/onDayClick=\{\(date\)=>\{ setPivot\(date\); setView\('day'\); \}\}/);
  });
});
