// ai-measure/core/framingGuide.js
// 촬영 위치·거리 실시간 판정 — MediaPipe 관절로 "지금 잘 찍히고 있는지"를 알려준다.
//
// 판정 항목:
//  1) 전신 보임(framing): 머리(코/귀)와 양 발목이 모두 화면 안에서 잡히는가.
//  2) 방향(orientation): 측면 / 정면 — 어깨 두 점의 가로 간격으로 추정.
//       측면이면 어깨가 거의 겹쳐 보여 간격이 좁고, 정면이면 넓다.
//  3) 거리(distance): 사람이 화면 세로를 차지하는 비율로 너무 가까움/멈 판정.
//
// 종목·화면마다 권장 방향이 다르므로 want('side'|'front'|'any')로 받는다.

import { LM } from './geometry';

const VIS = 0.3; // 이 값 이상이면 "보인다"

function vis(p) { return p && (p.visibility == null || p.visibility >= VIS); }

/**
 * 촬영 상태 판정.
 * @param {Array} lms MediaPipe pose landmarks
 * @param {{want?: 'side'|'front'|'any', fillMin?:number, fillMax?:number}} opt
 * @returns {{
 *   ok:boolean, level:'good'|'warn'|'bad',
 *   message:string,
 *   fullBody:boolean, orientation:'side'|'front'|'unknown', fillRatio:number|null
 * }}
 */
export function assessFraming(lms, opt = {}) {
  const want = opt.want || 'any';
  const fillMin = opt.fillMin ?? 0.55;  // 사람 키가 화면 세로의 최소 55%
  const fillMax = opt.fillMax ?? 0.95;  // 최대 95%(잘림 방지)

  if (!lms || !lms.length) {
    return { ok: false, level: 'bad', message: '사람이 보이지 않습니다. 카메라 앞에 서 주세요.',
             fullBody: false, orientation: 'unknown', fillRatio: null };
  }

  const nose = lms[LM.NOSE];
  const lEar = lms[LM.LEFT_EAR], rEar = lms[LM.RIGHT_EAR];
  const top = vis(nose) ? nose : vis(lEar) ? lEar : vis(rEar) ? rEar : null;
  const lAnk = lms[LM.LEFT_ANKLE], rAnk = lms[LM.RIGHT_ANKLE];
  const ankles = [lAnk, rAnk].filter(vis);
  const lSh = lms[LM.LEFT_SHOULDER], rSh = lms[LM.RIGHT_SHOULDER];

  // 1) 전신 보임 — 머리와 발목이 잡히고, 화면 가장자리에 너무 붙지 않았는가
  const headOK = !!top;
  const ankleOK = ankles.length > 0;
  const inFrame = (p) => p && p.x > 0.02 && p.x < 0.98 && p.y > 0.02 && p.y < 0.98;
  const fullBody = headOK && ankleOK && inFrame(top) && ankles.some(inFrame);

  // 2) 방향 — 어깨 가로 간격(정규화). 좁으면 측면, 넓으면 정면.
  let orientation = 'unknown';
  let shoulderGap = null;
  if (vis(lSh) && vis(rSh)) {
    shoulderGap = Math.abs(lSh.x - rSh.x);
    orientation = shoulderGap < 0.10 ? 'side' : 'front';
  }

  // 3) 거리 — 머리~발목 세로 비율
  let fillRatio = null;
  if (top && ankles.length) {
    const botY = Math.max(...ankles.map(a => a.y));
    fillRatio = Math.abs(botY - top.y);
  }

  // ── 종합 메시지(우선순위: 사람보임 → 전신 → 거리 → 방향) ──
  let level = 'good', message = '좋습니다 · 이대로 측정하세요', ok = true;

  if (!fullBody) {
    level = 'warn'; ok = false;
    if (!ankleOK) message = '발이 안 보입니다 · 뒤로 물러서거나 카메라를 아래로';
    else if (!headOK) message = '머리가 안 보입니다 · 카메라를 위로';
    else message = '전신이 화면에 다 들어오게 조정하세요';
  } else if (fillRatio != null && fillRatio < fillMin) {
    level = 'warn'; ok = false; message = '너무 멉니다 · 카메라에 더 가까이';
  } else if (fillRatio != null && fillRatio > fillMax) {
    level = 'warn'; ok = false; message = '너무 가깝습니다 · 조금 뒤로';
  } else if (want !== 'any' && orientation !== 'unknown' && orientation !== want) {
    level = 'warn'; ok = false;
    message = want === 'side'
      ? '옆에서 찍어주세요 · 몸을 90° 돌리거나 카메라를 옆으로'
      : '정면에서 찍어주세요';
  }

  return { ok, level, message, fullBody, orientation, fillRatio };
}

/** 종목/화면별 권장 방향·안내 텍스트 */
export const FRAMING_PRESETS = {
  lifting: {
    want: 'side',
    title: '측정 전 준비 (역도)',
    tips: [
      '카메라를 옆에 두고, 바벨이 위아래로 움직이는 게 잘 보이게 하세요.',
      '머리부터 발끝까지 전신이 화면에 들어오게 2~3m 거리에서 촬영하세요.',
      '폰을 세로로 고정(삼각대·선반)하면 흔들림이 줄어 정확해집니다.',
    ],
  },
  vbt: {
    want: 'side',
    title: '측정 전 준비 (VBT)',
    tips: [
      '옆에서 촬영해야 바벨의 수직 속도가 정확히 잡힙니다.',
      '전신이 보이도록 2~3m 거리에서, 폰을 고정하세요.',
      '한 번에 1렙(한 번 들어올리기)만 측정하면 속도가 더 정확합니다.',
    ],
  },
  squat: {
    want: 'side',
    title: '측정 전 준비 (스쿼트)',
    tips: [
      '옆에서 촬영하세요. 앉았다 일어서는 깊이가 잘 보입니다.',
      '전신이 보이도록 거리를 두고 폰을 고정하세요.',
    ],
  },
  deadlift: {
    want: 'side',
    title: '측정 전 준비 (데드리프트)',
    tips: [
      '옆에서 촬영하세요. 바닥에서 들어올리는 경로가 잘 보입니다.',
      '전신이 보이도록 거리를 두고 폰을 고정하세요.',
    ],
  },
  bench: {
    want: 'any',
    title: '측정 전 준비 (벤치프레스)',
    tips: [
      '벤치 옆 약간 위쪽에서, 바가 내려오고 올라가는 게 보이게 촬영하세요.',
      '바벨과 상체가 화면에 들어오게 거리를 맞추고 폰을 고정하세요.',
    ],
  },
};
