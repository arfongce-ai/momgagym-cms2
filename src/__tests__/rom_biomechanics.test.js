import { describe, expect, it } from 'vitest';
import {
  LM,
  angleBetween,
  vectorToAxisAngle,
  normalizePose,
  movingAverage,
  median,
  symmetryIndex,
  jointAngleByMode,
  pelvicDrop,
  RomAccumulator,
} from '../ai-measure/core/bodyMechanics';
import { generateRomDiagnosis } from '../ai-measure/core/romClinical';

// 표준 직립 포즈 생성기 (정규화 좌표). 필요한 관절만 의미있게 배치.
function makePose(overrides = {}) {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
  Object.assign(pose[LM.LEFT_SHOULDER], { x: 0.42, y: 0.25 });
  Object.assign(pose[LM.RIGHT_SHOULDER], { x: 0.58, y: 0.25 });
  Object.assign(pose[LM.LEFT_HIP], { x: 0.44, y: 0.52 });
  Object.assign(pose[LM.RIGHT_HIP], { x: 0.56, y: 0.52 });
  Object.assign(pose[LM.LEFT_KNEE], { x: 0.44, y: 0.72 });
  Object.assign(pose[LM.RIGHT_KNEE], { x: 0.56, y: 0.72 });
  Object.assign(pose[LM.LEFT_ANKLE], { x: 0.44, y: 0.92 });
  Object.assign(pose[LM.RIGHT_ANKLE], { x: 0.56, y: 0.92 });
  Object.assign(pose[LM.LEFT_FOOT_INDEX], { x: 0.46, y: 0.96 });
  Object.assign(pose[LM.RIGHT_FOOT_INDEX], { x: 0.54, y: 0.96 });
  Object.assign(pose[LM.LEFT_ELBOW], { x: 0.40, y: 0.40 });
  Object.assign(pose[LM.RIGHT_ELBOW], { x: 0.60, y: 0.40 });
  Object.entries(overrides).forEach(([idx, patch]) => Object.assign(pose[idx], patch));
  return pose;
}

describe('bodyMechanics — 기하 연산', () => {
  it('angleBetween: 직각을 90도로 계산', () => {
    const a = { x: 0, y: 1, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    const c = { x: 1, y: 0, z: 0 };
    expect(angleBetween(a, b, c, false)).toBeCloseTo(90, 0);
  });

  it('angleBetween: 일직선을 180도로 계산', () => {
    const a = { x: -1, y: 0 };
    const b = { x: 0, y: 0 };
    const c = { x: 1, y: 0 };
    expect(angleBetween(a, b, c, false)).toBeCloseTo(180, 0);
  });

  it('vectorToAxisAngle: 수직 아래로 향한 대퇴골은 수직축(위)과 180도', () => {
    const hip = { x: 0, y: 0 };
    const knee = { x: 0, y: 1 }; // 아래
    const up = { x: 0, y: -1 };
    expect(vectorToAxisAngle(hip, knee, up, false)).toBeCloseTo(180, 0);
  });

  it('vectorToAxisAngle: 수평으로 굴곡된 대퇴골은 수직축과 90도', () => {
    const hip = { x: 0, y: 0 };
    const knee = { x: 1, y: 0 }; // 수평
    const up = { x: 0, y: -1 };
    expect(vectorToAxisAngle(hip, knee, up, false)).toBeCloseTo(90, 0);
  });
});

describe('bodyMechanics — 정규화/필터', () => {
  it('normalizePose: 골반 중점이 원점(0,0)으로 평행이동된다', () => {
    const pose = makePose();
    const norm = normalizePose(pose);
    const hipMidX = (norm[LM.LEFT_HIP].x + norm[LM.RIGHT_HIP].x) / 2;
    const hipMidY = (norm[LM.LEFT_HIP].y + norm[LM.RIGHT_HIP].y) / 2;
    expect(hipMidX).toBeCloseTo(0, 5);
    expect(hipMidY).toBeCloseTo(0, 5);
  });

  it('normalizePose: 어깨너비가 1.0 으로 스케일된다', () => {
    const pose = makePose();
    const norm = normalizePose(pose);
    const w = Math.hypot(
      norm[LM.RIGHT_SHOULDER].x - norm[LM.LEFT_SHOULDER].x,
      norm[LM.RIGHT_SHOULDER].y - norm[LM.LEFT_SHOULDER].y,
    );
    expect(w).toBeCloseTo(1, 5);
  });

  it('normalizePose: 카메라 거리가 달라도(전체 축소) 동일 각도가 나온다', () => {
    const near = makePose();
    // far = 모든 좌표를 0.5 중심으로 절반 축소 (멀리서 찍은 것처럼)
    const far = near.map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * 0.5, y: 0.5 + (p.y - 0.5) * 0.5 }));
    const aNear = jointAngleByMode(normalizePose(near), 'KNEE', 'left', 'STANDING').angle;
    const aFar = jointAngleByMode(normalizePose(far), 'KNEE', 'left', 'STANDING').angle;
    expect(aNear).toBeCloseTo(aFar, 1);
  });

  it('movingAverage: 튀는 값(스파이크)을 완화한다', () => {
    const series = [100, 100, 100, 180, 100, 100, 100];
    const sm = movingAverage(series, 5);
    expect(sm[3]).toBeLessThan(180);
    expect(sm[3]).toBeGreaterThan(100);
  });

  it('median: 이상치에 강건', () => {
    expect(median([10, 12, 11, 200, 13])).toBe(12);
  });

  it('symmetryIndex: 동일값이면 0%', () => {
    expect(symmetryIndex(120, 120)).toBe(0);
  });

  it('symmetryIndex: 좌우 차이를 % 로 환산', () => {
    expect(symmetryIndex(100, 120)).toBeCloseTo(16.7, 0);
  });
});

