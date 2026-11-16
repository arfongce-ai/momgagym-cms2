import { describe, it, expect } from 'vitest';
import fs from 'fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('2026-11-16 무효 기록도 결과 숫자를 보여준다', () => {
  it('점프·스쿼트·스탠스 리포트가 무효여도 QuickResultSheet 를 가리지 않는다', () => {
    ['jump', 'squat', 'stance'].forEach((k) => {
      const src = read(`ai-measure/menus/${k[0].toUpperCase()}${k.slice(1)}ReportDashboard.jsx`);
      expect(src).not.toMatch(/report\.valid !== false && <QuickResultSheet/);
      expect(src).toContain('<QuickResultSheet');
    });
    const jump = read('ai-measure/menus/JumpReportDashboard.jsx');
    expect(jump).not.toContain('report.valid === false ? (\n            <InvalidBlock');
  });
});

describe('심폐지구력 저장 위치 안내', () => {
  it('설정 화면과 저장 중/저장 후에 위치를 보여준다', () => {
    const src = read('ai-measure/menus/CardioTestMeasure.jsx');
    expect(src).toContain('cardio-save-where-setup');
    expect((src.match(/AI 측정 이력 → 심폐지구력\(VO2max\)/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('새로고침(당겨서) 차단', () => {
  it('CSS 와 JS 보조가 모두 설치된다', () => {
    expect(read('styles/index.css')).toMatch(/html, body, #root \{ overscroll-behavior: none; \}/);
    expect(read('main.jsx')).toContain('installPreventPullRefresh()');
  });
  it('맨 위에서 아래로 끌 때만 막고, 스크롤 중간이면 건드리지 않는다', async () => {
    const { scrollableAncestorAtTop } = await import('../utils/preventPullRefresh');
    const body = { nodeType: 1 };
    globalThis.document = { body, documentElement: { nodeType: 1 }, scrollingElement: { scrollTop: 0 } };
    globalThis.getComputedStyle = () => ({ overflowY: 'auto' });
    const box = { nodeType: 1, scrollHeight: 500, clientHeight: 100, scrollTop: 0, parentElement: body };
    expect(scrollableAncestorAtTop(box)).toBe(true);
    box.scrollTop = 50;
    expect(scrollableAncestorAtTop(box)).toBe(false);
    delete globalThis.document; delete globalThis.getComputedStyle;
  });
});
