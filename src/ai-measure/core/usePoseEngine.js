// ai-measure/core/usePoseEngine.js
// 공통 포즈 엔진: 카메라 스트림 + MediaPipe Pose Landmarker.
// 모든 측정 메뉴가 이 훅 하나를 공유한다(중복 로드 방지).
//
// 설계:
//  - MediaPipe Tasks Vision 을 CDN(ESM)에서 동적 import → 빌드 의존성 0, 번들 비대화 방지.
//  - 메뉴 진입 시 init(), 이탈 시 stop() 으로 카메라·워커 자원 회수.
//  - onResult(landmarks, ts) 콜백으로 매 프레임 결과 전달. React state 우회(고주파).

import { useRef, useCallback, useState } from 'react';

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
      landmarkerRef.current = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
        // MediaPipe 내장 스무딩 비활성화(외부 필터링/정확 각도 위해)
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      // 2) 카메라 시작 (후면 우선, 해상도 fallback)
      const constraintsList = [
        { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: { facingMode: 'environment', width: { ideal: 854 }, height: { ideal: 480 } } },
        { video: { facingMode: 'user' } },
        { video: true },
      ];
      let stream = null;
      for (const c of constraintsList) {
        try { stream = await navigator.mediaDevices.getUserMedia(c); break; }
        catch (e) { /* 다음 제약으로 폴백 */ }
      }
      if (!stream) throw new Error('카메라를 사용할 수 없습니다. 권한을 확인해 주세요.');

      streamRef.current = stream;
      const video = videoEl || videoRef.current;
      if (!video) { stream.getTracks().forEach(t => t.stop()); return; }
      video.srcObject = stream;
      await video.play();

      setStatus('ready');
      runningRef.current = true;
      setStatus('running');

      // 3) 프레임 루프 (requestVideoFrameCallback 우선, 없으면 rAF)
      const loop = () => {
        if (!runningRef.current || !landmarkerRef.current || !video) return;
        const ts = performance.now();
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
