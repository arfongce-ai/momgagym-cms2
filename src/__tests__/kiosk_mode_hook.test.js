// kiosk_mode_hook.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] useKioskMode.js 회귀 테스트.
//  이 훅은 기존에 다른 탭/창(storage 이벤트)에서 켜고 끈 상태를 동기화하는
//  로직이 있었으나 현재 배포본에는 빠져 있어 다시 추가했다. 값을 "변경한"
//  탭 자신에게는 storage 이벤트가 발생하지 않는 브라우저 특성 때문에,
//  실제 재현(멀티탭 e2e)이 아니라 소스 배선을 고정하는 테스트로 대신한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/hooks/useKioskMode.js'),
  'utf8',
);

describe('useKioskMode.js — 상태 저장·복원', () => {
  it('localStorage 키는 momi_kiosk_mode 를 그대로 쓴다', () => {
    expect(src).toMatch(/const STORAGE_KEY = 'momi_kiosk_mode';/);
  });

  it('초기 state는 localStorage 값을 읽어서 정한다', () => {
    expect(src).toMatch(/localStorage\.getItem\(STORAGE_KEY\) === 'on'/);
  });

  it('localStorage 접근 실패(예: 시크릿 모드)를 try/catch로 흡수한다', () => {
    const initBlock = src.slice(src.indexOf('useState(() => {'), src.indexOf('});'));
    expect(initBlock).toMatch(/try \{[\s\S]*catch \(e\) \{[\s\S]*return false;/);
  });

  it('kioskOn이 바뀔 때마다 localStorage에 on/off 문자열로 기록한다', () => {
    expect(src).toMatch(/localStorage\.setItem\(STORAGE_KEY, kioskOn \? 'on' : 'off'\)/);
  });
});

describe('useKioskMode.js — 탭 간 동기화(신규 복원)', () => {
  it('window storage 이벤트를 구독한다', () => {
    expect(src).toMatch(/window\.addEventListener\('storage', onStorage\)/);
  });

  it('언마운트 시 리스너를 해제한다(메모리 누수 방지)', () => {
    expect(src).toMatch(/return \(\) => window\.removeEventListener\('storage', onStorage\);/);
  });

  it('이 훅과 무관한 storage 키 변경은 무시한다', () => {
    const handlerBlock = src.slice(src.indexOf('const onStorage'), src.indexOf('window.addEventListener'));
    expect(handlerBlock).toMatch(/if \(e\.key !== STORAGE_KEY\) return;/);
  });

  it('다른 탭에서 바뀐 값(e.newValue)으로 state를 그대로 동기화한다', () => {
    expect(src).toMatch(/setKioskOn\(e\.newValue === 'on'\)/);
  });

  it('구독 이펙트는 마운트 시 1회만 등록한다(의존성 배열이 빈 배열)', () => {
    const idx = src.indexOf('const onStorage');
    const effectStart = src.lastIndexOf('useEffect(() => {', idx);
    const effectEnd = src.indexOf('}, []);', effectStart);
    expect(effectEnd).toBeGreaterThan(effectStart);
  });
});

describe('useKioskMode.js — enable/disable', () => {
  it('enableKiosk는 인증 검사 없이 즉시 켠다(문서화된 의도: 켜기는 누구나)', () => {
    expect(src).toMatch(/const enableKiosk = useCallback\(\(\) => setKioskOn\(true\), \[\]\);/);
  });

  it('disableKiosk 자체는 인증을 검사하지 않는다 — 호출부(관리자 재인증 성공 콜백)에서 보장해야 함', () => {
    expect(src).toMatch(/관리자 재인증\(reauth\) 성공 후에만 호출할 것/);
    expect(src).toMatch(/const disableKiosk = useCallback\(\(\) => setKioskOn\(false\), \[\]\);/);
  });

  it('kioskOn, enableKiosk, disableKiosk 세 가지를 반환한다', () => {
    expect(src).toMatch(/return \{ kioskOn, enableKiosk, disableKiosk \};/);
  });
});
