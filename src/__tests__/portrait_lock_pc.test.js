// portrait_lock_pc.test.js
// ════════════════════════════════════════════════════════════════════════
//  버그: useLockPortrait이 브라우저 창의 가로/세로 비율(orientation: landscape)만
//  보고 차단 여부를 정했다. PC 모니터는 물리적으로 "세로로 돌릴" 수 없는데도,
//  넓은 창(landscape)이면 그대로 "세로로 돌려주세요" 안내로 막혀 PC 사용자가
//  AI 측정 화면에 영영 진입하지 못했다.
//  수정: 주 입력장치가 마우스/트랙패드(pointer: fine)인 PC에서는 이 잠금 자체를
//  건너뛴다(pointer: coarse인 터치기기에서만 적용).
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { shouldBlockPortrait } from '../ai-measure/core/useLockPortrait';

const root = join(process.cwd(), 'src');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('shouldBlockPortrait — PC/터치기기 판정 로직', () => {
  it('PC(주 입력장치가 마우스/트랙패드)는 가로여도 절대 차단하지 않는다', () => {
    expect(shouldBlockPortrait({ isTouchPrimary: false, isLandscape: true, nativeLocked: false })).toBe(false);
  });

  it('터치기기(폰/태블릿)에서 가로면 차단한다', () => {
    expect(shouldBlockPortrait({ isTouchPrimary: true, isLandscape: true, nativeLocked: false })).toBe(true);
  });

  it('터치기기에서 세로면 차단하지 않는다', () => {
    expect(shouldBlockPortrait({ isTouchPrimary: true, isLandscape: false, nativeLocked: false })).toBe(false);
  });

  it('네이티브 잠금(screen.orientation.lock)이 성공했으면 가로여도 차단하지 않는다', () => {
    expect(shouldBlockPortrait({ isTouchPrimary: true, isLandscape: true, nativeLocked: true })).toBe(false);
  });

  it('PC이면서 네이티브 잠금 상태여도(모순 상황) PC 우선으로 차단하지 않는다', () => {
    expect(shouldBlockPortrait({ isTouchPrimary: false, isLandscape: true, nativeLocked: true })).toBe(false);
  });
});

describe('useLockPortrait.js — PC 판별이 실제로 배선됐는지 소스 확인', () => {
  const hook = read('ai-measure/core/useLockPortrait.js');

  it('pointer: coarse로 터치 주 입력장치를 판별한다', () => {
    expect(hook).toMatch(/matchMedia\('\(pointer: coarse\)'\)/);
  });

  it('PC(터치 아님)면 잠금 로직 진입 전에 즉시 반환한다(가로 감지 로직을 타지 않음)', () => {
    const start = hook.indexOf('const isTouchPrimary');
    const guardEnd = hook.indexOf('let nativeLocked');
    const guard = hook.slice(start, guardEnd);
    expect(guard).toMatch(/if \(!isTouchPrimary\)\s*\{\s*setIsBlocked\(false\);\s*return undefined;\s*\}/);
  });

  it('기존 네이티브 잠금·가로감지 폴백 동작은 그대로 유지된다(회귀 방지)', () => {
    expect(hook).toMatch(/orientation\.lock\('portrait'\)/);
    expect(hook).toMatch(/matchMedia\('\(orientation: landscape\)'\)/);
    expect(hook).toMatch(/setIsBlocked/);
    expect(hook).toMatch(/return isBlocked/);
    expect(hook).not.toMatch(/rotate\(-90deg\)/);
  });
});
