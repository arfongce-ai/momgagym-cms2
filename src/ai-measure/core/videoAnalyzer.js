// ai-measure/core/videoAnalyzer.js
// ════════════════════════════════════════════════════════════════════════
//  업로드 영상 → 포즈 분석 공통 엔진 (모든 AI측정 메뉴가 재사용)
//  - seek 기반 frame-stepping: currentTime 을 점프시키고 'seeked' 를 기다린 뒤
//    그 프레임을 추론한다. 재생속도(1배속)에 묶이지 않아 빠르고, 프레임이
//    정확히 한 번씩만 처리된다(중복/누락 없음).
//  - 1280×720 다운스케일 캔버스에 그려서 추론 → 메모리/연산 부하 감소.
//  - detectForVideo 타임스탬프 단조증가 보장.
//
//  보행 전용 로직은 전혀 없음. push 콜백으로 landmarks 를 흘려보내므로
//  어떤 측정(보행/역도/자세 등)이든 자기 누적기를 붙여 쓰면 된다.
// ════════════════════════════════════════════════════════════════════════

import { loadPoseLandmarker, detectPoseFrame } from './poseBackend';

// 분석 처리 해상도 (요구사항 3: 메모리 부하 감소)
export const ANALYZE_MAX = { width: 1280, height: 720 };

// 영상 길이에 맞춰 분석할 프레임 수(샘플레이트)를 정한다.
// 너무 촘촘하면 느리고, 너무 성기면 케이던스/각도 정밀도가 떨어진다.
// 목표 ~30fps 상당(보행 분석에 충분), 최대 프레임 상한으로 폭주 방지.
const DEFAULT_TARGET_FPS = 30;
const DEFAULT_MAX_FRAMES = 600; // 안전 상한 (예: 20초 영상까지 30fps)

// ── 고속촬영(슬로모) 프리셋 ──────────────────────────────────────────
// 폰 슬로모는 240/120fps 로 찍어 30fps 컨테이너로 "느리게" 저장된다.
// → video.duration 이 실제의 N배. 시간 기반 지표(케이던스·속도)는 tMs 를
//   N으로 나눠 실제 시간축으로 환산해야 한다. (각도·대칭 등은 영향 없음)
// playbackRate = 컨테이너시간 / 실제시간 = 슬로모 배수.
//  - 일반 영상: 1
//  - 120fps 슬로모(30fps 저장): 4
//  - 240fps 슬로모(30fps 저장): 8
// 슬로모는 디테일이 촘촘하므로 targetFps 도 함께 올린다(빠른 임팩트 포착).
export const CAPTURE_PRESETS = {
  normal:    { label: '일반 (30fps)',        playbackRate: 1, targetFps: 30 },
  slowmo120: { label: '슬로모 120fps',       playbackRate: 4, targetFps: 60 },
  slowmo240: { label: '슬로모 240fps',       playbackRate: 8, targetFps: 90 },
};

/**
 * 업로드된 비디오 엘리먼트를 seek 하며 프레임마다 포즈를 추론한다.
 *
 * @param {object} args
 *  - video        : 이미 src 가 로드된 <video> (metadata 까지 준비됨)
 *  - onFrame      : ({ landmarks, tMs, realMs, index, total }) => void
 *                   tMs   = 실제 시간축(슬로모 보정 후) — 케이던스/속도 계산용
 *                   realMs= 컨테이너 시간(보정 전) — 영상 위 오버레이/탐색용
 *  - onProgress   : (ratio01) => void                            진행률(0~1)
 *  - targetFps    : 분석 샘플레이트 (프리셋에 없으면 이 값 사용)
 *  - playbackRate : 슬로모 배수 (1=일반, 4=120fps, 8=240fps). 기본 1.
 *  - maxFrames    : 프레임 상한 (기본 동적: 길이·fps 보고 자동 산정)
 *  - modelTier    : 'full' | 'lite' | 'heavy'
 *  - signal       : AbortSignal (취소 지원)
 * @returns {Promise<{ frames, durationSec, realDurationSec, playbackRate, aborted }>}
 */
