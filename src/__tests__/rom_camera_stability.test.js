// src/__tests__/rom_camera_stability.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2611-ROM] 폰 카메라 AROM 일관성 — 순간 튐이 결과가 되지 않고, 반복을 검출해
//  편차를 알리며, 옆모습·가시성 문제를 경고한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  LM, ROM_NORMS, jointAngleByMode, RomAccumulator, sustainedExtreme, detectRepPeaks, jointMinVisibility,
  viewSeparationRatio, ROM_VIEW_RATIO_MAX,
} from '../ai-measure/core/bodyMechanics';
import { generateRomDiagnosis } from '../ai-measure/core/romClinical';

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf-8');

function makePose(overrides = {}, vis = 0.99) {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: vis }));
  Object.assign(pose[LM.LEFT_SHOULDER], { x: 0.42, y: 0.25 });
  Object.assign(pose[LM.RIGHT_SHOULDER], { x: 0.58, y: 0.25 });
  Object.assign(pose[LM.LEFT_HIP], { x: 0.44, y: 0.52 });
  Object.assign(pose[LM.RIGHT_HIP], { x: 0.56, y: 0.52 });
  Object.assign(pose[LM.LEFT_KNEE], { x: 0.44, y: 0.72 });
  Object.assign(pose[LM.RIGHT_KNEE], { x: 0.56, y: 0.72 });
  Object.assign(pose[LM.LEFT_ANKLE], { x: 0.44, y: 0.92 });
  Object.assign(pose[LM.RIGHT_ANKLE], { x: 0.56, y: 0.92 });
  Object.entries(overrides).forEach(([idx, patch]) => Object.assign(pose[idx], patch));
  return pose;
}

// 왼쪽 무릎 굴곡 반복 — peaks(각 반복의 굴곡 정도 0~1) 만큼 굽혔다 폄. 프레임당 steps 개.
function kneeReps(peaks, { steps = 14, rest = 6, mutate } = {}) {
  const poses = [];
  const add = (bend) => poses.push(makePose({ [LM.LEFT_ANKLE]: { x: 0.44 + bend * 0.12, y: 0.92 - bend * 0.55 } }));
  for (let i = 0; i < rest; i++) add(0);
  for (const pk of peaks) {
    for (let i = 1; i <= steps; i++) add(pk * Math.sin((i / steps) * Math.PI));
    for (let i = 0; i < 3; i++) add(0);
  }
  for (let i = 0; i < rest; i++) add(0);
  return mutate ? mutate(poses) : poses;
}
function run(poses, joint = 'KNEE', poseMode = 'SUPINE') {
  const acc = new RomAccumulator({ joint, poseMode });
  poses.forEach((p, i) => acc.push(p, i * 40));
  return acc.summary();
}

describe('sustainedExtreme — 순간 튐 제거', () => {
  it('1~2프레임 튄 값은 최대가 되지 않는다', () => {
    const v = [80, 81, 80, 82, 150, 80, 81, 80, 81, 80, 160, 170, 81, 80];
    expect(sustainedExtreme(v, 'max')).toBeLessThan(90);
  });
  it('3프레임 이상 유지된 값은 최대로 인정한다', () => {
    const v = [80, 81, 120, 121, 122, 121, 120, 80];
    expect(sustainedExtreme(v, 'max')).toBeGreaterThanOrEqual(120);
  });
  it('min 모드(무릎·팔꿈치 내각)', () => {
    const v = [170, 170, 20, 170, 100, 100, 101, 100, 99, 170];
    expect(sustainedExtreme(v, 'min')).toBeGreaterThan(95);
  });
  it('표본이 k 미만이면 단순 극값', () => {
    expect(sustainedExtreme([3, 9, 5], 'max')).toBe(9);
    expect(sustainedExtreme([], 'max')).toBeNull();
  });
});

