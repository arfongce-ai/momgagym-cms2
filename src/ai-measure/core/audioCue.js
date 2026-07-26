// ai-measure/core/audioCue.js
// 측정 카운트다운/성공 알림용 사운드 큐.
// Web Audio API 로 즉석 합성한다 → 외부 오디오 파일/에셋 의존 0.
// 모바일 자동재생 정책: 사용자 탭(버튼)에서 처음 호출되므로 AudioContext 가
// 정상 resume 된다. 실패(미지원/차단) 시 조용히 무시하고 측정은 계속 진행.

// ── 마스터 볼륨 ──
//  기본 출력을 기존보다 2.5배(BOOST) 키우고, 사용자가 0~100% 로 조절할 수 있다.
//  설정은 localStorage 에 유지되어 모든 측정 사운드(카운트다운·렙·메트로놈·
//  인터벌·타이머)에 공통 적용된다. 개별 유효 게인은 클리핑 방지를 위해 1.0 상한.
const VOLUME_STORAGE_KEY = 'momgagym.soundVolume';
const SOUND_BOOST = 2.5;

let _volume = (() => {
  try {
    const v = Number(localStorage.getItem(VOLUME_STORAGE_KEY));
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1;
  } catch { return 1; }
})();
const _volumeListeners = new Set();

/** 현재 사용자 볼륨(0~1). */
export function getSoundVolume() { return _volume; }

/** 사용자 볼륨 설정(0~1) — 저장 + 구독자 통지. */
export function setSoundVolume(v) {
  _volume = Math.min(1, Math.max(0, Number(v) || 0));
  try { localStorage.setItem(VOLUME_STORAGE_KEY, String(_volume)); } catch { /* noop */ }
  _volumeListeners.forEach(fn => { try { fn(_volume); } catch { /* noop */ } });
}

/** 볼륨 변경 구독(UI 동기화용). 반환값으로 해제. */
export function subscribeSoundVolume(fn) {
  _volumeListeners.add(fn);
  return () => _volumeListeners.delete(fn);
}

/**
 * 기준 게인 → 부스트(2.5×)·사용자 볼륨 적용 후 클리핑 상한(1.0) 클램프.
 * 흩어진 메트로놈/타이머/인터벌 사운드가 전부 이 함수를 거친다.
 */
export function boostedGain(base) {
  return Math.min(1, Math.max(0, base * SOUND_BOOST * _volume));
}

let _ctx = null;

function getCtx() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!_ctx) {
    try { _ctx = new AC(); } catch (e) { return null; }
  }
  // iOS/Safari: 사용자 제스처 안에서 resume 해야 소리가 난다.
  if (_ctx.state === 'suspended') { try { _ctx.resume(); } catch (e) { /* noop */ } }
  return _ctx;
}

// 단일 톤 재생. freq(Hz), dur(초), gain(0~1), type(파형)
function tone(freq = 880, dur = 0.12, gain = 0.18, type = 'sine') {
  const g = boostedGain(gain);
  if (g <= 0.001) return; // 음소거
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    // 짧은 attack/decay 로 '딱' 끊기는 클릭음 방지
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(g, now + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  } catch (e) { /* noop */ }
}

/** 카운트다운 '틱' 음 (3,2,1 매 숫자마다). 짧고 낮은 톤. */
export function beepTick() {
  tone(660, 0.10, 0.16, 'sine');
}

/** 카운트다운 직후 '측정 시작' 음 (0 시점). 약간 높고 길게. */
export function beepGo() {
  tone(990, 0.18, 0.2, 'sine');
}

/** 측정/캡처 성공 음 (상승 2음 차임). */
export function beepSuccess() {
  tone(784, 0.12, 0.18, 'sine');          // G5
  setTimeout(() => tone(1175, 0.16, 0.2, 'sine'), 110); // D6
}

/** 인식/잠금 등 가벼운 확인 음 (선택적 사용). */
export function beepConfirm() {
  tone(880, 0.09, 0.14, 'sine');
}

/** 렙 자동 카운트 음 — 렙이 올라갈 때마다 짧고 또렷하게. */
export function beepRep() {
  tone(1320, 0.08, 0.2, 'square');
}

/**
 * 인터벌 구간 종료용 '휘슬' — 심판 호루라기처럼 크고 또렷하게.
 *  · 코치가 멀리서도 듣도록 다른 큐보다 확연히 크게(높은 기준 게인 + 부스트/볼륨은
 *    boostedGain 이 클리핑 상한 1.0 으로 안전 관리).
 *  · 실제 호루라기의 두 가지 특징을 합성으로 흉내낸다:
 *     (1) 2.6~2.9kHz 고음역, (2) 빠른 트릴(주파수 미세 진동)로 '삐——릭' 질감.
 *  · 두 번 짧게 끊어 불어(뚜-뚜) 신호가 분명하게 들리도록 한다.
 *  · 미지원/차단 시 조용히 무시(측정·타이머는 계속 진행).
 */
export function whistle() {
  const ctx = getCtx();
  if (!ctx) return;
  const g = boostedGain(0.55); // 다른 큐(0.14~0.2)보다 크게
  if (g <= 0.001) return;
  const blast = (startOffset, dur) => {
    try {
      const now = ctx.currentTime + startOffset;
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      const trill = ctx.createOscillator(); // 주파수를 흔들어 호루라기 트릴 생성
      const trillAmp = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(2650, now);
      osc.frequency.linearRampToValueAtTime(2850, now + dur);
      trill.type = 'sine';
      trill.frequency.setValueAtTime(28, now); // 28Hz 트릴
      trillAmp.gain.setValueAtTime(70, now);   // ±70Hz 편이
      trill.connect(trillAmp).connect(osc.frequency);
      amp.gain.setValueAtTime(0.0001, now);
      amp.gain.exponentialRampToValueAtTime(g, now + 0.02);
      amp.gain.setValueAtTime(g, now + dur - 0.04);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(amp).connect(ctx.destination);
      trill.start(now); osc.start(now);
      trill.stop(now + dur + 0.02); osc.stop(now + dur + 0.02);
    } catch (e) { /* noop */ }
  };
  blast(0, 0.22);     // 뚜
  blast(0.30, 0.34);  // 뚜——(길게)
}

/**
 * 사용자 제스처(버튼 탭) 시점에 먼저 호출해 두면 이후 setTimeout 안의
 * 사운드도 막히지 않는다(컨텍스트 워밍업).
 */
export function primeAudio() {
  getCtx();
}
