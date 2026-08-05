// kiosk_nav_filter.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] AppLayout.jsx의 키오스크 모드 메뉴 필터링 회귀 테스트.
//  KIOSK_ALLOWED 화이트리스트가 App.jsx의 KioskGuard 허용 경로(/ai, /report)와
//  어긋나면 "메뉴엔 안 보이는데 주소창으로는 되는" 혹은 그 반대의 불일치가
//  생길 수 있어, 두 파일이 같은 경로 목록을 쓰는지 함께 확인한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const layoutSrc = readFileSync(
  join(process.cwd(), 'src/components/layout/AppLayout.jsx'),
  'utf8',
);
const appSrc = readFileSync(join(process.cwd(), 'src/App.jsx'), 'utf8');

describe('AppLayout.jsx — 키오스크 메뉴 화이트리스트', () => {
  it("KIOSK_ALLOWED는 ['/ai', '/report'] 이다", () => {
    expect(layoutSrc).toMatch(/const KIOSK_ALLOWED = \['\/ai', '\/report'\];/);
  });

  it('KIOSK_ALLOWED가 App.jsx KioskGuard의 허용 경로와 같은 두 경로를 가리킨다(불일치 방지)', () => {
    const listed = layoutSrc.match(/const KIOSK_ALLOWED = \[(.*?)\];/)?.[1] ?? '';
    for (const p of ["'/ai'", "'/report'"]) {
      expect(listed).toContain(p);
      expect(appSrc).toContain(p);
    }
  });

  it('kioskOn일 때 사이드바 nav를 KIOSK_ALLOWED로 필터링한다', () => {
    expect(layoutSrc).toMatch(
      /const visibleNav = kioskOn \? NAV\.filter\(it => KIOSK_ALLOWED\.includes\(it\.path\)\) : NAV;/,
    );
  });

  it('kioskOn일 때 모바일 하단탭도 필터링된 visibleNav를 그대로 쓴다', () => {
    expect(layoutSrc).toMatch(/const mobileTabs = kioskOn\s*\?\s*visibleNav/);
  });

  it('kioskOn일 때 "전체" 메뉴 시트 버튼을 렌더링하지 않는다', () => {
    expect(layoutSrc).toMatch(/\{!kioskOn && \(/);
  });

  it('kioskOn일 때 전역 음성 명령("모미야") 컴포넌트를 아예 마운트하지 않는다', () => {
    expect(layoutSrc).toMatch(/\{!kioskOn && <GlobalVoiceCommand \/>\}/);
  });

  it('키오스크 해제는 AdminLockGate(관리자 재인증)를 통해서만 가능하다', () => {
    expect(layoutSrc).toMatch(/<AdminLockGate title="키오스크 모드 해제"/);
    expect(layoutSrc).toMatch(/<KioskUnlockTrigger onUnlock=\{handleUnlockSuccess\}/);
  });

  it('키오스크 켜기는 재인증 없이 즉시 실행된다(문서화된 의도)', () => {
    expect(layoutSrc).toMatch(/<button onClick=\{enableKiosk\}/);
  });
});
