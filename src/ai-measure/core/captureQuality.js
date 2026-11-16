// captureQuality.js — 촬영 품질 실시간 집계 + 측정 품질 등급 (2026-11-16)
//
// 측정 오류의 대부분은 계산식이 아니라 "나쁜 촬영 조건"에서 온다(발 잘림, 너무 멂,
// 화질 낮음, 프레임 부족, 느린 CPU 모드). 두 인식 엔진(poseBackend·usePoseEngine)이
// 프레임마다 여기로 보고하고, 화면 상단 준비 신호등과 저장 직전 품질 등급이 이 값을 쓴다.
// 측정값 계산에는 개입하지 않는다(표시·경고·기록 전용). 순수 로직 + 작은 구독 스토어.
import { assessFraming, MIN_CAMERA_DISTANCE_MM, fillMinForDistanceMm } from './framingGuide';

const FPS_WINDOW_MS = 2000;
const NOTIFY_MS = 250;

// 판정 기준(현장 기준값 — 실측 쌓이면 조정)
export const CAPTURE_LIMITS = Object.freeze({
  shortSideGood: 720,   // 짧은 변 720px 이상(HD)
  shortSideMin: 480,    // 480 미만이면 관절 위치 오차가 커짐
  fpsGood: 24,          // 점프·스프린트 시간 측정에 필요한 하한
  fpsMin: 15,
});

const RANK = { good: 0, warn: 1, bad: 2 };
const worst = (levels) => levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'good');

export function judgeResolution(w, h) {
  if (!w || !h) return { level: 'warn', text: '화질 확인 중' };
  const s = Math.min(w, h);
  if (s >= CAPTURE_LIMITS.shortSideGood) return { level: 'good', text: `화질 ${s}p` };
  if (s >= CAPTURE_LIMITS.shortSideMin) return { level: 'warn', text: `화질 낮음 ${s}p` };
  return { level: 'bad', text: `화질 매우 낮음 ${s}p` };
}

export function judgeFps(fps) {
  if (fps == null) return { level: 'warn', text: '속도 확인 중' };
  const f = Math.round(fps);
  if (f >= CAPTURE_LIMITS.fpsGood) return { level: 'good', text: `${f}fps` };
  if (f >= CAPTURE_LIMITS.fpsMin) return { level: 'warn', text: `${f}fps 느림` };
  return { level: 'bad', text: `${f}fps 매우 느림` };
}

export function judgeDelegate(delegate) {
  if (delegate === 'CPU') return { level: 'warn', text: '느린 모드(CPU)' };
  if (delegate === 'GPU') return { level: 'good', text: '빠른 모드' };
  return { level: 'good', text: '' };
}

export function createCaptureTracker(now = () => Date.now()) {
  let minDistanceMm = null; // 메뉴별 최소 촬영 거리(mm) — setMenu 로 지정
  let times = [];
  let last = null; // { framing, w, h, at }
  let delegate = null;
  let total = 0;
  let fullBody = 0;
  let fpsSum = 0;
  let fpsN = 0;
  const reasons = { noPerson: 0, notFull: 0, tooFar: 0, tooClose: 0 };

  return {
    setDelegate(d) { delegate = d; },
    setMenu(menuId) { minDistanceMm = MIN_CAMERA_DISTANCE_MM[menuId] || null; },
    record(landmarks, video) {
      const t = now();
      times.push(t);
      while (times.length && t - times[0] > FPS_WINDOW_MS) times.shift();
      const framing = assessFraming(landmarks, { want: 'any', minDistanceMm });
      last = { framing, w: video?.videoWidth || 0, h: video?.videoHeight || 0, at: t };
      total += 1;
      if (framing.ok) fullBody += 1;
      else if (!landmarks || !landmarks.length) reasons.noPerson += 1;
      else if (!framing.fullBody) reasons.notFull += 1;
      else if (framing.fillRatio != null && framing.fillRatio < (minDistanceMm ? fillMinForDistanceMm(minDistanceMm) : 0.55)) reasons.tooFar += 1;
      else reasons.tooClose += 1;
      const fps = this.fps();
      if (fps != null && times.length >= 10) { fpsSum += fps; fpsN += 1; }
    },
    fps() {
      if (times.length < 2) return null;
      const span = times[times.length - 1] - times[0];
      return span > 0 ? ((times.length - 1) * 1000) / span : null;
    },
    /** 화면 신호등용 현재 상태. 최근 1.2초 안에 프레임이 없으면 null(카메라 꺼짐). */
    live() {
      if (!last || now() - last.at > 1200) return null;
      const res = judgeResolution(last.w, last.h);
      const fps = judgeFps(this.fps());
      const del = judgeDelegate(delegate);
      const frame = { level: last.framing.ok ? 'good' : last.framing.level === 'bad' ? 'bad' : 'warn', text: last.framing.message };
      const level = worst([frame.level, res.level, fps.level, del.level]);
      return { level, frame, resolution: res, fps, delegate: del };
    },
    /** 측정 한 번 동안의 누적 요약(저장 시 기록). */
    summary() {
      if (!total) return null;
      const r3 = (x) => Math.round(x * 1000) / 1000;
      return {
        frames: total,
        fullBodyRatio: r3(fullBody / total),
        avgFps: fpsN ? Math.round((fpsSum / fpsN) * 10) / 10 : null,
        resolution: last ? { w: last.w, h: last.h } : null,
        delegate: delegate || null,
        reasons: { ...reasons },
      };
    },
    reset() {
      times = []; last = null; total = 0; fullBody = 0; fpsSum = 0; fpsN = 0;
      Object.keys(reasons).forEach((k) => { reasons[k] = 0; });
    },
  };
}