describe('detectRepPeaks — 반복별 피크', () => {
  const wave = (peaks, n = 20) => peaks.flatMap((pk) =>
    [0, 0, ...Array.from({ length: n }, (_, i) => pk * Math.sin(((i + 1) / (n + 1)) * Math.PI)), 0, 0]);

  it('3회 반복을 3개로 센다', () => {
    const r = detectRepPeaks(wave([90, 92, 88]));
    expect(r.count).toBe(3);
    expect(r.peaks[0]).toBeGreaterThan(85);
  });
  it('1회면 1', () => expect(detectRepPeaks(wave([90])).count).toBe(1));
  it('움직임이 15° 미만이면 반복 0(정지·떨림)', () => {
    const r = detectRepPeaks(wave([10, 9, 11]));
    expect(r.count).toBe(0);
  });
  it('피크 근처 잔떨림(±3°)으로 한 반복이 둘로 쪼개지지 않는다', () => {
    const w = wave([90]).map((x, i) => x + (x > 60 ? (i % 2 ? 3 : -3) : 0));
    expect(detectRepPeaks(w).count).toBe(1);
  });
});

describe('RomAccumulator — 일관성', () => {
  it('인식 튐 한 프레임(관절 순간 이탈)이 최대각을 부풀리지 않는다', () => {
    const clean = run(kneeReps([0.9]));
    const spiked = run(kneeReps([0.9], {
      // 올라가는 구간 한 프레임에서 발목이 크게 튐(실제 동작 범위를 훨씬 넘는 값)
      mutate: (ps) => { ps[9] = makePose({ [LM.LEFT_ANKLE]: { x: 0.40, y: 0.20 } }); return ps; },
    }));
    // 이전 방식(전체 프레임 단순 최댓값)이라면 이 튐이 그대로 결과가 되었다
    const plainMax = (poses) => {
      const acc = new RomAccumulator({ joint: 'KNEE', poseMode: 'SUPINE' });
      poses.forEach((p, i) => acc.push(p, i * 40));
      return Math.max(...acc.samples.map((x) => 180 - x.left));
    };
    const spikedPoses = kneeReps([0.9], { mutate: (ps) => { ps[9] = makePose({ [LM.LEFT_ANKLE]: { x: 0.40, y: 0.20 } }); return ps; } });
    expect(plainMax(spikedPoses)).toBeGreaterThan(clean.left_max_rom + 10);
    expect(Math.abs(spiked.left_max_rom - clean.left_max_rom)).toBeLessThan(3);
  });

  it('같은 크기의 반복 3회 → rep_count 3, 편차 작음, 경고 없음', () => {
    const s = run(kneeReps([0.9, 0.9, 0.9]));
    expect(s.stability.left.rep_count).toBe(3);
    expect(s.stability.left.peak_method).toBe('rep_median');
    expect(s.stability.left.rep_spread_deg).toBeLessThan(3);
    expect(s.stability.warnings.filter((w) => w.startsWith('left_'))).toEqual([]);
  });

  it('반복마다 크기가 많이 다르면 편차 경고(rep_spread)', () => {
    const s = run(kneeReps([0.55, 0.9, 0.7]));
    expect(s.stability.left.rep_spread_deg).toBeGreaterThanOrEqual(5);
    expect(s.stability.warnings).toContain('left_rep_spread');
  });

  it('1회만 하면 few_reps 경고(재측정 강제는 아님, 값은 나옴)', () => {
    const s = run(kneeReps([0.9]));
    expect(s.valid).toBe(true);
    expect(s.left_max_rom).toBeGreaterThan(40);
    expect(s.stability.warnings).toContain('left_few_reps');
  });

  it('움직이지 않은 쪽(오른쪽)은 경고 대상이 아니다', () => {
    const s = run(kneeReps([0.9, 0.9, 0.9]));
    expect(s.stability.right.moved).toBe(false);
    expect(s.stability.warnings.filter((w) => w.startsWith('right_'))).toEqual([]);
  });

  it('관절이 흐리게 잡힌(visibility<0.5) 프레임뿐이면 low_visibility 경고 + 값은 그대로 산출', () => {
    const poses = kneeReps([0.9, 0.9, 0.9]).map((_, i, arr) => arr[i]);
    const dim = poses.map((p) => p.map((q) => ({ ...q, visibility: 0.42 })));
    const s = run(dim);
    expect(s.stability.left.low_visibility).toBe(true);
    expect(s.stability.warnings).toContain('left_low_visibility');
    expect(s.left_max_rom).not.toBeNull();
  });

  it('잘 보이는 프레임이 충분하면 흐린 프레임을 대표값에서 뺀다', () => {
    const base = kneeReps([0.9, 0.9, 0.9]);
    const clean = run(base);
    // 일부 프레임(피크 부근)을 흐리게 + 값을 크게 어긋나게 → 흐린 프레임은 무시돼야 함
    const mut = base.map((p, i) => (i % 9 === 4
      ? makePose({ [LM.LEFT_ANKLE]: { x: 0.44, y: 0.30 } }).map((q) => ({ ...q, visibility: 0.3 }))
      : p));
    const s = run(mut);
    expect(Math.abs(s.left_max_rom - clean.left_max_rom)).toBeLessThan(6);
  });
});

