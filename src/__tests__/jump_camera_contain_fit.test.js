// jump_camera_contain_fit.test.js
// ════════════════════════════════════════════════════════════════════════
//  버그: 점프/RSI 화면만 라이브 카메라를 object-cover(+ Math.max 스케일, 화면
//  꽉 채우기/크롭)로 그리고 있었다. 다른 측정 화면(Squat/Posture 등, 전부
//  CameraStage 또는 동일 기준의 object-contain + Math.min 스케일 사용)은 카메라
//  원본을 잘라내지 않고 전체를 보여준다. 카메라 화면비와 화면(특히 키오스크
//  모니터) 비율이 다르면 cover 방식은 상/하단이 잘려 보였다(회원 머리·발이
//  프레임 밖으로 나가는 문제) — "점프만 캠이 조정 안 된다"로 보고된 증상.
//  2026-07-31: object-contain + Math.min으로 통일. 스켈레톤(drawSkeleton)과
//  기준선(drawBaseline)도 같은 스케일을 써야 실제 영상 위치와 어긋나지 않는다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/JumpPrecisionAnalysis.jsx'),
  'utf8',
);

describe('JumpPrecisionAnalysis.jsx — 라이브 카메라가 다른 측정 화면과 동일하게 contain으로 표시된다', () => {
  it('라이브 <video>가 object-contain을 쓴다(크롭하는 object-cover 아님)', () => {
    expect(src).toMatch(/<video ref=\{videoRef\}[^>]*object-contain/);
    expect(src).not.toMatch(/<video ref=\{videoRef\}[^>]*object-cover/);
  });

  it('drawSkeleton과 drawBaseline은 Math.min(contain) 스케일을 쓴다', () => {
    const skelStart = src.indexOf('function drawSkeleton(canvas, video, landmarks, phase)');
    const skelEnd = src.indexOf('\n}', skelStart);
    const skelBody = src.slice(skelStart, skelEnd);
    expect(skelBody).toMatch(/Math\.min\(cw \/ vw, ch \/ vh\)/);
    expect(skelBody).not.toMatch(/Math\.max\(cw \/ vw, ch \/ vh\)/);

    const baseStart = src.indexOf('function drawBaseline(canvas, video, baselineFeetY)');
    const baseEnd = src.indexOf('\n}', baseStart);
    const baseBody = src.slice(baseStart, baseEnd);
    expect(baseBody).toMatch(/Math\.min\(cw \/ vw, ch \/ vh\)/);
    expect(baseBody).not.toMatch(/Math\.max\(cw \/ vw, ch \/ vh\)/);
  });

  it('녹화 합성용 drawCoverJump(저장 파일 크롭)는 건드리지 않는다 — 라이브 화면과 별개', () => {
    // 저장되는 영상 파일은 여백 없이 꽉 채우는 게 의도된 동작(gait와 동일 정책).
    expect(src).toMatch(/function drawCoverJump\(ctx, video, width, height, rotationDeg = 0\)/);
  });
});
