// ai-measure/core/repCounter.js
// ════════════════════════════════════════════════════════════════════════
//  바벨 렙(반복) 자동 카운터 — 수직 위치(y)의 왕복을 1회로 센다.
//
//  원리(측정 정직성):
//   · 1렙 = 바벨이 한 방향으로 minTravel 이상 이동했다가 반대로 minTravel 이상
//     되돌아오는 완전한 왕복. 운동 시작 방향(스쿼트=하강 먼저, 데드=상승 먼저)에
//     무관하게 "내려갔다 올라옴" 또는 "올라갔다 내려옴" 한 사이클을 1회로 본다.
//   · 히스테리시스: 미세 떨림(노이즈)으로 카운트가 튀지 않도록, 방향 전환은
//     누적 이동량이 minTravel 을 넘을 때만 인정한다.
//   · 최소 ROM 게이트: minTravel 미만의 작은 움직임은 렙으로 세지 않는다
//     (허위 카운트 방지). 값이 애매하면 세지 않는 쪽이 안전하다.
//   · 좌표계: y 는 0(위)~1(아래) 정규화. 화면 비율 기준이라 운동·사람 무관하게 동작.
//
//  사용:
//   const rc = createRepCounter({ minTravel: 0.06 });
//   매 프레임: rc.push(y);   // y = 바벨 대표점 정규화 y (0~1)
//   rc.count();              // 현재까지 센 렙 수
//   rc.reset();
// ════════════════════════════════════════════════════════════════════════

/**
 * @param {object} opts
 * @param {number} [opts.minTravel=0.06] 1구간으로 인정할 최소 정규화 이동량(화면 높이 대비).
 *   0.06 ≈ 화면 높이의 6%. 너무 작으면 노이즈가 렙으로 잡히고, 너무 크면 작은
 *   가동범위 동작을 놓친다. 바벨 운동의 수직 ROM 은 보통 화면의 10~40%.
 * @param {number} [opts.smoothing=0.4] y EMA 평활 계수(0~1, 클수록 반응 빠름).
 */
export function createRepCounter({ minTravel = 0.06, smoothing = 0.4 } = {}) {
  let reps = 0;
  let emaY = null;          // 평활된 y
  let dir = 0;              // 현재 진행 방향: +1(아래로) | -1(위로) | 0(미정)
  let lastExtreme = null;   // 직전 극점(반전점) y
  let runExtreme = null;    // 현재 진행 방향의 최대 도달점
  let halfSwings = 0;       // 완성된 반(half) 스윙 수. 2 half = 1 rep.

  function registerHalfSwing() {
    halfSwings += 1;
    if (halfSwings % 2 === 0) reps += 1; // 반 스윙 2개 = 왕복 1회 = 1렙
  }

  function push(y) {
    const v = Number(y);
    if (!Number.isFinite(v)) return reps;

    emaY = emaY == null ? v : emaY + smoothing * (v - emaY);
    if (lastExtreme == null) { lastExtreme = emaY; runExtreme = emaY; return reps; }

    if (dir === 0) {
      // 시작 방향 결정.
      if (Math.abs(emaY - lastExtreme) >= minTravel * 0.5) {
        dir = emaY > lastExtreme ? 1 : -1;
        runExtreme = emaY;
      }
      return reps;
    }

    // 진행 방향으로 더 가면 도달 극점 갱신.
    if (dir === 1 && emaY > runExtreme) runExtreme = emaY;
    if (dir === -1 && emaY < runExtreme) runExtreme = emaY;

    // 극점에서 반대로 minTravel 이상 되돌아오면, 직전 진행이 1 반스윙으로 완성.
    const retrace = (dir === 1) ? (runExtreme - emaY) : (emaY - runExtreme);
    if (retrace >= minTravel) {
      const progressed = Math.abs(runExtreme - lastExtreme) >= minTravel;
      if (progressed) registerHalfSwing();
      // 반전: 직전 극점을 새 기준으로, 방향 전환.
      lastExtreme = runExtreme;
      dir = -dir;
      runExtreme = emaY;
    }
    return reps;
  }

  return {
    push,
    count() { return reps; },
    /**
     * 진행 중이지만 아직 반전하지 않은 마지막 반스윙도 포함한 '확정+진행중' 렙 수.
     *  업로드 영상처럼 데이터가 끝났을 때 마지막 올라옴을 반영하려면 이 값을 쓴다.
     *  실시간 표시에는 count()(확정값)를 쓰는 게 안전(과다 카운트 방지).
     */
    countWithPending() {
      // 현재 진행이 minTravel 넘었고 아직 반스윙으로 등록 안 됐으면 +1 half.
      if (dir !== 0 && Math.abs(runExtreme - lastExtreme) >= minTravel) {
        const pendingHalf = halfSwings + 1;
        return Math.floor(pendingHalf / 2);
      }
      return reps;
    },
    reset() { reps = 0; emaY = null; dir = 0; lastExtreme = null; runExtreme = null; halfSwings = 0; },
    direction() { return dir; },
  };
}

/**
 * 위치 시계열에서 총 렙 수를 한 번에 계산(업로드 영상 분석용).
 *  데이터가 끝났을 때 마지막 진행 반스윙까지 반영하려면 withPending=true.
 * @param {Array<{y:number}>|Array<number>} series
 * @param {object} opts createRepCounter 옵션 + { withPending }
 * @returns {number}
 */
export function countRepsFromSeries(series, opts = {}) {
  const { withPending = true, ...rcOpts } = opts;
  const rc = createRepCounter(rcOpts);
  if (!Array.isArray(series)) return 0;
  for (const s of series) {
    const y = typeof s === 'number' ? s : s?.y;
    rc.push(y);
  }
  return withPending ? rc.countWithPending() : rc.count();
}