describe('옆모습 정렬 신호', () => {
  const frontal = () => makePose(); // 어깨폭 0.16 / 몸통 0.27 → 정면 근처
  const sideish = () => makePose({
    [LM.LEFT_SHOULDER]: { x: 0.50, y: 0.25 }, [LM.RIGHT_SHOULDER]: { x: 0.505, y: 0.25 },
    [LM.LEFT_HIP]: { x: 0.50, y: 0.52 }, [LM.RIGHT_HIP]: { x: 0.505, y: 0.52 },
  });
  it('정면 쪽이면 비율이 크고, 옆모습이면 0 근처', () => {
    expect(viewSeparationRatio(frontal())).toBeGreaterThan(ROM_VIEW_RATIO_MAX);
    expect(viewSeparationRatio(sideish())).toBeLessThan(0.1);
  });
  it('어깨·골반이 안 보이면 null(추측하지 않음)', () => {
    const p = makePose();
    p[LM.LEFT_SHOULDER].visibility = 0.1;
    expect(viewSeparationRatio(p)).toBeNull();
  });
  it('촬영 내내 정면 쪽이면 view_not_side 경고, 옆모습이면 없음', () => {
    const f = run(kneeReps([0.9, 0.9, 0.9]));
    expect(f.stability.warnings).toContain('view_not_side');
    const side = run(kneeReps([0.9, 0.9, 0.9]).map((p) => {
      const q = p.map((x) => ({ ...x }));
      Object.assign(q[LM.LEFT_SHOULDER], { x: 0.50 }); Object.assign(q[LM.RIGHT_SHOULDER], { x: 0.505 });
      Object.assign(q[LM.LEFT_HIP], { x: 0.50 }); Object.assign(q[LM.RIGHT_HIP], { x: 0.505 });
      return q;
    }));
    expect(side.stability.view.ok).toBe(true);
    expect(side.stability.warnings).not.toContain('view_not_side');
  });
});

describe('jointMinVisibility', () => {
  it('쓰이는 랜드마크 중 최소값, 하나라도 없으면 null', () => {
    const p = makePose();
    p[LM.LEFT_KNEE].visibility = 0.6;
    expect(jointMinVisibility(p, 'KNEE', 'left', 'SUPINE')).toBeCloseTo(0.6, 5);
    p[LM.LEFT_ANKLE] = null;
    expect(jointMinVisibility(p, 'KNEE', 'left', 'SUPINE')).toBeNull();
  });
});

describe('generateRomDiagnosis — 안정성 경고 문구', () => {
  const base = { valid: true, left_max_rom: 120, right_max_rom: null, symmetry_index_score: null };
  it('반복 편차·옆모습 이탈은 재측정 권고 flag, 등급은 그대로', () => {
    const plain = generateRomDiagnosis({ ...base }, { joint: 'KNEE', poseMode: 'SUPINE' });
    const dx = generateRomDiagnosis({
      ...base,
      stability: {
        left: { rep_count: 3, rep_peaks: [110, 120, 128], rep_spread_deg: 18 },
        right: {}, view: { ok: false },
        warnings: ['left_rep_spread', 'view_not_side'],
      },
    }, { joint: 'KNEE', poseMode: 'SUPINE' });
    expect(dx.flags).toContain('retest_recommended');
    expect(dx.flags).toContain('rep_unstable');
    expect(dx.flags).toContain('view_not_side');
    expect(dx.grade).toBe(plain.grade);
    expect(dx.details.join(' ')).toMatch(/18°/);
  });
  it('stability 가 없으면(구 리포트) 아무것도 추가하지 않는다', () => {
    const a = generateRomDiagnosis({ ...base }, { joint: 'KNEE', poseMode: 'SUPINE' });
    expect(a.flags).not.toContain('retest_recommended');
  });
});

