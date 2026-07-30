// ai-measure/core/poseBackend.js
// MediaPipe PoseLandmarker(Tasks Vision)를 CDN에서 런타임 로드해 1회 초기화한다.
// xlsx(loadXlsx.js)와 동일한 전략: package.json 의존성으로 넣지 않아 Cloudflare
// 빌드를 가볍게 유지하고, 보행 분석을 실제로 쓸 때만 브라우저에서 받아온다.
//
// 반환 landmark 규약은 gaitBiomechanics 가 기대하는 형태와 동일하다:
//   Array<{ x, y, z?, visibility }>  (BlazePose 33점, x·y 는 0~1 정규화)
// MediaPipe 결과의 result.landmarks[0] 가 바로 이 형태이므로 그대로 쓴다.
//
// ⚠ 중요한 함정 2가지(실측 확인):
//  1) 동적 import 는 반드시 '패키지 루트'에서 해야 named export 가 나온다.
//     '.../vision_bundle.mjs' 를 직접 import 하면 export 가 비어 조용히 실패한다.
//     → 카메라는 켜지지만 detectForVideo 가 아무것도 안 돌려주는 증상.
//  2) 버전은 핀 고정(@latest 는 깨질 수 있음). GPU delegate 실패 시 CPU 폴백.

let _visionPromise = null;
let _landmarker = null;

// 버전 핀 고정 (production 안전). 패키지 '루트'에서 import.
const TV_VERSION = '0.10.14';
const TV_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TV_VERSION}`;
const WASM_ROOT = `${TV_ROOT}/wasm`;
// 모델 등급별 URL. 정확도: lite < full < heavy, 속도(빠름): lite > full > heavy.
// full = 정확도/속도 균형(권장). heavy = 최고 정확도(최신 고사양 폰).
const MODEL_URLS = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
};
// 기본 등급: full (lite보다 관절 위치 정확, 대부분 폰에서 실시간 가능)
let _modelTier = 'full';

async function _createWithDelegate(PoseLandmarker, FilesetResolver, numPoses, delegate) {
  const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);
  const modelUrl = MODEL_URLS[_modelTier] || MODEL_URLS.full;
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: modelUrl, delegate },
    runningMode: 'VIDEO',
    numPoses,
    // 검출/추적 신뢰도 하한 — 너무 낮으면 노이즈, 너무 높으면 미검출.
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

/**
 * PoseLandmarker 를 VIDEO 모드로 1회 생성. 이미 만들어졌으면 캐시 반환.
 * GPU 실패 시 CPU 로 자동 폴백.
 *
 * [2026-07-30] 키오스크 로딩 속도 개선: 예전엔 화면을 나갈 때마다
 * closePoseLandmarker() 를 호출해서, 회원이 바뀔 때마다(=측정 화면 재진입마다)
 * CDN에서 모델을 통째로 다시 받아와 초기화했다(로딩이 길다는 불만의 원인).
 * 이제 화면 언마운트 시 더 이상 자동으로 닫지 않는다 — 브라우저 탭이 켜져
 * 있는 한(하루 종일 켜두는 키오스크 PC 특성상) 모델을 계속 재사용해, 첫
 * 로딩 이후로는 화면 진입이 즉시 된다. 카메라 스트림 자체(진짜 매번 새로
 * 열어야 하는 것)는 이 캐시와 무관하게 화면마다 정상적으로 열고 닫는다.
 * @param {object} opts  { numPoses=1, modelTier='full'|'lite'|'heavy' }
 */
export async function loadPoseLandmarker(opts = {}) {
  const { numPoses = 1, modelTier } = opts;
  // 이미 다른 등급으로 캐시돼 있으면 재사용하지 않고 새로 올린다(정확도 등급 불일치 방지).
  if (modelTier && MODEL_URLS[modelTier] && modelTier !== _modelTier && (_landmarker || _visionPromise)) {
    closePoseLandmarker();
  }
  if (_landmarker) return _landmarker;
  if (_visionPromise) return _visionPromise;

  if (modelTier && MODEL_URLS[modelTier]) _modelTier = modelTier;
  _visionPromise = (async () => {
    // ✅ 패키지 루트에서 import (vision_bundle.mjs 직접 import 금지)
    const vision = await import(/* @vite-ignore */ TV_ROOT);
    const { FilesetResolver, PoseLandmarker } = vision;
    if (!FilesetResolver || !PoseLandmarker) {
      throw new Error('MediaPipe named export 로드 실패 (CDN 경로 확인 필요)');
    }
    try {
      _landmarker = await _createWithDelegate(PoseLandmarker, FilesetResolver, numPoses, 'GPU');
    } catch (gpuErr) {
      // 일부 모바일/브라우저는 GPU delegate 실패 → CPU 폴백
      _landmarker = await _createWithDelegate(PoseLandmarker, FilesetResolver, numPoses, 'CPU');
    }
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
