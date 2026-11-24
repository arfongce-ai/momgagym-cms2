// ai-measure/core/seniorAutoCounter.js
// ════════════════════════════════════════════════════════════════════════
//  [시니어 테스트 자동 카운트 2026-11-24] 카메라 자세(33점)로 앉았다↔섰다를 세는 순수 로직.
//  · 신호 s = (무릎 y − 엉덩이 y) / 몸통 길이(어깨~엉덩이). 앉으면 0 근처, 서면 0.7~1.
//  · 문턱 2개(앉음 sitAt / 섬 standAt)로 히스테리시스 → 떨림으로 카운트가 튀지 않는다.
//  · 앉음→섬 전환 1번 = 1회. 0.6초 안의 재전환은 무시.
//  · TUG: 첫 일어섬에 시작, 걸어서 돌아와 다시 앉음에 종료(걸은 거리 walked 도 기록).
//  · 값은 "자동 추정"이다. 측정자가 확인·수정한 값을 저장하고, 자동값은 원본으로 함께 남긴다.
//  · 가시성이 낮거나 몸이 안 잡히면 세지 않는다(값이 애매하면 세지 않는 쪽이 안전).
// ════════════════════════════════════════════════════════════════════════
const L = { sh: [11, 12], hip: [23, 24], knee: [25, 26] };
const MIN_VIS = 0.5;
const MIN_REP_GAP_MS = 600;

function avgPoint(lm, idxs) {
  const pts = idxs.map((i) => lm?.[i]).filter((p) => p && (p.visibility ?? 1) >= MIN_VIS && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length) return null;
  return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
}

/** 앉음/섬 신호. 몸이 안 잡히면 null. */
export function sitStandSignal(landmarks) {
  if (!Array.isArray(landmarks) && !landmarks?.length) return null;
  const sh = avgPoint(landmarks, L.sh);
  const hip = avgPoint(landmarks, L.hip);
  const knee = avgPoint(landmarks, L.knee);
  if (!sh || !hip || !knee) return null;
  const torso = Math.hypot(sh.x - hip.x, sh.y - hip.y);
  if (torso < 0.04) return null; // 너무 작게 찍힘/몸통이 안 보임
  return { s: (knee.y - hip.y) / torso, hipX: hip.x, torso };
}

export function createSeniorAutoCounter({ testId = 'chair30', sitAt = 0.35, standAt = 0.7, smoothing = 0.5, targetReps = 5 } = {}) {
  let ema = null;
  let state = 'unknown'; // unknown | sit | stand
  let reps = 0;
  let lastRepAt = -Infinity;
  let startedAtMs = null;   // TUG/5회: 첫 일어섬 시각
  let finishedAtMs = null;
  let hipX0 = null;
  let maxWalk = 0;
  let lastSignalAt = null;
  const events = [];

  function push(landmarks, tMs) {
    const sig = sitStandSignal(landmarks);
    if (!sig) return snapshot(false);
    lastSignalAt = tMs;
    ema = ema == null ? sig.s : ema + smoothing * (sig.s - ema);
    if (hipX0 == null) hipX0 = sig.hipX;
    if (startedAtMs != null && finishedAtMs == null) maxWalk = Math.max(maxWalk, Math.abs(sig.hipX - hipX0) / sig.torso);

    if (state === 'unknown') {
      if (ema <= sitAt) state = 'sit';
      else if (ema >= standAt) state = 'stand'; // 선 채로 시작: 앉기 전엔 세지 않는다
      return snapshot(true);
    }
    if (state === 'sit' && ema >= standAt) {
      state = 'stand';
      if (tMs - lastRepAt >= MIN_REP_GAP_MS) {
        lastRepAt = tMs;
        if (testId === 'tug') {
          if (startedAtMs == null) startedAtMs = tMs;
        } else {
          if (startedAtMs == null) startedAtMs = tMs;
          reps += 1;
          events.push(Math.round((tMs - startedAtMs) / 100) / 10);
          if (testId === 'sts5' && reps >= targetReps && finishedAtMs == null) finishedAtMs = tMs;
        }
      }
    } else if (state === 'stand' && ema <= sitAt) {
      state = 'sit';
      if (testId === 'tug' && startedAtMs != null && finishedAtMs == null && tMs - startedAtMs >= 2000) {
        finishedAtMs = tMs;
      }
    }
    return snapshot(true);
  }

  function snapshot(tracked) {
    return {
      tracked, state, signal: ema, count: reps,
      started: startedAtMs != null, finished: finishedAtMs != null,
      startedAtMs, finishedAtMs,
      elapsedSec: startedAtMs != null && finishedAtMs != null ? Math.round((finishedAtMs - startedAtMs) / 100) / 10 : null,
      walked: Math.round(maxWalk * 100) / 100,
      events: events.slice(),
      lastSignalAt,
    };
  }

  return { push, snapshot: () => snapshot(ema != null), reset() { ema = null; state = 'unknown'; reps = 0; lastRepAt = -Infinity; startedAtMs = null; finishedAtMs = null; hipX0 = null; maxWalk = 0; events.length = 0; } };
}