// ── 세션 공용 스토어 (두 엔진이 같이 보고) ──
const _tracker = createCaptureTracker();
const _subs = new Set();
let _lastNotify = 0;

function notify(force = false) {
  const t = Date.now();
  if (!force && t - _lastNotify < NOTIFY_MS) return;
  _lastNotify = t;
  const snap = _tracker.live();
  _subs.forEach((fn) => { try { fn(snap); } catch (e) { /* 구독자 오류 무시 */ } });
}

export function recordCaptureFrame(landmarks, video) {
  _tracker.record(landmarks && landmarks.length ? landmarks : null, video);
  notify();
}
export function setCaptureDelegate(d) { _tracker.setDelegate(d); }
export function setCaptureMenu(menuId) { _tracker.setMenu(menuId); }
export function getCaptureLive() { return _tracker.live(); }
export function getCaptureSummary() { return _tracker.summary(); }
export function resetCaptureQuality() { _tracker.reset(); notify(true); }
export function subscribeCapture(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

// ── 측정 품질 등급 ─────────────────────────────────────────────────────
// recognition: recognitionStats.snapshot() / capture: summary()
// 영상 없이 입력만 하는 측정(신체정보·심폐 등)은 둘 다 없어서 null → 등급 표시 안 함.
export const QUALITY_KO = Object.freeze({ good: '좋음', fair: '보통', poor: '낮음' });

export function assessMeasureQuality({ recognition = null, capture = null, timing = false } = {}) {
  if (!recognition && !capture) return null;
  const reasons = [];
  let points = 100;
  const ratio = recognition?.ratio;
  if (ratio != null) {
    if (ratio < 0.6) { points -= 45; reasons.push(`관절 인식률 ${Math.round(ratio * 100)}% — 매우 낮음`); }
    else if (ratio < 0.8) { points -= 25; reasons.push(`관절 인식률 ${Math.round(ratio * 100)}% — 낮음`); }
  }
  if (capture) {
    const fb = capture.fullBodyRatio;
    if (fb != null && fb < 0.6) { points -= 30; reasons.push(`전신이 화면에 다 들어온 시간 ${Math.round(fb * 100)}%`); }
    else if (fb != null && fb < 0.85) { points -= 12; reasons.push(`전신이 잘린 시간이 있음(${Math.round((1 - fb) * 100)}%)`); }
    const r = capture.reasons || {};
    const worstReason = Object.entries(r).sort((a, b) => b[1] - a[1])[0];
    if (worstReason && worstReason[1] > 0 && fb != null && fb < 0.85) {
      const hint = { noPerson: '사람이 안 잡힌 구간이 많음', notFull: '머리나 발이 화면 밖으로 나감', tooFar: '카메라가 너무 멂', tooClose: '카메라가 너무 가까움' }[worstReason[0]];
      if (hint) reasons.push(hint);
    }
    const fps = capture.avgFps;
    if (fps != null) {
      const need = timing ? CAPTURE_LIMITS.fpsGood : CAPTURE_LIMITS.fpsMin;
      if (fps < need) { points -= timing ? 30 : 10; reasons.push(`초당 ${fps}프레임 — ${timing ? '시간 측정 오차 큼' : '느림'}`); }
    }
    const s = capture.resolution ? Math.min(capture.resolution.w, capture.resolution.h) : null;
    if (s && s < CAPTURE_LIMITS.shortSideMin) { points -= 20; reasons.push(`화질 ${s}p — 낮음`); }
    if (capture.delegate === 'CPU') { points -= 5; reasons.push('느린 모드(CPU)로 분석됨'); }
  }
  const score = Math.max(0, Math.min(100, points));
  const grade = score >= 80 ? 'good' : score >= 60 ? 'fair' : 'poor';
  return { grade, score, reasons, remeasure: grade === 'poor' };
}
