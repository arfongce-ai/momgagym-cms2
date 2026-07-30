// pose_backend_cache.test.js
// ════════════════════════════════════════════════════════════════════════
//  poseBackend.js — 2026-07-30 키오스크 로딩 속도 개선.
//  화면을 나갈 때마다 AI 모델을 닫던 걸 그만두고(브라우저 탭이 켜져 있는
//  동안 재사용), 대신 다른 등급(modelTier)이 요청되면 캐시를 안전하게
//  갈아끼우도록 만들었다. 실제 CDN 로딩은 무겁고 이 테스트 범위 밖이라,
//  여기서는 소스 레벨로 핵심 안전장치가 들어있는지만 확인한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(process.cwd(), 'src/ai-measure/core/poseBackend.js'), 'utf8');

describe('poseBackend.js — 영구 캐시 + 등급 불일치 안전장치', () => {
  it('다른 modelTier가 요청되면 기존 캐시를 닫고 새로 올린다(등급 혼동 방지)', () => {
    expect(src).toMatch(/modelTier\s*!==\s*_modelTier/);
    const fnStart = src.indexOf('export async function loadPoseLandmarker');
    const fnEnd = src.indexOf('\n}', fnStart);
    const body = src.slice(fnStart, fnEnd);
    expect(body).toMatch(/closePoseLandmarker\(\)/);
  });

  it('같은 등급이면 기존 캐시(_landmarker)를 즉시 반환한다(재로딩 없음)', () => {
    expect(src).toMatch(/if \(_landmarker\) return _landmarker;/);
  });

  it('closePoseLandmarker는 여전히 내보내져 있다(필요 시 명시적으로 쓸 수 있게)', () => {
    expect(src).toMatch(/export function closePoseLandmarker/);
  });
});

describe.each([
  'ai-measure/menus/JumpPrecisionAnalysis.jsx',
  'ai-measure/menus/GaitRunningAnalysis.jsx',
])('%s — 언마운트 시 AI 모델을 더 이상 닫지 않는다', (path) => {
  const fileSrc = readFileSync(join(process.cwd(), 'src', path), 'utf8');

  it('closePoseLandmarker를 더 이상 호출하지 않는다', () => {
    expect(fileSrc).not.toMatch(/closePoseLandmarker\(\)/);
  });
});

describe('usePoseEngine.js — 영구 캐시(ROM·스쿼트·SLST·VBT·자세측정 등 7개 화면 공유)', () => {
  const src = readFileSync(join(process.cwd(), 'src/ai-measure/core/usePoseEngine.js'), 'utf8');

  it('다른 modelTier가 요청되면 기존 캐시를 닫고 새로 올린다(등급 혼동 방지)', () => {
    expect(src).toMatch(/_sharedLandmarkerTier\s*!==\s*modelTier/);
    const fnStart = src.indexOf('async function getSharedLandmarker');
    const fnEnd = src.indexOf('\n}', fnStart);
    expect(src.slice(fnStart, fnEnd)).toMatch(/_sharedLandmarker\.close\(\)/);
  });

  it('stop()은 이 훅 인스턴스의 참조만 놓고, 모듈 캐시 자체는 닫지 않는다', () => {
    const fnStart = src.indexOf('const stop = useCallback');
    const fnEnd = src.indexOf('}, []);', fnStart);
    const body = src.slice(fnStart, fnEnd);
    expect(body).toMatch(/landmarkerRef\.current = null;/);
    expect(body).not.toMatch(/landmarkerRef\.current\.close\(\)/);
  });

  it('start()는 매번 새로 로드하지 않고 공유 캐시(getSharedLandmarker)를 사용한다', () => {
    expect(src).toMatch(/landmarkerRef\.current = await getSharedLandmarker\(modelTier\);/);
  });
});
