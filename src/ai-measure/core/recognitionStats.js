// recognitionStats.js — 측정 인식률 (2026-10)
//
// 포즈 검출 결과를 프레임마다 받아 "주요 관절이 또렷하게 인식된 프레임 비율"을 센다.
//  - 주요 관절: 어깨(11·12), 엉덩이(23·24), 무릎(25·26), 발목(27·28)
//  - 한 프레임이 '인식됨'이려면 검출 성공 + 주요 관절 평균 visibility ≥ minVisibility
// 결과는 측정 리포트에 recognition 으로 저장되고, 이력 화면에 '측정 인식률'로 표시된다.
// [2026-10 정확성 수정] 카메라를 켜고 자세를 잡는 준비 시간이 분모에 들어가 인식률이 낮게 나오던 문제:
//  처음으로 주요 관절이 또렷하게 인식된 프레임부터 세기 시작한다(그 전 프레임은 setupFrames 로만 기록).
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
  let started = false; // 처음 또렷하게 인식된 프레임 이후부터 집계
  let setup = 0;       // 준비 구간(집계 제외) 프레임 수
  return {
    /** landmarks 가 null 이면 검출 실패 프레임으로 센다(집계 시작 후). */
    record(landmarks) {
      const v = frameKeyVisibility(landmarks);
      if (!started) {
        if (v != null && v >= minVisibility) started = true;
        else { setup += 1; return; }
      }
      frames += 1;
      if (v == null) return;
      detected += 1;
      visSum += v;
      if (v >= minVisibility) good += 1;
    },
    reset() { frames = 0; detected = 0; good = 0; visSum = 0; started = false; setup = 0; },
    /** 프레임이 하나도 없으면 null. ratio 는 0~1. */
    snapshot() {
      if (!frames && !setup) return null;
      if (!frames) {
        // 끝까지 또렷하게 인식된 적이 없음 — 인식률 0%, 준비 구간만 있었음
        return { frames: setup, detectedFrames: 0, goodFrames: 0, ratio: 0, detectionRatio: 0, avgVisibility: 0, setupFrames: 0 };
      }
      const r4 = (x) => Math.round(x * 1000) / 1000;
      return {
        frames,
        detectedFrames: detected,
        goodFrames: good,
        ratio: r4(good / frames),
        detectionRatio: r4(detected / frames),
        avgVisibility: detected ? r4(visSum / detected) : 0,
        setupFrames: setup,
      };
    },
  };
}

// ── 세션 단위 공용 집계기 (영상·실시간·정지이미지 검출이 모두 여기로 모인다) ──
const _session = createRecognitionTracker();
export const recordRecognitionFrame = (landmarks) => _session.record(landmarks);
export const resetRecognition = () => _session.reset();
export const getRecognitionSnapshot = () => _session.snapshot();
