// jump_calib_fallback_notice_ui.test.js
// ════════════════════════════════════════════════════════════════════════
//  타임아웃 폴백으로 기준이 잠겼을 때, 화면(버튼 위 문구·상단 패널)에 그
//  사실을 알리는 문구가 실제로 뜨는지 — 그리고 calib.push()에 타임스탬프가
//  실제로 전달되는지(안 넘기면 타임아웃 폴백 자체가 발동하지 않으므로 필수
//  배선) 소스 레벨로 고정한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/JumpPrecisionAnalysis.jsx'),
  'utf8',
);

describe('JumpPrecisionAnalysis.jsx — 타임아웃 폴백 잠금을 화면에서 알 수 있다', () => {
  it('calib.push()에 타임스탬프(ts)를 넘긴다(안 넘기면 타임아웃 폴백이 절대 발동하지 않음)', () => {
    expect(src).toMatch(/calib\.push\(landmarks, ts\)/);
  });

  it("st.ready일 때 basis==='timeout_fallback'이면 전용 안내 문구를 calibMsg로 세팅한다", () => {
    const idx = src.indexOf("if (st.ready) {");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 600);
    expect(block).toMatch(/calib\.result\?\.basis === 'timeout_fallback'/);
    expect(block).toMatch(/기준을 임시로 잡았습니다/);
  });

  it('버튼 바로 위 문구도 ready 단계에서 calibMsg(폴백 안내)가 있으면 그걸 우선 보여준다', () => {
    expect(src).toMatch(/\? \(calibMsg \|\| '버튼을 누르면 3초 후 측정이 시작됩니다'\)/);
  });
});
