// measure_hud_aspect_wiring.test.js
//  · 소스 배선 회귀 보호: (1) 바벨 리프팅 저장이 세션+리포트로 흐르는지,
//    (2) 전 측정 모듈이 게이지형 HUD(GaugeHud/drawGaugeHud)를 쓰는지,
//    (3) 녹화가 공통 비율(recordAspect)로 통일됐는지.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(process.cwd(), 'src');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('바벨 리프팅 저장 → 세션·리포트 배선', () => {
  const hub = read('ai-measure/AiMeasureHub.jsx');

  it('handleSave 가 lifting 분기를 처리하고 저장된 세션을 반환한다', () => {
    expect(hub).toContain("active.id === 'lifting'");
    expect(hub).toContain('const savedSession = await aiStore.addSession');
    expect(hub).toMatch(/if \(isLifting\)\s*\{\s*return savedSession;/);
  });

  it('BarbellLiftingHub 는 저장 세션의 data 를 펼쳐 리포트로 전환한다', () => {
    const bar = read('ai-measure/menus/BarbellLiftingHub.jsx');
    expect(bar).toContain('res.data');
    expect(bar).toContain("setView('report')");
    expect(bar).toContain('LiftingReportDashboard');
  });
});

describe('게이지형 HUD 채택(실시간 + 녹화 번인)', () => {
  it('공통 게이지 컴포넌트/드로어가 존재한다', () => {
    expect(read('ai-measure/menus/GaugeHud.jsx')).toContain('export default function GaugeHud');
    expect(read('ai-measure/core/recordingOverlay.js')).toContain('export function drawGaugeHud');
  });

  for (const file of [
    'ai-measure/menus/RomMeasure.jsx',
    'ai-measure/menus/VbtMeasure.jsx',
    'ai-measure/menus/OneRMEstimate.jsx',
    'ai-measure/menus/GaitRunningAnalysis.jsx',
    'ai-measure/menus/JumpPrecisionAnalysis.jsx',
  ]) {
    it(`${file} → 실시간 GaugeHud 사용`, () => {
      expect(read(file)).toContain('<GaugeHud');
    });
  }

  for (const file of [
    'ai-measure/menus/RomMeasure.jsx',
    'ai-measure/menus/GaitRunningAnalysis.jsx',
    'ai-measure/menus/JumpPrecisionAnalysis.jsx',
    'ai-measure/menus/OneRMEstimate.jsx',
  ]) {
    it(`${file} → 녹화 번인 drawGaugeHud 사용`, () => {
      expect(read(file)).toContain('drawGaugeHud');
    });
  }
});

describe('녹화 비율 통일(recordAspect)', () => {
  for (const file of [
    'ai-measure/menus/RomMeasure.jsx',
    'ai-measure/menus/VbtMeasure.jsx',
    'ai-measure/menus/OneRMEstimate.jsx',
    'ai-measure/menus/LiftingMeasure.jsx',
  ]) {
    it(`${file} → outputSize + drawVideoCover 로 고정 비율 녹화`, () => {
      const src = read(file);
      expect(src).toContain("from '../core/recordAspect'");
      expect(src).toContain('outputSize(aspectRef.current)');
      expect(src).toContain('drawVideoCover(ctx, video');
    });
  }

  it('CameraStage 가 비율 크롭 가이드(aspectFrame)를 지원한다', () => {
    expect(read('ai-measure/menus/CameraStage.jsx')).toContain('aspectFrame');
  });
});

describe('게이지 값 null-safe (회귀: Number(null)===0 유출 방지)', () => {
  it('GaugeHud 는 null/빈값을 값없음으로 처리한다', () => {
    const src = read('ai-measure/menus/GaugeHud.jsx');
    expect(src).toContain("value != null && value !== ''");
    // Number(value) 를 곧바로 유한성 판정하지 않는다(널 유출 방지)
    expect(src).not.toMatch(/const v = Number\(value\);\s*\n\s*const hasV = Number\.isFinite\(v\);/);
  });

  it('drawGaugeHud 도 동일하게 null 을 -- 로 처리한다', () => {
    const src = read('ai-measure/core/recordingOverlay.js');
    expect(src).toContain("gv != null && gv !== ''");
  });
});
