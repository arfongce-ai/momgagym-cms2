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
    // 거북목(전방 머리)
    const fh = sagittal.forwardHeadMm;
    const fhSev = sev(fh, TH.forwardHeadMm, TH.forwardHeadMm * 2);
    if (fhSev && head) {
      markers.push({ x: head.x, y: head.y, severity: fhSev, type: 'arrow', dir: 'right',
        label: `거북목 ${Math.abs(Math.round(fh))}mm` });
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
    // 목 기울기(측면): 귀-어깨 수직선 대비 기울기 — forwardHead 로 대체되므로 생략 가능
  }

  return markers;
}

export const OVERLAY_THRESHOLDS = TH;
