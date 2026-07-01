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

const SEARCH_RADIUS = 0.18;   // 검색창 반경(화면비율) — 직전 위치 둘레만 탐색 (넓힘: 빠른 움직임 대응)
const SEED_RADIUS = 0.035;    // seed 평균색 샘플 반경 (넓힘: 탭이 살짝 빗나가도 색 학습 성공)
const COLOR_TOL = 105;        // 색 거리 허용치 — 작을수록 엄격 (완화: 조명/반사 대응)
const RELAXED_COLOR_TOL = 138;// 엄격 매칭 실패 시 2차 탐색 허용치
const SAMPLE_STEP = 2;        // 픽셀 샘플 간격(속도/정확도 균형)
const EMA_ALPHA = 0.4;        // 위치 평활
const MIN_MATCH = 3;          // 이보다 매칭 픽셀 적으면 "못 찾음"(가려짐)으로 보고 유지 (완화: 작은 점도 감지)
const TARGET_ADAPT_ALPHA = 0.08; // 조명 변화에 맞춰 학습색을 아주 천천히 보정

/** 영상에서 정규화 좌표 둘레의 평균색 샘플 (RGB + HSV) */
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
  const r0 = R / n, g0 = G / n, b0 = B / n;
  const hsv = toHsv(r0, g0, b0);
  return { r: r0, g: g0, b: b0, h: hsv.h, s: hsv.s, v: hsv.v };
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function edgeStrength(data, bw, bh, x, y) {
  if (x <= 0 || y <= 0 || x >= bw - 1 || y >= bh - 1) return 0;
  const idx = (xx, yy) => (yy * bw + xx) * 4;
  const l = (xx, yy) => {
    const i = idx(xx, yy);
    return luminance(data[i], data[i + 1], data[i + 2]);
  };
  const dx = Math.abs(l(x + 1, y) - l(x - 1, y));
  const dy = Math.abs(l(x, y + 1) - l(x, y - 1));
  return Math.min(1, (dx + dy) / 170);
}

function blendTargetColor(prev, next, alpha = TARGET_ADAPT_ALPHA) {
  if (!prev || !next) return prev || next || null;
  const r = prev.r + (next.r - prev.r) * alpha;
  const g = prev.g + (next.g - prev.g) * alpha;
  const b = prev.b + (next.b - prev.b) * alpha;
  const hsv = toHsv(r, g, b);
  return { r, g, b, h: hsv.h, s: hsv.s, v: hsv.v };
}

/**
 * 한 점의 색 매칭 추적. HSV 거리 기반(조명에 강함) + 속도 예측(pred) 중심 검색.
 * @param pos 직전 위치, @param target 학습색, @param pred 예측 위치(없으면 pos)
 */
function trackOne(ctx, w, h, pos, target, pred) {
  const center = pred || pos;
  const cx = center.x * w, cy = center.y * h;
  const rad = SEARCH_RADIUS * Math.min(w, h);
  const x0 = Math.max(0, Math.floor(cx - rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const x1 = Math.min(w, Math.ceil(cx + rad));
  const y1 = Math.min(h, Math.ceil(cy + rad));
  if (x1 <= x0 || y1 <= y0) return null;
  const bw = x1 - x0, bh = y1 - y0;
  const { data } = ctx.getImageData(x0, y0, bw, bh);
  const collect = (tolPx, minMatch) => {
    let sumX = 0, sumY = 0, sumWt = 0, n = 0;
    const TOL = tolPx / 255; // HSV 거리 스케일에 맞춘 허용치
    for (let yy = 0; yy < bh; yy += SAMPLE_STEP) {
      for (let xx = 0; xx < bw; xx += SAMPLE_STEP) {
        const idx = (yy * bw + xx) * 4;
        const c = toHsv(data[idx], data[idx + 1], data[idx + 2]);
        const dist = hsvDist(c, target);
        if (dist > TOL) continue;

        const absX = x0 + xx;
        const absY = y0 + yy;
        const dxy = Math.hypot(absX - cx, absY - cy) / Math.max(1, rad);
        const colorWt = 1 - dist / TOL;
        const spatialWt = Math.max(0.18, 1 - dxy * 0.72);
        const edgeWt = 1 + edgeStrength(data, bw, bh, xx, yy) * 0.65;
        const wt = colorWt * spatialWt * edgeWt;
        sumX += absX * wt; sumY += absY * wt; sumWt += wt; n++;
      }
    }
    if (n < minMatch || sumWt <= 0) return null;
    return { x: (sumX / sumWt) / w, y: (sumY / sumWt) / h, matches: n };
  };

  return collect(COLOR_TOL, MIN_MATCH) || collect(RELAXED_COLOR_TOL, 2);
}

/** RGB → HSV (h는 0~360, s·v는 0~1) — 조명 변화에 강한 매칭용 */
function toHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** 두 색의 HSV 거리(조명/밝기 변화에 RGB보다 강함) */
function hsvDist(c, t) {
  let dh = Math.abs(c.h - t.h); if (dh > 180) dh = 360 - dh;
  const dH = dh / 180;
  const dS = Math.abs(c.s - t.s);
  const dV = Math.abs(c.v - t.v);
  const wH = Math.min(c.s, t.s); // 둘 다 채도 높을 때만 색상 강조
  return Math.sqrt((dH * wH) ** 2 + (dS * 0.6) ** 2 + (dV * 0.5) ** 2);
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
      points.push({ target: col, pos: { x: nx, y: ny }, prev: null, ema: { x: nx, y: ny }, alive: true });
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

      // 1) 각 점 추적 (직전 속도로 검색창 중심을 미리 이동 → 빠른 움직임 대응)
      const found = points.map(p => {
        const pred = p.prev
          ? { x: p.pos.x + (p.pos.x - p.prev.x), y: p.pos.y + (p.pos.y - p.prev.y) }
          : p.pos;
        const r = trackOne(c, w, h, p.pos, p.target, pred);
        if (r) {
          p.prev = p.pos;
          p.pos = r;
          p.target = blendTargetColor(p.target, sampleColor(c, w, h, r.x, r.y, SEED_RADIUS * 0.8));
          p.alive = true;
        }
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
        target = blendTargetColor(target, sampleColor(c, w, h, r.x, r.y, SEED_RADIUS * 0.8));
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
