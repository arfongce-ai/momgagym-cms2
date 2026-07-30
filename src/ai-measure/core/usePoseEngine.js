// ai-measure/core/usePoseEngine.js
// 공통 포즈 엔진: 카메라 스트림 + MediaPipe Pose Landmarker.
// 모든 측정 메뉴가 이 훅 하나를 공유한다(중복 로드 방지).
//
// 설계:
//  - MediaPipe Tasks Vision 을 CDN(ESM)에서 동적 import → 빌드 의존성 0, 번들 비대화 방지.
//  - 메뉴 진입 시 init(), 이탈 시 stop() 으로 카메라·워커 자원 회수.
//  - onResult(landmarks, ts) 콜백으로 매 프레임 결과 전달. React state 우회(고주파).
//
// [2026-07-30] "키오스크 로딩 속도 개선" 시도를 되돌림 — PoseLandmarker를 모듈
// 레벨로 캐싱해 화면 재진입마다 재사용하도록 바꿨었는데, 배포 후 ROM·스쿼트·
// SLST·VBT·자세측정 등 이 훅을 쓰는 화면 전부에서 인식 자체가 안 되는 광범위한
// 회귀가 발생했다. 같은 PoseLandmarker 인스턴스를 서로 다른 화면의 서로 다른
// 카메라 스트림(video element)에 재사용하는 게 MediaPipe Tasks Vision에서
// 조용히 실패하는 것으로 추정된다(에러가 프레임 루프의 try/catch에 먹혀
// 증상만 "인식 진행률이 0%에서 안 움직인다"로 나타남). 로딩 속도보다 정확성이
// 우선이라 원래 방식(화면마다 새로 로드하고 나갈 때 닫기)으로 되돌린다.
// 이 최적화는 나중에 더 안전한 방법(예: 화면 전환 시에도 같은 video element를
// 재사용하거나, MediaPipe 쪽 재사용 지원 여부를 먼저 확인)으로 다시 시도한다.
import { useRef, useCallback, useState } from 'react';
import { openMainCameraStream, lockCameraCapture, unlockCameraCapture } from './cameraSelect';

const VISION_CDN =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
// 모델 등급별 URL. 정확도: lite < full < heavy. 발목/발 등 말단 관절은
// full 이 lite 보다 확연히 안정적으로 잡힌다(자세·체형 측정 발목 누락 개선).
const MODEL_URLS = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
};

export function usePoseEngine({ onResult, modelTier = 'full' } = {}) {
  const videoRef = useRef(null);
  const landmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const runningRef = useRef(false);
  // 최신 onResult 를 ref 로 유지 — 루프가 start() 시점의 콜백을 붙잡아
  //  관절/자세 변경이 스켈레톤에 반영되지 않던 문제(스테일 클로저)를 방지.
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const [status, setStatus] = useState('idle'); // idle | loading | ready | running | error
  const [error, setError] = useState(null);

  // MediaPipe 로드 + 카메라 시작
  const start = useCallback(async (videoEl) => {
    try {
      setStatus('loading');
      setError(null);

      // 1) MediaPipe Tasks Vision 동적 로드 (CDN ESM)
      const vision = await import(/* @vite-ignore */ `${VISION_CDN}`);
      const { FilesetResolver, PoseLandmarker } = vision;
      const fileset = await FilesetResolver.forVisionTasks(`${VISION_CDN}/wasm`);
      const modelUrl = MODEL_URLS[modelTier] || MODEL_URLS.full;
      const buildOpts = (delegate) => ({
        baseOptions: { modelAssetPath: modelUrl, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      // GPU 우선, 실패 시 CPU 폴백(일부 기기/브라우저에서 GPU delegate 미지원)
      try {
        landmarkerRef.current = await PoseLandmarker.createFromOptions(fileset, buildOpts('GPU'));
      } catch (gpuErr) {
        landmarkerRef.current = await PoseLandmarker.createFromOptions(fileset, buildOpts('CPU'));
      }

      // 2) 카메라 시작 — 후면 "메인(광각)" 렌즈를 명시 선택해 초광각 왜곡 방지.
      const stream = await openMainCameraStream({ audio: false });

      streamRef.current = stream;
      // video 요소를 다시 취득(풀스크린 오버레이가 status 변경 후 렌더되는 경우 대비).
      // 호출 시점에 null이었어도, loading 상태로 바뀌며 요소가 렌더되므로 충분히 기다린다.
      // (1RM처럼 status!=='idle'일 때만 video가 렌더되는 화면에서 검은화면 방지)
      let video = videoEl || videoRef.current;
      for (let i = 0; i < 80 && !video; i++) {
        await new Promise(r => setTimeout(r, 25)); // 최대 약 2초 대기
        video = videoRef.current;
      }
      if (!video) {
        // video 요소를 끝내 못 잡으면 조용히 idle로 빠지지 말고 오류로 알린다.
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        throw new Error('영상 화면을 준비하지 못했습니다. 화면을 닫고 다시 시도해 주세요.');
      }
      video.srcObject = stream;
      // 메타데이터(해상도)가 준비될 때까지 기다린 뒤 재생 — 캔버스 정렬·검은화면 방지
      if (!video.videoWidth) {
        await new Promise((res) => {
          let done = false;
          const finish = () => { if (!done) { done = true; res(); } };
          video.addEventListener('loadedmetadata', finish, { once: true });
          setTimeout(finish, 1500); // 안전장치
        });
      }
      try { await video.play(); } catch (e) { /* 자동재생 정책: 무음·playsInline이라 보통 통과 */ }

      setStatus('ready');
      runningRef.current = true;
      setStatus('running');

      // 3) 프레임 루프 (requestVideoFrameCallback 우선, 없으면 rAF)
      let lastTs = 0;
      const loop = () => {
        if (!runningRef.current || !landmarkerRef.current || !video) return;
        let ts = performance.now();
        // MediaPipe는 동일/역행 timestamp에서 에러 → 단조증가 보장
        if (ts <= lastTs) ts = lastTs + 1;
        lastTs = ts;
        try {
          const res = landmarkerRef.current.detectForVideo(video, ts);
          const lms = res?.landmarks?.[0] || null;
          onResultRef.current?.(lms, ts, video);
        } catch (e) { /* 단일 프레임 오류는 무시하고 계속 */ }
        if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
          video.requestVideoFrameCallback(loop);
        } else {
          rafRef.current = requestAnimationFrame(loop);
        }
      };
      if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
        video.requestVideoFrameCallback(loop);
      } else {
        rafRef.current = requestAnimationFrame(loop);
      }
    } catch (err) {
      setError(err.message || String(err));
      setStatus('error');
      stop();
    }
  }, [modelTier]);

  // 자원 회수: 카메라 트랙 정지 + landmarker close + 루프 중단
  const stop = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    if (landmarkerRef.current) {
      try { landmarkerRef.current.close(); } catch (e) { /* noop */ }
      landmarkerRef.current = null;
    }
    setStatus('idle');
  }, []);

  const lockCapture = useCallback((point) => lockCameraCapture(streamRef.current, point), []);
  const unlockCapture = useCallback(() => unlockCameraCapture(streamRef.current), []);

  return { videoRef, start, stop, status, error, lockCapture, unlockCapture };
}
