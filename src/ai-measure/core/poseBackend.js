// ai-measure/core/poseBackend.js
// MediaPipe PoseLandmarker(Tasks Vision)를 CDN에서 런타임 로드해 1회 초기화한다.
// xlsx(loadXlsx.js)와 동일한 전략: package.json 의존성으로 넣지 않아 Cloudflare
// 빌드를 가볍게 유지하고, 보행 분석을 실제로 쓸 때만 브라우저에서 받아온다.
//
// 반환 landmark 규약은 gaitBiomechanics 가 기대하는 형태와 동일하다:
//   Array<{ x, y, z?, visibility }>  (BlazePose 33점, x·y 는 0~1 정규화)
// MediaPipe 결과의 result.landmarks[0] 가 바로 이 형태이므로 그대로 쓴다.

let _visionPromise = null;
let _landmarker = null;

const TASKS_VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest';
const WASM_ROOT = `${TASKS_VISION_CDN}/wasm`;
// lite 모델: 모바일 실시간에 적합(정확도/속도 균형). 필요 시 full/heavy 로 교체.
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

/**
 * PoseLandmarker 를 VIDEO 모드로 1회 생성. 이미 만들어졌으면 캐시 반환.
 * @param {object} opts  { numPoses=1, delegate='GPU' }
 */
export async function loadPoseLandmarker(opts = {}) {
  if (_landmarker) return _landmarker;
  if (_visionPromise) return _visionPromise;

  const { numPoses = 1, delegate = 'GPU' } = opts;
  _visionPromise = (async () => {
    // ESM 동적 import (CDN). Cloudflare 정적 빌드에 포함되지 않는다.
    const vision = await import(/* @vite-ignore */ `${TASKS_VISION_CDN}/vision_bundle.mjs`);
    const { FilesetResolver, PoseLandmarker } = vision;
    const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);
    _landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numPoses,
    });
    return _landmarker;
  })();

  try {
    return await _visionPromise;
  } catch (e) {
    _visionPromise = null;
    throw new Error(
      'AI 분석 모듈(MediaPipe)을 불러오지 못했습니다. 인터넷 연결을 확인하거나, ' +
      '카카오톡 등 앱 내 브라우저가 아닌 크롬·사파리에서 시도해 주세요.'
    );
  }
}

/**
 * 비디오 프레임 1장에서 포즈를 추론한다.
 * @param {HTMLVideoElement} video
 * @param {number} timestampMs  단조 증가해야 함(같은 값 2회 금지)
 * @returns {{ landmarks: Array<{x,y,z?,visibility}> } | null}
 */
export function detectPoseFrame(video, timestampMs) {
  if (!_landmarker || !video || video.readyState < 2) return null;
  const result = _landmarker.detectForVideo(video, timestampMs);
  const lm = result?.landmarks?.[0];
  if (!lm || !lm.length) return null;
  return { landmarks: lm };
}

/** 자원 해제(언마운트 시). 다시 쓰려면 loadPoseLandmarker 재호출. */
export function closePoseLandmarker() {
  try { _landmarker?.close?.(); } catch (e) { /* noop */ }
  _landmarker = null;
  _visionPromise = null;
}

export function isPoseReady() {
  return !!_landmarker;
}
