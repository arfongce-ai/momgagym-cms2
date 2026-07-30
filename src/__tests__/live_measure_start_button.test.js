// live_measure_start_button.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-07-30 갱신] SLST·스쿼트는 처음엔 VBT/점프처럼 "버튼 → 3-2-1 카운트다운
//  → 시작"으로 만들었었는데, 이후 요청으로 ROM과 동일하게 "버튼을 누르면
//  카운트다운 없이 즉시 시작"하는 방식으로 다시 바꿨다(큰 원형 빨간 "녹화 시작"
//  버튼, ROM의 beginRecord()와 동일 패턴). 캘리브레이션 완료 후에도 트래커
//  생성·녹화 시작은 버튼을 눌러야 비로소 일어난다는 점(자동 시작 아님)은 그대로
//  유지한다 — 여기서 바뀐 건 "버튼 누른 다음에 카운트다운이 있냐 없냐"뿐이다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(process.cwd(), 'src');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe.each([
  'ai-measure/menus/SquatLiveAnalysis.jsx',
  'ai-measure/menus/StanceLiveAnalysis.jsx',
])('%s — ROM 스타일 즉시 시작 버튼(카운트다운 없음)', (path) => {
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

  it('startMeasurement은 카운트다운을 거치지 않고 즉시 트래커 생성 + 녹화를 시작한다', () => {
    const fnStart = src.indexOf('const startMeasurement');
    const fnEnd = src.indexOf('\n  };', fnStart);
    const body = src.slice(fnStart, fnEnd);
    expect(body).not.toMatch(/runStartCountdown/);
    expect(body).toMatch(/new (SquatBiomechanicsTracker|SingleLegStanceTracker)\(/);
    expect(body).toMatch(/beginRecording\(\);/);
  });

  it('버튼이 ROM과 동일한 스타일(큰 원형·빨간색·"녹화 시작" 2줄 텍스트)이다', () => {
    expect(src).toMatch(/녹화<br \/>시작/);
    expect(src).toMatch(/h-20 w-20 rounded-full border-4 border-white bg-red-500/);
    expect(src).toMatch(/disabled=\{status !== 'running'\}/);
  });
});
