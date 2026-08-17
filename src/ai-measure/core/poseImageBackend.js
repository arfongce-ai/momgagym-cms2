// ai-measure/core/poseImageBackend.js
// MediaPipe PoseLandmarker(Tasks Vision)를 정지 이미지(IMAGE 모드)로 쓰는 버전.
// poseBackend.js(VIDEO 모드, 실시간 카메라용)와 CDN 로드 전략은 동일하지만
// 별도 인스턴스로 분리했다 — runningMode는 인스턴스 생성 시 고정되는 값이라
// VIDEO용 인스턴스를 IMAGE 검출(detect)에 재사용할 수 없다(공유 시 조용히
// 실패 — poseBackend.js 상단 주석의 "인스턴스 재사용 함정"과 같은 종류의 문제).
//
// 오버레이 비교 도구(menus/OverlayCompare.jsx)에서 업로드된 두 장의 사진/
// 영상 프레임을 비교해 발목 위치를 인식하고 자동 정렬하는 데 쓰인다.

let _visionPromise = null;
let _landmarker = null;

// 버전 핀 고정(poseBackend.js와 동일 버전 — 두 모듈이 같은 CDN 응답을 공유해
// 브라우저 캐시 히트율을 높인다). 패키지 '루트'에서 import.
const TV_VERSION = '0.10.14';
const TV_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TV_VERSION}`;
const WASM_ROOT = `${TV_ROOT}/wasm`;
// 발목처럼 말단 관절의 정확도가 중요해 lite 대신 full 등급을 쓴다(근거는
// poseBackend.js 주석과 동일 — "발목/발 등 말단 관절은 full이 lite보다 안정적").
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

async function _createWithDelegate(PoseLandmarker, FilesetResolver, delegate) {
  const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'IMAGE',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
  });
}

/**
 * IMAGE 모드 PoseLandmarker를 1회 생성. 이미 만들어졌으면 캐시 반환.
 * GPU 실패 시 CPU로 자동 폴백(poseBackend.js와 동일 정책).
 */
export async function loadImagePoseLandmarker() {
  if (_landmarker) return _landmarker;
  if (_visionPromise) return _visionPromise;

  _visionPromise = (async () => {
    // ✅ 패키지 루트에서 import(vision_bundle.mjs 직접 import 금지 — poseBackend.js와 동일한 함정)
    const vision = await import(/* @vite-ignore */ TV_ROOT);
    const { FilesetResolver, PoseLandmarker } = vision;
    if (!FilesetResolver || !PoseLandmarker) {
      throw new Error('MediaPipe named export 로드 실패 (CDN 경로 확인 필요)');
    }
    try {
      _landmarker = await _createWithDelegate(PoseLandmarker, FilesetResolver, 'GPU');
    } catch (gpuErr) {
      // 일부 모바일/브라우저는 GPU delegate 실패 → CPU 폴백
      _landmarker = await _createWithDelegate(PoseLandmarker, FilesetResolver, 'CPU');
    }
    return _landmarker;
  })();

  try {
    return await _visionPromise;
  } catch (e) {
    _visionPromise = null;
    throw new Error(
      'AI 정렬 모듈(MediaPipe)을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'
    );
  }
}

/**
 * 정지 이미지(또는 캔버스에 캡처한 영상 프레임 1장)에서 포즈를 추론한다.
 * @param {HTMLImageElement|HTMLCanvasElement|ImageBitmap} source
 * @returns {{ landmarks: Array<{x,y,z?,visibility}> } | null}
 */
export function detectPoseImage(source) {
  if (!_landmarker || !source) return null;
  const result = _landmarker.detect(source);
  const lm = result?.landmarks?.[0];
  if (!lm || !lm.length) return null;
  return { landmarks: lm };
}

/** 자원 해제. 다시 쓰려면 loadImagePoseLandmarker 재호출. */
export function closeImagePoseLandmarker() {
  try { _landmarker?.close?.(); } catch (e) { /* noop */ }
  _landmarker = null;
  _visionPromise = null;
}

export function isImagePoseReady() {
  return !!_landmarker;
}
