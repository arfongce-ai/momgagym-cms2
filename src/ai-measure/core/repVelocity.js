import { computeBarVelocities } from './lifting';

const r2 = (x) => Math.round(x * 100) / 100;
const r1 = (x) => Math.round(x * 10) / 10;

function cleanPath(path) {
  return (Array.isArray(path) ? path : [])
    .map((p) => ({ x: Number(p.x), y: Number(p.y), ts: Number(p.ts) }))
    .filter((p) => Number.isFinite(p.y) && Number.isFinite(p.ts))
    .sort((a, b) => a.ts - b.ts);
}

function inferMinTravel(points, minTravelRatio) {
  if (Number.isFinite(minTravelRatio) && minTravelRatio > 0) return minTravelRatio;
  if (points.length < 2) return 0.025;
  const ys = points.map((p) => p.y);
  const rom = Math.max(...ys) - Math.min(...ys);
  return Math.max(0.025, rom * 0.22);
}

export function segmentBarPath(path, opts = {}) {
  const points = cleanPath(path);
  if (points.length < 3) return [];

  const minTravel = inferMinTravel(points, opts.minTravelRatio);
  const extrema = [0];
  let direction = 0;
  let anchorIdx = 0;
  let extremeIdx = 0;

  for (let i = 1; i < points.length; i++) {
    const y = points[i].y;
    if (direction === 0) {
      const dy = y - points[anchorIdx].y;
      if (Math.abs(dy) >= minTravel) {
        direction = dy > 0 ? 1 : -1;
        extremeIdx = i;
      }
      continue;
    }

    if (direction > 0 && y >= points[extremeIdx].y) extremeIdx = i;
    if (direction < 0 && y <= points[extremeIdx].y) extremeIdx = i;

    const retrace = direction > 0
      ? points[extremeIdx].y - y
      : y - points[extremeIdx].y;
    if (retrace >= minTravel) {
      if (Math.abs(points[extremeIdx].y - points[anchorIdx].y) >= minTravel) {
        extrema.push(extremeIdx);
      }
      anchorIdx = extremeIdx;
      direction *= -1;
      extremeIdx = i;
    }
  }

  if (Math.abs(points[extremeIdx].y - points[extrema[extrema.length - 1]].y) >= minTravel) {
    extrema.push(extremeIdx);
  }

  const segments = [];
  for (let i = 1; i < extrema.length; i++) {
    const startIdx = extrema[i - 1];
    const endIdx = extrema[i];
    const start = points[startIdx];
    const end = points[endIdx];
    const travelRatio = Math.abs(end.y - start.y);
    const durationSec = (end.ts - start.ts) / 1000;
    if (travelRatio < minTravel || durationSec <= 0) continue;
    segments.push({
      startIndex: startIdx,
      endIndex: endIdx,
      startMs: start.ts,
      endMs: end.ts,
      durationSec: r2(durationSec),
      travelRatio: r2(travelRatio * 100) / 100,
      direction: end.y < start.y ? 'up' : 'down',
      points: points.slice(startIdx, endIdx + 1),
    });
  }
  return segments;
}

export function buildRepVelocityMetrics(path, opts = {}) {
  const cmPerRatio = Number(opts.cmPerRatio);
  const canScale = Number.isFinite(cmPerRatio) && cmPerRatio > 0;
  const segments = segmentBarPath(path, opts);
  const reps = segments
    .filter((seg) => seg.direction === 'up')
    .map((seg, index) => {
      const series = canScale
        ? seg.points.map((p) => ({ yCm: p.y * cmPerRatio, ts: p.ts }))
        : [];
      const velo = canScale
        ? computeBarVelocities(series, { source: opts.source, fps: opts.fps })
        : { meanVelocity: null, peakVelocity: null, peakReason: 'no_calibration', romCm: null };
      return {
        repNo: index + 1,
        startMs: Math.round(seg.startMs),
        endMs: Math.round(seg.endMs),
        durationSec: seg.durationSec,
        romCm: velo.romCm != null ? velo.romCm : (canScale ? r1(seg.travelRatio * cmPerRatio) : null),
        meanVelocity: velo.meanVelocity,
        peakVelocity: velo.peakVelocity,
        peakReason: velo.peakReason,
      };
    });

  const velocities = reps.map((r) => r.meanVelocity).filter((v) => Number.isFinite(v) && v > 0);
  const best = velocities.length ? Math.max(...velocities) : null;
  const last = velocities.length ? velocities[velocities.length - 1] : null;
  const lossPct = best && last != null ? r1(((best - last) / best) * 100) : null;

  return {
    reps,
    summary: {
      repCount: reps.length,
      bestMeanVelocity: best != null ? r2(best) : null,
      lastMeanVelocity: last != null ? r2(last) : null,
      averageMeanVelocity: velocities.length
        ? r2(velocities.reduce((sum, value) => sum + value, 0) / velocities.length)
        : null,
      velocityLossPct: lossPct,
    },
  };
}
