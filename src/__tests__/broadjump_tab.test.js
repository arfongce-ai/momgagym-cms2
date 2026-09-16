// broadjump_tab.test.js
// [제자리멀리뛰기(SBJ) 탭 분리 2026-09-16] registry.js에 'broadjump' 탭을
// 새로 등록하고, JumpAnalysisHub.jsx를 allowedSubTypes로 재사용하며,
// AiMeasureHub.jsx의 저장 분기(isJump)에 broadjump를 포함시킨 것을 검증한다.
// [한발멀리뛰기 추가 2026-09-16] 같은 탭에 SBJ(양발) 외에 한발멀리뛰기
// (정면/안쪽/바깥쪽) 3종을 추가하면서, fixedSubType(1개 고정)에서
// allowedSubTypes(부분집합 허용)로 일반화된 배선을 검증한다.
// 다른 정적 소스 패턴 테스트(jump_multi_trial.test.js 등)와 동일한 방식 —
// 실제 카메라·Firebase 없이 소스 코드 자체의 배선을 확인한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MEASURE_MENUS } from '../ai-measure/registry';
import { BROAD_JUMP_SUBTYPES, JUMP_SUBTYPES } from '../ai-measure/core/jumpTypes';

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

// [한발멀리뛰기 추가 2026-09-16]
describe('jumpTypes.js — BROAD_JUMP_SUBTYPES(제자리멀리뛰기 탭의 세부종류 4종)', () => {
  it('SBJ + 한발멀리뛰기 3방향(정면/안쪽/바깥쪽) 순서대로 정확히 4종이다', () => {
    expect(BROAD_JUMP_SUBTYPES).toEqual(['sbj', 'shjf', 'shjm', 'shjl']);
  });

  it('전부 engine이 horizontal이다(같은 계산 엔진 재사용 — 새로 안 만듦)', () => {
    BROAD_JUMP_SUBTYPES.forEach((k) => expect(JUMP_SUBTYPES[k].engine).toBe('horizontal'));
  });

  it('SBJ만 양발(singleLeg:false)이고 한발멀리뛰기 3종은 전부 singleLeg:true다', () => {
    expect(JUMP_SUBTYPES.sbj.singleLeg).toBe(false);
    expect(JUMP_SUBTYPES.shjf.singleLeg).toBe(true);
    expect(JUMP_SUBTYPES.shjm.singleLeg).toBe(true);
    expect(JUMP_SUBTYPES.shjl.singleLeg).toBe(true);
  });

  it('정면(shjf)은 SBJ와 같은 측면(side) 촬영, 안쪽/바깥쪽(shjm/shjl)은 정면(front) 촬영을 권장한다', () => {
    expect(JUMP_SUBTYPES.sbj.view).toBe('side');
    expect(JUMP_SUBTYPES.shjf.view).toBe('side');
    expect(JUMP_SUBTYPES.shjm.view).toBe('front');
    expect(JUMP_SUBTYPES.shjl.view).toBe('front');
  });
});

describe('JumpAnalysisHub.jsx — allowedSubTypes prop으로 세부종류 선택을 제한', () => {
  const src = readSrc('src', 'ai-measure', 'menus', 'JumpAnalysisHub.jsx');

  it('allowedSubTypes prop을 받고, 있으면 그 부분집합 중 첫 종류를 초기 jumpSubType으로 쓴다', () => {
    expect(src).toContain('allowedSubTypes = null');
    expect(src).toContain('const subTypeOrder = allowedSubTypes || JUMP_SUBTYPE_ORDER;');
    expect(src).toContain("useState(subTypeOrder[0] || 'cmj')");
  });

  it('subTypeOrder가 1개뿐이면(예전 fixedSubType과 동일 효과) 세부종류 선택 칩을 숨긴다', () => {
    expect(src).toContain('{subTypeOrder.length > 1 && (');
  });

  it('더 이상 fixedSubType(1개 고정 전용 prop)을 쓰지 않는다(allowedSubTypes로 일반화 완료)', () => {
    expect(src).not.toMatch(/fixedSubType\s*[:=]/);
  });
});

describe('AiMeasureHub.jsx — broadjump 탭 배선', () => {
  const src = readSrc('src', 'ai-measure', 'AiMeasureHub.jsx');

  it('broadjump 탭에 allowedSubTypes=BROAD_JUMP_SUBTYPES prop을 넘긴다', () => {
    expect(src).toContain("import { BROAD_JUMP_SUBTYPES } from './core/jumpTypes';");
    expect(src).toContain("active.id === 'broadjump' ? { allowedSubTypes: BROAD_JUMP_SUBTYPES }");
  });

  it('broadjump도 wideMeasure(넓은 레이아웃) 대상이다', () => {
    expect(src).toMatch(/wideMeasure = .*active\.id === 'broadjump'/);
  });

  it('저장 분기(isJump)에 broadjump를 포함한다 — 빠지면 SBJ/한발멀리뛰기 측정이 gait_reports에 저장 안 되는 데이터 유실 버그가 된다', () => {
    expect(src).toContain("const isJump = active.id === 'jump' || active.id === 'broadjump';");
  });
});

// [한발멀리뛰기 추가 2026-09-16]
describe('jumpBiomechanics.js — 한발멀리뛰기 좌우 비대칭(findHopAsymmetry)', () => {
  const src = readSrc('src', 'ai-measure', 'core', 'jumpBiomechanics.js');

  it('findSljAsymmetry는 기존 시그니처·동작을 그대로 유지한다(하위호환)', () => {
    expect(src).toContain('export function findSljAsymmetry({ reports, currentReport }) {');
  });

  it('findHopAsymmetry는 subType까지 받아 같은 방향끼리만 비교한다(정면 기록을 안쪽과 비교하지 않음)', () => {
    expect(src).toContain('export function findHopAsymmetry({ reports, currentReport, subType }) {');
    expect(src).toContain("valueField: 'distanceCm'");
  });
});
