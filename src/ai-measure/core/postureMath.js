// Posture and body alignment math for BlazePose 33-landmark arrays.
// Coordinates are expected to be normalized MediaPipe/BlazePose points:
// { x: 0..1, y: 0..1, z?: number, visibility?: number }.

export const POSE_LANDMARKS = Object.freeze({
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
});

const LM = POSE_LANDMARKS;
const MIN_VISIBILITY = 0.45;
const EPS = 1e-7;
const COG_NORMAL_TOLERANCE_PCT = 5;

export const POSTURE_STATUS = Object.freeze({
  NORMAL: 'normal',
  CAUTION: 'caution',
  RISK: 'risk',
});

export const POSTURE_STATUS_KO = Object.freeze({
  normal: '정상',
  caution: '주의',
  risk: '위험',
});

export function round(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return null;
  const unit = 10 ** digits;
  return Math.round(value * unit) / unit;
}

export function isVisible(point, threshold = MIN_VISIBILITY) {
  return !!point && (point.visibility == null || point.visibility >= threshold);
}

export function getLandmark(landmarks, index, threshold = MIN_VISIBILITY) {
  const point = landmarks?.[index];
  return isVisible(point, threshold) ? point : null;
}

export function getReliableLandmarks(landmarks, threshold = 0.75) {
  if (!Array.isArray(landmarks)) return [];
  return landmarks.map((point, index) => {
    if (!point || (point.visibility != null && point.visibility < threshold)) {
      return {
        index,
        x: null,
        y: null,
        z: null,
        visibility: point?.visibility ?? 0,
        isValid: false,
      };
    }
    return { ...point, index, isValid: true };
  });
}

export function areLandmarksReliable(landmarks, indexes, threshold = 0.75) {
  return indexes.every((index) => isVisible(landmarks?.[index], threshold));
}

export function isPelvisDataReliable(landmarks, threshold = 0.8) {
  return areLandmarksReliable(landmarks, [LM.LEFT_HIP, LM.RIGHT_HIP], threshold);
}

export function midpoint(a, b) {
  if (!a || !b) return null;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  };
}

