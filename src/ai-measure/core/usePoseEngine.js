// ai-measure/core/usePoseEngine.js
// 공통 포즈 엔진: 카메라 스트림 + MediaPipe Pose Landmarker.
// 모든 측정 메뉴가 이 훅 하나를 공유한다(중복 로드 방지).
//
// 설계:
//  - MediaPipe Tasks Vision 을 CDN(ESM)에서 동적 import → 빌드 의존성 0, 번들 비대화 방지.
//  - 메뉴 진입 시 init(), 이탈 시 stop() 으로 카메라·워커 자원 회수.
//  - onResult(landmarks, ts) 콜백으로 매 프레임 결과 전달. React state 우회(고주파).

import { useRef, useCallback, useState } from 'react';
import { openMainCameraStream } from './cameraSelect';

const VISION_CDN =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export function usePoseEngine({ onResult } = {}) {
  const videoRef = useRef(null);
  const landmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const runningRef = useRef(false);

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
      const buildOpts = (delegate) => ({
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
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
      const video = videoEl || videoRef.current;
      if (!video) { stream.getTracks().forEach(t => t.stop()); return; }
      video.srcObject = stream;
      await video.play();

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
          onResult?.(lms, ts, video);
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
  }, [onResult]);

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

  return { videoRef, start, stop, status, error };
}
