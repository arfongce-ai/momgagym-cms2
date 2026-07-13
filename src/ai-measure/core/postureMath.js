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

  // ── 측정 정직성 가드: 측면(발목 겹침)에서 CoG/BoS 계산 거부 ──
  const shoulderWidthForBos = distance2d(leftShoulder, rightShoulder);
  const bosToShoulder = shoulderWidthForBos > EPS ? bosWidth / shoulderWidthForBos : 0;
  if (bosToShoulder < 0.35) {
    return {
      available: false,
      status: POSTURE_STATUS.NORMAL,
      message: '측면 자세에서는 무게중심(CoG)·지지기반(BoS) 균형을 계산하지 않습니다. 정면 또는 후면에서 측정해 주세요.',
    };
  }

  const cogTop = shoulderMid;
  const cogBottom = pelvisMid;
  const footY = footMid.y;
  const dy = cogBottom.y - cogTop.y;
  const slopeX = Math.abs(dy) < EPS ? 0 : (cogBottom.x - cogTop.x) / dy;
  const cogAtBosX = cogTop.x + slopeX * (footY - cogTop.y);
  const offsetRatioOfHalfBos = (cogAtBosX - footMid.x) / (bosWidth / 2);
  const offsetPctRaw = round(offsetRatioOfHalfBos * 100, 1);
  if (!Number.isFinite(offsetPctRaw) || Math.abs(offsetPctRaw) > 120) {
    return {
      available: false,
      status: POSTURE_STATUS.NORMAL,
      message: '무게중심 계산값이 정상 범위를 벗어나 신뢰할 수 없습니다(랜드마크 불안정). 자세·조명을 조정해 다시 측정해 주세요.',
    };
  }
  const offsetPct = offsetPctRaw;
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
    messages.push(`좌우 비대칭 지수 ${asymmetry.averageAsi}%로, 몸 한쪽으로 부담이 쏠리고 있는지 확인이 필요합니다.`);
  }
  const cogOffsetForComment = Math.abs(cog?.balanceOffsetPct ?? cog?.offsetPct ?? 0);
  if (cog?.available && cogOffsetForComment >= 18) {
    messages.push(`무게중심이 ${cogOffsetForComment}% ${cog.direction === 'right' ? '우측' : '좌측'}으로 쏠려 있어, 양발에 체중을 고르게 싣는 연습이 도움이 됩니다.`);
  }
  const highRisk = ruleFindings.filter((item) => item.status === POSTURE_STATUS.RISK);
  if (highRisk.length) messages.push(`${highRisk.map((item) => item.label).join(', ')} 항목을 가장 먼저 교정하는 것이 좋습니다.`);
  return messages.join(' ');
}

// 머리 yaw 프록시(정면): 코가 양 눈(없으면 양 귀) 중심에서 좌우로 치우친 정도를
// 각도로 환산. 부호 규약은 estimate3DRotation 의 어깨/골반 yaw 와 통일한다:
//   사람이 왼쪽으로 회전 → 음수(−), 오른쪽으로 회전 → 양수(+).
//   머리가 왼쪽으로 돌면 코는 화면 오른쪽(+x)으로 가므로, ratio(+)를 음수로 매핑.
// 정밀 각도 아님(추정).
export function estimateHeadYawProxy(landmarks) {
  const nose = getLandmark(landmarks, LM.NOSE, 0.3);
  const lEye = getLandmark(landmarks, LM.LEFT_EYE, 0.3);
  const rEye = getLandmark(landmarks, LM.RIGHT_EYE, 0.3);
  const lEar = getLandmark(landmarks, LM.LEFT_EAR, 0.3);
  const rEar = getLandmark(landmarks, LM.RIGHT_EAR, 0.3);
  const pair = (lEye && rEye) ? [lEye, rEye] : (lEar && rEar) ? [lEar, rEar] : null;
  if (!nose || !pair) return null;
  const [l, r] = pair;
  const midX = (l.x + r.x) / 2;
  const span = Math.abs(r.x - l.x);
  if (span < EPS) return null;
  const ratio = (nose.x - midX) / (span / 2); // 코가 오른쪽이면 +
  // 코 오른쪽(+) = 머리 왼쪽회전 → 음수로 매핑(부호 반전). ±30° 범위(경험적).
  return round(-clamp(ratio, -1.5, 1.5) * 30, 1);
}

