import { describe, it, expect } from 'vitest';
import { buildPostureMarkers } from '../ai-measure/core/postureOverlay';
import { POSE_LANDMARKS as LM } from '../ai-measure/core/postureMath';

function baseLandmarks() {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
  Object.assign(lm[LM.LEFT_SHOULDER], { x: 0.42, y: 0.30 });
  Object.assign(lm[LM.RIGHT_SHOULDER], { x: 0.58, y: 0.30 });
  Object.assign(lm[LM.LEFT_HIP], { x: 0.45, y: 0.55 });
  Object.assign(lm[LM.RIGHT_HIP], { x: 0.55, y: 0.55 });
  Object.assign(lm[LM.LEFT_KNEE], { x: 0.46, y: 0.72 });
  Object.assign(lm[LM.RIGHT_KNEE], { x: 0.54, y: 0.72 });
  Object.assign(lm[LM.LEFT_ANKLE], { x: 0.46, y: 0.90 });
  Object.assign(lm[LM.RIGHT_ANKLE], { x: 0.54, y: 0.90 });
  Object.assign(lm[LM.LEFT_EAR], { x: 0.47, y: 0.12 });
  Object.assign(lm[LM.RIGHT_EAR], { x: 0.53, y: 0.12 });
  Object.assign(lm[LM.NOSE], { x: 0.5, y: 0.10 });
  return lm;
}

describe('buildPostureMarkers', () => {
  it('정상 범위면 마커를 만들지 않는다(과잉 표시 금지)', () => {
    const analysis = {
      frontal: { shoulderHeightDiffMm: 2, pelvisHeightDiffMm: 2 },
      sagittal: {},
    };
    const lm = baseLandmarks();
    Object.assign(lm[LM.LEFT_EAR], { y: 0.12 });
    Object.assign(lm[LM.RIGHT_EAR], { y: 0.12 }); // 수평 → 머리기울기 0
    expect(buildPostureMarkers(analysis, lm, 'front')).toHaveLength(0);
  });

  it('정면: 어깨 높이차가 크면 높은 어깨에 원 마커', () => {
    const analysis = { frontal: { shoulderHeightDiffMm: 18, pelvisHeightDiffMm: 2 }, sagittal: {} };
    const lm = baseLandmarks();
    Object.assign(lm[LM.LEFT_SHOULDER], { y: 0.28 }); // 좌 어깨가 더 높음(y 작음)
    const markers = buildPostureMarkers(analysis, lm, 'front');
    const sh = markers.find((m) => m.label.includes('어깨'));
    expect(sh).toBeTruthy();
    expect(sh.type).toBe('circle');
    expect(sh.severity).toBe('risk'); // 18 >= 16
    // 높은 쪽(좌) 어깨 좌표 근처
    expect(sh.x).toBeCloseTo(lm[LM.LEFT_SHOULDER].x, 2);
  });

  it('정면: 골반 높이차 마커 severity 경계(주의)', () => {
    const analysis = { frontal: { shoulderHeightDiffMm: 1, pelvisHeightDiffMm: 9 }, sagittal: {} };
    const markers = buildPostureMarkers(analysis, baseLandmarks(), 'front');
    const pv = markers.find((m) => m.label.includes('골반'));
    expect(pv).toBeTruthy();
    expect(pv.severity).toBe('caution'); // 9 in [8,16)
  });

  it('측면: 거북목이 크면 머리에 화살표 마커', () => {
    const analysis = { frontal: {}, sagittal: { forwardHeadMm: 60, kyphosisProxyDeg: 180, kneeExtensionProxyDeg: 178 } };
    const markers = buildPostureMarkers(analysis, baseLandmarks(), 'left');
    const fh = markers.find((m) => m.label.includes('거북목'));
    expect(fh).toBeTruthy();
    expect(fh.type).toBe('arrow');
  });

  it('측면: 무릎 과신전(180° 초과)이면 무릎에 원 마커', () => {
    const analysis = { frontal: {}, sagittal: { forwardHeadMm: 10, kyphosisProxyDeg: 180, kneeExtensionProxyDeg: 188 } };
    const markers = buildPostureMarkers(analysis, baseLandmarks(), 'right');
    const kn = markers.find((m) => m.label.includes('무릎'));
    expect(kn).toBeTruthy();
    expect(kn.type).toBe('circle');
  });

  it('정면 항목은 측면에서 표시되지 않는다(면별 적합성)', () => {
    const analysis = { frontal: { shoulderHeightDiffMm: 30, pelvisHeightDiffMm: 30 }, sagittal: {} };
    // 측면으로 호출 → 어깨/골반 높이차(정면 항목) 마커는 없어야 함
    const markers = buildPostureMarkers(analysis, baseLandmarks(), 'left');
    expect(markers.find((m) => m.label.includes('어깨 높이차'))).toBeFalsy();
    expect(markers.find((m) => m.label.includes('골반 높이차'))).toBeFalsy();
  });

  it('랜드마크/분석이 없으면 빈 배열', () => {
    expect(buildPostureMarkers(null, baseLandmarks(), 'front')).toEqual([]);
    expect(buildPostureMarkers({ frontal: {}, sagittal: {} }, null, 'front')).toEqual([]);
  });
});

