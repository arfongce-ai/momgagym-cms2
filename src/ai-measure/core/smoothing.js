// ai-measure/core/smoothing.js
// 랜드마크 떨림 완화 — 최근 N프레임 지수이동평균(EMA).
// 임계값으로 관절을 "버리지" 않고, 위치를 부드럽게 만들어 흔들림만 줄인다.

export function createSmoother(alpha = 0.5) {
  // alpha 클수록 최신값 비중↑(반응 빠름), 작을수록 부드러움↑
  let prev = null;
  return function smooth(lms) {
    if (!lms) { prev = null; return null; }
    if (!prev || prev.length !== lms.length) {
      prev = lms.map(p => ({ ...p }));
      return prev;
    }
    const out = lms.map((p, i) => {
      const q = prev[i];
      if (!p) return q;
      if (!q) return { ...p };
      return {
        x: q.x + (p.x - q.x) * alpha,
        y: q.y + (p.y - q.y) * alpha,
        z: p.z != null && q.z != null ? q.z + (p.z - q.z) * alpha : p.z,
        visibility: p.visibility,
      };
    });
    prev = out;
    return out;
  };
}

// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] 화면에 "표시되는 각도 숫자" 전용 안정화기.
//
//  랜드마크 위치를 EMA로 부드럽게 해도, 각도는 세 점의 관계라 미세한 좌표
//  떨림이 그대로 몇 도씩 증폭된다. 그 결과 정지해 있어도 숫자가 매 프레임
//  바뀌어 "예민하다"고 느껴진다. 그래서 두 단계로 잡는다:
//    1) 각도 값 자체를 한 번 더 EMA로 부드럽게 하고,
//    2) 데드밴드(히스테리시스) — 부드럽게 한 값이 "지금 표시 중인 값"에서
//       deadbandDeg 이상 벗어날 때만 표시값을 갱신한다.
//  덕분에 가만히 있으면 숫자가 고정되고, 실제로 움직이면 곧바로 따라간다
//  (움직이면 차이가 금방 데드밴드를 넘기 때문).
//
//  key는 관절 식별자(예: '11-13-15') — 관절마다 상태를 따로 유지한다.
// ════════════════════════════════════════════════════════════════════════
export function createAngleStabilizer({ alpha = 0.25, deadbandDeg = 3 } = {}) {
  const ema = new Map();   // key → 내부적으로 이어지는 실수 각도
  const shown = new Map(); // key → 실제 화면에 표시 중인 정수 각도
  return {
    stabilize(key, angle) {
      if (angle == null || !Number.isFinite(angle)) return null;
      const prev = ema.get(key);
      const next = prev == null ? angle : prev + (angle - prev) * alpha;
      ema.set(key, next);
      const current = shown.get(key);
      if (current == null || Math.abs(next - current) >= deadbandDeg) {
        const rounded = Math.round(next);
        shown.set(key, rounded);
        return rounded;
      }
      return current;
    },
    reset() { ema.clear(); shown.clear(); },
  };
}