// 하체 yaw 프록시(정면): 양 무릎/발의 전후 깊이차(z)로 하체 회전 추정.
// 한쪽 무릎이 카메라에 가까우면(z 작음) 그쪽이 앞으로 → 회전. 추정값.
export function estimateLowerYawProxy(landmarks) {
  const lKnee = getLandmark(landmarks, LM.LEFT_KNEE, 0.3);
  const rKnee = getLandmark(landmarks, LM.RIGHT_KNEE, 0.3);
  const lAnkle = getLandmark(landmarks, LM.LEFT_ANKLE, 0.3);
  const rAnkle = getLandmark(landmarks, LM.RIGHT_ANKLE, 0.3);
  const knee = (lKnee && rKnee) ? (rKnee.z ?? 0) - (lKnee.z ?? 0) : null;
  const ankle = (lAnkle && rAnkle) ? (rAnkle.z ?? 0) - (lAnkle.z ?? 0) : null;
  const dz = meanDefined([knee, ankle]);
  if (dz == null) return null;
  // z 차이(right.z - left.z)를 각도로 매핑. pairYawDegrees 와 동일 공식이라
  // 부호 규약도 동일: 사람 왼쪽회전(오른쪽이 앞, z작음) → 음수(−), 오른쪽회전 → 양수(+).
  return round(clamp(dz * 120, -30, 30), 1);
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
  // 회전 종합 분석용 프록시 (정면 기준): 머리 yaw, 하체 yaw.
  const headYawProxyDeg = estimateHeadYawProxy(landmarks);
  const lowerYawProxyDeg = estimateLowerYawProxy(landmarks);
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
    headYawProxyDeg,
    lowerYawProxyDeg,
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

// ════════════════════════════════════════════════════════════════════════
//  촬영 방향(면) 판별 — 자세·체형 자동 촬영용
//  반환: { view: 'front'|'back'|'left'|'right'|'unknown', confidence, shoulderRatio, faceVis }
//
//  신호(모두 카메라 거리와 무관하게 정규화):
//   1) 어깨폭/몸통높이 비(shoulderRatio):
//        넓다(≥ frontMin) → 정면/후면(어깨가 카메라를 향해 펼쳐짐)
//        좁다(≤ sideMax)  → 좌/우 측면(어깨가 겹쳐 보임)
//   2) 정면 vs 후면: 환경(후면) 카메라 기준, 사람이 정면을 보면
//        왼어깨(LM11)가 화면 오른쪽(x 큼) → (L.x - R.x) > 0
//        뒤돌면 부호가 뒤집힌다 → (L.x - R.x) < 0
//        + 얼굴 랜드마크(코·눈) 가시성: 정면 높음, 후면 낮음 (보조 확인)
//   3) 좌 vs 우 측면: 카메라를 향한 쪽(코가 가리키는 x 방향)으로 판별.
//        코가 어깨중심보다 화면 오른쪽 → 사람의 '왼쪽'이 카메라를 향함 → 좌측면
//        (정규화: 사람 기준 면 라벨. VIEW_STEPS 의 left/right 와 일치하도록 보정)
// ════════════════════════════════════════════════════════════════════════
export const POSTURE_VIEW_TUNING = Object.freeze({
  shoulderFrontMin: 0.16, // 어깨폭/몸통높이 비 이상 → 정면/후면 후보
  shoulderSideMax: 0.12,  // 이하 → 측면 후보 (사이 구간은 약한 신뢰도)
  faceVisFront: 0.55,     // 코·눈 가시성 이상 → 정면 확정
  faceVisBack: 0.30,      // 코·눈 가시성 이하 → 후면 확정 (그 사이는 어깨 부호로 보조)
});

export function detectPostureView(landmarks, tuning = POSTURE_VIEW_TUNING) {
  const empty = { view: 'unknown', confidence: 0, shoulderRatio: null, faceVis: null };
  if (!Array.isArray(landmarks)) return empty;
  const lS = getLandmark(landmarks, LM.LEFT_SHOULDER, 0.2);
  const rS = getLandmark(landmarks, LM.RIGHT_SHOULDER, 0.2);
  const lH = getLandmark(landmarks, LM.LEFT_HIP, 0.2);
  const rH = getLandmark(landmarks, LM.RIGHT_HIP, 0.2);
  if (!lS || !rS || !lH || !rH) return empty;

  const shoulderMid = midpoint(lS, rS);
  const hipMid = midpoint(lH, rH);
  const trunkH = Math.abs((hipMid?.y ?? 0) - (shoulderMid?.y ?? 0));
  if (trunkH < EPS) return empty;

  // 1) 어깨폭(수평 성분) / 몸통높이
  const shoulderW = Math.abs(rS.x - lS.x);
  const shoulderRatio = round(shoulderW / trunkH, 3);

  // 1-b) 측면 강도(side strength) — 측면일수록 두 어깨의 '깊이(z) 차'가 크고,
  //   한쪽 귀만 잘 보이며, 코가 (좁은) 어깨 중심에서 옆으로 크게 벗어난다.
  //   어깨폭이 애매(0.10~0.16)해도 이 신호들로 측면을 잡는다.
  //   ▸ 어깨 z 분리: |lS.z − rS.z| 를 몸통높이로 정규화. 측면이면 큼.
  //   ▸ 귀 비대칭: 좌/우 귀 visibility 차가 크면 한쪽 면(측면) 가능성↑.
  //   ▸ 코 수평 이탈(주신호·z 무관): 측면이면 코가 어깨중심에서 옆으로 멀어진다.
  //     z 좌표(단안 깊이)는 노이즈가 커서, 이 2D 신호를 함께 써 측면 인식률을 높인다.
  const shoulderZsep = Math.abs((lS.z ?? 0) - (rS.z ?? 0)) / (trunkH || 1);
  const lEarV = landmarks[LM.LEFT_EAR]?.visibility ?? 0.5;
  const rEarV = landmarks[LM.RIGHT_EAR]?.visibility ?? 0.5;
  const earAsym = Math.abs(lEarV - rEarV);
  // 코 수평 이탈: 어깨중심 대비 코의 x 편차를 몸통높이로 정규화(거리 무관).
  const noseLm = landmarks[LM.NOSE];
  const noseOffset = (noseLm && (noseLm.visibility == null || noseLm.visibility > 0.3))
    ? Math.abs((noseLm.x ?? shoulderMid.x) - shoulderMid.x) / (trunkH || 1)
    : 0;
  // 측면 강도: z분리 + 코 수평이탈(둘 다 주신호) + 귀비대칭(보조). 0~1로 클램프.
  const sideStrength = clamp(
    clamp(shoulderZsep / 0.55, 0, 1) * 0.5
    + clamp(noseOffset / 0.28, 0, 1) * 0.35
    + clamp(earAsym / 0.6, 0, 1) * 0.15,
    0, 1,
  );

  // 얼굴 가시성 (코+양눈+양귀 평균) — 참고/표시용
  const faceIdx = [LM.NOSE, LM.LEFT_EYE, LM.RIGHT_EYE, LM.LEFT_EAR, LM.RIGHT_EAR];
  const visVals = faceIdx
    .map((i) => landmarks[i])
    .filter(Boolean)
    .map((p) => (p.visibility == null ? 0.5 : p.visibility));
  const faceVis = visVals.length ? round(visVals.reduce((a, b) => a + b, 0) / visVals.length, 3) : 0;

  // ════════════════════════════════════════════════════════════════════
  //  정면/후면 강건 판별 — 다중 신호 투표
  //
  //  ※ visibility 는 신뢰 불가: BlazePose 는 뒤통수에서도 코·눈 visibility 를
  //    높게 출력한다(머리 위치 추정). 그래서 visibility 기반 판별은 실패한다.
  //
  //  핵심 신호 = '얼굴 좌우 배치'와 '어깨 좌우 배치'의 부호 비교.
  //   ※ 좌표계: 이 앱 카메라는 후면(environment) 렌즈를 '미러링 없이' 사용한다.
  //     셀카(전면·미러)와 좌우가 반대 → 부호 규칙도 반대다.
  //     정면(카메라 바라봄): 해부학 LEFT 가 화면 오른쪽(x 큼) → L.x − R.x > 0
  //     후면(등 보임): 좌우 반전 → L.x − R.x < 0
  //   보조 신호 = 코 z-깊이(정면이면 코가 귀보다 앞, z 작음). 좌우반전과 무관해 유지.
  // ════════════════════════════════════════════════════════════════════
  const lEye = landmarks[LM.LEFT_EYE];
  const rEye = landmarks[LM.RIGHT_EYE];
  const lEar = landmarks[LM.LEFT_EAR];
  const rEar = landmarks[LM.RIGHT_EAR];
  const nose = landmarks[LM.NOSE];

  let frontVotes = 0;
  let backVotes = 0;

  // 신호 1: 눈 좌우 부호 (미러링 없는 후면 카메라 → 정면이면 L_eye.x > R_eye.x → 양수)
  if (lEye && rEye && Math.abs(lEye.x - rEye.x) > 0.012) {
    if (lEye.x - rEye.x > 0) frontVotes += 2; else backVotes += 2;
  }
  // 신호 2: 귀 좌우 부호 (정면이면 L_ear.x > R_ear.x → 양수)
  if (lEar && rEar && Math.abs(lEar.x - rEar.x) > 0.012) {
    if (lEar.x - rEar.x > 0) frontVotes += 2; else backVotes += 2;
  }
  // 신호 3: 코 z-깊이 vs 귀 평균 z (정면이면 코가 더 앞 → z 작음)
  if (nose && lEar && rEar) {
    const earZ = ((lEar.z ?? 0) + (rEar.z ?? 0)) / 2;
    const dz = (nose.z ?? 0) - earZ;
    if (Math.abs(dz) > 0.02) {
      if (dz < 0) frontVotes += 1; else backVotes += 1;
    }
  }
  // 신호 4(약): 어깨 좌우 부호 (미러링 없는 후면 카메라: 정면이면 lS.x − rS.x > 0)
  const signLR = lS.x - rS.x; // 미러링 없는 후면 카메라: 정면이면 +, 후면이면 −
  if (Math.abs(signLR) > 0.02) {
    if (signLR > 0) frontVotes += 1; else backVotes += 1;
  }

  const faceFacing = frontVotes === 0 && backVotes === 0
    ? null
    : frontVotes >= backVotes ? 'front' : 'back';
  const facingMargin = Math.abs(frontVotes - backVotes);
  const totalVotes = frontVotes + backVotes;

  // 측면 좌/우 판정 헬퍼 (코 위치 우선, 미검출 시 어깨 z-깊이)
  const resolveSide = () => {
    const nose = getLandmark(landmarks, LM.NOSE, 0.15);
    if (nose && shoulderMid) {
      // 코가 화면 오른쪽(x 큼) → 사람의 왼쪽 면이 카메라 → '좌측면(left)'
      return nose.x > shoulderMid.x ? 'left' : 'right';
    }
    const lz = lS.z ?? 0, rz = rS.z ?? 0;
    return lz < rz ? 'left' : 'right';
  };

  // ── 측면 우선 판정 ──
  //  어깨폭이 좁거나(고전 기준), 어깨폭이 애매해도 '측면 강도'가 충분히 높으면
  //  측면으로 확정한다. (정면/후면으로 오인하던 프로필 케이스 해결)
  const strongSide = sideStrength >= 0.40;
  if (shoulderRatio <= tuning.shoulderSideMax || strongSide) {
    const view = resolveSide();
    // 신뢰도: 어깨폭 기반 + 측면강도 중 큰 값
    const widthSideConf = shoulderRatio <= tuning.shoulderSideMax
      ? clamp((tuning.shoulderSideMax - shoulderRatio) / 0.08, 0, 1) : 0;
    const sideConf = round(0.5 + 0.5 * Math.max(widthSideConf, sideStrength), 3);
    return { view, confidence: sideConf, shoulderRatio, faceVis, sideStrength: round(sideStrength, 3) };
  }

  // ── 정면/후면 (어깨 넓음) ──
  if (shoulderRatio >= tuning.shoulderFrontMin) {
    const widthConf = clamp((shoulderRatio - tuning.shoulderFrontMin) / 0.1, 0, 1);
    if (faceFacing) {
      // 투표 마진이 클수록 신뢰도 높음
      const voteConf = totalVotes > 0 ? clamp(facingMargin / totalVotes, 0, 1) : 0;
      const conf = round(0.5 + 0.5 * Math.max(widthConf, voteConf), 3);
      return { view: faceFacing, confidence: conf, shoulderRatio, faceVis, frontVotes, backVotes };
    }
    // 신호가 전혀 없을 때만 어깨 부호로 최후 판정 (정면이면 signLR > 0)
    const view = signLR > 0 ? 'front' : 'back';
    return { view, confidence: 0.35, shoulderRatio, faceVis, frontVotes, backVotes };
  }

  // ── 모호 구간(어깨폭 중간, 측면강도도 약함) ──
  //  애매하면 측면강도가 조금이라도 우세할 때 측면으로 기운다(측면 미인식 완화).
  if (sideStrength >= 0.24) {
    const view = resolveSide();
    return { view, confidence: round(0.4 + 0.3 * sideStrength, 3), shoulderRatio, faceVis, sideStrength: round(sideStrength, 3) };
  }
  return { view: 'unknown', confidence: 0.2, shoulderRatio, faceVis };
}

// 안정 판정용 누적기: 최근 N프레임 다수결 + 목표 면 연속 일치 카운트.
export class PostureViewVoter {
  constructor({ window = 12 } = {}) {
    this.window = window;
    this.buf = [];
  }
  push(view) {
    if (!view) return;
    this.buf.push(view);
    if (this.buf.length > this.window) this.buf.shift();
  }
  reset() { this.buf = []; }
  // 현재 다수결 면과 그 비율
  majority() {
    if (!this.buf.length) return { view: 'unknown', ratio: 0 };
    const counts = {};
    this.buf.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
    let best = 'unknown', bestN = 0;
    Object.entries(counts).forEach(([v, n]) => { if (n > bestN) { best = v; bestN = n; } });
    return { view: best, ratio: round(bestN / this.buf.length, 2) };
  }
  // 목표 면이 충분히 안정적으로(비율·표본수) 잡혔는지
  isStable(target, { minRatio = 0.7, minFrames = 8 } = {}) {
    if (this.buf.length < minFrames) return false;
    const { view, ratio } = this.majority();
    return view === target && ratio >= minRatio;
  }
}

// 후면(back) 측정 시 코·눈 랜드마크는 BlazePose 가 뒤통수에서 '추정'한 값이라
// 신뢰할 수 없다. 분석/저장 전에 강제로 제거(visibility 0)해 잘못된 거북목·
// 머리회전 수치 산출을 막는다(측정 정직성). 귀(7,8)는 유지.
export function sanitizeBackLandmarks(landmarks) {
  if (!Array.isArray(landmarks)) return landmarks;
  const FACE_FRONT_IDX = new Set([0, 1, 2, 3, 4, 5, 6, 9, 10]); // 코·양눈(inner/outer)·입
  return landmarks.map((p, i) => {
    if (!p) return p;
    if (FACE_FRONT_IDX.has(i)) return { ...p, visibility: 0, presence: 0, _removed: true };
    return p;
  });
}
