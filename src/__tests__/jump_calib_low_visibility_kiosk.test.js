// jump_calib_low_visibility_kiosk.test.js
// ════════════════════════════════════════════════════════════════════════
//  2026-07-31: "키오스크 모드에서 발목(복숭아뼈)을 못 잡는다 — 점프해도
//  측정이 안 된다, 폰 모드는 되는데 키오스크는 안 된다"는 리포트.
//  jumpBiomechanics.js에 이미 07-30에 minVisibility 0.3→0.2로 한 번
//  완화한 기록이 있었지만(같은 증상), 그걸로도 부족했다는 뜻이라 한 단계
//  더(0.2→0.12) 낮췄고, calibMinVisRatio도 0.8→0.6으로 낮췄다. 또한
//  StandingCalibrator.status()가 실제 인식률(visRatio)을 반환하지 않아
//  화면에 "인식률 N%" 같은 구체적 진단을 못 보여주고 있었다 — 이제
//  status()가 visRatio를 반환하고, 화면 메시지도 이 값을 쓴다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JUMP_TUNING, StandingCalibrator } from '../ai-measure/core/jumpBiomechanics.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const makeLm = ({ feetY = 0.9, pelvisY = 0.6, headY = 0.1, vis = 0.95 } = {}) => {
  const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: vis }));
  a[0] = { x: 0.5, y: headY, visibility: vis };
  a[23] = { x: 0.45, y: pelvisY, visibility: vis };
  a[24] = { x: 0.55, y: pelvisY, visibility: vis };
  a[27] = { x: 0.45, y: feetY, visibility: vis };
  a[28] = { x: 0.55, y: feetY, visibility: vis };
  return a;
};

describe('JUMP_TUNING — 가시성 문턱이 07-30보다 한 단계 더 완화됐다', () => {
  it('minVisibility가 0.2가 아니라 0.12다', () => {
    expect(JUMP_TUNING.minVisibility).toBeCloseTo(0.12, 6);
  });
  it('calibMinVisRatio가 0.8이 아니라 0.6이다', () => {
    expect(JUMP_TUNING.calibMinVisRatio).toBeCloseTo(0.6, 6);
  });
});

describe('StandingCalibrator.status() — 실제 인식률(visRatio)을 반환한다', () => {
  it('가시성 0.15(구 0.2 기준선 미달, 신 0.12 기준선은 통과)인 발목도 표본으로 쌓인다', () => {
    const calib = new StandingCalibrator({ heightCm: 170 });
    for (let i = 0; i < 12; i++) calib.push(makeLm({ vis: 0.15 }));
    const st = calib.status();
    expect(st.visRatio).toBeGreaterThan(0.9); // 거의 모든 프레임이 표본으로 잡혔어야 함
  });

  it('가시성이 0.12 문턱보다도 낮으면(예: 0.05) 여전히 low_visibility로 남고, visRatio가 낮게 나온다', () => {
    const calib = new StandingCalibrator({ heightCm: 170 });
    for (let i = 0; i < 12; i++) calib.push(makeLm({ vis: 0.05 }));
    const st = calib.status();
    expect(st.ready).toBe(false);
    expect(st.reason).toBe('low_visibility');
    expect(st.visRatio).toBeCloseTo(0, 6);
  });

  it('locked 상태에서도 visRatio를 반환한다(=1)', () => {
    const calib = new StandingCalibrator({ heightCm: 170 });
    for (let i = 0; i < 20; i++) calib.push(makeLm({ vis: 0.95 }));
    expect(calib.locked).toBe(true);
    expect(calib.status().visRatio).toBe(1);
  });
});

describe('JumpPrecisionAnalysis.jsx — low_visibility 메시지가 실제 인식률(%)을 보여준다', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/ai-measure/menus/JumpPrecisionAnalysis.jsx'),
    'utf8',
  );
  it("고정 문구가 아니라 st.visRatio 기반 퍼센트를 메시지에 넣는다", () => {
    expect(src).toMatch(/발\/골반 인식률 \$\{Math\.round\(\(st\.visRatio \|\| 0\) \* 100\)\}%/);
  });
});
