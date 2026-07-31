// jump_calib_msg_visible.test.js
// ════════════════════════════════════════════════════════════════════════
//  버그: "기준 다시 잡기"를 눌러도 반응이 안 보인다고 보고됨. 실제로는
//  resetPipeline()이 phase를 'arming'으로 되돌리고 보정을 재시작하는 건
//  맞았지만, 그 진행 상황을 담은 calibMsg("자세 보정 중... N%" 등)가 화면
//  어디에도 그려지지 않고 있었다 — JumpLiveOverlay는 calibMsg를 prop으로
//  받기만 하고 JSX에서 한 번도 안 썼고(죽은 prop), 버튼 바로 위 안내
//  문구도 phase와 무관하게 거의 똑같은 고정 문장만 보여줬다. 그래서
//  재보정이 실제로는 진행 중이어도 화면상으론 "누르기 전/후 똑같다"로
//  보였다. 2026-07-31: calibMsg를 위쪽 상태 패널과 버튼 바로 위 안내
//  문구 양쪽에 실제로 표시하도록 수정 — 특히 버튼 옆 문구는 사용자가
//  실제로 보고 있는 자리라 재보정 확인 신호로 가장 직접적이다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/JumpPrecisionAnalysis.jsx'),
  'utf8',
);

describe('JumpPrecisionAnalysis.jsx — calibMsg(보정 진행률)가 화면에 실제로 보인다', () => {
  it('JumpLiveOverlay가 calibMsg를 렌더링한다(예전엔 prop만 받고 안 그렸음)', () => {
    const start = src.indexOf('function JumpLiveOverlay(');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('\nfunction ', start + 10);
    const body = src.slice(start, end === -1 ? undefined : end);
    expect(body).toMatch(/\{calibMsg && phase !== 'air' && \(/);
  });

  it("버튼 바로 위 안내 문구가 phase==='ready'가 아닐 때 calibMsg를 보여준다(예전엔 phase와 거의 무관한 고정 문장이었음)", () => {
    expect(src).toMatch(/: \(calibMsg \|\| '자세 기준을 잡는 중입니다 — 카메라 앞에 똑바로 서 주세요'\)/);
    // 옛 고정 문장(재보정 여부와 무관하게 항상 같은 텍스트)이 남아있지 않아야 한다.
    expect(src).not.toMatch(/버튼을 누르면 3초 후 측정이 시작됩니다 — 그 사이에 자리에 서 주세요/);
  });

  it("'기준 다시 잡기' 버튼은 여전히 resetPipeline을 직접 호출한다(로직 자체는 원래도 정상이었음)", () => {
    expect(src).toMatch(/<button onClick=\{resetPipeline\}/);
  });
});
