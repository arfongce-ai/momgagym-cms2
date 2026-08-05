// vbt_landmark_rotation.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] 카메라 원본이 회전된 채로 들어오는 기종(키오스크)에서 VBT의
//  핵심 지표인 바 속도(수직 변위 기반)가 원본 좌표를 그대로 쓰던 문제 수정.
//  이 화면은 라이브 스켈레톤 오버레이가 없어(RSI 방식, 캔버스는 비워 둠)
//  raw/보정 분리 없이 handleResult 진입 시 한 번만 보정하면 된다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/VbtMeasure.jsx'),
  'utf8',
);

describe('VbtMeasure.jsx — 카메라 회전 보정 배선', () => {
  it('rotateLandmarksNormalized를 recordAspect에서 가져온다', () => {
    expect(src).toMatch(/rotateLandmarksNormalized/);
  });

  it('rotationDeg 선언이 handleResult보다 앞에 있다(TDZ 에러 방지)', () => {
    const rotIdx = src.indexOf('const [rotationDeg] = useCameraRotation();');
    const handleIdx = src.indexOf('const handleResult = useCallback');
    expect(rotIdx).toBeGreaterThan(-1);
    expect(rotIdx).toBeLessThan(handleIdx);
  });

  it('rotationDeg 선언이 정확히 한 번만 있다(중복 선언 방지)', () => {
    const matches = src.match(/const \[rotationDeg\] = useCameraRotation\(\);/g) || [];
    expect(matches.length).toBe(1);
  });

  it('handleResult 진입 즉시 rawLms를 보정해 lms로 쓴다', () => {
    const start = src.indexOf('const handleResult = useCallback');
    const end = src.indexOf('const ph = personHeightRatio', start);
    const body = src.slice(start, end);
    expect(body).toMatch(/const lms = rotateLandmarksNormalized\(rawLms, rotationDeg\);/);
  });

  it('handleResult의 dependency 배열에 rotationDeg가 포함된다', () => {
    expect(src).toMatch(/\}, \[heightCm, referenceScale, rotationDeg\]\);/);
  });
});
