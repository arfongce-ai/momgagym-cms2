// stance_eyes_open_closed_sequence.test.js
// ════════════════════════════════════════════════════════════════════════
//  2026-08-02: SLST가 눈뜨고 왼쪽→오른쪽 → (눈감아주세요 전환) → 눈감고
//  왼쪽→오른쪽 순서로 총 4회 시행을 모으도록 확장됨. StanceAnalysisHub.jsx의
//  handleLegComplete 상태머신이 정확히 이 순서로 단계를 전환하는지, 마지막
//  시행에서 evaluateSingleLegStanceWithEyes로 4개 요약을 모두 넘기는지 소스
//  레벨로 고정한다(다른 stance 소스 테스트들과 동일한 방식).
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/StanceAnalysisHub.jsx'),
  'utf8',
);

describe('StanceAnalysisHub.jsx — 눈뜨고/눈감고 4단계 시퀀스', () => {
  it('handleLegComplete가 eyesState를 먼저 분기하고, 눈뜨고 오른쪽 완료 시 eyes_transition으로 넘어간다', () => {
    const start = src.indexOf('const handleLegComplete');
    const end = src.indexOf('}, [eyesState, legStep', start);
    const body = src.slice(start, end);
    expect(body).toMatch(/if \(eyesState === 'open'\)/);
    expect(body).toMatch(/setView\('eyes_transition'\)/);
  });

  it('눈감고 오른쪽까지 완료되면(마지막 단계) combineAndProceed에 4개 요약을 모두 넘긴다', () => {
    expect(src).toMatch(/combineAndProceed\(openLeft, openRight, closedLeft, summary\)/);
  });

  it('proceedToClosedPhase가 eyesState를 closed로, legStep을 left로 리셋하고 measure로 돌아간다', () => {
    const start = src.indexOf('const proceedToClosedPhase');
    const end = src.indexOf('};', start);
    const body = src.slice(start, end);
    expect(body).toMatch(/setEyesState\('closed'\)/);
    expect(body).toMatch(/setLegStep\('left'\)/);
    expect(body).toMatch(/setView\('measure'\)/);
  });

  it('combineAndProceed가 evaluateSingleLegStanceWithEyes를 open/closed 구조로 호출한다', () => {
    const start = src.indexOf('const combineAndProceed');
    const end = src.indexOf('}, [member]', start);
    const body = src.slice(start, end);
    expect(body).toMatch(/evaluateSingleLegStanceWithEyes\(\{/);
    expect(body).toMatch(/open: \{ left: openL, right: openR \}/);
    expect(body).toMatch(/closed: \{ left: closedL, right: closedR \}/);
  });

  it('backToMeasure가 eyesState/legStep과 4개 요약 상태를 전부 초기화한다', () => {
    const start = src.indexOf('const backToMeasure');
    const end = src.indexOf('};', start);
    const body = src.slice(start, end);
    expect(body).toMatch(/setEyesState\('open'\)/);
    expect(body).toMatch(/setLegStep\('left'\)/);
    expect(body).toMatch(/setOpenLeft\(null\)/);
    expect(body).toMatch(/setOpenRight\(null\)/);
    expect(body).toMatch(/setClosedLeft\(null\)/);
    expect(body).toMatch(/setClosedRight\(null\)/);
  });

  it('측정 화면(live/upload) 양쪽 모두에 eyesClosed prop을 넘긴다', () => {
    const matches = src.match(/eyesClosed=\{eyesState === 'closed'\}/g) || [];
    expect(matches.length).toBe(2);
  });

  it('키(heightCm) 관련 코드가 더는 남아있지 않다(2026-08-02 제거)', () => {
    expect(src).not.toMatch(/heightCm/);
    expect(src).not.toMatch(/onMemberHeightChange/);
  });
});
