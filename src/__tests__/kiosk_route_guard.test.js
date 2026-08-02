// kiosk_route_guard.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] App.jsx의 KioskGuard 회귀 테스트.
//  AppLayout의 메뉴 숨김은 "안 보이게"만 할 뿐이고, 주소창 직접 입력이나
//  북마크로는 우회될 수 있어 라우트 레벨 가드가 별도로 필요하다. 이 테스트는
//  그 이중 방어 배선이 유지되는지 소스 패턴으로 고정한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(process.cwd(), 'src/App.jsx'), 'utf8');

describe('App.jsx — KioskGuard', () => {
  it('useKioskMode에서 kioskOn을 가져온다', () => {
    expect(src).toMatch(/const \{ kioskOn \} = useKioskMode\(\);/);
  });

  it('허용 경로는 /ai, /ai\\/*, /report, /report\\/* 뿐이다', () => {
    const guardStart = src.indexOf('function KioskGuard');
    const guardEnd = src.indexOf('\n}', guardStart);
    const body = src.slice(guardStart, guardEnd);
    expect(body).toMatch(/location\.pathname === '\/ai'/);
    expect(body).toMatch(/location\.pathname\.startsWith\('\/ai\/'\)/);
    expect(body).toMatch(/location\.pathname === '\/report'/);
    expect(body).toMatch(/location\.pathname\.startsWith\('\/report\/'\)/);
  });

  it('키오스크 on + 비허용 경로면 /ai로 리다이렉트한다', () => {
    expect(src).toMatch(/if \(kioskOn && !allowed\) \{\s*return <Navigate to="\/ai" replace \/>;/);
  });

  it('KioskGuard는 Routes 바깥(상위)에서 감싸 모든 경로 전환에 적용된다', () => {
    const layoutStart = src.indexOf('<AppLayout');
    const guardOpenIdx = src.indexOf('<KioskGuard>', layoutStart);
    const routesIdx = src.indexOf('<Routes>', layoutStart);
    expect(guardOpenIdx).toBeGreaterThan(-1);
    expect(guardOpenIdx).toBeLessThan(routesIdx);
  });

  it('/login 라우트는 KioskGuard가 감싸는 트리 바깥에 있다(로그인 자체를 막지 않기 위해)', () => {
    const loginIdx = src.indexOf("path=\"/login\"");
    const guardIdx = src.indexOf('function KioskGuard');
    expect(loginIdx).toBeGreaterThan(-1);
    // /login 라우트 선언이 KioskGuard 컴포넌트 렌더 트리(<KioskGuard> JSX) 안에 있지 않은지 확인
    const kioskJsxOpen = src.indexOf('<KioskGuard>');
    const kioskJsxClose = src.indexOf('</KioskGuard>');
    expect(loginIdx < kioskJsxOpen || loginIdx > kioskJsxClose).toBe(true);
  });
});
