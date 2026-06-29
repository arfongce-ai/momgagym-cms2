// ai-measure/core/audioCue.js
// 측정 카운트다운/성공 알림용 사운드 큐.
// Web Audio API 로 즉석 합성한다 → 외부 오디오 파일/에셋 의존 0.
// 모바일 자동재생 정책: 사용자 탭(버튼)에서 처음 호출되므로 AudioContext 가
// 정상 resume 된다. 실패(미지원/차단) 시 조용히 무시하고 측정은 계속 진행.

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
    amp.gain.exponentialRampToValueAtTime(gain, now + 0.01);
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

/**
 * 사용자 제스처(버튼 탭) 시점에 먼저 호출해 두면 이후 setTimeout 안의
 * 사운드도 막히지 않는다(컨텍스트 워밍업).
 */
export function primeAudio() {
  getCtx();
}
