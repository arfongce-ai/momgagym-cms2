// lint_crash_guard.test.js
// ════════════════════════════════════════════════════════════════════════
//  화면을 멈추게 하는 "정의되지 않은 이름" 오류를 npm test·회귀 게이트에서 잡는다.
//
//  배경(2026-09-23): ae7049f에서 1RM '영상만 저장' 버튼을 지우며 useState 선언까지 지웠지만
//  setVideoSavedMsg 호출은 남아, 1RM 추정 화면에서 카메라를 여는 순간 ReferenceError가 났다.
//  빌드(vite build)와 기존 테스트는 이 종류의 오류를 잡지 못한다 — 그래서 ESLint의 해당 규칙만
//  src 전체에 돌려, 오류가 0건인지 확인한다(.eslintrc.json 설정 그대로 사용).
//
//  잡는 규칙: no-undef(없는 변수·함수 호출), react/jsx-no-undef(없는 컴포넌트 사용),
//            react-hooks/rules-of-hooks(훅 호출 순서 위반 — 런타임 오류로 이어짐)
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import eslintPkg from 'eslint';

const { ESLint } = eslintPkg;
const CRASH_RULES = new Set(['no-undef', 'react/jsx-no-undef', 'react-hooks/rules-of-hooks']);

describe('실행 중 멈춤 예방 — 정의되지 않은 이름 사용 금지', () => {
  it('src 전체에 no-undef · jsx-no-undef · rules-of-hooks 오류가 0건이다', async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const results = await eslint.lintFiles(['src/**/*.js', 'src/**/*.jsx']);
    const hits = results.flatMap(r => r.messages
      .filter(m => CRASH_RULES.has(m.ruleId))
      .map(m => `${r.filePath.replace(/\\/g, '/').split('/src/').pop()}:${m.line} ${m.ruleId} — ${m.message}`));
    expect(hits).toEqual([]);
  }, 120000);
});
