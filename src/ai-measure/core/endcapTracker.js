// ai-measure/core/endcapTracker.js
// 탭(tap) 기반 엔드캡(바벨 봉 끝) 추적기 — 사람 관절(MediaPipe)이 아니라
// 영상 픽셀에서 "지정한 색 덩어리"를 직접 따라간다.
//
// 원리(쉽게):
//  1) 사용자가 화면에서 엔드캡을 한 번 톡 누른다(seed).
//  2) 그 지점 주변의 평균 색(RGB)을 "찾을 색"으로 기억한다.
//  3) 다음 프레임마다, 직전 위치 둘레의 작은 검색창 안에서
//     기억한 색과 가장 비슷한 픽셀들의 무게중심을 새 위치로 잡는다.
//  4) EMA로 부드럽게 + 너무 안 비슷하면(가려짐) 위치 유지.
//
// 좌표는 모두 정규화(0~1). MediaPipe 트래커와 동일한 좌표계라
// barbell.js 의 romToCm/personHeightRatio 와 그대로 호환된다.

const SEARCH_RADIUS = 0.10;   // 검색창 반경(화면비율) — 직전 위치 둘레만 탐색
const SEED_RADIUS = 0.02;     // seed 평균색 샘플 반경
const COLOR_TOL = 60;         // 색 거리 허용치(RGB 유클리드) — 작을수록 엄격
const SAMPLE_STEP = 2;        // 픽셀 샘플 간격(속도/정확도 균형)
const EMA_ALPHA = 0.35;       // 위치 평활
const MIN_MATCH = 8;          // 이보다 매칭 픽셀 적으면 "못 찾음"(가려짐)으로 보고 유지

/** 영상에서 정규화 좌표 둘레의 평균색 샘플 */
function sampleColor(ctx, w, h, nx, ny, rNorm) {
  const cx = Math.round(nx * w), cy = Math.round(ny * h);
  const r = Math.max(2, Math.round(rNorm * Math.min(w, h)));
  const x0 = Math.max(0, cx - r), y0 = Math.max(0, cy - r);
  const x1 = Math.min(w, cx + r), y1 = Math.min(h, cy + r);
  if (x1 <= x0 || y1 <= y0) return null;
  const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
  let R = 0, G = 0, B = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) { R += data[i]; G += data[i + 1]; B += data[i + 2]; n++; }
  if (!n) return null;
  return { r: R / n, g: G / n, b: B / n };
}