describe('bodyMechanics — 자세모드별 기준 벡터', () => {
  it('STANDING vs SUPINE 은 같은 굴곡 자세라도 기준선이 다르다', () => {
    // 대퇴골을 수평으로 굴곡(고관절 90도 굴곡 자세)
    const pose = makePose({ [LM.LEFT_KNEE]: { x: 0.20, y: 0.52 } });
    const standing = jointAngleByMode(normalizePose(pose), 'HIP', 'left', 'STANDING');
    const supine = jointAngleByMode(normalizePose(pose), 'HIP', 'left', 'SUPINE');
    expect(standing.base).toBe('vertical_gravity_line');
    expect(supine.base).toBe('horizontal_bed_plane');
    // 같은 대퇴골 벡터라도 수직 기준선(서서) vs 수평 기준선(누워서)으로 측정하므로
    // 두 각도는 90도 차이가 나야 한다(기준선 직교).
    expect(Math.abs(standing.angle - supine.angle)).toBeCloseTo(90, 0);
  });

  it('STANDING HIP 은 보상값(pelvicDrop)을 함께 반환한다', () => {
    const pose = makePose();
    const res = jointAngleByMode(normalizePose(pose), 'HIP', 'left', 'STANDING');
    expect(res.compensatory).not.toBeNull();
  });

  it('SUPINE HIP 은 보상값을 추적하지 않는다(지면 통제)', () => {
    const pose = makePose();
    const res = jointAngleByMode(normalizePose(pose), 'HIP', 'left', 'SUPINE');
    expect(res.compensatory).toBeNull();
  });

  it('pelvicDrop: 지지쪽 골반이 내려앉으면 양수로 감지', () => {
    // 왼쪽을 측정(움직임), 오른쪽(지지) 골반을 아래로(y 큼)
    const pose = makePose({ [LM.RIGHT_HIP]: { x: 0.56, y: 0.60 } });
    const drop = pelvicDrop(pose, 'left');
    expect(drop).toBeGreaterThan(0);
  });
});

describe('RomAccumulator — 시계열 누적/요약', () => {
  it('데이터가 부족하면 valid=false', () => {
    const acc = new RomAccumulator({ joint: 'KNEE', poseMode: 'STANDING' });
    acc.push(makePose(), 0);
    acc.push(makePose(), 33);
    const sum = acc.summary();
    expect(sum.valid).toBe(false);
  });

  it('무릎 굴곡 동작에서 최대 굴곡각을 산출한다', () => {
    const acc = new RomAccumulator({ joint: 'KNEE', poseMode: 'SUPINE' });
    // 펴짐(거의 180 내각) → 점점 굽힘(무릎을 hip 쪽으로) → 다시 펴짐
    for (let i = 0; i < 20; i++) {
      const bend = Math.sin((i / 19) * Math.PI); // 0→1→0
      // ankle 을 무릎 위로 끌어올려 무릎 내각을 줄인다(굴곡)
      const ankleY = 0.92 - bend * 0.55;
      const ankleX = 0.44 + bend * 0.10;
      const pose = makePose({ [LM.LEFT_ANKLE]: { x: ankleX, y: ankleY } });
      acc.push(pose, i * 40);
    }
    const sum = acc.summary();
    expect(sum.valid).toBe(true);
    expect(sum.left_max_rom).toBeGreaterThan(40); // 의미있는 굴곡 발생
  });

  it('좌우 동일 동작이면 대칭성 점수가 낮다(대칭)', () => {
    const acc = new RomAccumulator({ joint: 'KNEE', poseMode: 'SUPINE' });
    for (let i = 0; i < 16; i++) {
      const bend = Math.sin((i / 15) * Math.PI);
      const pose = makePose({
        [LM.LEFT_ANKLE]: { x: 0.44 + bend * 0.1, y: 0.92 - bend * 0.5 },
        [LM.RIGHT_ANKLE]: { x: 0.56 - bend * 0.1, y: 0.92 - bend * 0.5 },
      });
      acc.push(pose, i * 40);
    }
    const sum = acc.summary();
    expect(sum.symmetry_index_score).toBeLessThan(10);
  });

  it('timeSeries 스키마 필드를 포함한다', () => {
    const acc = new RomAccumulator({ joint: 'HIP', poseMode: 'STANDING' });
    for (let i = 0; i < 8; i++) acc.push(makePose(), i * 40);
    const sum = acc.summary();
    expect(sum.timeSeries[0]).toHaveProperty('timestamp');
    expect(sum.timeSeries[0]).toHaveProperty('left_angle');
    expect(sum.timeSeries[0]).toHaveProperty('right_angle');
    expect(sum.timeSeries[0]).toHaveProperty('compensatory_value');
  });
});

