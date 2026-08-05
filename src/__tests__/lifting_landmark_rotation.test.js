// lifting_landmark_rotation.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] 카메라 원본이 회전된 채로 들어오는 기종(키오스크)에서 역도의
//  속도·렙·ROM 판정(y축 기준 계산)이 원본 좌표를 그대로 쓰던 문제 수정.
//
//  이 화면은 fusedRef.path()가 라이브 궤적 표시 + 녹화 합성(coverMapPath가
//  자체적으로 회전 보정) 두 곳에서 원본(raw) 좌표를 그대로 기대하므로
//  fusedRef 자체는 건드릴 수 없다 — 그래서 같은 시퀀스를 회전 보정된 좌표로
//  받는 별도의 judgeAccRef를 두고, 속도·렙·최종 요약만 그쪽을 쓴다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/LiftingMeasure.jsx'),
  'utf8',
);

describe('LiftingMeasure.jsx — 카메라 회전 보정 배선(이중 누적기)', () => {
  it('judgeAccRef(판정 전용 누적기)를 별도로 둔다', () => {
    expect(src).toMatch(/const judgeAccRef = useRef\(new BarbellAccumulator\(\)\);/);
  });

  it('fusedRef에는 원본(raw) 점을, judgeAccRef에는 보정된 점을 push한다', () => {
    expect(src).toMatch(/fusedRef\.current\.push\(fused\.point, ts\);/);
    expect(src).toMatch(/const correctedFusedPoint = rotateLandmarksNormalized\(\[fused\.point\], rotationDeg\)\[0\];/);
    expect(src).toMatch(/judgeAccRef\.current\.push\(correctedFusedPoint, ts\);/);
  });

  it('라이브 속도 표시와 최종 세트 요약은 judgeAccRef(보정)를 쓴다', () => {
    expect(src).toMatch(/const lv = judgeAccRef\.current\.live\(scale\.cmPerRatio\);/);
    expect(src).toMatch(/const sum = judgeAccRef\.current\.summary\(/);
  });

  it('궤적 표시(라이브 캔버스·녹화 합성)는 fusedRef(원본)를 그대로 쓴다(이중 회전 방지)', () => {
    expect(src).toMatch(/const path = fusedRef\.current\.path\(\);/);
    expect(src).toMatch(/coverMapPath\(fusedRef\.current\.path\(\), video, canvas\.width, canvas\.height, rotationDeg\)/);
  });

  it('두 리셋 지점(세트 시작 전·녹화 시작) 모두 judgeAccRef도 함께 초기화한다', () => {
    const matches = src.match(/judgeAccRef\.current\.reset\(\);/g) || [];
    expect(matches.length).toBe(2);
  });

  it('바-COG 수평 이격은 회전 보정된 COG(correctedCog)를 쓴다', () => {
    expect(src).toMatch(/const correctedCog = estimateBodyCOG\(correctedLms, correctedFr\.orientation\);/);
    expect(src).toMatch(/barCogHorizontalGap\(correctedFusedPoint, correctedCog\.point\)/);
  });

  it('라이브 COG 마커 표시는 원본(raw) cog를 그대로 쓴다(이중 회전 방지)', () => {
    expect(src).toMatch(/ctx\.arc\(cog\.point\.x \* cw, cog\.point\.y \* ch, 9, 0, Math\.PI \* 2\)/);
  });
});
