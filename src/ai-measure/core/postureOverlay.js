// postureOverlay.js
// 측정 분석 결과(analysis)에서 '문제 위치 마커'를 산출한다. 캡처한 사진 위에
// 빨간 원/화살표로 표시하기 위한 정규화 좌표(0~1) 기반 마커 목록을 만든다.
//
// 측정 정직성:
//  • 정상 범위(주의/위험 아님)는 마커를 만들지 않는다(과잉 표시 금지).
//  • 판정에 필요한 랜드마크가 없으면 그 항목은 건너뛴다.
//  • 측면/정면 등 해당 면에서 의미 있는 항목만 표시한다.

import { POSE_LANDMARKS as LM } from './postureMath';

// 임계값(측정 정직성: 너무 민감하지 않게 보수적으로)
const TH = {
  shoulderDiffMm: 8,    // 어깨 좌우 높이차
  pelvisDiffMm: 8,      // 골반 좌우 높이차
  headTiltDeg: 5,       // 머리 기울기(정면/후면)
  neckTiltDeg: 12,      // 목 기울기(측면)
  forwardHeadMm: 40,    // 거북목(전방머리)
  kyphosisDeg: 10,      // 굽은등(귀-어깨-골반 각의 180° 편위)
  kneeExtDeg: 5,        // 무릎 과신전(180° 초과)
};

export const POSTURE_SKELETON_CONNECTIONS = [
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
  [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP],
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.LEFT_KNEE],
  [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE],
  [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
  [LM.LEFT_ANKLE, LM.LEFT_HEEL],
  [LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX],
  [LM.RIGHT_ANKLE, LM.RIGHT_HEEL],
  [LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX],
];

const pt = (landmarks, idx) => {
  const p = landmarks?.[idx];
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { x: p.x, y: p.y };
};
const mid = (a, b) => (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a || b || null);

// severity: 'caution' | 'risk'
function sev(value, caution, risk) {
  const v = Math.abs(value ?? 0);
  if (v >= risk) return 'risk';
  if (v >= caution) return 'caution';
  return null;
}

