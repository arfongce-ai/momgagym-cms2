// rom_measure_elbow_ui.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] RomMeasure.jsx(측정 화면) 쪽 ELBOW UI 배선 회귀 테스트.
//  계산 로직(bodyMechanics.js)은 rom_elbow_support.test.js에서 별도로
//  검증하고, 여기서는 "선택 목록에 뜨는지 / 허용 자세모드가 맞는지 / 라이브
//  오버레이가 손목까지 잡아오는지"처럼 화면 배선만 고정한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/RomMeasure.jsx'),
  'utf8',
);

describe('RomMeasure.jsx — 관절 선택 목록', () => {
  it('JOINTS 목록에 팔꿈치(ELBOW)가 있다', () => {
    expect(src).toMatch(/\{ key: 'ELBOW', label: '주관절\(팔꿈치\)', short: '팔꿈치' \}/);
  });

  it('기존 4개 관절(고관절·무릎·어깨·발목)은 그대로 남아있다(추가만 했지 교체하지 않음)', () => {
    expect(src).toMatch(/key: 'HIP'/);
    expect(src).toMatch(/key: 'KNEE'/);
    expect(src).toMatch(/key: 'SHOULDER'/);
    expect(src).toMatch(/key: 'ANKLE'/);
  });
});

describe('RomMeasure.jsx — ELBOW 허용 자세모드', () => {
  it('어깨와 동일하게 서서/앉아서만 허용한다(눕는 자세 없음)', () => {
    const start = src.indexOf('ELBOW: [');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf('],', start));
    expect(block).toMatch(/key: 'STANDING'/);
    expect(block).toMatch(/key: 'SEATED'/);
    expect(block).not.toMatch(/SUPINE|PRONE/);
  });
});

describe('RomMeasure.jsx — 라이브 오버레이 지오메트리', () => {
  it('WRIST 랜드마크를 추가로 가져온다(팔꿈치 각 표시에 필요)', () => {
    expect(src).toMatch(/const wrist = p\('WRIST'\);/);
  });

  it("joint === 'ELBOW'일 때 shoulder-elbow-wrist 3점으로 오버레이를 그린다", () => {
    expect(src).toMatch(
      /if \(joint === 'ELBOW' && shoulder && elbow && wrist\) return \{ a: shoulder, b: elbow, c: wrist \};/,
    );
  });

  it('다른 관절들(HIP/KNEE/SHOULDER/ANKLE)의 오버레이 분기도 그대로 남아있다', () => {
    expect(src).toMatch(/joint === 'HIP'/);
    expect(src).toMatch(/joint === 'KNEE'/);
    expect(src).toMatch(/joint === 'SHOULDER'/);
    expect(src).toMatch(/joint === 'ANKLE'/);
  });
});
