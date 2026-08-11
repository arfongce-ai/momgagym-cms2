// [라이트모드 2026-08-11] 다크모드를 꺼도 글자가 안 보이던 버그의 근본 원인
// (body만 인라인으로 바뀌고 나머지는 하드코딩 다크라 안 바뀜)을 고친 기반
// 구조 + 스크린샷으로 신고받은 3개 화면(AI측정/회원관리/스케줄)이 이제
// dark: variant를 쓰는지 정적 소스 패턴으로 검증. 실제 렌더링(jsdom)은 이
// 프로젝트에 없어서(voice_control_timer_ui_wiring.test.js 등과 동일한
// 컨벤션) 색상까지는 못 보지만, "하드코딩 다크 전용 클래스로 되돌아가지
//않는지"는 이 정도로도 충분히 잡아낼 수 있다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

describe('index.css — 라이트모드 기반 CSS 변수 구조', () => {
  const css = readSrc('src', 'styles', 'index.css');

  it(':root(라이트 기본값)와 .dark(다크 오버라이드) 블록이 둘 다 있다', () => {
    expect(css).toContain(':root {');
    expect(css).toContain('.dark {');
    // :root는 밝은 배경(흰색 계열), .dark는 기존 어두운 배경값을 유지해야 한다.
    const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('.dark {'));
    expect(rootBlock).toContain('--bg:#f8fafc');
    const darkBlock = css.slice(css.indexOf('.dark {'), css.indexOf('.dark {') + 400);
    expect(darkBlock).toContain('--bg:#0b1120');
  });

  it('고아 상태였던 죽은 라이트모드 규칙([data-theme="light"]/.light-mode)이 제거됐다(회귀 방지 — 아무 데서도 안 켜지던 데드 코드)', () => {
    expect(css).not.toContain('[data-theme="light"]');
    expect(css).not.toContain('.light-mode');
  });

  it('공용 컴포넌트 클래스(.card/.input/.panel/.badge-ok 등)가 dark: variant를 쓴다(여기 한 곳 고치면 수십 개 파일에 자동 적용되는 핵심 레버리지)', () => {
    for (const cls of ['.card {', '.panel {', '.input {', '.badge-ok {', '.badge-warn {', '.badge-bad {', '.measure-title {']) {
      const idx = css.indexOf(cls);
      expect(idx, `${cls} 정의를 못 찾음`).toBeGreaterThan(-1);
      const line = css.slice(idx, css.indexOf('\n', idx));
      expect(line, `${cls}에 dark: variant가 없음`).toContain('dark:');
    }
  });

  it('모달(.modal-box)과 세로안내(.ai-rotate-hint)는 CSS 변수를 써서 테마를 따라간다(하드코딩 hex 제거)', () => {
    const modalIdx = css.indexOf('.modal-box {');
    const modalBlock = css.slice(modalIdx, css.indexOf('}', modalIdx));
    expect(modalBlock).toContain('var(--surface)');
    expect(modalBlock).not.toContain('#0f172a');

    const hintIdx = css.indexOf('.ai-rotate-hint {');
    const hintBlock = css.slice(hintIdx, css.indexOf('}', hintIdx));
    expect(hintBlock).toContain('var(--surface)');
  });

  it('카메라 스테이지(.measure-camera/.cam-stage)는 의도적으로 검정 고정 유지(카메라 뷰파인더는 테마 무관 — 회귀 방지: 실수로 바꾸지 않았는지)', () => {
    const camIdx = css.indexOf('.measure-camera {');
    const camBlock = css.slice(camIdx, css.indexOf('}', css.indexOf('}', camIdx) + 1));
    expect(camBlock).toContain('bg-black');
  });
});

describe('App.jsx — 다크모드 토글 메커니즘', () => {
  const src = readSrc('src', 'App.jsx');

  it('.dark 클래스 토글은 유지하되, body 인라인 스타일 직접 조작은 제거됐다(이제 CSS가 전담 — 버그의 근본 원인이었던 "일부만 바뀌는" 구조 제거)', () => {
    expect(src).toContain("document.documentElement.classList.toggle('dark', darkMode)");
    expect(src).not.toContain('document.body.style.background');
    expect(src).not.toContain('document.body.style.color');
  });

  it('AppLayout에 더 이상 darkMode prop을 넘기지 않는다(AppLayout이 이제 dark: variant로 직접 처리)', () => {
    expect(src).not.toContain('<AppLayout darkMode={darkMode}>');
  });
});

describe('AppLayout.jsx — darkMode prop 기반 삼항연산자를 dark: variant로 통일', () => {
  const src = readSrc('src', 'components', 'layout', 'AppLayout.jsx');

  it('darkMode prop을 더 이상 받지 않는다(prop drilling 없이 dark: variant로 직접 처리)', () => {
    expect(src).toContain('export default function AppLayout({ children }) {');
    expect(src).not.toContain('darkMode');
  });

  it('사이드바·모바일헤더·하단네비가 전부 dark: variant를 쓴다(스크린샷에서 신고된 화면들을 감싸는 공통 셸)', () => {
    expect(src).toMatch(/bg-white dark:bg-slate-900/);
    expect(src).toMatch(/border-slate-200 dark:border-slate-800/);
  });
});

describe.each([
  ['AiMeasureHub.jsx (스크린샷 3 — AI 측정·분석)', 'src/ai-measure/AiMeasureHub.jsx'],
  ['Members.jsx (스크린샷 2 — 회원 관리)', 'src/pages/Members.jsx'],
  ['Schedule.jsx (스크린샷 1 — 스케줄 월간뷰)', 'src/pages/Schedule.jsx'],
])('%s — 라이트모드 대응', (label, path) => {
  const src = readSrc(path);

  it('dark: variant를 실제로 쓴다(하드코딩 다크 전용에서 벗어남)', () => {
    expect(src).toMatch(/dark:bg-slate-900|dark:bg-slate-800/);
  });
});

describe('AiMeasureHub.jsx — 메뉴 카드 제목 글자색 누락 버그(신고된 정확한 증상) 수정 확인', () => {
  const src = readSrc('src', 'ai-measure', 'AiMeasureHub.jsx');

  it('카드 제목 <p>가 이제 명시적 색상 클래스를 갖는다(예전엔 색상 클래스가 없어 body 상속에 기대다가, 다크모드를 끄면 카드 배경은 그대로 어두운데 글자만 검정으로 바뀌어 안 보이던 게 원래 버그)', () => {
    const idx = src.indexOf('{menu.no}. {menu.title}');
    const lineStart = src.lastIndexOf('<p', idx);
    const tag = src.slice(lineStart, idx);
    expect(tag).toContain('text-slate-900');
    expect(tag).toContain('dark:text-slate-100');
  });
});

describe('TrainerBadge.jsx — 잔여세션 배지 색상 라이트모드 대응', () => {
  const src = readSrc('src', 'components', 'common', 'TrainerBadge.jsx');

  it('emerald/amber/red 텍스트 색이 전부 dark: variant를 쓴다(밝은 배경에서도 대비 확보)', () => {
    expect(src).toContain('text-emerald-700 dark:text-emerald-400');
    expect(src).toContain('text-amber-700 dark:text-amber-400');
    expect(src).toContain('text-red-700 dark:text-red-400');
  });
});
