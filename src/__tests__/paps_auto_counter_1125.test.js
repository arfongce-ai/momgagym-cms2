import { describe, it, expect } from 'vitest';
import { createPapsAutoCounter, elbowAngleSignal, trunkInclineSignal, supportsPapsAuto } from '../ai-measure/core/papsAutoCounter';

const blank = () => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
const set = (lm, i, x, y) => { lm[i] = { x, y, visibility: 1 }; };

// 왼팔: 어깨(0.5,0.3) 팔꿈치 아래 손목 각도로 팔꿈치각 만들기
function armPose(deg) {
  const lm = blank();
  set(lm, 11, 0.5, 0.3); set(lm, 13, 0.5, 0.5); // 위팔: 아래로 0.2
  const rad = (deg * Math.PI) / 180;
  // 팔꿈치에서 어깨 방향(위)과 deg 만큼 벌어진 손목
  set(lm, 15, 0.5 + 0.2 * Math.sin(rad), 0.5 - 0.2 * Math.cos(rad));
  return lm;
}
function trunkPose(incDeg) {
  const lm = blank();
  const rad = (incDeg * Math.PI) / 180;
  set(lm, 23, 0.4, 0.6); set(lm, 24, 0.4, 0.6);
  set(lm, 11, 0.4 + 0.3 * Math.cos(rad), 0.6 - 0.3 * Math.sin(rad)); set(lm, 12, 0.4 + 0.3 * Math.cos(rad), 0.6 - 0.3 * Math.sin(rad));
  return lm;
}
function run(counter, frames, step = 100) {
  let t = 0; let snap;
  frames.forEach((f) => { snap = counter.push(f, t); t += step; });
  return snap;
}

describe('PAPS 자동 카운터', () => {
  it('신호: 팔꿈치각·몸통기울기', () => {
    expect(Math.round(elbowAngleSignal(armPose(170)))).toBe(170);
    expect(Math.round(trunkInclineSignal(trunkPose(60)))).toBe(60);
    expect(elbowAngleSignal(blank())).toBe(null);
  });
  it('팔굽혀펴기: 펴짐→접힘 3번 = 3회, 안 접히면 안 센다', () => {
    const c = createPapsAutoCounter({ testId: 'pushup', smoothing: 1 });
    const cycle = [170, 170, 90, 90, 170, 170];
    const frames = [...cycle, ...cycle, ...cycle].map(armPose);
    expect(run(c, frames, 300).count).toBe(3);
    const c2 = createPapsAutoCounter({ testId: 'pushup', smoothing: 1 });
    expect(run(c2, [170, 150, 145, 150, 170, 150, 145].map(armPose), 300).count).toBe(0);
  });
  it('윗몸말아올리기: 눕힘→일으킴 2번 = 2회', () => {
    const c = createPapsAutoCounter({ testId: 'curlup', smoothing: 1 });
    const frames = [5, 5, 70, 70, 5, 5, 70, 70].map(trunkPose);
    expect(run(c, frames, 500).count).toBe(2);
  });
  it('쉬는 자세에서 시작하지 않으면 첫 동작은 세지 않는다', () => {
    const c = createPapsAutoCounter({ testId: 'curlup', smoothing: 1 });
    expect(run(c, [70, 70, 5, 5].map(trunkPose), 500).count).toBe(0);
  });
  it('몸이 안 잡히면 tracked=false 이고 세지 않는다', () => {
    const c = createPapsAutoCounter({ testId: 'pushup' });
    const s = run(c, [blank(), blank()], 300);
    expect(s.tracked).toBe(false);
    expect(s.count).toBe(0);
  });
  it('사이드스텝: 중심 보정 후 좌우 끝을 오갈 때마다 센다', () => {
    const c = createPapsAutoCounter({ testId: 'sidestep20', smoothing: 1, calibrateMs: 400 });
    const pose = (dx) => { const lm = blank(); set(lm, 23, 0.5 + dx - 0.05, 0.6); set(lm, 24, 0.5 + dx + 0.05, 0.6); return lm; };
    // 골반 너비 0.1 → 진폭 1.0 = 0.1. 중심 보정 6프레임 후 L R L R
    const frames = [0, 0, 0, 0, 0, 0, -0.15, -0.15, 0.15, 0.15, -0.15, -0.15, 0.15, 0.15].map(pose);
    expect(run(c, frames, 150).count).toBe(3);
  });
  it('지원 테스트 목록', () => {
    ['pushup', 'pullup', 'curlup', 'sidestep20'].forEach((id) => expect(supportsPapsAuto(id)).toBe(true));
    ['hang', 'sitreach', 'standbend', 'grip'].forEach((id) => expect(supportsPapsAuto(id)).toBe(false));
  });
});

describe('푸시업 극점 폭 방식 (실제 영상 6~7회가 4회로 나오던 문제)', () => {
  const sim = (seq, step = 120) => {
    const c = createPapsAutoCounter({ testId: 'pushup', smoothing: 0.5 });
    return run(c, seq.map(armPose), step).count;
  };
  const wave = (hi, lo, reps, n = 8) => {
    const out = [];
    for (let r = 0; r < reps; r++) for (let i = 0; i < n; i++) out.push(lo + ((hi - lo) * (1 + Math.cos((2 * Math.PI * i) / n))) / 2);
    return out;
  };
  it('끝까지 못 펴는 푸시업(140°↔85°)도 센다', () => { expect(sim(wave(140, 85, 6))).toBe(6); });
  it('깊이가 얕은 푸시업(165°↔115°)도 센다', () => { expect(sim(wave(165, 115, 6))).toBe(6); });
  it('정상 푸시업(170°↔80°) 7회 = 7회', () => { expect(sim(wave(170, 80, 7))).toBe(7); });
  it('떨림(±5°)만 있는 정지 자세는 세지 않는다', () => {
    const still = Array.from({ length: 60 }, (_, i) => 165 + (i % 2 ? 5 : -5));
    expect(sim(still)).toBe(0);
  });
  it('두 팔 각도를 평균한다', () => {
    const lm = armPose(150);
    lm[12] = { x: 0.5, y: 0.3, visibility: 1 }; lm[14] = { x: 0.5, y: 0.5, visibility: 1 };
    const rad = (140 * Math.PI) / 180; lm[16] = { x: 0.5 + 0.2 * Math.sin(rad), y: 0.5 - 0.2 * Math.cos(rad), visibility: 1 };
    expect(Math.round(elbowAngleSignal(lm))).toBe(145);
  });
});