describe('romClinical — AI 진단 엔진', () => {
  it('데이터 부족 시 진단을 보류한다(insufficient)', () => {
    const dx = generateRomDiagnosis({ valid: false }, { joint: 'HIP', poseMode: 'STANDING' });
    expect(dx.grade).toBe('insufficient');
    expect(dx.flags).toContain('insufficient_data');
  });

  it('정상 범위면 good 등급', () => {
    const summary = {
      valid: true,
      left_max_rom: 120, right_max_rom: 122,
      symmetry_index_score: 1.6,
      end_range_stability_score: { left: 85, right: 88 },
      compensation: { left: 1, right: 1 },
    };
    const dx = generateRomDiagnosis(summary, { joint: 'HIP', poseMode: 'SUPINE' });
    expect(dx.grade).toBe('good');
  });

  it('좌우 비대칭이 크면 asymmetry 플래그와 attention 이상 등급', () => {
    const summary = {
      valid: true,
      left_max_rom: 90, right_max_rom: 125,
      symmetry_index_score: 28,
      end_range_stability_score: { left: 80, right: 80 },
      compensation: { left: 2, right: 2 },
    };
    const dx = generateRomDiagnosis(summary, { joint: 'HIP', poseMode: 'SUPINE' });
    expect(dx.flags).toContain('asymmetry');
    expect(['attention', 'focus']).toContain(dx.grade);
  });

  it('양측 가동범위 제한이면 focus 등급 (끝범위 측정은 진단에서 제외)', () => {
    const summary = {
      valid: true,
      left_max_rom: 70, right_max_rom: 72,
      symmetry_index_score: 2.8,
      compensation: { left: 2, right: 2 },
    };
    const dx = generateRomDiagnosis(summary, { joint: 'HIP', poseMode: 'SUPINE' });
    expect(dx.grade).toBe('focus');
    // 끝범위 관련 플래그/문구는 더 이상 생성되지 않는다(항목 5).
    expect(dx.flags).not.toContain('end_range_instability');
    expect(dx.details.join(' ')).not.toMatch(/끝범위|잔떨림/);
  });
});

describe('ROM 리포트 저장 페이로드 — ObjectURL 제외 규약', () => {
  // RomMeasure.handleSave 가 저장 직전 제거하는 필드(화면 전용 ObjectURL)를
  // 시뮬레이션해, 저장 페이로드에 blob URL 이 새어 나가지 않는지 검증.
  function buildSavePayload(report) {
    const { snapshotUrl, previewVideoUrl, ...payload } = report;
    return payload;
  }

  it('snapshotUrl/previewVideoUrl(로컬 ObjectURL)은 저장 페이로드에서 제거된다', () => {
    const report = {
      kind: 'rom', joint: 'HIP', poseMode: 'SUPINE',
      snapshotUrl: 'blob:http://x/snap',
      previewVideoUrl: 'blob:http://x/video',
      hasVideo: true,
      linkedPostureReportId: 'posture_123',
      summary: { valid: true, left_max_rom: 120 },
      diagnosis: { grade: 'good' },
      pairKey: 'm1_rom_HIP_SUPINE',
    };
    const payload = buildSavePayload(report);
    expect(payload.snapshotUrl).toBeUndefined();
    expect(payload.previewVideoUrl).toBeUndefined();
    // 정량 데이터(스키마)와 비교키는 유지된다.
    expect(payload.summary.left_max_rom).toBe(120);
    expect(payload.pairKey).toBe('m1_rom_HIP_SUPINE');
    expect(payload.hasVideo).toBe(true);
    expect(payload.linkedPostureReportId).toBe('posture_123');
  });
});