// analysis + landmarks + viewKey → 마커 배열
// 마커: { x, y, severity, type:'circle'|'arrow', label, dir? }
//  x,y 는 정규화(0~1). arrow 는 dir(방향 라디안 또는 'left'/'right'/'up'/'down')로 표시.
export function buildPostureMarkers(analysis, landmarks, viewKey) {
  if (!analysis || !Array.isArray(landmarks)) return [];
  const markers = [];
  const frontal = analysis.frontal || {};
  const sagittal = analysis.sagittal || {};
  const isFrontBack = viewKey === 'front' || viewKey === 'back';
  const isSide = viewKey === 'left' || viewKey === 'right';

  const lS = pt(landmarks, LM.LEFT_SHOULDER);
  const rS = pt(landmarks, LM.RIGHT_SHOULDER);
  const lH = pt(landmarks, LM.LEFT_HIP);
  const rH = pt(landmarks, LM.RIGHT_HIP);
  const lEar = pt(landmarks, LM.LEFT_EAR);
  const rEar = pt(landmarks, LM.RIGHT_EAR);
  const nose = pt(landmarks, LM.NOSE);
  const head = mid(lEar, rEar) || nose;

  // ── 정면/후면 항목 ──
  if (isFrontBack) {
    // 어깨 좌우 높이차
    const sd = frontal.shoulderHeightDiffMm;
    const sdSev = sev(sd, TH.shoulderDiffMm, TH.shoulderDiffMm * 2);
    if (sdSev && lS && rS) {
      // 높은 쪽 어깨에 원
      const higher = (lS.y <= rS.y) ? lS : rS;
      markers.push({ x: higher.x, y: higher.y, severity: sdSev, type: 'circle',
        label: `어깨 높이차 ${Math.abs(Math.round(sd))}mm` });
    }
    // 골반 좌우 높이차
    const pd = frontal.pelvisHeightDiffMm;
    const pdSev = sev(pd, TH.pelvisDiffMm, TH.pelvisDiffMm * 2);
    if (pdSev && lH && rH) {
      const higher = (lH.y <= rH.y) ? lH : rH;
      markers.push({ x: higher.x, y: higher.y, severity: pdSev, type: 'circle',
        label: `골반 높이차 ${Math.abs(Math.round(pd))}mm` });
    }
    // 머리 기울기(정면): 좌우 귀의 y 차이로 추정
    if (lEar && rEar && head) {
      const tiltDeg = Math.atan2((rEar.y - lEar.y), Math.abs(rEar.x - lEar.x) || 1e-6) * 180 / Math.PI;
      const tSev = sev(tiltDeg, TH.headTiltDeg, TH.headTiltDeg * 2);
      if (tSev) {
        markers.push({ x: head.x, y: head.y, severity: tSev, type: 'arrow',
          dir: tiltDeg > 0 ? 'right' : 'left', label: `머리 기울기 ${Math.abs(Math.round(tiltDeg))}°` });
      }
    }
  }

  // ── 측면 항목 ──
  if (isSide) {
    // ── 측면 항목 ──
    // 거북목(전방 머리) — 라벨은 머리 높이
    const fh = sagittal.forwardHeadMm;
    const fhSev = sev(fh, TH.forwardHeadMm, TH.forwardHeadMm * 2);
    if (fhSev && head) {
      markers.push({ x: head.x, y: head.y, severity: fhSev, type: 'arrow', dir: 'right',
        label: `거북목 ${Math.abs(Math.round(fh))}mm`, labelDy: 0 });
    }
    // 굽은등(귀-어깨-골반 각의 180° 편위)
    const ky = sagittal.kyphosisProxyDeg;
    if (ky != null) {
      const dev = Math.abs(180 - ky);
      const kSev = sev(dev, TH.kyphosisDeg, TH.kyphosisDeg * 2);
      const shoulder = mid(lS, rS);
      if (kSev && shoulder) {
        markers.push({ x: shoulder.x, y: shoulder.y, severity: kSev, type: 'circle',
          label: `굽은등 편위 ${Math.round(dev)}°` });
      }
    }
    // 무릎 과신전
    const ke = sagittal.kneeExtensionProxyDeg;
    if (ke != null && ke > 180) {
      const dev = ke - 180;
      const keSev = sev(dev, TH.kneeExtDeg, TH.kneeExtDeg * 2);
      const knee = pt(landmarks, LM.LEFT_KNEE) || pt(landmarks, LM.RIGHT_KNEE);
      if (keSev && knee) {
        markers.push({ x: knee.x, y: knee.y, severity: keSev, type: 'circle',
          label: `무릎 과신전 ${Math.round(dev)}°` });
      }
    }
    // 목 기울기(측면): 귀-어깨를 잇는 선이 '수직'에서 얼마나 기울었는지(앞으로 기운 각).
    //  측면에서 머리가 앞으로 나오면 이 선이 수직에서 벗어난다. 거북목(거리, mm)과
    //  별개로 '각도'로 직관 표시한다.
    const earForNeck = lEar || rEar;
    const shoulderForNeck = mid(lS, rS) || lS || rS;
    if (earForNeck && shoulderForNeck) {
      const dx = earForNeck.x - shoulderForNeck.x;
      const dy = earForNeck.y - shoulderForNeck.y; // 귀가 어깨보다 위 → dy<0
      // 수직선(위쪽) 대비 기울기 각. |dx|가 클수록(머리 전방) 각 커짐.
      const neckTiltDeg = Math.abs(Math.atan2(dx, -dy) * 180 / Math.PI);
      const ntSev = sev(neckTiltDeg, TH.neckTiltDeg, TH.neckTiltDeg * 2);
      if (ntSev) {
        // 귀 위치(머리)에 화살표로 표시. 라벨은 거북목 라벨과 겹치지 않게 위로 올림.
        markers.push({ x: earForNeck.x, y: earForNeck.y, severity: ntSev, type: 'arrow',
          dir: dx >= 0 ? 'right' : 'left', label: `목 기울기 ${Math.round(neckTiltDeg)}°`, labelDy: -0.045 });
      }
    }
  }

  return markers;
}