function medianOf(values) {
  const arr = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 캡처 직전 N프레임의 랜드마크들을 좌표별 중앙값으로 결합해 떨림에 강한
 * "대표 프레임"을 만든다. 점프(최고값)·보행(스텝 중앙값)과 동일한 측정 정직성
 * 철학을 정지 자세 측정에도 적용하기 위한 순수 함수.
 *
 *  · x / y / z / visibility 각각을 33개 인덱스별로 중앙값(median) 처리.
 *    평균이 아니라 중앙값을 쓰는 이유: 한두 프레임의 순간 오검출(튐)이
 *    결과에 끌려가지 않도록(이상치 내성).
 *  · 어떤 인덱스가 일부 프레임에서만 잡혔다면(가시성 부족), 그 인덱스는
 *    잡힌 프레임들만 모아 중앙값을 낸다(억지로 0으로 채우지 않음).
 *  · 단일 프레임이면 그대로 반환(결합 불필요).
 *
 * @param {Array<Array<{x,y,z?,visibility?}>>} frames 시간순 랜드마크 배열들
 * @returns {Array|null} 결합된 33-랜드마크 배열, 입력이 비면 null
 */
export function medianLandmarks(frames) {
  const valid = (Array.isArray(frames) ? frames : []).filter(
    (f) => Array.isArray(f) && f.length,
  );
  if (!valid.length) return null;
  if (valid.length === 1) return valid[0];

  const length = valid.reduce((max, f) => Math.max(max, f.length), 0);
  const out = [];
  for (let i = 0; i < length; i++) {
    const xs = [];
    const ys = [];
    const zs = [];
    const vs = [];
    for (const frame of valid) {
      const p = frame[i];
      if (!p) continue;
      if (typeof p.x === 'number') xs.push(p.x);
      if (typeof p.y === 'number') ys.push(p.y);
      if (typeof p.z === 'number') zs.push(p.z);
      if (typeof p.visibility === 'number') vs.push(p.visibility);
    }
    if (!xs.length || !ys.length) {
      out.push(null);
      continue;
    }
    const point = { x: medianOf(xs), y: medianOf(ys) };
    if (zs.length) point.z = medianOf(zs);
    if (vs.length) point.visibility = medianOf(vs);
    out.push(point);
  }
  return out;
}

export function distance2d(a, b) {
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distance3d(a, b) {
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

export function angleDeg(a, b, c, use3d = true) {
  if (!a || !b || !c) return null;
  const ab = { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) };
  const cb = { x: c.x - b.x, y: c.y - b.y, z: (c.z ?? 0) - (b.z ?? 0) };
  const dot = ab.x * cb.x + ab.y * cb.y + (use3d ? ab.z * cb.z : 0);
  const magA = Math.hypot(ab.x, ab.y, use3d ? ab.z : 0);
  const magC = Math.hypot(cb.x, cb.y, use3d ? cb.z : 0);
  if (magA < EPS || magC < EPS) return null;
  const cos = Math.max(-1, Math.min(1, dot / (magA * magC)));
  return round((Math.acos(cos) * 180) / Math.PI, 1);
}

export const angleAt = angleDeg;

export function signedAngle2d(a, b, c) {
  if (!a || !b || !c) return null;
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const cross = ab.x * cb.y - ab.y * cb.x;
  return round((Math.atan2(cross, dot) * 180) / Math.PI, 1);
}

export function estimateBodyScale(landmarks, heightCm = null) {
  const shoulder = midpoint(getLandmark(landmarks, LM.LEFT_SHOULDER), getLandmark(landmarks, LM.RIGHT_SHOULDER));
  const ankle = midpoint(getLandmark(landmarks, LM.LEFT_ANKLE), getLandmark(landmarks, LM.RIGHT_ANKLE));
  const nose = getLandmark(landmarks, LM.NOSE, 0.25);
  const top = nose || shoulder;
  const normalizedHeight = top && ankle ? Math.abs(ankle.y - top.y) : null;
  if (!normalizedHeight || normalizedHeight < 0.05) return null;
  return {
    normalizedHeight,
    cmPerNormalizedUnit: heightCm ? heightCm / normalizedHeight : null,
    mmPerNormalizedUnit: heightCm ? (heightCm * 10) / normalizedHeight : null,
  };
}

export function calculatePixelToCmScale(landmarks, heightCm = null) {
  const scale = estimateBodyScale(landmarks, heightCm);
  return {
    normalizedHeight: scale?.normalizedHeight ?? null,
    cmPerNormalizedUnit: scale?.cmPerNormalizedUnit ?? null,
    mmPerNormalizedUnit: scale?.mmPerNormalizedUnit ?? null,
  };
}

export function normalizedDeltaToMm(delta, landmarks, heightCm = null) {
  const scale = estimateBodyScale(landmarks, heightCm);
  if (!scale?.mmPerNormalizedUnit) return null;
  return round(delta * scale.mmPerNormalizedUnit, 1);
}

export function normalizedDistanceToMm(a, b, landmarks, heightCm = null) {
  const distance = distance2d(a, b);
  return distance == null ? null : normalizedDeltaToMm(distance, landmarks, heightCm);
}

export function asymmetryIndex(leftValue, rightValue) {
  if (leftValue == null || rightValue == null) return null;
  const denominator = (Math.abs(leftValue) + Math.abs(rightValue)) / 2;
  if (denominator < EPS) return 0;
  return round((Math.abs(leftValue - rightValue) / denominator) * 100, 1);
}

function pairTiltDegrees(left, right) {
  if (!left || !right) return null;
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  if (Math.hypot(dx, dy) < EPS) return null;
  return round((Math.atan2(dy, dx) * 180) / Math.PI, 1);
}

function pairYawDegrees(left, right) {
  if (!left || !right) return null;
  const width = Math.max(distance2d(left, right) ?? 0, EPS);
  const dz = (right.z ?? 0) - (left.z ?? 0);
  return round((Math.atan2(dz, width) * 180) / Math.PI, 1);
}

function segmentPitchDegrees(top, bottom) {
  if (!top || !bottom) return null;
  const dy = bottom.y - top.y;
  const dz = (bottom.z ?? 0) - (top.z ?? 0);
  if (Math.hypot(dy, dz) < EPS) return null;
  return round((Math.atan2(dz, Math.abs(dy)) * 180) / Math.PI, 1);
}

export function estimate3DRotation(landmarks) {
  const leftShoulder = getLandmark(landmarks, LM.LEFT_SHOULDER);
  const rightShoulder = getLandmark(landmarks, LM.RIGHT_SHOULDER);
  const leftHip = getLandmark(landmarks, LM.LEFT_HIP);
  const rightHip = getLandmark(landmarks, LM.RIGHT_HIP);
  const shoulderMid = midpoint(leftShoulder, rightShoulder);
  const hipMid = midpoint(leftHip, rightHip);

  const shoulderRoll = pairTiltDegrees(leftShoulder, rightShoulder);
  const pelvisRoll = pairTiltDegrees(leftHip, rightHip);
  const shoulderYaw = pairYawDegrees(leftShoulder, rightShoulder);
  const pelvisYaw = pairYawDegrees(leftHip, rightHip);
  const trunkPitch = segmentPitchDegrees(shoulderMid, hipMid);

  return {
    rollDeg: round(meanDefined([shoulderRoll, pelvisRoll]), 1),
    pitchDeg: trunkPitch,
    yawDeg: round(meanDefined([shoulderYaw, pelvisYaw]), 1),
    segments: {
      shoulderRollDeg: shoulderRoll,
      pelvisRollDeg: pelvisRoll,
      shoulderYawDeg: shoulderYaw,
      pelvisYawDeg: pelvisYaw,
      trunkPitchDeg: trunkPitch,
    },
  };
}

export function jointAnglesFromBlazePose(landmarks) {
  return {
    left: {
      hip: angleDeg(getLandmark(landmarks, LM.LEFT_SHOULDER), getLandmark(landmarks, LM.LEFT_HIP), getLandmark(landmarks, LM.LEFT_KNEE)),
      knee: angleDeg(getLandmark(landmarks, LM.LEFT_HIP), getLandmark(landmarks, LM.LEFT_KNEE), getLandmark(landmarks, LM.LEFT_ANKLE)),
      ankle: angleDeg(getLandmark(landmarks, LM.LEFT_KNEE), getLandmark(landmarks, LM.LEFT_ANKLE), getLandmark(landmarks, LM.LEFT_FOOT_INDEX)),
    },
    right: {
      hip: angleDeg(getLandmark(landmarks, LM.RIGHT_SHOULDER), getLandmark(landmarks, LM.RIGHT_HIP), getLandmark(landmarks, LM.RIGHT_KNEE)),
      knee: angleDeg(getLandmark(landmarks, LM.RIGHT_HIP), getLandmark(landmarks, LM.RIGHT_KNEE), getLandmark(landmarks, LM.RIGHT_ANKLE)),
      ankle: angleDeg(getLandmark(landmarks, LM.RIGHT_KNEE), getLandmark(landmarks, LM.RIGHT_ANKLE), getLandmark(landmarks, LM.RIGHT_FOOT_INDEX)),
    },
  };
}

export function estimateKneeExtensionAngle(landmarks, side) {
  const hip = getLandmark(landmarks, side === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP);
  const knee = getLandmark(landmarks, side === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE);
  const ankle = getLandmark(landmarks, side === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE);
  const base = angleDeg(hip, knee, ankle);
  const signed = signedAngle2d(hip, knee, ankle);
  if (base == null) return null;

  // BlazePose does not directly output tibiofemoral extension past 180 degrees.
  // This signed 2D proxy lets side-view frames flag probable recurvatum.
  const hyperProxy = signed != null && Math.abs(signed) < 8 && base > 176 ? base + Math.max(0, 8 - Math.abs(signed)) : base;
  return round(hyperProxy, 1);
}

export function evaluatePostureRules(landmarks) {
  const angles = jointAnglesFromBlazePose(landmarks);
  const leftKneeExtension = estimateKneeExtensionAngle(landmarks, 'left');
  const rightKneeExtension = estimateKneeExtensionAngle(landmarks, 'right');
  const legAlignment = classifyLegAlignment(landmarks);

  const findings = [];
  for (const [side, value] of [['left', leftKneeExtension], ['right', rightKneeExtension]]) {
    if (value == null) continue;
    if (value > 185) {
      findings.push({
        key: `${side}_knee_hyperextension`,
        status: POSTURE_STATUS.RISK,
        label: side === 'left' ? '좌측 무릎 과신전' : '우측 무릎 과신전',
        value,
        unit: 'deg',
        message: '무릎 신전각이 185도를 초과하여 과신전 위험이 큽니다.',
      });
    } else if (value > 180) {
      findings.push({
        key: `${side}_knee_extension_caution`,
        status: POSTURE_STATUS.CAUTION,
        label: side === 'left' ? '좌측 무릎 신전 주의' : '우측 무릎 신전 주의',
        value,
        unit: 'deg',
        message: '무릎 잠김 또는 과신전 경향을 추적 관찰하세요.',
      });
    }
  }

  if (legAlignment.status !== POSTURE_STATUS.NORMAL) findings.push(legAlignment);

  return {
    status: worstStatus(findings.map((item) => item.status)),
    findings,
    angles,
    kneeExtension: { left: leftKneeExtension, right: rightKneeExtension },
    legAlignment,
  };
}

export function classifyLegAlignment(landmarks) {
  const leftHip = getLandmark(landmarks, LM.LEFT_HIP);
  const rightHip = getLandmark(landmarks, LM.RIGHT_HIP);
  const leftKnee = getLandmark(landmarks, LM.LEFT_KNEE);
  const rightKnee = getLandmark(landmarks, LM.RIGHT_KNEE);
  const leftAnkle = getLandmark(landmarks, LM.LEFT_ANKLE);
  const rightAnkle = getLandmark(landmarks, LM.RIGHT_ANKLE);
  const hipWidth = distance2d(leftHip, rightHip);
  const kneeWidth = distance2d(leftKnee, rightKnee);
  const ankleWidth = distance2d(leftAnkle, rightAnkle);
  if (!hipWidth || !kneeWidth || !ankleWidth) {
    return { key: 'leg_alignment', status: POSTURE_STATUS.NORMAL, label: '하지 정렬', message: '판별 가능한 랜드마크가 부족합니다.' };
  }

  const kneeToHip = kneeWidth / hipWidth;
  const ankleToHip = ankleWidth / hipWidth;
  const valgusIndex = ankleToHip - kneeToHip;
  const varusIndex = kneeToHip - ankleToHip;

  if (valgusIndex >= 0.22) {
    return {
      key: 'genu_valgum',
      status: valgusIndex >= 0.35 ? POSTURE_STATUS.RISK : POSTURE_STATUS.CAUTION,
      label: 'X 다리 경향',
      value: round(valgusIndex * 100, 1),
      unit: 'index',
      message: '양 무릎 간격이 발목 간격에 비해 좁아 동적/정적 외반 정렬을 확인해야 합니다.',
    };
  }
  if (varusIndex >= 0.2) {
    return {
      key: 'genu_varum',
      status: varusIndex >= 0.32 ? POSTURE_STATUS.RISK : POSTURE_STATUS.CAUTION,
      label: 'O 다리 경향',
      value: round(varusIndex * 100, 1),
      unit: 'index',
      message: '양 무릎 간격이 발목 간격에 비해 넓어 내반 정렬을 확인해야 합니다.',
    };
  }
  return {
    key: 'leg_alignment',
    status: POSTURE_STATUS.NORMAL,
    label: '하지 정렬',
    value: round((Math.abs(kneeToHip - ankleToHip)) * 100, 1),
    unit: 'index',
    message: '정면 하지 정렬이 정상 범위에 가깝습니다.',
  };
}

export function calculateAsymmetryProfile(landmarks) {
  const angles = jointAnglesFromBlazePose(landmarks);
  const shoulderTilt = pairTiltDegrees(getLandmark(landmarks, LM.LEFT_SHOULDER), getLandmark(landmarks, LM.RIGHT_SHOULDER));
  const pelvisTilt = pairTiltDegrees(getLandmark(landmarks, LM.LEFT_HIP), getLandmark(landmarks, LM.RIGHT_HIP));
  const kneeAsi = asymmetryIndex(angles.left.knee, angles.right.knee);
  const hipAsi = asymmetryIndex(angles.left.hip, angles.right.hip);
  const ankleAsi = asymmetryIndex(angles.left.ankle, angles.right.ankle);
  const averageAsi = round(meanDefined([kneeAsi, hipAsi, ankleAsi]), 1);

  return {
    averageAsi,
    jointAsi: { hip: hipAsi, knee: kneeAsi, ankle: ankleAsi },
    frontalTiltDeg: { shoulder: shoulderTilt, pelvis: pelvisTilt },
    angles,
  };
}

export function analyzeFrontalAlignment(landmarks, { heightCm = null } = {}) {
  const leftShoulder = getLandmark(landmarks, LM.LEFT_SHOULDER);
  const rightShoulder = getLandmark(landmarks, LM.RIGHT_SHOULDER);
  const leftHip = getLandmark(landmarks, LM.LEFT_HIP);
  const rightHip = getLandmark(landmarks, LM.RIGHT_HIP);
  const leftAnkle = getLandmark(landmarks, LM.LEFT_ANKLE);
  const rightAnkle = getLandmark(landmarks, LM.RIGHT_ANKLE);
  const trunkDeviation = calculatePosturalDeviationMm(landmarks, heightCm);
  const legAlignment = classifyLegAlignment(landmarks);

  const shoulderDiffMm = leftShoulder && rightShoulder
    ? normalizedDeltaToMm(leftShoulder.y - rightShoulder.y, landmarks, heightCm)
    : null;
  const pelvisDiffMm = leftHip && rightHip
    ? normalizedDeltaToMm(leftHip.y - rightHip.y, landmarks, heightCm)
    : null;
  const ankleDiffMm = leftAnkle && rightAnkle
    ? normalizedDeltaToMm(leftAnkle.y - rightAnkle.y, landmarks, heightCm)
    : null;

  const pelvisAbs = Math.abs(pelvisDiffMm ?? 0);
  const ankleAbs = Math.abs(ankleDiffMm ?? 0);
  const pelvisPattern = pelvisDiffMm == null
    ? 'unknown'
    : pelvisAbs < 5
      ? 'within_error'
      : ankleAbs >= pelvisAbs * 0.65
        ? 'structural_leg_length_pattern'
        : 'functional_lumbopelvic_pattern';

  return {
    shoulderHeightDiffMm: shoulderDiffMm,
    shoulderHigherSide: higherSideFromY(leftShoulder, rightShoulder),
    pelvisHeightDiffMm: pelvisDiffMm,
    pelvisHigherSide: higherSideFromY(leftHip, rightHip),
    ankleHeightDiffMm: ankleDiffMm,
    pelvisPattern,
    qAngleProxyDeg: {
      left: angleDeg(leftHip, getLandmark(landmarks, LM.LEFT_KNEE), leftAnkle, false),
      right: angleDeg(rightHip, getLandmark(landmarks, LM.RIGHT_KNEE), rightAnkle, false),
    },
    trunkShiftMm: trunkDeviation.pelvis,
    legAlignment,
  };
}

export function analyzeSagittalAlignment(landmarks, { heightCm = null } = {}) {
  const ear = midpoint(getLandmark(landmarks, LM.LEFT_EAR, 0.25), getLandmark(landmarks, LM.RIGHT_EAR, 0.25)) || getLandmark(landmarks, LM.NOSE, 0.25);
  const shoulder = midpoint(getLandmark(landmarks, LM.LEFT_SHOULDER), getLandmark(landmarks, LM.RIGHT_SHOULDER));
  const hip = midpoint(getLandmark(landmarks, LM.LEFT_HIP), getLandmark(landmarks, LM.RIGHT_HIP));
  const knee = midpoint(getLandmark(landmarks, LM.LEFT_KNEE), getLandmark(landmarks, LM.RIGHT_KNEE));
  const ankle = midpoint(getLandmark(landmarks, LM.LEFT_ANKLE), getLandmark(landmarks, LM.RIGHT_ANKLE));
  const rotations = estimate3DRotation(landmarks);

  const forwardHeadMm = ear && shoulder
    ? normalizedDeltaToMm(Math.abs(ear.x - shoulder.x), landmarks, heightCm)
    : null;
  const kyphosisProxyDeg = angleDeg(ear, shoulder, hip, false);
  const kneeExtensionProxyDeg = angleDeg(hip, knee, ankle, false);
  const anklePlumbKneeDeviationMm = ankle && knee
    ? normalizedDeltaToMm(knee.x - ankle.x, landmarks, heightCm)
    : null;
  const anklePlumbHipDeviationMm = ankle && hip
    ? normalizedDeltaToMm(hip.x - ankle.x, landmarks, heightCm)
    : null;

  return {
    forwardHeadMm,
    kyphosisProxyDeg,
    pelvicPitchProxyDeg: rotations.segments?.trunkPitchDeg ?? rotations.pitchDeg,
    kneeExtensionProxyDeg,
    anklePlumbKneeDeviationMm,
    anklePlumbHipDeviationMm,
  };
}

export function calculatePosturalDeviationMm(landmarks, heightCm = null) {
  const shoulderMid = midpoint(getLandmark(landmarks, LM.LEFT_SHOULDER), getLandmark(landmarks, LM.RIGHT_SHOULDER));
  const hipMid = midpoint(getLandmark(landmarks, LM.LEFT_HIP), getLandmark(landmarks, LM.RIGHT_HIP));
  const ankleMid = midpoint(getLandmark(landmarks, LM.LEFT_ANKLE), getLandmark(landmarks, LM.RIGHT_ANKLE));
  const nose = getLandmark(landmarks, LM.NOSE, 0.25);
  const earMid = midpoint(getLandmark(landmarks, LM.LEFT_EAR, 0.25), getLandmark(landmarks, LM.RIGHT_EAR, 0.25));
  const headPoint = earMid || nose;
  const referenceX = ankleMid?.x ?? hipMid?.x ?? shoulderMid?.x;

  const toDev = (point) => (point && referenceX != null ? normalizedDeltaToMm(point.x - referenceX, landmarks, heightCm) : null);
  return {
    head: toDev(headPoint),
    shoulder: toDev(shoulderMid),
    pelvis: toDev(hipMid),
    knee: toDev(midpoint(getLandmark(landmarks, LM.LEFT_KNEE), getLandmark(landmarks, LM.RIGHT_KNEE))),
    referenceX,
  };
}

export function calculateCenterOfGravity(landmarks) {
  const leftShoulder = getLandmark(landmarks, LM.LEFT_SHOULDER);
  const rightShoulder = getLandmark(landmarks, LM.RIGHT_SHOULDER);
  const leftHip = getLandmark(landmarks, LM.LEFT_HIP);
  const rightHip = getLandmark(landmarks, LM.RIGHT_HIP);
  const leftAnkle = getLandmark(landmarks, LM.LEFT_ANKLE);
  const rightAnkle = getLandmark(landmarks, LM.RIGHT_ANKLE);
  const shoulderMid = midpoint(leftShoulder, rightShoulder);
  const pelvisMid = midpoint(leftHip, rightHip);
  const footMid = midpoint(leftAnkle, rightAnkle);
  const bosWidth = distance2d(leftAnkle, rightAnkle);
  if (!shoulderMid || !pelvisMid || !footMid || !bosWidth) {
    return {
      available: false,
      status: POSTURE_STATUS.NORMAL,
      message: 'CoG/BoS 계산에 필요한 어깨, 골반, 발목 랜드마크가 부족합니다.',
    };
  }

  const cogTop = shoulderMid;
  const cogBottom = pelvisMid;
  const footY = footMid.y;
  const dy = cogBottom.y - cogTop.y;
  const slopeX = Math.abs(dy) < EPS ? 0 : (cogBottom.x - cogTop.x) / dy;
  const cogAtBosX = cogTop.x + slopeX * (footY - cogTop.y);
  const offsetRatioOfHalfBos = (cogAtBosX - footMid.x) / (bosWidth / 2);
  const offsetPct = round(offsetRatioOfHalfBos * 100, 1);
  const isWithinTolerance = Math.abs(offsetPct) <= COG_NORMAL_TOLERANCE_PCT;
  const balanceOffsetPct = isWithinTolerance ? 0 : round(offsetPct, 1);
  const absBalanceOffset = Math.abs(balanceOffsetPct);
  const status = absBalanceOffset >= 35 ? POSTURE_STATUS.RISK : absBalanceOffset >= 18 ? POSTURE_STATUS.CAUTION : POSTURE_STATUS.NORMAL;
  const direction = isWithinTolerance ? 'center' : balanceOffsetPct > 0 ? 'right' : 'left';
  const message = isWithinTolerance
    ? `가상 무게중심선이 지지기반 중심 ±${COG_NORMAL_TOLERANCE_PCT}% 오차 범위 안에 있어 정상 밸런스로 판정됩니다.`
    : `가상 무게중심선이 지지기반 중심에서 ${Math.abs(balanceOffsetPct)}% ${balanceOffsetPct > 0 ? '우측' : '좌측'}으로 편향되었습니다.`;

  return {
    available: true,
    status,
    cogLine: { top: cogTop, bottom: cogBottom, xAtBos: cogAtBosX },
    bos: { left: leftAnkle, right: rightAnkle, center: footMid, width: bosWidth },
    offsetPct,
    balanceOffsetPct,
    tolerancePct: COG_NORMAL_TOLERANCE_PCT,
    isWithinTolerance,
    direction,
    message,
  };
}

export function calculatePostureScore({
  deviationsMm = {},
  asi = null,
  ruleFindings = [],
  cog = null,
  weights = {},
} = {}) {
  const w = {
    deviation: 0.42,
    asymmetry: 0.24,
    rules: 0.24,
    cog: 0.1,
    ...weights,
  };

  const deviationValues = Object.values(deviationsMm).filter((value) => typeof value === 'number' && Number.isFinite(value));
  const deviationPenalty = deviationValues.reduce((sum, value) => {
    const mm = Math.abs(value);
    if (mm <= 10) return sum;
    if (mm <= 25) return sum + (mm - 10) * 0.8;
    return sum + 12 + (mm - 25) * 1.4;
  }, 0);
  const deviationScore = clamp(100 - deviationPenalty / Math.max(1, deviationValues.length), 0, 100);

  const asiScore = asi == null ? 82 : clamp(100 - asi * 3.2, 0, 100);

  const rulePenalty = ruleFindings.reduce((sum, item) => {
    if (item.status === POSTURE_STATUS.RISK) return sum + 28;
    if (item.status === POSTURE_STATUS.CAUTION) return sum + 13;
    return sum;
  }, 0);
  const ruleScore = clamp(100 - rulePenalty, 0, 100);

  const cogAbs = Math.abs(cog?.balanceOffsetPct ?? cog?.offsetPct ?? 0);
  const cogScore = cog?.available === false ? 82 : clamp(100 - cogAbs * 1.5, 0, 100);

  const score = round(
    deviationScore * w.deviation +
      asiScore * w.asymmetry +
      ruleScore * w.rules +
      cogScore * w.cog,
    0,
  );

  return {
    score: clamp(score, 0, 100),
    components: {
      deviation: round(deviationScore, 0),
      asymmetry: round(asiScore, 0),
      rules: round(ruleScore, 0),
      cog: round(cogScore, 0),
    },
  };
}

export function mapScoreToBodyAge(score, actualAge, options = {}) {
  if (score == null || actualAge == null) return null;
  const { minAge = 12, maxAge = 90 } = options;
  let delta;
  if (score >= 90) delta = -8;
  else if (score >= 80) delta = -4;
  else if (score >= 70) delta = 0;
  else if (score >= 60) delta = 5;
  else if (score >= 45) delta = 10;
  else delta = 16;
  const fineTune = (70 - score) * 0.15;
  return Math.round(clamp(actualAge + delta + fineTune, minAge, maxAge));
}

export function classifyPostureAgeGroup(actualAge) {
  if (actualAge == null || Number.isNaN(Number(actualAge))) return 'unknown';
  const age = Number(actualAge);
  if (age < 7) return 'under_7_screening_limited';
  if (age < 19) return 'youth_growth';
  return 'adult';
}

export function generatePostureComment({ score, bodyAge, actualAge, ruleFindings = [], cog = null, asymmetry = null } = {}) {
  const grade = score >= 85 ? '우수' : score >= 70 ? '양호' : score >= 55 ? '관리 필요' : '집중 관리';
  const messages = [`통합 체형 점수는 ${score}점으로 ${grade} 단계입니다.`];
  if (bodyAge && actualAge) {
    const diff = bodyAge - actualAge;
    messages.push(diff <= 0 ? `체형 나이는 실제 나이보다 ${Math.abs(diff)}세 젊게 추정됩니다.` : `체형 나이는 실제 나이보다 ${diff}세 높게 추정됩니다.`);
  }
  if (asymmetry?.averageAsi != null && asymmetry.averageAsi >= 10) {
    messages.push(`좌우 비대칭 지수 ${asymmetry.averageAsi}%로 편측 보상 패턴을 확인하세요.`);
  }
  const cogOffsetForComment = Math.abs(cog?.balanceOffsetPct ?? cog?.offsetPct ?? 0);
  if (cog?.available && cogOffsetForComment >= 18) {
    messages.push(`무게중심이 ${cogOffsetForComment}% ${cog.direction === 'right' ? '우측' : '좌측'}으로 편향되어 체중지지 균형 훈련이 권장됩니다.`);
  }
  const highRisk = ruleFindings.filter((item) => item.status === POSTURE_STATUS.RISK);
  if (highRisk.length) messages.push(`${highRisk.map((item) => item.label).join(', ')} 항목은 우선 교정 대상으로 분류됩니다.`);
  return messages.join(' ');
}

export function analyzePostureFromLandmarks(landmarks, { heightCm = null, actualAge = null } = {}) {
  const reliability = calculateReliabilityProfile(landmarks);
  const asymmetry = calculateAsymmetryProfile(landmarks);
  const rotations = estimate3DRotation(landmarks);
  const rules = evaluatePostureRules(landmarks);
  const deviationsMm = calculatePosturalDeviationMm(landmarks, heightCm);
  const cog = calculateCenterOfGravity(landmarks);
  const frontal = analyzeFrontalAlignment(landmarks, { heightCm });
  const sagittal = analyzeSagittalAlignment(landmarks, { heightCm });
  const scoreResult = calculatePostureScore({
    deviationsMm,
    asi: asymmetry.averageAsi,
    ruleFindings: rules.findings,
    cog,
  });
  const bodyAge = mapScoreToBodyAge(scoreResult.score, actualAge);
  const summaryComment = generatePostureComment({
    score: scoreResult.score,
    bodyAge,
    actualAge,
    ruleFindings: rules.findings,
    cog,
    asymmetry,
  });

  return {
    score: scoreResult.score,
    scoreComponents: scoreResult.components,
    bodyAge,
    reliability,
    asymmetry,
    rotations,
    frontal,
    sagittal,
    rules,
    deviationsMm,
    cog,
    summaryComment,
    status: worstStatus([rules.status, cog.status, scoreResult.score < 55 ? POSTURE_STATUS.RISK : scoreResult.score < 70 ? POSTURE_STATUS.CAUTION : POSTURE_STATUS.NORMAL]),
  };
}

export function calculateReliabilityProfile(landmarks, threshold = 0.75) {
  const required = [
    LM.LEFT_SHOULDER,
    LM.RIGHT_SHOULDER,
    LM.LEFT_HIP,
    LM.RIGHT_HIP,
    LM.LEFT_KNEE,
    LM.RIGHT_KNEE,
    LM.LEFT_ANKLE,
    LM.RIGHT_ANKLE,
  ];
  const validCount = required.filter((index) => isVisible(landmarks?.[index], threshold)).length;
  const averageVisibility = round(meanDefined(required.map((index) => landmarks?.[index]?.visibility ?? 0)), 2);
  return {
    threshold,
    requiredCount: required.length,
    validCount,
    averageVisibility,
    pelvisReliable: isPelvisDataReliable(landmarks, Math.max(0.75, threshold)),
    fullBodyReliable: validCount === required.length,
    reliableLandmarks: getReliableLandmarks(landmarks, threshold),
  };
}

function meanDefined(values) {
  const valid = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function worstStatus(statuses) {
  if (statuses.includes(POSTURE_STATUS.RISK)) return POSTURE_STATUS.RISK;
  if (statuses.includes(POSTURE_STATUS.CAUTION)) return POSTURE_STATUS.CAUTION;
  return POSTURE_STATUS.NORMAL;
}

function higherSideFromY(left, right) {
  if (!left || !right) return null;
  if (Math.abs(left.y - right.y) < 0.002) return 'level';
  return left.y < right.y ? 'left' : 'right';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
