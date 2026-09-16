// broadjump_tab.test.js
// [제자리멀리뛰기(SBJ) 탭 분리 2026-09-16] registry.js에 'broadjump' 탭을
// 새로 등록하고, JumpAnalysisHub.jsx를 fixedSubType='sbj'로 재사용하며,
// AiMeasureHub.jsx의 저장 분기(isJump)에 broadjump를 포함시킨 것을 검증한다.
// 다른 정적 소스 패턴 테스트(jump_multi_trial.test.js 등)와 동일한 방식 —
// 실제 카메라·Firebase 없이 소스 코드 자체의 배선을 확인한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MEASURE_MENUS } from '../ai-measure/registry';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

describe('registry.js — broadjump(제자리멀리뛰기) 탭 등록', () => {
  it('jump(5번) 바로 다음(6번)에 별도 탭으로 등록되어 있다', () => {
    const jump = MEASURE_MENUS.find((m) => m.id === 'jump');
    const broadjump = MEASURE_MENUS.find((m) => m.id === 'broadjump');
    expect(jump).toBeTruthy();
    expect(broadjump).toBeTruthy();
    expect(broadjump.no).toBe(jump.no + 1);
    expect(broadjump.status).toBe('ready');
    expect(broadjump.component).toBeTruthy();
  });

  it('탭 순번(no)은 여전히 1..N 정수 오름차순, 중복 없음(renumbering 검증)', () => {
    const nos = MEASURE_MENUS.map((m) => m.no);
    const sorted = [...nos].sort((a, b) => a - b);
    expect(nos).toEqual(sorted);
    expect(new Set(nos).size).toBe(nos.length);
    expect(nos.every((n) => Number.isInteger(n))).toBe(true);
  });

  it('jump 탭과 동일한 컴포넌트(JumpAnalysisHub.jsx)를 재사용한다(새로 안 만듦)', () => {
    const src = readSrc('src', 'ai-measure', 'registry.js');
    const jumpBlock = src.slice(src.indexOf("id: 'jump'"), src.indexOf("id: 'broadjump'"));
    const broadjumpBlock = src.slice(src.indexOf("id: 'broadjump'"), src.indexOf("id: 'sprint'"));
    expect(jumpBlock).toContain("JumpAnalysisHub.jsx'");
    expect(broadjumpBlock).toContain("JumpAnalysisHub.jsx'");
  });
});

describe('JumpAnalysisHub.jsx — fixedSubType prop으로 SBJ 전용 탭 지원', () => {
  const src = readSrc('src', 'ai-measure', 'menus', 'JumpAnalysisHub.jsx');

  it('fixedSubType prop을 받고, 있으면 초기 jumpSubType으로 쓴다', () => {
    expect(src).toContain('fixedSubType = null');
    expect(src).toContain("useState(fixedSubType || 'cmj')");
  });

  it('fixedSubType이 있으면 세부종류 선택 칩을 숨긴다', () => {
    expect(src).toContain('{!fixedSubType && (');
  });
});

describe('AiMeasureHub.jsx — broadjump 탭 배선', () => {
  const src = readSrc('src', 'ai-measure', 'AiMeasureHub.jsx');

  it('broadjump 탭에 fixedSubType="sbj" prop을 넘긴다', () => {
    expect(src).toContain("active.id === 'broadjump' ? { fixedSubType: 'sbj' }");
  });

  it('broadjump도 wideMeasure(넓은 레이아웃) 대상이다', () => {
    expect(src).toMatch(/wideMeasure = .*active\.id === 'broadjump'/);
  });

  it('저장 분기(isJump)에 broadjump를 포함한다 — 빠지면 SBJ 측정이 gait_reports에 저장 안 되는 데이터 유실 버그가 된다', () => {
    expect(src).toContain("const isJump = active.id === 'jump' || active.id === 'broadjump';");
  });
});
