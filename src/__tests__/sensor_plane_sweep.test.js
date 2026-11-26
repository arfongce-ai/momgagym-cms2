import { describe, it, expect } from 'vitest';
import {
  planeComponents, gravityPlaneAngleDeg, offPlaneRatio, estimateTiltErrorDeg, SENSOR_PLANES,
} from '../ai-measure/core/sensorTilt';
import {
  createSweepRecorder, computeSegments, getSweepPreset, wrapDeg, profilePoints,
} from '../ai-measure/core/sensorSweep';
import { getSensorJointTip } from '../ai-measure/core/sensorJointTips';

const G = 9.81;
const rad = (d) => (d * Math.PI) / 180;
// 폰을 세로로 등에 댄 서 있는 상태(곧게 섬): 중력은 폰 y축(긴 변) 방향, 화면 법선 z·짧은 변 x에는 거의 없음.
const gv = (gx, gy, gz) => ({ x: gx, y: gy, z: gz });
const angleOf = (plane, g) => {
  const c = planeComponents(plane, g);
  return gravityPlaneAngleDeg(c.gy, c.gz, c.gx);
};

describe('측정 방향(평면) — 폰을 세로로 댈 때', () => {
  it('목록은 yz·yx·xz', () => { expect(SENSOR_PLANES).toEqual(['yz', 'yx', 'xz']); });

  it('앞뒤(yz): 긴 변이 앞으로 30° 기울면 30° (기존 동작 그대로)', () => {
    const t = rad(30);
    expect(angleOf('yz', gv(0, G * Math.cos(t), G * Math.sin(t)))).toBeCloseTo(30, 1);
  });

  it('옆(yx): 화면 평면에서 긴 변이 30° 기울면 30° — 기존(yz) 공식으로는 0° 로 못 잰다', () => {
    const t = rad(30);
    const g = gv(G * Math.sin(t), G * Math.cos(t), 0);
    expect(angleOf('yx', g)).toBeCloseTo(30, 1);
    expect(angleOf('yz', g)).toBeCloseTo(0, 1); // 예전 공식은 옆 기울임을 못 본다(그래서 방향 선택이 필요)
  });

  it('돌림(xz): 긴 변이 수평(몸통 숙임)일 때 긴 변 축 회전 40° → 40°', () => {
    const t = rad(40);
    // 폰 긴 변(y)이 수평이면 중력은 x–z 평면에만 있다
    const g = gv(G * Math.sin(t), 0, G * Math.cos(t));
    expect(angleOf('xz', g)).toBeCloseTo(40, 1);
  });

  it('측정면 이탈·비틀림 오차도 방향에 맞게 계산(옆 방향에서 앞으로 숙이면 이탈 큼)', () => {
    const t = rad(20); // 옆으로 20° 기울임 + 앞으로 숙임 성분
    const straight = planeComponents('yx', gv(G * Math.sin(t), G * Math.cos(t), 0));
    const bent = planeComponents('yx', gv(G * Math.sin(t) * 0.9, G * Math.cos(t) * 0.7, G * 0.5));
    const off0 = offPlaneRatio(straight.gx, straight.gy, straight.gz);
    const off1 = offPlaneRatio(bent.gx, bent.gy, bent.gz);
    expect(off0).toBeCloseTo(0, 2);
    expect(off1).toBeGreaterThan(0.3);
    expect(estimateTiltErrorDeg(bent.gx, bent.gy, bent.gz)).toBeGreaterThan(estimateTiltErrorDeg(straight.gx, straight.gy, straight.gz));
  });
});