function drawArrow(ctx, fromX, fromY, toX, toY, color, scale) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, 3 * scale);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  const ang = Math.atan2(toY - fromY, toX - fromX);
  const head = Math.max(7, 11 * scale);
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - head * Math.cos(ang - Math.PI / 6), toY - head * Math.sin(ang - Math.PI / 6));
  ctx.lineTo(toX - head * Math.cos(ang + Math.PI / 6), toY - head * Math.sin(ang + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawLabel(ctx, text, x, y, color, scale, width, height) {
  if (!text) return;
  ctx.save();
  const fontSize = Math.max(12, Math.round(14 * scale));
  const padX = 6 * scale;
  const padY = 4 * scale;
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  const textWidth = ctx.measureText(text).width;
  const boxW = textWidth + padX * 2;
  const boxH = fontSize + padY * 2;
  const boxX = Math.max(4, Math.min(width - boxW - 4, x));
  const boxY = Math.max(4, Math.min(height - boxH - 4, y - boxH + fontSize * 0.2));
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.fillStyle = color;
  ctx.fillText(text, boxX + padX, boxY + padY + fontSize * 0.78);
  ctx.restore();
}

function markerColor(marker) {
  return marker?.severity === 'risk' ? 'rgba(248,113,113,0.95)' : 'rgba(251,146,60,0.95)';
}

function arrowStart(marker, x, y, length) {
  switch (marker.dir) {
    case 'left':
      return { x: x + length, y };
    case 'right':
      return { x: x - length, y };
    case 'up':
      return { x, y: y + length };
    case 'down':
      return { x, y: y - length };
    default:
      return { x: x - length, y };
  }
}

export function drawPostureSnapshotOverlay(ctx, landmarks, analysis, viewKey, width, height) {
  if (!ctx || !Array.isArray(landmarks) || !width || !height) return;
  const px = (p) => ({ x: p.x * width, y: p.y * height });
  const visible = (p, threshold = 0.3) => (
    !!p
    && Number.isFinite(p.x)
    && Number.isFinite(p.y)
    && (p.visibility == null || p.visibility >= threshold)
  );
  const scale = width / 600;

  ctx.save();
  ctx.lineWidth = Math.max(2, width / 180);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(52,211,153,0.92)';
  POSTURE_SKELETON_CONNECTIONS.forEach(([a, b]) => {
    const pa = landmarks[a];
    const pb = landmarks[b];
    if (!visible(pa) || !visible(pb)) return;
    const A = px(pa);
    const B = px(pb);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
  });

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  const r = Math.max(3, width / 150);
  landmarks.forEach((point) => {
    if (!visible(point)) return;
    const P = px(point);
    ctx.beginPath();
    ctx.arc(P.x, P.y, r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  const markers = buildPostureMarkers(analysis, landmarks, viewKey);
  markers.forEach((marker) => {
    if (!Number.isFinite(marker.x) || !Number.isFinite(marker.y)) return;
    const x = marker.x * width;
    const y = marker.y * height;
    const color = markerColor(marker);
    const radius = Math.max(18, 26 * scale);

    if (marker.type === 'circle') {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, 3 * scale);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (marker.type === 'arrow') {
      const length = Math.max(26, 38 * scale);
      const from = arrowStart(marker, x, y, length);
      drawArrow(ctx, from.x, from.y, x, y, color, scale);
    }

    const dy = Number.isFinite(marker.labelDy) ? marker.labelDy * height : -6 * scale;
    drawLabel(ctx, marker.label, x + radius + 6 * scale, y + dy, color, scale, width, height);
  });
}

export const OVERLAY_THRESHOLDS = TH;
