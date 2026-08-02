// jump_rotation_stale_closure.test.js
// ════════════════════════════════════════════════════════════════════════
//  버그(진짜 원인): 점프 화면의 포즈 감지 루프(loop)는 startVisionPipeline()이
//  호출되는 시점에 딱 한 번 만들어져 requestAnimationFrame으로 계속 자기
//  자신을 재호출하는 장수(長壽) 클로저다. 이 loop 안에서 drawBaseline·
//  drawCoverJump를 부를 때 rotationDeg "상태값"을 직접 클로저로 참조하면,
//  loop가 만들어진 시점 이후의 rotationDeg 값(예: localStorage에서 뒤늦게
//  로드됐거나, 회전 버튼을 누른 경우)을 못 본다. 화면(JSX, 회전 래퍼·버튼·
//  디버그 텍스트)은 매 렌더 최신 state를 그대로 쓰므로 비디오·버튼 표시는
//  항상 맞게 보이는데, loop 안의 기준선만 옛 rotationDeg로 계산돼 어긋나
//  보였다(키오스크에서 세로로 보인 실제 원인 — 이전 커밋의 회전별 분기
//  로직 자체는 맞았지만, 넘겨받는 값이 클로저 안에서 이미 stale했다).
//  2026-07-31: armedRef·calibLockedRef와 동일한 기존 패턴을 그대로 따라
//  rotationDegRef로 미러링, loop 내부 호출은 전부 ref를 읽도록 수정.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/JumpPrecisionAnalysis.jsx'),
  'utf8',
);

describe('JumpPrecisionAnalysis.jsx — rotationDeg가 loop 안에서 stale하지 않다', () => {
  it('rotationDegRef가 armedRef와 같은 자리에 선언돼 있다(기존 loop-참조 ref 패턴)', () => {
    expect(src).toMatch(/const armedRef = useRef\(false\);/);
    expect(src).toMatch(/const rotationDegRef = useRef\(0\);/);
  });

  it('rotationDeg 상태가 바뀔 때마다 rotationDegRef로 미러링하는 useEffect가 있다(armedRef 미러링과 동일 패턴)', () => {
    expect(src).toMatch(/useEffect\(\(\) => \{ armedRef\.current = armed; \}, \[armed\]\);/);
    expect(src).toMatch(/useEffect\(\(\) => \{ rotationDegRef\.current = rotationDeg; \}, \[rotationDeg\]\);/);
  });

  it('loop 내부(drawCoverJump·drawBaseline 호출부)는 rotationDeg 상태가 아니라 rotationDegRef.current를 읽는다', () => {
    expect(src).toMatch(/drawCoverJump\(ctx, video, canvas\.width, canvas\.height, rotationDegRef\.current\)/);
    expect(src).toMatch(/drawBaseline\(skeletonCanvasRef\.current, video, calib\.result\.baselineFeetY, rotationDegRef\.current\)/);
    // loop 내부에 상태값 그대로(rotationDeg, ref 아님) 넘기는 옛 호출이 남아있지 않아야 한다.
    expect(src).not.toMatch(/drawCoverJump\(ctx, video, canvas\.width, canvas\.height, rotationDeg\)/);
    expect(src).not.toMatch(/drawBaseline\(skeletonCanvasRef\.current, video, calib\.result\.baselineFeetY, rotationDeg\)/);
  });

  it('화면(JSX) 쪽 회전 래퍼·버튼은 그대로 반응형 rotationDeg 상태를 쓴다(ref로 바꾸면 오히려 화면이 한 프레임 늦게 갱신될 수 있어 그대로 둬야 한다)', () => {
    // 임시 디버그 표시(rot={rotationDeg}°)는 2026-08-02 오버레이 정리 작업에서
    // 제거됨 — 동일한 반응형 상태 사용 여부는 회전 버튼 표시로 계속 검증한다.
    expect(src).toMatch(/style=\{rotationDeg \? \{/);
    expect(src).toMatch(/rotationDeg \? ` \$\{rotationDeg\}°` : ''/);
  });
});
