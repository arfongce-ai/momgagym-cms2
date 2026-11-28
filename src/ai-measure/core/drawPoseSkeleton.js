// ai-measure/core/drawPoseSkeleton.js
// 카메라 자동 카운트 화면(시니어·PAPS)이 같이 쓰는 스켈레톤 그리기. 기존 측정 화면과 같은 object-contain 좌표계.
// 스켈레톤 OFF 여도 인식·카운트는 계속된다(화면에 그리는 것만 끈다).
import { isSkeletonEnabled } from './skeletonPref';

export const LEG_BONES = [[11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
export const LEG_DOTS = [11, 12, 23, 24, 25, 26, 27, 28];
export const ARM_BONES = [[11, 13], [13, 15], [12, 14], [14, 16]];
export const ARM_DOTS = [13, 14, 15, 16];

const visOk = (p) => !!p && (p.visibility == null || p.visibility >= 0.3);

export function drawPoseSkeleton(canvas, video, landmarks, tracked, { bones = LEG_BONES, dots = LEG_DOTS } = {}) {
  if (!canvas || !video) return;
  const cw = canvas.clientWidth || canvas.width; const ch = canvas.clientHeight || canvas.height;
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, cw, ch);
  if (!landmarks || !isSkeletonEnabled()) return;
  const vw = video.videoWidth || cw; const vh = video.videoHeight || ch;
  const scale = Math.min(cw / vw, ch / vh);
  const dw = vw * scale; const dh = vh * scale; const ox = (cw - dw) / 2; const oy = (ch - dh) / 2;
  const X = (p) => ox + p.x * dw; const Y = (p) => oy + p.y * dh;
  ctx.strokeStyle = tracked ? 'rgba(52,211,153,0.95)' : 'rgba(251,191,36,0.95)';
  ctx.lineWidth = 3; ctx.lineCap = 'round';
  bones.forEach(([a, b]) => {
    const pa = landmarks[a]; const pb = landmarks[b];
    if (!visOk(pa) || !visOk(pb)) return;
    ctx.beginPath(); ctx.moveTo(X(pa), Y(pa)); ctx.lineTo(X(pb), Y(pb)); ctx.stroke();
  });
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  dots.forEach((i) => {
    const p = landmarks[i];
    if (!visOk(p)) return;
    ctx.beginPath(); ctx.arc(X(p), Y(p), 5, 0, Math.PI * 2); ctx.fill();
  });
}