/** 한 점의 색 매칭 추적(직전 위치 둘레 검색). 매칭 부족 시 null 반환 */
function trackOne(ctx, w, h, pos, target) {
  const cx = pos.x * w, cy = pos.y * h;
  const rad = SEARCH_RADIUS * Math.min(w, h);
  const x0 = Math.max(0, Math.floor(cx - rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const x1 = Math.min(w, Math.ceil(cx + rad));
  const y1 = Math.min(h, Math.ceil(cy + rad));
  if (x1 <= x0 || y1 <= y0) return null;
  const bw = x1 - x0, bh = y1 - y0;
  const { data } = ctx.getImageData(x0, y0, bw, bh);
  let sumX = 0, sumY = 0, n = 0;
  for (let yy = 0; yy < bh; yy += SAMPLE_STEP) {
    for (let xx = 0; xx < bw; xx += SAMPLE_STEP) {
      const idx = (yy * bw + xx) * 4;
      const dr = data[idx] - target.r;
      const dg = data[idx + 1] - target.g;
      const db = data[idx + 2] - target.b;
      if (Math.sqrt(dr * dr + dg * dg + db * db) <= COLOR_TOL) {
        sumX += (x0 + xx); sumY += (y0 + yy); n++;
      }
    }
  }
  if (n < MIN_MATCH) return null;
  return { x: (sumX / n) / w, y: (sumY / n) / h };
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 다중점 추적기 — 최대 3점을 동시에 추적하고, 튄 점을 걸러 중앙값으로 합친다.
 * 오류 최소화 원리:
 *  - 각 점을 따로 색 매칭 추적.
 *  - 프레임마다 살아있는 점들의 y 중앙값을 구하고,
 *    중앙값에서 OUTLIER_TOL 이상 벗어난 점은 그 프레임에서 제외(튄 것으로 간주).
 *  - 남은 점들의 중앙 좌표를 대표 위치로 사용 → 한 점이 가려지거나 잘못 따라가도 안정.
 *  - 살아있는 점 수(activeCount)로 신뢰도를 표시할 수 있다.
 *
 * 사용 흐름:
 *   const t = createMultiTracker();
 *   t.seed(video, nx, ny);  // 점 추가(최대 3회)
 *   매 프레임: const p = t.update(video);  // {x,y}|null
 *   기록 구간: t.push(p, ts);
 *   t.summary(); t.activeCount(); t.pointCount();
 */
const MAX_POINTS = 3;
const OUTLIER_TOL = 0.05;  // 중앙값에서 이만큼(화면비율) 벗어난 점은 튄 것으로 제외

export function createMultiTracker() {
  // 각 추적점: { target:{r,g,b}, pos:{x,y}, ema:{x,y}, alive:bool }
  const points = [];
  const samples = [];
  let minY = Infinity, maxY = -Infinity;
  let lastActive = 0;

  let cv = null, ctx = null;
  const ensureCanvas = (w, h) => {
    if (!cv) { cv = document.createElement('canvas'); ctx = cv.getContext('2d', { willReadFrequently: true }); }
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return ctx;
  };

  return {
    seed(video, nx, ny) {
      if (points.length >= MAX_POINTS) return false;
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return false;
      const c = ensureCanvas(w, h);
      c.drawImage(video, 0, 0, w, h);
      const col = sampleColor(c, w, h, nx, ny, SEED_RADIUS);
      if (!col) return false;
      points.push({ target: col, pos: { x: nx, y: ny }, ema: { x: nx, y: ny }, alive: true });
      return true;
    },

    isSeeded() { return points.length > 0; },
    pointCount() { return points.length; },
    activeCount() { return lastActive; },

    update(video) {
      if (!points.length) return null;
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return this.current();
      const c = ensureCanvas(w, h);
      c.drawImage(video, 0, 0, w, h);

      // 1) 각 점 추적
      const found = points.map(p => {
        const r = trackOne(c, w, h, p.pos, p.target);
        if (r) { p.pos = r; p.alive = true; }
        else { p.alive = false; }
        return p.alive ? r : null;
      });

      // 2) 살아있는 점들의 y 중앙값으로 튄 점 제외
      const aliveYs = found.filter(Boolean).map(p => p.y);
      const medY = median(aliveYs);
      const keep = [];
      points.forEach((p, i) => {
        const r = found[i];
        if (!r) return;
        if (medY != null && Math.abs(r.y - medY) > OUTLIER_TOL) return; // 튄 점 제외
        // EMA 평활
        p.ema = { x: p.ema.x + (r.x - p.ema.x) * EMA_ALPHA, y: p.ema.y + (r.y - p.ema.y) * EMA_ALPHA };
        keep.push(p.ema);
      });
      lastActive = keep.length;
      if (!keep.length) return this.current();

      // 3) 남은 점들의 중앙 좌표를 대표 위치로
      const repX = median(keep.map(p => p.x));
      const repY = median(keep.map(p => p.y));
      this._rep = { x: repX, y: repY };
      return this._rep;
    },

    push(point, ts) {
      if (!point) return;
      const last = samples[samples.length - 1];
      if (last) {
        const dx = point.x - last.x, dy = point.y - last.y;
        if (Math.hypot(dx, dy) < 0.004) { last.ts = ts; return; }
      }
      samples.push({ x: point.x, y: point.y, ts });
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    },

    path() { return samples; },
    points() { return points; },          // 각 점 표시용
    current() { return this._rep || (points[0] && points[0].ema) || null; },
    _rep: null,

    reset() { samples.length = 0; minY = Infinity; maxY = -Infinity; },
    clear() {
      points.length = 0; samples.length = 0; minY = Infinity; maxY = -Infinity;
      lastActive = 0; this._rep = null;
    },

    summary() {
      if (samples.length < 5) return null;
      const romRatio = maxY - minY;
      const durationMs = samples[samples.length - 1].ts - samples[0].ts;
      return {
        romRatio: Math.round(romRatio * 1000) / 1000,
        samples: samples.length,
        durationMs: Math.round(durationMs),
        points: points.length,
      };
    },
  };
}

/**
 * 엔드캡 추적기 생성.
 * 사용 흐름:
 *   const t = createEndcapTracker();
 *   t.seed(video, nx, ny);                 // 탭 위치로 색 학습 + 시작점
 *   매 프레임: const p = t.update(video);   // {x,y}|null
 *   기록 구간: t.push(p, ts);
 *   끝: t.summary();
 */
export function createEndcapTracker() {
  let target = null;       // 학습한 색 {r,g,b}
  let pos = null;          // 현재 위치(정규화) {x,y}
  let ema = null;          // 평활 위치
  // ROM 기록
  const samples = [];      // {x,y,ts}
  let minY = Infinity, maxY = -Infinity;

  // 재사용 캔버스(프레임 픽셀 읽기용)
  let cv = null, ctx = null;
  const ensureCanvas = (w, h) => {
    if (!cv) { cv = document.createElement('canvas'); ctx = cv.getContext('2d', { willReadFrequently: true }); }
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return ctx;
  };

  return {
    /** 탭 지점으로 색 학습 + 추적 시작점 설정 */
    seed(video, nx, ny) {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return false;
      const c = ensureCanvas(w, h);
      c.drawImage(video, 0, 0, w, h);
      const col = sampleColor(c, w, h, nx, ny, SEED_RADIUS);
      if (!col) return false;
      target = col;
      pos = { x: nx, y: ny };
      ema = { x: nx, y: ny };
      return true;
    },

    isSeeded() { return !!target; },

    /** 한 프레임 추적. 새 위치(정규화) 반환, 못 찾으면 직전 위치 유지 */
    update(video) {
      if (!target || !pos) return null;
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return ema;
      const c = ensureCanvas(w, h);
      c.drawImage(video, 0, 0, w, h);
      const r = trackOne(c, w, h, pos, target);
      if (r) {
        pos = r;
        ema = ema
          ? { x: ema.x + (r.x - ema.x) * EMA_ALPHA, y: ema.y + (r.y - ema.y) * EMA_ALPHA }
          : { x: r.x, y: r.y };
      }
      // 매칭 부족(가려짐)이면 ema 유지
      return ema;
    },

    /** 기록 구간 좌표 누적(ROM용). 평활 좌표를 넣어준다. */
    push(point, ts) {
      if (!point) return;
      const last = samples[samples.length - 1];
      if (last) {
        const dx = point.x - last.x, dy = point.y - last.y;
        if (Math.hypot(dx, dy) < 0.004) { last.ts = ts; return; } // 데드존
      }
      samples.push({ x: point.x, y: point.y, ts });
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    },

    path() { return samples; },
    current() { return ema; },

    reset() {
      // 색 학습은 유지하고 기록만 초기화
      samples.length = 0; minY = Infinity; maxY = -Infinity;
    },
    clear() {
      // 완전 초기화(색까지)
      target = null; pos = null; ema = null;
      samples.length = 0; minY = Infinity; maxY = -Infinity;
    },

    summary() {
      if (samples.length < 5) return null;
      const romRatio = maxY - minY;
      const durationMs = samples[samples.length - 1].ts - samples[0].ts;
      return {
        romRatio: Math.round(romRatio * 1000) / 1000,
        samples: samples.length,
        durationMs: Math.round(durationMs),
      };
    },
  };
}
