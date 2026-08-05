// recordAspect.js — AI 측정 녹화·미리보기 비율 표준(전 모듈 공통)
// ════════════════════════════════════════════════════════════════════════
//  요구사항: 측정마다 화면 크기가 제각각 → 인스타그램에 올리기 좋은 비율로 통일.
//   · 기본 3:4 세로(피트니스 전신 촬영에 적합), 사용자가 1:1 정사각으로 전환 가능.
//   · ROM·보행·RSI·1RM·VBT·역도 등 모든 모듈이 동일한 출력 해상도/비율을 쓴다.
//   · 원본 카메라 해상도(videoWidth×videoHeight)로 바로 녹화하면 기기마다 달라지므로,
//     반드시 고정 캔버스(OUTPUT_SIZE)에 drawCover(중앙 크롭)로 합성해 통일한다.
// ════════════════════════════════════════════════════════════════════════

export const ASPECT_KEYS = ['3/4', '1/1'];
export const DEFAULT_ASPECT = '3/4';

// 표준 출력 해상도(px) — 인스타 권장 화질. 3:4 = 1080×1440, 1:1 = 1080×1080.
export const OUTPUT_SIZE = {
  '3/4': { width: 1080, height: 1440 },
  '1/1': { width: 1080, height: 1080 },
};

// 유효한 비율 키로 정규화(잘못된 값이면 기본 3:4).
export function normalizeAspect(aspect) {
  return ASPECT_KEYS.includes(aspect) ? aspect : DEFAULT_ASPECT;
}

// 출력 캔버스 크기(px) 반환.
export function outputSize(aspect) {
  return OUTPUT_SIZE[normalizeAspect(aspect)] || OUTPUT_SIZE[DEFAULT_ASPECT];
}

// CSS aspect-ratio 문자열('3 / 4' | '1 / 1') — 미리보기 프레임용.
export function aspectCss(aspect) {
  return normalizeAspect(aspect).replace('/', ' / ');
}

// 짧은 라벨('3:4' | '1:1') — 토글 버튼 표시용.
export function aspectLabel(aspect) {
  return normalizeAspect(aspect) === '1/1' ? '1:1' : '3:4';
}

