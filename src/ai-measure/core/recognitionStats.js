// recognitionStats.js — 측정 인식률 (2026-10)
//
// 포즈 검출 결과를 프레임마다 받아 "주요 관절이 또렷하게 인식된 프레임 비율"을 센다.
//  - 주요 관절: 어깨(11·12), 엉덩이(23·24), 무릎(25·26), 발목(27·28)
//  - 한 프레임이 '인식됨'이려면 검출 성공 + 주요 관절 평균 visibility ≥ minVisibility
// 결과는 측정 리포트에 recognition 으로 저장되고, 이력 화면에 '측정 인식률'로 표시된다.
// 측정 판정 자체에는 쓰지 않는다(정보 표시용). 순수 로직 — 카메라/브라우저 의존 없음.

export const KEY_LANDMARKS = Object.freeze([11, 12, 23, 24, 25, 26, 27, 28]);
export const MIN_VISIBILITY = 0.5;

export function frameKeyVisibility(landmarks) {
  if (!Array.isArray(landmarks) || !landmarks.length) return null;
  let sum = 0;
  let n = 0;
  for (const i of KEY_LANDMARKS) {
    const p = landmarks[i];
    if (!p) continue;
    sum += p.visibility == null ? 1 : Number(p.visibility) || 0;
    n += 1;
  }
  return n ? sum / n : null;
}

export function createRecognitionTracker(minVisibility = MIN_VISIBILITY) {
  let frames = 0;
  let detected = 0;
  let good = 0;
  let visSum = 0;
  return {
    /** landmarks 가 null 이면 검출 실패 프레임으로 센다. */
    record(landmarks) {
      frames += 1;
      const v = frameKeyVisibility(landmarks);
      if (v == null) return;
      detected += 1;
      visSum += v;
      if (v >= minVisibility) good += 1;
    },
    reset() { frames = 0; detected = 0; good = 0; visSum = 0; },
    /** 프레임이 하나도 없으면 null. ratio 는 0~1. */
    snapshot() {
      if (!frames) return null;
      const r4 = (x) => Math.round(x * 1000) / 1000;
      return {
        frames,
        detectedFrames: detected,
        goodFrames: good,
        ratio: r4(good / frames),
        detectionRatio: r4(detected / frames),
        avgVisibility: detected ? r4(visSum / detected) : 0,
      };
    },
  };
}

// ── 세션 단위 공용 집계기 (영상·실시간·정지이미지 검출이 모두 여기로 모인다) ──
const _session = createRecognitionTracker();
export const recordRecognitionFrame = (landmarks) => _session.record(landmarks);
export const resetRecognition = () => _session.reset();
export const getRecognitionSnapshot = () => _session.snapshot();
