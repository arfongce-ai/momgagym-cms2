// angle_stabilizer.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] createAngleStabilizer 동작 테스트.
//  랜드마크 좌표를 EMA로 부드럽게 해도, 각도는 세 점의 "관계"라서 미세한 좌표
//  떨림이 몇 도씩 증폭된다 — 그래서 가만히 서 있어도 숫자가 계속 바뀌어
//  "예민하다"고 느껴졌다(현장 피드백 2회 연속). 이 안정화기는 각도 값 자체를
//  한 번 더 EMA로 누른 뒤, 표시값이 deadbandDeg 이상 벗어날 때만 갱신한다.
//
//  소스 패턴 매칭이 아니라 실제 함수를 돌려서 계약을 고정한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { createAngleStabilizer } from '../ai-measure/core/smoothing';

const K = 'elbow-L';

describe('createAngleStabilizer — 기본 동작', () => {
  it('첫 값은 그대로 표시한다(초기 지연 없음)', () => {
    const s = createAngleStabilizer();
    expect(s.stabilize(K, 137.4)).toBe(137);
  });

  it('null/NaN 각도는 null을 돌려주고 상태를 오염시키지 않는다', () => {
    const s = createAngleStabilizer();
    expect(s.stabilize(K, null)).toBeNull();
    expect(s.stabilize(K, NaN)).toBeNull();
    expect(s.stabilize(K, 90)).toBe(90); // 이후 정상값은 그대로 첫 값 취급
  });

  it('관절마다 상태를 따로 유지한다(키 분리)', () => {
    const s = createAngleStabilizer();
    s.stabilize('elbow-L', 90);
    s.stabilize('knee-R', 170);
    // 서로 영향을 주지 않으므로 각자의 값 근처를 유지한다.
    for (let i = 0; i < 10; i++) {
      s.stabilize('elbow-L', 90);
      s.stabilize('knee-R', 170);
    }
    expect(s.stabilize('elbow-L', 90)).toBe(90);
    expect(s.stabilize('knee-R', 170)).toBe(170);
  });

  it('reset()하면 상태가 비워진다', () => {
    const s = createAngleStabilizer();
    s.stabilize(K, 90);
    s.reset();
    expect(s.stabilize(K, 150)).toBe(150); // 리셋 후 첫 값이므로 그대로
  });
});

describe('createAngleStabilizer — 정지 중 떨림 억제(핵심 목적)', () => {
  it('실제로는 가만히 있는데 ±2° 노이즈가 낀 경우, 표시값이 고정된다', () => {
    const s = createAngleStabilizer({ alpha: 0.25, deadbandDeg: 3 });
    const noise = [0, 1.8, -1.5, 2.0, -2.0, 1.2, -1.9, 0.7, -0.4, 1.6, -1.1, 0.9];
    const shown = noise.map((n) => s.stabilize(K, 140 + n));
    const uniqueAfterSettle = new Set(shown.slice(3));
    // 초반 몇 프레임 EMA가 자리잡은 뒤에는 표시값이 사실상 한 값으로 고정된다.
    expect(uniqueAfterSettle.size).toBeLessThanOrEqual(2);
  });

  it('[회귀] 안정화기 없이 반올림만 하면 같은 노이즈에서 값이 계속 바뀐다(수정 전 동작)', () => {
    const noise = [0, 1.8, -1.5, 2.0, -2.0, 1.2, -1.9, 0.7, -0.4, 1.6, -1.1, 0.9];
    const naive = noise.map((n) => Math.round(140 + n));
    // 수정 전에는 12프레임 동안 6가지 이상의 서로 다른 숫자가 표시됐다.
    expect(new Set(naive).size).toBeGreaterThan(4);
  });
});

describe('createAngleStabilizer — 실제 움직임에는 따라간다(과하게 굳지 않음)', () => {
  it('관절을 크게 굽히면 표시값이 그 방향으로 실제로 이동한다', () => {
    const s = createAngleStabilizer({ alpha: 0.25, deadbandDeg: 3 });
    s.stabilize(K, 170); // 편 상태
    let last = 170;
    // 170° → 60° 로 굽히는 동작을 30프레임에 걸쳐 입력
    for (let i = 1; i <= 30; i++) {
      last = s.stabilize(K, 170 - (110 * i) / 30);
    }
    expect(last).toBeLessThan(80); // 목표(60)에 충분히 근접
  });

  it('데드밴드보다 확실히 큰 변화(10°)는 몇 프레임 안에 반영된다', () => {
    const s = createAngleStabilizer({ alpha: 0.25, deadbandDeg: 3 });
    s.stabilize(K, 100);
    let shown = 100;
    for (let i = 0; i < 6; i++) shown = s.stabilize(K, 110);
    expect(shown).toBeGreaterThan(103); // 갱신이 실제로 일어났다
  });

  it('deadbandDeg를 키우면 더 둔감해진다(튜닝 가능)', () => {
    const gentle = createAngleStabilizer({ alpha: 0.25, deadbandDeg: 1 });
    const strong = createAngleStabilizer({ alpha: 0.25, deadbandDeg: 8 });
    const seq = [140, 141.5, 139, 142, 138.5, 141];
    const g = new Set(seq.map((v) => gentle.stabilize(K, v)));
    const st = new Set(seq.map((v) => strong.stabilize(K, v)));
    expect(st.size).toBeLessThanOrEqual(g.size);
  });
});
