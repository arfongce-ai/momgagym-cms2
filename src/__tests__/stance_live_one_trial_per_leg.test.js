// stance_live_one_trial_per_leg.test.js
// ════════════════════════════════════════════════════════════════════════
//  버그: 원레그(SLST) 라이브 화면이 다리당 2회 시행을 기다렸다(SingleLegStanceTracker
//  기본값 maxTrials=2). 실제 운영은 다리당 1회(왼발 1회 → 오른발 1회)라, 회원이
//  1회만 하고 반대쪽 발로 넘어가면 트래커가 계속 2번째 시행을 기다려 다음
//  단계(오른발)로 못 넘어갔다 — "인식·촬영이 잘 안 된다"로 보고된 증상.
//  2026-07-31: SLST_LIVE_MAX_TRIALS=1로 트래커를 생성하도록 수정.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/StanceLiveAnalysis.jsx'),
  'utf8',
);

describe('StanceLiveAnalysis.jsx — 다리당 시행 1회로 트래커를 생성한다', () => {
  it('SLST_LIVE_MAX_TRIALS 상수가 1이다', () => {
    expect(src).toMatch(/const SLST_LIVE_MAX_TRIALS = 1;/);
  });

  it('두 트래커 생성부(캘리브 전/후 버튼 케이스) 모두 maxTrials를 명시적으로 넘긴다', () => {
    const matches = src.match(/new SingleLegStanceTracker\(calib\.result, stanceLeg, \{ maxTrials: SLST_LIVE_MAX_TRIALS \}\)/g) || [];
    expect(matches.length).toBe(2);
  });

  it("'2회 모두 완료' 같은 다리당 2회 가정 문구가 남아있지 않다", () => {
    expect(src).not.toMatch(/2회 모두 완료/);
  });
});
