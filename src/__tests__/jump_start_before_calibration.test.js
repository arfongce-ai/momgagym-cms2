// jump_start_before_calibration.test.js
// ════════════════════════════════════════════════════════════════════════
//  점프 "측정 시작" 버튼도 SLST·스쿼트와 같은 이유로 고쳤다 — 캘리브레이션이
//  끝나야만 버튼이 눌리던 걸 없앴다(그 사람이 카메라 앞과 노트북 앞에 동시에
//  있어야 하는 모순 방지). 점프는 3-2-1 카운트다운이 있는 구조라 트래커
//  생성 시점을 "카운트다운 종료"에서 "실제로 캘리브레이션이 끝나는 시점
//  (루프 안)"으로 옮겼다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/JumpPrecisionAnalysis.jsx'),
  'utf8',
);

describe('JumpPrecisionAnalysis.jsx — 캘리브레이션과 무관하게 언제든 누를 수 있는 측정 시작 버튼', () => {
  it('버튼의 disabled 조건에 phase 체크가 없다(카운트다운 중복 방지만 남음)', () => {
    const btnStart = src.indexOf('onClick={beginCountdown}');
    const btnEnd = src.indexOf('</button>', btnStart);
    const btnBlock = src.slice(btnStart, btnEnd);
    expect(btnBlock).toMatch(/disabled=\{countdown != null\}/);
    expect(btnBlock).not.toMatch(/phase !== 'ready'/);
  });

  it('beginCountdown 자체에도 캘리브레이션 완료를 요구하는 가드가 없다', () => {
    const fnStart = src.indexOf('const beginCountdown');
    const fnEnd = src.indexOf('\n  };', fnStart);
    const body = src.slice(fnStart, fnEnd);
    expect(body).not.toMatch(/calibLockedRef\.current/);
  });

  it('카운트다운이 끝나면 캘리브레이션 완료 여부와 무관하게 armed로 전환된다(트래커 생성 조건 없음)', () => {
    const fnStart = src.indexOf('const beginCountdown');
    const fnEnd = src.indexOf('\n  };', fnStart);
    const body = src.slice(fnStart, fnEnd);
    expect(body).toMatch(/setArmed\(true\);/);
    expect(body).toMatch(/armedRef\.current = true;/);
    expect(body).not.toMatch(/if \(calib\?\.result\)/);
  });

  it('실제 트래커 생성은 측정 루프 안, armed 상태에서 트래커가 없을 때 지연 생성된다', () => {
    const loopMarker = src.indexOf('── 측정 단계 ──');
    const loopChunk = src.slice(loopMarker, loopMarker + 500);
    expect(loopChunk).toMatch(/if \(!trackerRef\.current\)/);
    expect(loopChunk).toMatch(/new JumpFlightTracker\(calib\.result\)/);
  });
});
