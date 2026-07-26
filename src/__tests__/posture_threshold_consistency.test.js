// posture_threshold_consistency.test.js
// ════════════════════════════════════════════════════════════════════════
//  버그: postureOverlay.js(사진 마커) · PostureReport.jsx(지표 패널) ·
//  postureClinical.js(부위별 진단)가 같은 지표(어깨/골반/거북목/무릎 등)를
//  각자 하드코딩해, 같은 측정값을 두고 화면 위치마다 다른 주의/위험
//  판정이 나왔다(예: 거북목 60mm가 사진 마커는 '주의'(40/80 기준), 지표
//  패널·부위별 진단은 '위험'(25/45 기준)).
//  postureMath.js의 POSTURE_THRESHOLDS를 단일 소스로 만들고 세 파일이
//  이를 import하도록 통일했다. 이 테스트는 실제로 같은 값에 대해 같은
//  판정이 나오는지 직접 검증한다(소스 문자열 확인이 아니라 실행 결과 비교).
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { POSE_LANDMARKS as LM, POSTURE_THRESHOLDS } from '../ai-measure/core/postureMath';
import { buildPostureMarkers } from '../ai-measure/core/postureOverlay';
import { buildRegionDiagnoses } from '../ai-measure/core/postureClinical';

const root = join(process.cwd(), 'src');
const read = (p) => readFileSync(join(root, p), 'utf8');

function baseLandmarks() {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
  Object.assign(lm[LM.LEFT_SHOULDER], { x: 0.42, y: 0.30 });
  Object.assign(lm[LM.RIGHT_SHOULDER], { x: 0.58, y: 0.30 });
  Object.assign(lm[LM.LEFT_HIP], { x: 0.45, y: 0.55 });
  Object.assign(lm[LM.RIGHT_HIP], { x: 0.55, y: 0.55 });
  Object.assign(lm[LM.LEFT_EAR], { x: 0.47, y: 0.12 });
  Object.assign(lm[LM.RIGHT_EAR], { x: 0.53, y: 0.12 });
  return lm;
}

describe('공용 임계값(POSTURE_THRESHOLDS) — 소스 배선', () => {
  it('postureOverlay.js와 postureClinical.js 둘 다 postureMath.js에서 import한다(각자 하드코딩 금지)', () => {
    const overlay = read('ai-measure/core/postureOverlay.js');
    const clinical = read('ai-measure/core/postureClinical.js');
    expect(overlay).toContain("import { POSE_LANDMARKS as LM, POSTURE_THRESHOLDS } from './postureMath';");
    expect(clinical).toContain("import { POSTURE_THRESHOLDS } from './postureMath';");
    expect(overlay).not.toMatch(/const TH = \{/);
  });

  it('PostureReport.jsx도 postureMath.js에서 POSTURE_THRESHOLDS를 import한다', () => {
    const report = read('ai-measure/menus/PostureReport.jsx');
    expect(report).toContain('POSTURE_THRESHOLDS');
    expect(report).toContain("from '../core/postureMath'");
  });
});

describe('임계값 통일 — 사진 마커와 부위별 진단이 같은 값에 같은 판정을 낸다', () => {
  it('어깨 높이차 17mm: 이전엔 마커=위험(≥16) vs 진단=주의(<18)로 갈렸다 — 이제 둘 다 주의', () => {
    const value = 17;
    const markers = buildPostureMarkers(
      { frontal: { shoulderHeightDiffMm: value, pelvisHeightDiffMm: 0 }, sagittal: {} },
      baseLandmarks(), 'front',
    );
    const overlaySeverity = markers.find((m) => m.label.includes('어깨'))?.severity ?? 'normal';

    const regions = buildRegionDiagnoses({
      front: { frontal: { shoulderHeightDiffMm: value }, cog: null },
    }, {});
    const clinicalLevel = regions.find((r) => r.key === 'shoulder_back').level;

    expect(overlaySeverity).toBe('caution');
    expect(clinicalLevel).toBe('caution');
    expect(overlaySeverity).toBe(clinicalLevel);
  });

  it('거북목 60mm: 이전엔 마커=주의(40/80 기준) vs 지표패널·진단=위험(25/45 기준)으로 갈렸다 — 이제 둘 다 위험', () => {
    const value = 60;
    const markers = buildPostureMarkers(
      { frontal: {}, sagittal: { forwardHeadMm: value, kyphosisProxyDeg: 180, kneeExtensionProxyDeg: 178 } },
      baseLandmarks(), 'left',
    );
    const overlaySeverity = markers.find((m) => m.label.includes('거북목'))?.severity ?? 'normal';
    expect(overlaySeverity).toBe('risk');
    expect(value).toBeGreaterThan(POSTURE_THRESHOLDS.forwardHeadMm[1]); // 45 초과 → risk와 일치
  });

  it('무릎 신전각 188도: 이전엔 마커=주의(190 미만) vs 점수 엔진=위험(185 초과)으로 갈렸다 — 이제 둘 다 위험', () => {
    const markers = buildPostureMarkers(
      { frontal: {}, sagittal: { forwardHeadMm: 10, kyphosisProxyDeg: 180, kneeExtensionProxyDeg: 188 } },
      baseLandmarks(), 'right',
    );
    const overlaySeverity = markers.find((m) => m.label.includes('무릎'))?.severity ?? 'normal';
    expect(overlaySeverity).toBe('risk'); // 188 > riskAbove(185)
  });
});

describe('무릎 신전각 판정 방향 통일 — 과신전만 본다(미달 판정 제거)', () => {
  const src = read('ai-measure/menus/PostureReport.jsx');

  it('PostureReport.jsx의 kneeExtensionStatus가 더 이상 미달(<175/177)을 판정하지 않는다', () => {
    const start = src.indexOf('function kneeExtensionStatus(value) {');
    const end = src.indexOf('\n}', start);
    const fn = src.slice(start, end);
    expect(fn).not.toContain('< 175');
    expect(fn).not.toContain('< 177');
    expect(fn).toContain('POSTURE_THRESHOLDS.kneeExtensionDeg');
  });

  it('postureMath.js(evaluatePostureRules)와 postureClinical.js(부위별 진단) 둘 다 같은 kneeExtensionDeg 상수를 쓴다', () => {
    const math = read('ai-measure/core/postureMath.js');
    const clinical = read('ai-measure/core/postureClinical.js');
    expect(math).toContain('POSTURE_THRESHOLDS.kneeExtensionDeg');
    expect(clinical).toContain('POSTURE_THRESHOLDS.kneeExtensionDeg');
  });
});
