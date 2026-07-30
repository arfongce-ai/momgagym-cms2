// pose_backend_cache.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-07-30 되돌림] 화면 재진입 로딩 속도 개선을 위해 AI 모델(PoseLandmarker)을
//  화면 간 공유 캐시로 만들었었는데, 배포 후 ROM·스쿼트·SLST·VBT·자세측정·점프
//  등 전 화면에서 인식 자체가 안 되는 광범위한 회귀가 발생했다(캘리브레이션
//  진행률이 몇 초가 지나도 0%에서 전혀 안 움직임 — 영상으로 확인됨). 같은
//  PoseLandmarker 인스턴스를 서로 다른 카메라 스트림(video element)에 재사용하는
//  게 MediaPipe Tasks Vision에서 조용히 실패하는 것으로 추정되어(에러가 프레임
//  루프의 try/catch에 먹혀 증상만 남음), 로딩 속도보다 정확성을 우선해 원래
//  방식(화면마다 새로 로드 + 나갈 때 닫기)으로 되돌렸다. 이 테스트는 되돌림이
//  제대로 됐는지(공유 캐시 코드가 다시 안 남아있는지) 확인한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('poseBackend.js — 화면마다 새로 로드(공유 캐시 없음)', () => {
  const src = readFileSync(join(process.cwd(), 'src/ai-measure/core/poseBackend.js'), 'utf8');

  it('closePoseLandmarker는 여전히 내보내져 있고, 화면들이 언마운트 시 이걸 부른다', () => {
    expect(src).toMatch(/export function closePoseLandmarker/);
  });
});

describe.each([
  'ai-measure/menus/JumpPrecisionAnalysis.jsx',
  'ai-measure/menus/GaitRunningAnalysis.jsx',
  'ai-measure/menus/RecordMeasure.jsx',
])('%s — 언마운트 시 AI 모델을 다시 닫는다(원래 방식으로 복원)', (path) => {
  const fileSrc = readFileSync(join(process.cwd(), 'src', path), 'utf8');

  it('closePoseLandmarker를 언마운트 시 호출한다', () => {
    expect(fileSrc).toMatch(/closePoseLandmarker\(\)/);
  });
});

describe('usePoseEngine.js — 화면마다 새로 로드(공유 캐시 없음, ROM·스쿼트·SLST·VBT·자세측정 등 7개 화면 공유 훅)', () => {
  const src = readFileSync(join(process.cwd(), 'src/ai-measure/core/usePoseEngine.js'), 'utf8');

  it('모듈 레벨 공유 캐시(getSharedLandmarker)가 더 이상 존재하지 않는다', () => {
    expect(src).not.toMatch(/getSharedLandmarker/);
    expect(src).not.toMatch(/_sharedLandmarker/);
  });

  it('start()는 매번 새 PoseLandmarker를 만든다', () => {
    expect(src).toMatch(/landmarkerRef\.current = await PoseLandmarker\.createFromOptions/);
  });

  it('stop()은 landmarker를 닫고 참조를 놓는다(원래 방식)', () => {
    const fnStart = src.indexOf('const stop = useCallback');
    const fnEnd = src.indexOf('}, []);', fnStart);
    const body = src.slice(fnStart, fnEnd);
    expect(body).toMatch(/landmarkerRef\.current\.close\(\)/);
    expect(body).toMatch(/landmarkerRef\.current = null;/);
  });
});
