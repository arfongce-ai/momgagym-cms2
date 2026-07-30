// live_measure_start_button.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-07-30 두 번째 갱신] "촬영은 누가 하나?" 문제 — 예전엔 버튼이
//  uiPhase==='ready'(=캘리브레이션 완료) 일 때만 렌더링돼서, 촬영 대상자
//  본인이 카메라 앞에 이미 서 있어야만 버튼을 누를 수 있었다(그 사람이
//  동시에 노트북 앞에도 있어야 하는 모순). 이제 버튼은 캘리브레이션 상태와
//  무관하게 항상 눌를 수 있고, 트래커 생성은 "버튼이 눌렸는지"와 "캘리브레이션이
//  끝났는지" 중 나중에 만족되는 시점에 handleResult 안에서 일어난다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(process.cwd(), 'src');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe.each([
  ['ai-measure/menus/SquatLiveAnalysis.jsx', 'SquatBiomechanicsTracker'],
  ['ai-measure/menus/StanceLiveAnalysis.jsx', 'SingleLegStanceTracker'],
])('%s — 캘리브레이션과 무관하게 언제든 누를 수 있는 녹화 시작 버튼', (path, trackerName) => {
  const src = read(path);

  it('startMeasurement은 캘리브레이션 완료를 요구하지 않고, 카운트다운도 없이 즉시 armed 상태로 전환한다', () => {
    const fnStart = src.indexOf('const startMeasurement');
    const fnEnd = src.indexOf('\n  };', fnStart);
    const body = src.slice(fnStart, fnEnd);
    expect(body).not.toMatch(/calibRef\.current\?\.locked/);
    expect(body).not.toMatch(/runStartCountdown/);
    expect(body).not.toMatch(new RegExp(`new ${trackerName}\\(`));
    expect(body).toMatch(/measureStartedRef\.current = true;/);
    expect(body).toMatch(/beginRecording\(\);/);
  });

  it('버튼을 캘리브레이션보다 먼저 눌러둔 경우: 캘리브레이션이 막 끝나는 시점(st.ready 분기)에 트래커를 생성한다', () => {
    const guardStart = src.indexOf('if (!calib.locked)');
    const guardEnd = src.indexOf('if (!measureStartedRef.current) return;');
    const guardBlock = src.slice(guardStart, guardEnd);
    expect(guardBlock).toMatch(/if \(st\.ready\)/);
    expect(guardBlock).toMatch(/measureStartedRef\.current && !trackerRef\.current/);
    expect(guardBlock).toMatch(new RegExp(`new ${trackerName}\\(`));
  });

  it('캘리브레이션이 버튼보다 먼저 끝난 경우: 버튼을 누른 직후(측정 게이트 통과 후)에 트래커를 생성한다', () => {
    const gateStart = src.indexOf('if (!measureStartedRef.current) return;');
    const tracker1Start = src.indexOf('const tracker = trackerRef.current;', gateStart);
    const between = src.slice(gateStart, tracker1Start);
    expect(gateStart).toBeGreaterThan(-1);
    expect(tracker1Start).toBeGreaterThan(gateStart);
    expect(between).toMatch(/if \(!trackerRef\.current\)/);
    expect(between).toMatch(new RegExp(`new ${trackerName}\\(`));
  });

  it('버튼이 ROM과 동일한 스타일이고, 캘리브레이션 진행 중이어도(calibrating/low_visibility) 렌더링된다', () => {
    expect(src).toMatch(/녹화<br \/>시작/);
    expect(src).toMatch(/h-20 w-20 rounded-full border-4 border-white bg-red-500/);
    // 버튼 렌더 조건에 uiPhase === 'ready' 같은 제약이 더 이상 없어야 한다.
    const btnStart = src.lastIndexOf('h-20 w-20 rounded-full border-4 border-white bg-red-500');
    const before = src.slice(Math.max(0, btnStart - 200), btnStart);
    expect(before).not.toMatch(/uiPhase === 'ready' && !started/);
  });
});