export async function analyzeUploadedVideo({
  video, onFrame, onProgress,
  targetFps = DEFAULT_TARGET_FPS, playbackRate = 1, maxFrames,
  modelTier = 'full', signal,
}) {
  await loadPoseLandmarker({ numPoses: 1, modelTier });

  const duration = video.duration;
  if (!duration || !Number.isFinite(duration)) {
    throw new Error('영상 길이를 읽을 수 없습니다. 다른 파일로 시도해 주세요.');
  }

  // 처리용 다운스케일 캔버스 (원본 비율 유지하며 1280×720 박스 안에 맞춤)
  const vw = video.videoWidth || ANALYZE_MAX.width;
  const vh = video.videoHeight || ANALYZE_MAX.height;
  const scale = Math.min(1, ANALYZE_MAX.width / vw, ANALYZE_MAX.height / vh);
  const cw = Math.round(vw * scale);
  const ch = Math.round(vh * scale);
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d', { alpha: false });

  // 프레임 상한: 슬로모는 더 많은 프레임이 필요하므로 동적으로 잡되,
  // 메모리/연산 폭주를 막는 절대 상한(1800 ≈ 90fps×20s)을 둔다.
  const ABS_MAX = 1800;
  const cap = Math.min(ABS_MAX, maxFrames || Math.ceil(duration * targetFps));
  const total = Math.min(cap, Math.max(1, Math.floor(duration * targetFps)));
  const dt = duration / total;

  // seek 완료를 Promise 로 대기 (frame-stepping 핵심)
  const seekTo = (t) => new Promise((resolve) => {
    const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
    video.addEventListener('seeked', onSeeked);
    // 끝을 살짝 넘지 않도록 클램프
    video.currentTime = Math.min(t, Math.max(0, duration - 1e-3));
  });

  video.pause(); // 재생 대신 seek 으로 제어

  let tsMono = 0; // detectForVideo 단조증가 타임스탬프
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) return { frames: i, durationSec: duration, realDurationSec: duration / playbackRate, playbackRate, aborted: true };

    await seekTo(i * dt);
    if (signal?.aborted) return { frames: i, durationSec: duration, realDurationSec: duration / playbackRate, playbackRate, aborted: true };

    // 다운스케일 캔버스에 그려 추론 (메모리 절약)
    ctx.drawImage(video, 0, 0, cw, ch);

    // 단조증가 보장: 실제 영상시간(ms)이 같거나 역행해도 +1 보정
    const realMs = Math.round(video.currentTime * 1000);
    tsMono = Math.max(tsMono + 1, realMs);

    let landmarks = null;
    try {
      const res = detectPoseFrame(canvas, tsMono); // video 대신 캔버스 전달
      landmarks = res?.landmarks || null;
    } catch (e) { landmarks = null; }

    if (landmarks && typeof onFrame === 'function') {
      // tMs = 실제 시간축(슬로모 보정). 케이던스/속도 등 '초당' 지표가 이 값을 쓴다.
      //   slowmo 8배 → 컨테이너 8초가 실제 1초이므로 tMs = realMs / 8.
      // realMs = 컨테이너 시간(보정 전). 영상 위 오버레이/탐색이 필요하면 이 값.
      onFrame({
        landmarks,
        tMs: realMs / playbackRate,
        realMs,
        index: i, total,
      });
    }
    if (typeof onProgress === 'function') onProgress((i + 1) / total);

    // 이벤트루프 양보 (UI 프리징 방지)
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
  }

  return {
    frames: total,
    durationSec: duration,                  // 컨테이너 길이
    realDurationSec: duration / playbackRate, // 실제 시간 길이
    playbackRate,
    aborted: false,
  };
}
