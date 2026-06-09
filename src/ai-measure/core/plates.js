// ai-measure/core/plates.js
// IWF(국제역도연맹) 규격 원판(플레이트) 색상 정의 + 영상에서 색 자동 인식 + 무게 합산.
//
// 설계 원칙(동규님 지침):
//  - 색 자동인식은 "보조 수단" → 항상 수동 확인·수정과 함께 사용.
//  - IWF 국제규격 색상 기준 그대로 사용.
//  - 한쪽(편측) 원판 구성을 인식 → 양쪽(×2) + 봉 무게로 총중량 산출.
//
// 색 인식 한계(현실):
//  - 조명/각도/겹침/땀·먼지에 민감 → 추정값은 항상 사용자 확인 필요.
//  - 그래서 "추정만 제시"하고, 최종 무게는 사용자가 버튼으로 확정/수정한다.

// ───────── IWF 규격 원판 (kg ↔ 대표 색상) ─────────
// hsv: 대표 색의 Hue(0~360) 범위와 채도/명도 하한. 흰/검정은 별도 규칙.
export const IWF_PLATES = [
  { kg: 25,  label: '빨강',   color: '#D7263D', hue: [350, 360, 0, 12], satMin: 0.45, valMin: 0.30 },
  { kg: 20,  label: '파랑',   color: '#0B61A4', hue: [200, 240],        satMin: 0.40, valMin: 0.25 },
  { kg: 15,  label: '노랑',   color: '#F2C200', hue: [45, 65],          satMin: 0.45, valMin: 0.45 },
  { kg: 10,  label: '초록',   color: '#1F9D55', hue: [95, 160],         satMin: 0.30, valMin: 0.25 },
  { kg: 5,   label: '흰색',   color: '#E8E8E8', hue: null, white: true },
  { kg: 2.5, label: '빨강(소)', color: '#D7263D', hue: [350, 360, 0, 12], satMin: 0.45, valMin: 0.30, small: true },
  { kg: 1.25,label: '크롬',   color: '#C0C4CC', hue: null, chrome: true },
];

// 봉(바벨) 기본 무게
export const BAR_WEIGHTS = [
  { kg: 20, label: '남성 봉 20kg' },
  { kg: 15, label: '여성 봉 15kg' },
  { kg: 10, label: '경량 봉 10kg' },
  { kg: 0,  label: '봉 없음 0kg' },
];

// ───────── RGB → HSV ─────────
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r)      h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

// hue 가 범위에 드는지 (빨강처럼 0 경계를 넘는 경우 4-튜플 지원)
function hueInRange(h, range) {
  if (!range) return false;
  if (range.length === 4) {
    return (h >= range[0] && h <= range[1]) || (h >= range[2] && h <= range[3]);
  }
  return h >= range[0] && h <= range[1];
}

// 한 픽셀 색을 IWF 원판 종류로 분류 (없으면 null)
export function classifyPixel(r, g, b) {
  const { h, s, v } = rgbToHsv(r, g, b);
  // 너무 어두우면(검정 봉/그림자) 무시
  if (v < 0.12) return null;
  // 흰색: 채도 매우 낮고 밝음
  if (s < 0.12 && v > 0.72) return 'white';
  // 크롬/회색: 채도 낮고 중간 밝기 → 무게로 안 셈(소형 보조판)
  if (s < 0.16 && v > 0.35 && v <= 0.72) return 'chrome';
  // 유채색 매칭
  for (const p of IWF_PLATES) {
    if (!p.hue) continue;
    if (hueInRange(h, p.hue) && s >= (p.satMin || 0.3) && v >= (p.valMin || 0.25)) {
      // 같은 색(빨강 25/2.5)은 크기로 구분 불가 → 큰쪽(25)으로 우선 분류
      return p.label === '노랑' ? 'yellow'
           : p.label === '파랑' ? 'blue'
           : p.label === '초록' ? 'green'
           : 'red';
    }
  }
  return null;
}

const TAG_TO_KG = { red: 25, blue: 20, yellow: 15, green: 10, white: 5, chrome: 0 };
const TAG_TO_LABEL = { red: '빨강', blue: '파랑', yellow: '노랑', green: '초록', white: '흰색', chrome: '크롬' };

/**
 * 영상 프레임의 관심영역(ROI)에서 색을 집계해 "편측 원판 구성"을 추정.
 * @param {HTMLVideoElement} video
 * @param {{x:number,y:number,w:number,h:number}} roi  0~1 정규화 박스(바벨 끝 부분)
 * @returns {{ counts:Object, dominant:Array<{tag,label,kg,ratio}> }}
 */
export function detectPlatesFromVideo(video, roi) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return { counts: {}, dominant: [] };

  const sx = Math.max(0, Math.floor(roi.x * vw));
  const sy = Math.max(0, Math.floor(roi.y * vh));
  const sw = Math.min(vw - sx, Math.floor(roi.w * vw));
  const sh = Math.min(vh - sy, Math.floor(roi.h * vh));
  if (sw <= 0 || sh <= 0) return { counts: {}, dominant: [] };

  // 다운스케일 샘플링 캔버스
  const TARGET = 64;
  const cv = document.createElement('canvas');
  cv.width = TARGET; cv.height = TARGET;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, TARGET, TARGET);
  const { data } = ctx.getImageData(0, 0, TARGET, TARGET);

  const counts = {};
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const tag = classifyPixel(data[i], data[i + 1], data[i + 2]);
    if (!tag) continue;
    counts[tag] = (counts[tag] || 0) + 1;
    total++;
  }
  const dominant = Object.entries(counts)
    .filter(([tag]) => tag !== 'chrome')         // 크롬은 무게 0 → 후보에서 제외
    .map(([tag, n]) => ({
      tag,
      label: TAG_TO_LABEL[tag],
      kg: TAG_TO_KG[tag],
      ratio: total ? Math.round((n / total) * 100) / 100 : 0,
    }))
    .filter(d => d.ratio >= 0.06)                // 잡음 컷(6% 미만 색은 무시)
    .sort((a, b) => b.ratio - a.ratio);

  return { counts, dominant };
}

/**
 * 색 추정 결과 → "편측 원판 후보 목록"으로 변환(각 1장씩 가정).
 * 사용자가 화면에서 장수를 직접 +/- 로 보정하는 출발점.
 */
export function suggestSidePlates(dominant) {
  // 비율 높은 순으로 최대 3종 제안, 각 1장
  return dominant.slice(0, 3).map(d => ({ kg: d.kg, label: d.label, count: 1 }));
}

/**
 * 총중량 계산. sidePlates = [{kg, count}], 양쪽 동일 가정(×2) + 봉.
 * @returns {{ total:number, perSide:number, breakdown:Array }}
 */
export function totalWeight(sidePlates, barKg) {
  const perSide = sidePlates.reduce((s, p) => s + p.kg * (p.count || 0), 0);
  const total = perSide * 2 + (barKg || 0);
  return {
    total: Math.round(total * 100) / 100,
    perSide: Math.round(perSide * 100) / 100,
    breakdown: sidePlates.filter(p => p.count > 0),
  };
}
