// onerm_landmark_rotation.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] 카메라 원본이 회전된 채로 들어오는 기종(키오스크)에서 1RM
//  추정의 핵심 지표인 바 속도(수직 변위 기반)가 원본 좌표를 그대로 쓰던
//  문제 수정. handleResult가 useCallback([]) 고정 함수라 ref로 최신
//  회전값을 참조한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/OneRMEstimate.jsx'),
  'utf8',
);

describe('OneRMEstimate.jsx — 카메라 회전 보정 배선', () => {
  it('rotateLandmarksNormalized를 recordAspect에서 가져온다', () => {
    expect(src).toMatch(/rotateLandmarksNormalized/);
  });

  it('rotationDegRef로 최신 회전값을 참조한다(useCallback([]) 스테일 클로저 방지)', () => {
    expect(src).toMatch(/const rotationDegRef = useRef\(0\);/);
    expect(src).toMatch(/useEffect\(\(\) => \{ rotationDegRef\.current = rotationDeg; \}, \[rotationDeg\]\);/);
  });

  it('rotationDeg 선언이 정확히 한 번만 있다(중복 선언 방지)', () => {
    const matches = src.match(/const \[rotationDeg\] = useCameraRotation\(\);/g) || [];
    expect(matches.length).toBe(1);
  });

  it('handleResult 진입 즉시 rawLms를 보정해 lms로 쓴다', () => {
    const start = src.indexOf('const handleResult = useCallback');
    const end = src.indexOf('const want = ', start);
    const body = src.slice(start, end);
    expect(body).toMatch(/const lms = rotateLandmarksNormalized\(rawLms, rotationDegRef\.current\);/);
  });
});
