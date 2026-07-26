// Shared distance calibration helpers for barbell measurements.
// A known object in frame is preferred over body-height scaling.

const r1 = (x) => Math.round(x * 10) / 10;
const r4 = (x) => Math.round(x * 10000) / 10000;

export const CALIBRATION_PRESETS = Object.freeze([
  { key: 'iwf_45_plate', label: 'IWF 45cm plate', lengthCm: 45 },
  { key: 'olympic_sleeve', label: 'Olympic sleeve 41.5cm', lengthCm: 41.5 },
  { key: 'calibration_bar_50', label: 'Calibration bar 50cm', lengthCm: 50 },
]);

export function pointDistanceRatio(a, b) {
  if (!a || !b) return null;
  const ax = Number(a.x), ay = Number(a.y);
  const bx = Number(b.x), by = Number(b.y);
  if (![ax, ay, bx, by].every(Number.isFinite)) return null;
  return Math.hypot(ax - bx, ay - by);
}

export function buildReferenceScale(points, knownLengthCm) {
  const p = Array.isArray(points) ? points : [];
  const known = Number(knownLengthCm);
  const ratio = pointDistanceRatio(p[0], p[1]);
  if (!Number.isFinite(known) || known <= 0 || !Number.isFinite(ratio) || ratio <= 0) {
    return null;
  }
  return {
    source: 'reference',
    knownLengthCm: r1(known),
    referenceRatio: r4(ratio),
    cmPerRatio: known / ratio,
  };
}

export function bodyHeightScale(personHeightRatio, heightCm) {
  const ratio = Number(personHeightRatio);
  const height = Number(heightCm);
  if (!Number.isFinite(ratio) || ratio <= 0 || !Number.isFinite(height) || height <= 0) {
    return null;
  }
  return {
    source: 'body_height',
    knownLengthCm: r1(height),
    referenceRatio: r4(ratio),
    cmPerRatio: height / ratio,
  };
}

export function resolveDistanceScale({ referenceScale, personHeightRatio, heightCm } = {}) {
  if (referenceScale?.cmPerRatio > 0) {
    return { ...referenceScale, isCalibrated: true };
  }
  const body = bodyHeightScale(personHeightRatio, heightCm);
  if (body) return { ...body, isCalibrated: true };
  return {
    source: 'none',
    knownLengthCm: null,
    referenceRatio: null,
    cmPerRatio: null,
    isCalibrated: false,
  };
}

export function ratioToCm(ratio, cmPerRatio) {
  const r = Number(ratio);
  const scale = Number(cmPerRatio);
  if (!Number.isFinite(r) || !Number.isFinite(scale) || scale <= 0) return null;
  return r1(Math.abs(r) * scale);
}

export function serializeDistanceScale(scale) {
  if (!scale || !scale.isCalibrated) {
    return { source: 'none', isCalibrated: false };
  }
  return {
    source: scale.source,
    isCalibrated: true,
    knownLengthCm: scale.knownLengthCm ?? null,
    referenceRatio: scale.referenceRatio ?? null,
    cmPerRatio: scale.cmPerRatio ? r1(scale.cmPerRatio) : null,
  };
}
