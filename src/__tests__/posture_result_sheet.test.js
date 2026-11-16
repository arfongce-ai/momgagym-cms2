import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildPostureSheetItems,
  pickPriorityTop3,
  activeRegions,
  collectViewLandmarks,
  markerPct,
  levelOf,
} from '../ai-measure/core/postureResultSheet';
import { POSTURE_THRESHOLDS } from '../ai-measure/core/postureMath';
import { buildRegionDiagnoses } from '../ai-measure/core/postureClinical';

const pv = {
  front: { frontal: { shoulderHeightDiffMm: -20, pelvisHeightDiffMm: 5, qAngleProxyDeg: { left: 176, right: 178 } } },
  back: { frontal: { shoulderHeightDiffMm: 9, pelvisHeightDiffMm: -14 } },
  left: { sagittal: { forwardHeadMm: 30, kyphosisProxyDeg: 170, pelvicPitchProxyDeg: -3, anklePlumbHipDeviationMm: 10, anklePlumbKneeDeviationMm: 5 } },
};

describe('자세 결과시트 — 항목 계산', () => {
  const items = buildPostureSheetItems({ perViewAnalysis: pv, sex: 'male' });
  const by = Object.fromEntries(items.map((it) => [it.key, it]));

  it('기존 POSTURE_THRESHOLDS 기준을 그대로 쓴다(새 기준 없음)', () => {
    expect([by.forward_head.caution, by.forward_head.risk]).toEqual(POSTURE_THRESHOLDS.forwardHeadMm);
    expect([by.shoulder_height.caution, by.shoulder_height.risk]).toEqual(POSTURE_THRESHOLDS.shoulderDiffMm);
    expect([by.knee_plumb.caution, by.knee_plumb.risk]).toEqual(POSTURE_THRESHOLDS.ankleKneePlumbMm);
  });

  it('어깨·골반은 정면/후면 중 더 크게 벗어난 쪽 값과 출처를 쓴다', () => {
    expect(by.shoulder_height.value).toBe(20);
    expect(by.shoulder_height.source).toBe('front');
    expect(by.shoulder_height.level).toBe('risk');
    expect(by.pelvis_height.value).toBe(14);
    expect(by.pelvis_height.source).toBe('back');
    expect(by.pelvis_height.level).toBe('caution');
  });

  it('굽은 등은 180° 편위로 변환한다', () => {
    expect(by.kyphosis.value).toBe(10);
    expect(by.kyphosis.level).toBe('normal');
  });

  it('부위별 진단(buildRegionDiagnoses)과 단계가 어긋나지 않는다', () => {
    const regions = Object.fromEntries(buildRegionDiagnoses(pv, { sex: 'male' }).map((r) => [r.key, r]));
    // 머리·목은 거북목 하나로만 판정되므로 단계가 같아야 한다.
    expect(regions.head_neck.level).toBe(by.forward_head.level);
  });

  it('정상 항목에는 근육 경향을 붙이지 않는다', () => {
    expect(by.kyphosis.tight).toEqual([]);
    expect(by.shoulder_height.tight.length).toBeGreaterThan(0);
  });

  it('먼저 볼 3가지는 위험 → 주의, 위험선 대비 비율 순', () => {
    const top = pickPriorityTop3(items);
    expect(top[0].key).toBe('shoulder_height');
    expect(top.map((t) => t.rank)).toEqual(top.map((_, i) => i + 1));
    expect(top.every((t) => t.level !== 'normal')).toBe(true);
  });

  it('지난번 값과의 차이를 계산한다(음수 = 좋아짐)', () => {
    const prev = { perViewAnalysis: { left: { sagittal: { forwardHeadMm: 36 } } } };
    const withPrev = buildPostureSheetItems({ perViewAnalysis: pv, previous: prev });
    const fh = withPrev.find((it) => it.key === 'forward_head');
    expect(fh.previous).toBe(36);
    expect(fh.delta).toBe(-6);
  });

  it('주의·위험 부위만 근육 그림에 색칠한다', () => {
    const regions = activeRegions(items);
    expect(regions).toContain('shoulder_back');
    expect(regions).not.toContain('foot_leg');
  });

  it('측정값 없는 항목은 목록에서 뺀다', () => {
    const only = buildPostureSheetItems({ analysis: { frontal: { shoulderHeightDiffMm: 3 } } });
    expect(only.map((it) => it.key)).toEqual(['shoulder_height']);
  });
});

describe('자세 결과시트 — 보조 함수', () => {
  it('levelOf / markerPct 경계', () => {
    expect(levelOf(25, 25, 45)).toBe('caution');
    expect(levelOf(45, 25, 45)).toBe('risk');
    expect(levelOf(null, 25, 45)).toBeNull();
    expect(markerPct(0, 25, 45)).toBe(0);
    expect(markerPct(999, 25, 45)).toBe(100);
  });

  it('면별 좌표: 저장된 viewLandmarks 우선, 없으면 대표 1면', () => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
    expect(Object.keys(collectViewLandmarks({ viewLandmarks: { front: lm, left: lm } }))).toEqual(['front', 'left']);
    expect(Object.keys(collectViewLandmarks({ fallback: lm }))).toEqual(['front']);
    expect(collectViewLandmarks({ viewLandmarks: { front: [] } })).toEqual({});
  });
});

describe('자세 리포트 화면 연결', () => {
  const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
  const report = read('ai-measure/menus/PostureReport.jsx');
  const sheet = read('ai-measure/menus/PostureResultSheet.jsx');

  it('PostureReport가 결과시트를 렌더한다', () => {
    expect(report).toContain("import PostureResultSheet from './PostureResultSheet.jsx'");
    expect(report).toMatch(/<PostureResultSheet[\s\S]*previousReport=\{previousReport\}/);
  });

  it('밝은 화면에서 안 보이던 단독 흰 글씨 제목이 없다', () => {
    expect(report).not.toMatch(/text-white(?!\S)(?<!dark:text-white)/);
    expect(sheet).not.toMatch(/(?<!dark:)text-white/);
  });

  it('측정하지 않는 장기·신경·림프·악화 시뮬레이션 문구를 넣지 않는다', () => {
    expect(sheet).not.toMatch(/WORSENED|>악화|>장기<|>신경<|>림프</);
    expect(sheet).toContain('추정 · 측정값 아님');
  });
});

describe('근육 경향 해부도', async () => {
  const { muscleStates, REGION_MUSCLES } = await import('../ai-measure/menus/MuscleAnatomyFigure.jsx');
  const { buildMuscleMap } = await import('../ai-measure/core/postureClinical');

  it('부위별 근육 묶음이 buildMuscleMap의 부위와 같다', () => {
    ['head_neck', 'shoulder_back', 'pelvis_spine', 'foot_leg'].forEach((r) => {
      expect(REGION_MUSCLES[r]).toBeTruthy();
      expect(buildMuscleMap([{ key: r, level: 'caution' }]).tight.length).toBeGreaterThan(0);
    });
  });

  it('활성 부위만 색칠, 정상이면 색칠 없음', () => {
    expect(muscleStates([])).toEqual({});
    const s = muscleStates(['shoulder_back']);
    expect(s['front.pec']).toBe('tight');
    expect(s['back.rhomboid']).toBe('weak');
    expect(s['back.calf']).toBeUndefined();
  });
});