describe('쓸기 모드 계산', () => {
  it('프리셋: 몸통 굽힘·가쪽은 S2·S2위15cm·T12·C7, 돌림은 T12·T1', () => {
    expect(getSweepPreset('TRUNK', 'yz').points.map((p) => p.key)).toEqual(['S2', 'L15', 'T12', 'C7']);
    expect(getSweepPreset('TRUNK', 'yx').points.length).toBe(4);
    expect(getSweepPreset('TRUNK', 'xz').points.map((p) => p.key)).toEqual(['T12', 'T1']);
    expect(getSweepPreset('KNEE', 'yz')).toBeNull();
  });

  it('wrapDeg: −180..180 으로 접는다', () => {
    expect(wrapDeg(190)).toBeCloseTo(-170, 5);
    expect(wrapDeg(-190)).toBeCloseTo(170, 5);
    expect(wrapDeg(null)).toBeNull();
  });

  const feed = (rec, deg, t0, ms, accMag = G, step = 20) => {
    for (let t = t0; t < t0 + ms; t += step) rec.push(deg + (((t / step) | 0) % 2 ? 0.1 : -0.1), accMag, t);
    return t0 + ms;
  };

  it('기록기: 지점마다 중앙값을 잡고 구간 각도는 위 − 아래', () => {
    const rec = createSweepRecorder();
    let t = 1000;
    t = feed(rec, 10, t, 600); const mS2 = rec.mark('S2', t);
    t = feed(rec, 24, t, 600); const mL = rec.mark('L15', t);
    t = feed(rec, 35, t, 600); const mT = rec.mark('T12', t);
    t = feed(rec, 52, t, 600); const mC = rec.mark('C7', t);
    expect(mS2.angle).toBeCloseTo(10, 0);
    expect(mC.quality).toBe('ok');
    const seg = computeSegments([mS2, mL, mT, mC], getSweepPreset('TRUNK', 'yz').segments);
    const by = Object.fromEntries(seg.map((s) => [s.key, s]));
    expect(by.thoracolumbar.value).toBeCloseTo(42, 0); // C7 − S2
    expect(by.lumbar.value).toBeCloseTo(14, 0);        // L15 − S2
    expect(by.lumbar_t12.value).toBeCloseTo(25, 0);    // T12 − S2
    expect(by.thoracic.value).toBeCloseTo(17, 0);      // C7 − T12
    expect(by.thoracolumbar.ok).toBe(true);
  });

  it('부호 뒤집기', () => {
    const marks = [{ key: 'S2', angle: 10, quality: 'ok' }, { key: 'C7', angle: 50, quality: 'ok' }];
    const seg = computeSegments(marks, getSweepPreset('TRUNK', 'yz').segments, { flip: true });
    expect(seg.find((s) => s.key === 'thoracolumbar').value).toBeCloseTo(-40, 5);
  });

  it('지점이 없으면 null, ±180 경계도 이어서 계산', () => {
    const seg = computeSegments([{ key: 'S2', angle: 170, quality: 'ok' }], getSweepPreset('TRUNK', 'yz').segments);
    expect(seg.every((s) => s.value === null)).toBe(true);
    const seg2 = computeSegments([{ key: 'S2', angle: 170, quality: 'ok' }, { key: 'C7', angle: -170, quality: 'ok' }], getSweepPreset('TRUNK', 'yz').segments);
    expect(seg2.find((s) => s.key === 'thoracolumbar').value).toBeCloseTo(20, 5);
  });

  it('흔들리거나(범위 큼) 가속이 크면 shaky, 구간 결과는 참고용(ok=false)', () => {
    const rec = createSweepRecorder();
    let t = 1000;
    for (let i = 0; i < 30; i++) { rec.push(10 + (i % 2 ? 4 : -4), G, t); t += 20; }
    const m1 = rec.mark('S2', t);
    expect(m1.quality).toBe('shaky');
    const rec2 = createSweepRecorder();
    t = 1000;
    for (let i = 0; i < 30; i++) { rec2.push(10, G * 1.3, t); t += 20; }
    expect(rec2.mark('S2', t).quality).toBe('shaky');
    const ok = { key: 'C7', angle: 40, quality: 'ok' };
    const seg = computeSegments([m1, ok], getSweepPreset('TRUNK', 'yz').segments);
    expect(seg.find((s) => s.key === 'thoracolumbar').ok).toBe(false);
  });

  it('표본이 모자라면 mark 는 null', () => {
    const rec = createSweepRecorder();
    rec.push(10, G, 1000); rec.push(10, G, 1020);
    expect(rec.mark('S2', 1040)).toBeNull();
  });

  it('곡선 점: 짧으면 null, 정상이면 0~폭/높이 범위', () => {
    expect(profilePoints([{ t: 0, deg: 1 }])).toBeNull();
    const series = Array.from({ length: 20 }, (_, i) => ({ t: i * 50, deg: i }));
    const pts = profilePoints(series, { width: 300, height: 70 });
    expect(pts.length).toBe(20);
    expect(pts[0].x).toBe(0); expect(pts[19].x).toBe(300);
    expect(pts.every((p) => p.y >= 0 && p.y <= 70)).toBe(true);
  });
});

