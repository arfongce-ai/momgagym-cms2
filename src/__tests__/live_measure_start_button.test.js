// live_measure_start_button.test.js
// ════════════════════════════════════════════════════════════════════════
//  SLST·스쿼트 실시간 화면도 VBT/점프와 동일하게 "촬영 버튼 → 3-2-1 카운트다운
//  → 시작" 흐름을 따르도록 통일했다. 예전에는 캘리브레이션(가만히 서서 인식)이
//  끝나는 즉시 자동으로 트래커 생성·녹화·시행 판정이 시작돼서, 버튼을 누르는
//  다른 측정 화면들과 UX가 달랐다(트레이너 입장에선 "녹화 버튼이 없다"로 보임).
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(process.cwd(), 'src');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe.each([
  'ai-measure/menus/SquatLiveAnalysis.jsx',
  'ai-measure/menus/StanceLiveAnalysis.jsx',
])('%s — 촬영 시작 버튼 + 카운트다운', (path) => {
  const src = read(path);

  it('캘리브레이션 완료 분기는 uiPhase만 바꾸고, 트래커 생성·녹화 시작은 더 이상 여기서 하지 않는다', () => {
    const guardStart = src.indexOf('if (!calib.locked)');
    const guardEnd = src.indexOf('if (!measureStartedRef.current) return;');
    expect(guardStart).toBeGreaterThan(-1);
    expect(guardEnd).toBeGreaterThan(guardStart);
    const guardBlock = src.slice(guardStart, guardEnd);
    expect(guardBlock).not.toMatch(/beginRecording\(\)/);
    expect(guardBlock).not.toMatch(/new (SquatBiomechanicsTracker|SingleLegStanceTracker)\(/);
  });

  it('measureStartedRef가 true가 되기 전까지는 시행 판정 로직으로 진입하지 않는다', () => {
    expect(src).toMatch(/if \(!measureStartedRef\.current\) return;/);
  });

  it('3초 카운트다운이 끝나야 트래커 생성 + 녹화가 시작된다', () => {
    const fnStart = src.indexOf('const runStartCountdown');
    const fnEnd = src.indexOf('const startMeasurement');
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    expect(src.slice(fnStart, fnEnd)).toMatch(/let next = 3;/);
  });

  it('촬영 시작 버튼이 존재하고 카운트다운 중에는 비활성화된다', () => {
    expect(src).toMatch(/●\s*촬영\s*시작/);
    expect(src).toMatch(/disabled=\{countdown != null\}/);
  });

  it('CameraStage에 countdown을 전달해 화면 중앙에 숫자가 보이게 한다', () => {
    expect(src).toMatch(/countdown=\{countdown\}/);
  });
});
