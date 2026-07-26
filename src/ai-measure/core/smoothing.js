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