describe('TRUNK 센서 안내(교재 기준)', () => {
  it('3블록: 굽힘·폄 / 가쪽 / 돌림 — 돌림은 숙인 앉은 자세에서 센서 가능으로 안내', () => {
    const tip = getSensorJointTip('TRUNK');
    expect(tip.blocks.map((b) => b.title)).toEqual([
      '몸통 굽힘 · 폄 (측정 방향: 앞뒤)', '몸통 가쪽 굽힘 (측정 방향: 옆)', '몸통 돌림 (측정 방향: 돌림)',
    ]);
    const rot = tip.blocks[2].mount;
    expect(rot).toContain('바닥과 평행');
    expect(rot).toContain('T1');
    expect(rot).toContain('T12');
    expect(JSON.stringify(tip)).not.toContain('센서로 잴 수 없습니다.\n');
  });
});

import { createAutoMarker } from '../ai-measure/core/sensorSweep';
import { defaultPlaneFor } from '../ai-measure/core/sensorTilt';

describe('측정 방향 자동 선택', () => {
  it('선택한 움직임에서 방향이 정해진다', () => {
    expect(defaultPlaneFor('TRUNK', 'T_FLEXION')).toBe('yz');
    expect(defaultPlaneFor('TRUNK', 'T_EXTENSION')).toBe('yz');
    expect(defaultPlaneFor('TRUNK', 'T_LATERAL')).toBe('yx');
    expect(defaultPlaneFor('TRUNK', 'T_ROTATION')).toBe('xz');
    expect(defaultPlaneFor('NECK', 'LATERAL')).toBe('yx');
    expect(defaultPlaneFor('NECK', 'FLEXION')).toBe('yz');
    expect(defaultPlaneFor('KNEE', 'STANDING')).toBe('yz');
    expect(defaultPlaneFor('TRUNK', undefined)).toBe('yz');
  });
});

describe('쓸기 자동 표시(멈추면 기록)', () => {
  const G2 = 9.81;
  // 20ms 간격 표본을 ms 동안 넣고 발화 횟수·시각을 돌려준다
  const run = (am, st, ms, { deg, acc = G2, wobble = 0.1 }) => {
    let fires = 0; let maxProg = 0;
    const end = st.t + ms;
    while (st.t < end) {
      const d = typeof deg === 'function' ? deg(st.t) : deg + (((st.t / 20) | 0) % 2 ? wobble : -wobble);
      const r = am.push(d, typeof acc === 'function' ? acc(st.t) : acc, st.t);
      if (r.fire) fires++;
      maxProg = Math.max(maxProg, r.progress);
      st.t += 20;
    }
    return { fires, maxProg };
  };
  const moving = { deg: (t) => 10 + 20 * Math.sin(t / 80), acc: G2 * 1.25 };

  it('시작 때 손에 든 채 가만히 있어도 기록되지 않는다(움직임이 먼저 있어야 함)', () => {
    const am = createAutoMarker(); const st = { t: 0 };
    expect(run(am, st, 3000, { deg: 5 }).fires).toBe(0);
  });

  it('움직인 뒤 1초 멈추면 한 번 기록, 계속 멈춰 있어도 중복 없음', () => {
    const am = createAutoMarker(); const st = { t: 0 };
    run(am, st, 600, moving);
    const a = run(am, st, 1500, { deg: 12 });
    expect(a.fires).toBe(1);
    expect(a.maxProg).toBe(1);
    expect(run(am, st, 3000, { deg: 12 }).fires).toBe(0);
  });

  it('다시 움직였다 멈추면 다음 지점 기록', () => {
    const am = createAutoMarker(); const st = { t: 0 };
    run(am, st, 600, moving); run(am, st, 1500, { deg: 12 });
    run(am, st, 600, moving);
    expect(run(am, st, 1500, { deg: 30 }).fires).toBe(1);
  });

  it('멈췄어도 가속이 크면(손으로 흔드는 중) 기록 안 함', () => {
    const am = createAutoMarker(); const st = { t: 0 };
    run(am, st, 600, moving);
    expect(run(am, st, 2000, { deg: 12, acc: G2 * 1.2 }).fires).toBe(0);
  });

  it('1초 못 채우고 움직이면 기록 안 함, 취소(disarm) 뒤에는 움직여야 다시 받는다', () => {
    const am = createAutoMarker(); const st = { t: 0 };
    run(am, st, 600, moving);
    expect(run(am, st, 600, { deg: 12 }).fires).toBe(0);
    run(am, st, 500, moving);
    expect(run(am, st, 1500, { deg: 20 }).fires).toBe(1);
    am.disarm();
    expect(run(am, st, 3000, { deg: 20 }).fires).toBe(0);
  });
});
