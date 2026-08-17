// overlay_compare_registry.test.js
// ════════════════════════════════════════════════════════════════════════
//  '전/후 비교(오버레이)' 메뉴 추가 배선 확인 — ai_measure_2607b.test.js와
//  같은 정적 소스 패턴 테스트(회원 데이터·측정값을 저장/판정하지 않는 시각
//  비교 도구라 다른 측정처럼 리포트/저장 배선 테스트는 두지 않는다).
// ════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MEASURE_MENUS } from '../ai-measure/registry';

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf-8');

describe('registry.js — 전/후 비교(compare) 메뉴 등록', () => {
  it('compare 메뉴가 ready 상태로 컴포넌트와 함께 등록되어 있다', () => {
    const compare = MEASURE_MENUS.find((m) => m.id === 'compare');
    expect(compare).toBeTruthy();
    expect(compare.status).toBe('ready');
    expect(compare.component).toBeTruthy();
  });

  it('timer는 여전히 정렬 후 배열 맨 끝이다(기존 불변식 유지)', () => {
    const order = [...MEASURE_MENUS].sort((a, b) => a.no - b.no).map((m) => m.id);
    expect(order.indexOf('timer')).toBe(order.length - 1);
    expect(order[0]).toBe('body');
  });

  it('탭 순서(no)는 여전히 정수·중복 없이 오름차순이다', () => {
    const nos = MEASURE_MENUS.map((m) => m.no);
    const sorted = [...nos].sort((a, b) => a - b);
    expect(nos).toEqual(sorted);
    expect(new Set(nos).size).toBe(nos.length);
    expect(nos.every((n) => Number.isInteger(n))).toBe(true);
  });

  it('compare는 개별 측정 항목들(스쿼트까지) 뒤, 도구(녹화·초시계) 앞에 온다', () => {
    const order = [...MEASURE_MENUS].sort((a, b) => a.no - b.no).map((m) => m.id);
    expect(order.indexOf('squat')).toBeLessThan(order.indexOf('compare'));
    expect(order.indexOf('compare')).toBeLessThan(order.indexOf('record'));
    expect(order.indexOf('record')).toBeLessThan(order.indexOf('timer'));
  });
});

describe('AiMeasureHub.jsx — compare 화면은 넓은 레이아웃(max-w-6xl)을 쓴다', () => {
  const src = read('ai-measure/AiMeasureHub.jsx');
  it("wideMeasure 조건에 active.id === 'compare'가 포함되어 있다", () => {
    const idx = src.indexOf('const wideMeasure =');
    const line = src.slice(idx, src.indexOf(';', idx));
    expect(line).toContain("active.id === 'compare'");
  });
});