// 90도 단위로 정규화(그 외 값은 0으로 취급).
function normalizeRotation(deg) {
  const r = (((Math.round((Number(deg) || 0) / 90) * 90) % 360) + 360) % 360;
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

// ── 랜드마크 좌표 자체의 회전 보정 ──
// [2026-08-02] 원인: 카메라 원본 영상이 회전된 채로 들어오는 기종(키오스크 등)에서는
// usePoseEngine이 그 원본 프레임에 그대로 포즈 인식을 돌리므로, 반환되는 랜드마크의
// x/y 축이 실제 좌우/상하와 어긋난다. drawVideoCover 등은 "화면에 그릴 때"만 보정할
// 뿐 랜드마크 자체는 그대로라, 거북목(ear.x-shoulder.x)이나 기울기(atan2로 수직 기준
// 비교)처럼 "x=좌우, y=상하"를 가정하는 판정 계산이 축이 뒤바뀐 채로 잘못된 값을
// 낸다(예: 정상 범위인 목 기울기가 88°로 나옴 — 90도 회전으로 수직↔수평이 뒤바뀐
// 전형적 증상). 3점 각도(angleDeg)처럼 축에 무관한 계산은 원래도 안전하지만, 어느
// 계산이 안전한지 모듈마다 개별 판단하는 건 누락 위험이 커서, 판정에 들어가기 전에
// 랜드마크 좌표 자체를 항상 "똑바로 선 좌표계"로 통일해 넘긴다.
// rotationDeg는 useCameraRotation()과 동일한 값(카메라 원본을 시계방향으로 이만큼
// 돌려야 바로 서는 정도)이며, drawVideoCover가 캔버스를 회전시키는 것과 동일한
// 방향 규약으로 정규화 좌표(0~1)를 변환한다.
export function rotateLandmarksNormalized(landmarks, rotationDeg = 0) {
  const rot = normalizeRotation(rotationDeg);
  if (!rot || !Array.isArray(landmarks)) return landmarks;
  return landmarks.map((p) => {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return p;
    let x, y;
    if (rot === 90) { x = 1 - p.y; y = p.x; }
    else if (rot === 180) { x = 1 - p.x; y = 1 - p.y; }
    else { x = p.y; y = 1 - p.x; } // 270
    return { ...p, x, y };
  });
}

// 캔버스 중심 기준 오프셋(dx,dy)을 rot(90/180/270, 시계방향)만큼 회전.
function rotateOffset(dx, dy, rot) {
  if (rot === 90) return { x: -dy, y: dx };
  if (rot === 180) return { x: -dx, y: -dy };
  if (rot === 270) return { x: dy, y: -dx };
  return { x: dx, y: dy };
}

// cover 크롭 파라미터 매퍼를 반환(스켈레톤 등 정규화 좌표 → 캔버스 픽셀 정렬용).
// rotationDeg: 카메라 원본 영상을 시계방향으로 이만큼 돌려야 바로 서는 경우(0/90/180/270).
//  · useCameraRotation 이 저장한 값과 동일한 값을 넘기면, drawVideoCover 로 그려진
//    (회전 보정된) 영상 위에 스켈레톤이 정확히 겹친다.
export function coverTransform(video, width, height, rotationDeg = 0) {
  const sw0 = video?.videoWidth, sh0 = video?.videoHeight;
  if (!sw0 || !sh0) {
    return { X: (p) => p.x * width, Y: (p) => p.y * height };
  }
  const rot = normalizeRotation(rotationDeg);
  if (!rot) {
    // 회전 없음 — 기존 경로 그대로(회귀 방지).
    const sr = sw0 / sh0, tr = width / height;
    let sx = 0, sy = 0, sw = sw0, sh = sh0;
    if (sr > tr) { sw = sh0 * tr; sx = (sw0 - sw) / 2; }
    else { sh = sw0 / tr; sy = (sh0 - sh) / 2; }
    return {
      X: (p) => (((p.x * sw0) - sx) / sw) * width,
      Y: (p) => (((p.y * sh0) - sy) / sh) * height,
    };
  }

  const swapped = rot === 90 || rot === 270;
  const tw = swapped ? height : width;
  const th = swapped ? width : height;
  const sr = sw0 / sh0, tr = tw / th;
  let sx = 0, sy = 0, sw = sw0, sh = sh0;
  if (sr > tr) { sw = sh0 * tr; sx = (sw0 - sw) / 2; }
  else { sh = sw0 / tr; sy = (sh0 - sh) / 2; }
  const toXY = (p) => {
    const u = ((p.x * sw0) - sx) / sw;
    const v = ((p.y * sh0) - sy) / sh;
    const off = rotateOffset((u - 0.5) * tw, (v - 0.5) * th, rot);
    return { x: width / 2 + off.x, y: height / 2 + off.y };
  };
  return { X: (p) => toXY(p).x, Y: (p) => toXY(p).y };
}

// 원본 비디오 정규화 좌표(0~1) 배열을 cover 크롭 캔버스의 정규화 좌표로 변환.
//  · drawVideoCover 와 동일한 크롭 규칙 → 궤적선이 영상과 정확히 정렬된다.
export function coverMapPath(path, video, width, height, rotationDeg = 0) {
  const sw0 = video?.videoWidth, sh0 = video?.videoHeight;
  if (!Array.isArray(path) || !sw0 || !sh0) return path || [];
  const rot = normalizeRotation(rotationDeg);
  if (!rot) {
    // 회전 없음 — 기존 경로 그대로(회귀 방지).
    const sr = sw0 / sh0, tr = width / height;
    let sx = 0, sy = 0, sw = sw0, sh = sh0;
    if (sr > tr) { sw = sh0 * tr; sx = (sw0 - sw) / 2; }
    else { sh = sw0 / tr; sy = (sh0 - sh) / 2; }
    return path.map((p) => ({
      x: ((p.x * sw0) - sx) / sw,
      y: ((p.y * sh0) - sy) / sh,
    }));
  }

  const swapped = rot === 90 || rot === 270;
  const tw = swapped ? height : width;
  const th = swapped ? width : height;
  const sr = sw0 / sh0, tr = tw / th;
  let sx = 0, sy = 0, sw = sw0, sh = sh0;
  if (sr > tr) { sw = sh0 * tr; sx = (sw0 - sw) / 2; }
  else { sh = sw0 / tr; sy = (sh0 - sh) / 2; }
  return path.map((p) => {
    const u = ((p.x * sw0) - sx) / sw;
    const v = ((p.y * sh0) - sy) / sh;
    const off = rotateOffset((u - 0.5) * tw, (v - 0.5) * th, rot);
    return { x: 0.5 + off.x / width, y: 0.5 + off.y / height };
  });
}
//  · 검은 여백 없이 꽉 채운다(보행 drawCover 와 동일 규칙).
//  · 반환: 그려졌으면 true(비디오 준비 전이면 false).
export function drawVideoCover(ctx, video, width, height, rotationDeg = 0) {
  const sw0 = video?.videoWidth, sh0 = video?.videoHeight;
  if (!sw0 || !sh0) return false;
  const rot = normalizeRotation(rotationDeg);
  if (!rot) {
    // 회전 없음 — 기존 경로 그대로(회귀 방지).
    const sr = sw0 / sh0, tr = width / height;
    let sx = 0, sy = 0, sw = sw0, sh = sh0;
    if (sr > tr) { sw = sh0 * tr; sx = (sw0 - sw) / 2; }
    else { sh = sw0 / tr; sy = (sh0 - sh) / 2; }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
    return true;
  }

  const swapped = rot === 90 || rot === 270;
  const tw = swapped ? height : width;
  const th = swapped ? width : height;
  const sr = sw0 / sh0, tr = tw / th;
  let sx = 0, sy = 0, sw = sw0, sh = sh0;
  if (sr > tr) { sw = sh0 * tr; sx = (sw0 - sw) / 2; }
  else { sh = sw0 / tr; sy = (sh0 - sh) / 2; }
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(video, sx, sy, sw, sh, -tw / 2, -th / 2, tw, th);
  ctx.restore();
  return true;
}