describe('RomMeasure 배선 (소스 확인)', () => {
  const src = read('ai-measure/menus/RomMeasure.jsx');
  it('안내 문구가 3회 반복이고, 옆모습 정렬을 실시간으로 알린다(촬영은 막지 않음)', () => {
    expect(src).toMatch(/3회/);
    expect(src).toMatch(/viewSeparationRatio/);
    expect(src).toMatch(/옆모습 정렬 확인됨/);
    expect(src).not.toMatch(/disabled=\{[^}]*viewState/);
  });
});

// ── 어깨 벌림(ABDUCTION, 정면 촬영) ──
describe('어깨 벌림(ABDUCTION) 추가', () => {
  const mk = (armDeg) => {
    // 정면: 어깨 (±0.1, 0.3), 골반 (±0.08, 0.6). 오른팔을 수직 아래(0°)에서 armDeg만큼 옆으로 든다.
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
    lm[LM.LEFT_SHOULDER] = { x: 0.4, y: 0.3, z: 0, visibility: 0.99 };
    lm[LM.RIGHT_SHOULDER] = { x: 0.6, y: 0.3, z: 0, visibility: 0.99 };
    lm[LM.LEFT_HIP] = { x: 0.42, y: 0.6, z: 0, visibility: 0.99 };
    lm[LM.RIGHT_HIP] = { x: 0.58, y: 0.6, z: 0, visibility: 0.99 };
    const r = (armDeg * Math.PI) / 180;
    lm[LM.RIGHT_ELBOW] = { x: 0.6 + 0.2 * Math.sin(r), y: 0.3 + 0.2 * Math.cos(r), z: 0, visibility: 0.99 };
    lm[LM.LEFT_ELBOW] = { x: 0.4 - 0.2 * Math.sin(r), y: 0.3 + 0.2 * Math.cos(r), z: 0, visibility: 0.99 };
    return lm;
  };
  it('팔 내림=0°, 수평=90°, 머리 위=180°', () => {
    for (const a of [0, 90, 170]) {
      const got = jointAngleByMode(mk(a), 'SHOULDER', 'right', 'ABDUCTION').angle;
      expect(Math.abs(got - a)).toBeLessThan(1);
    }
  });
  it('ROM_NORMS에 벌림 기준이 있고 sanity 범위가 적용된다', () => {
    expect(ROM_NORMS.SHOULDER.ABDUCTION.abduction.normal).toBe(170);
  });
  it('정면이면 정렬 OK, 옆으로 돌면 view_not_front 경고', () => {
    const front = new RomAccumulator({ joint: 'SHOULDER', poseMode: 'ABDUCTION' });
    const side = new RomAccumulator({ joint: 'SHOULDER', poseMode: 'ABDUCTION' });
    for (let i = 0; i < 40; i++) {
      const a = 90 + 80 * Math.sin(i / 4);
      front.push(mk(a), i * 100);
      const s = mk(a);
      s[LM.LEFT_SHOULDER] = { x: 0.49, y: 0.3, z: 0, visibility: 0.99 };
      s[LM.RIGHT_SHOULDER] = { x: 0.51, y: 0.3, z: 0, visibility: 0.99 };
      side.push(s, i * 100);
    }
    expect(front.summary().stability.view.ok).toBe(true);
    expect(side.summary().stability.warnings).toContain('view_not_front');
    expect(side.summary().stability.warnings).not.toContain('view_not_side');
  });
});