describe('측면 목 기울기 마커', () => {
  function sideLandmarks({ earX = 0.55, shoulderX = 0.5 } = {}) {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
    Object.assign(lm[LM.LEFT_SHOULDER], { x: shoulderX, y: 0.30 });
    Object.assign(lm[LM.RIGHT_SHOULDER], { x: shoulderX + 0.005, y: 0.30 });
    Object.assign(lm[LM.LEFT_EAR], { x: earX, y: 0.12 });
    Object.assign(lm[LM.RIGHT_EAR], { x: earX + 0.005, y: 0.12 });
    Object.assign(lm[LM.LEFT_HIP], { x: shoulderX, y: 0.55 });
    Object.assign(lm[LM.RIGHT_HIP], { x: shoulderX + 0.005, y: 0.55 });
    Object.assign(lm[LM.LEFT_KNEE], { x: shoulderX, y: 0.72 });
    Object.assign(lm[LM.LEFT_ANKLE], { x: shoulderX, y: 0.90 });
    return lm;
  }

  it('머리가 어깨보다 앞으로 크게 나오면 목 기울기 마커가 생긴다', () => {
    // ear x=0.62, shoulder x=0.5 → 머리가 앞으로, dy≈0.18 → tilt≈34° (>12)
    const analysis = { frontal: {}, sagittal: { forwardHeadMm: 10, kyphosisProxyDeg: 180, kneeExtensionProxyDeg: 178 } };
    const markers = buildPostureMarkers(analysis, sideLandmarks({ earX: 0.62, shoulderX: 0.5 }), 'left');
    const neck = markers.find((m) => m.label.includes('목 기울기'));
    expect(neck).toBeTruthy();
    expect(neck.type).toBe('arrow');
    expect(neck.label).toMatch(/목 기울기 \d+°/);
  });

  it('머리가 어깨 위 거의 수직이면 목 기울기 마커 없음(정상)', () => {
    const analysis = { frontal: {}, sagittal: { forwardHeadMm: 10, kyphosisProxyDeg: 180, kneeExtensionProxyDeg: 178 } };
    // ear x≈shoulder x → tilt≈0
    const markers = buildPostureMarkers(analysis, sideLandmarks({ earX: 0.503, shoulderX: 0.5 }), 'left');
    expect(markers.find((m) => m.label.includes('목 기울기'))).toBeFalsy();
  });

  it('정면에서는 목 기울기(측면 항목) 마커가 나오지 않는다', () => {
    const analysis = { frontal: { shoulderHeightDiffMm: 2, pelvisHeightDiffMm: 2 }, sagittal: {} };
    const markers = buildPostureMarkers(analysis, sideLandmarks({ earX: 0.62 }), 'front');
    expect(markers.find((m) => m.label.includes('목 기울기'))).toBeFalsy();
  });
});
