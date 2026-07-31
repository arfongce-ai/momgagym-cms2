// squat_live_two_reps_per_view.test.js
// ════════════════════════════════════════════════════════════════════════
//  버그: 오버헤드 딥 스쿼트 라이브 화면이 정면 1회·측면 1회에서 바로 다음
//  단계로 넘어갔다(SquatBiomechanicsTracker를 매번 maxTrials:1로 생성). 실제
//  운영은 정면 2회 → 측면 2회라, 회원이 1회 하자마자 화면이 다음 단계로
//  넘어가버려 두 번째 반복을 받아주지 않았다 — "인식·촬영이 잘 안 된다"로
//  이어짐. 2026-07-31: 뷰당 maxTrials를 2로 올리고, 1회차 완료 시점엔
//  'rep_done'(대기) 상태로만 머물다 2회차까지 채워야 다음 단계로 넘어가도록
//  수정. 최종 제출 시에는 tracker.summary()의 {trial1,trial2}를 그대로
//  front1/front2, side1/side2로 넘겨 squatBiomechanics.js의 새 4-트라이얼
//  결합 경로로 들어간다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/SquatLiveAnalysis.jsx'),
  'utf8',
);

describe('SquatLiveAnalysis.jsx — 정면 2회 + 측면 2회로 측정한다', () => {
  it('SQUAT_LIVE_MAX_TRIALS_PER_VIEW가 2다', () => {
    expect(src).toMatch(/const SQUAT_LIVE_MAX_TRIALS_PER_VIEW = 2;/);
  });

  it('두 트래커 생성부 모두 maxTrials: 1이 아니라 상수를 쓴다(고정 1회 잔존 없음)', () => {
    expect(src).not.toMatch(/new SquatBiomechanicsTracker\(calib\.result, \{ maxTrials: 1 \}\)/);
    const matches = src.match(/new SquatBiomechanicsTracker\(calib\.result, \{ maxTrials: SQUAT_LIVE_MAX_TRIALS_PER_VIEW \}\)/g) || [];
    expect(matches.length).toBe(2);
  });

  it("반복 1개 완료 시 tracker.trials.length가 maxTrials 미만이면 'rep_done'으로 머물고, 다 채워야만 다음 단계로 넘어간다", () => {
    const idx = src.indexOf('tracker.trials.length > beforeCount');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 1000);
    expect(block).toMatch(/tracker\.trials\.length >= tracker\.maxTrials/);
    expect(block).toMatch(/setUiPhase\('rep_done'\)/);
    expect(block).toMatch(/frontSummaryRef\.current = tracker\.summary\(\)/);
  });

  it("finishAndSubmit이 tracker.summary()로 front1/front2/side1/side2를 조립한다", () => {
    const idx = src.indexOf('const finishAndSubmit');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 1400);
    expect(block).toMatch(/sideSummary = trackerRef\.current\.summary\(\)/);
    expect(block).toMatch(/front1: frontSummary\?\.trial1/);
    expect(block).toMatch(/front2: frontSummary\?\.trial2/);
    expect(block).toMatch(/side1: sideSummary\?\.trial1/);
    expect(block).toMatch(/side2: sideSummary\?\.trial2/);
  });

  it('옛 frontTrialRef(단일 시행 보관)가 더는 쓰이지 않는다', () => {
    expect(src).not.toMatch(/frontTrialRef/);
  });

  it("진행 표시가 옛 총 2회가 아니라 SQUAT_LIVE_TOTAL_TRIALS(4)를 쓴다", () => {
    expect(src).toMatch(/const SQUAT_LIVE_TOTAL_TRIALS = SQUAT_LIVE_MAX_TRIALS_PER_VIEW \* 2;/);
    expect(src).not.toMatch(/totalDone\}\/2/);
  });

  it("'rep_done' 단계에서도 started는 유지되어 녹화·트래커가 끊기지 않는다(버튼 목록에 rep_done을 넣을 필요 없음)", () => {
    // rep_done은 started===true인 동안에만 발생하므로, "!started && ..." 계열
    // 조건에 rep_done을 추가하지 않은 게 의도된 설계임을 고정.
    const startBtnIdx = src.indexOf("{!started && !['front_done', 'finished'].includes(uiPhase)");
    expect(startBtnIdx).toBeGreaterThan(-1);
  });
});
