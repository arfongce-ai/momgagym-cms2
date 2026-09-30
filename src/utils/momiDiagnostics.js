// 모미 음성인식 진단용 순수 유틸 — 앱 상태(인증·회원 데이터)에 의존하지 않는다.
// useMomiVoice(앱 안 진단)와 /mic-test(로그인 없는 독립 진단 페이지)가 같은 판정을 쓰도록 분리.
// 개인정보: 마이크 샘플은 브라우저 안에서 RMS 숫자로만 요약하고, 저장·전송하지 않는다.

export const LOCAL_INSTALL_TIMEOUT_MS = 90000;
export const MIC_AMBIENT_MS = 2000;
export const MIC_VOICE_MS = 3000;

export function hasMicSignal(ambientRms, voiceRms) {
  return Number.isFinite(voiceRms) && voiceRms >= Math.max(0.006, (Number.isFinite(ambientRms) ? ambientRms : 0) * 1.35);
}

// SpeechRecognition.install() 결과를 "미지원 / 반환 false / 예외 / 시간 초과 / 성공"으로 나눈다.
// install()은 사용자 제스처 안에서 동기적으로 불러야 하므로 이 함수도 동기적으로 호출한다.
export function requestLocalRecognitionInstall(SpeechRecognitionCtor, timeoutMs = LOCAL_INSTALL_TIMEOUT_MS) {
  if (typeof SpeechRecognitionCtor?.install !== 'function') {
    return Promise.resolve({ ok: false, reason: 'unsupported' });
  }
  let request;
  try {
    request = Promise.resolve(SpeechRecognitionCtor.install({ langs: ['ko-KR'], processLocally: true }));
  } catch (error) {
    return Promise.resolve({ ok: false, reason: 'threw', detail: error?.name || 'Error' });
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs);
    request.then(
      (value) => {
        clearTimeout(timer);
        resolve(value ? { ok: true } : { ok: false, reason: 'returned-false' });
      },
      (error) => {
        clearTimeout(timer);
        resolve({ ok: false, reason: 'threw', detail: error?.name || 'Error' });
      },
    );
  });
}

// 재시도해도 같은 결과일 가능성이 큰 사유(브라우저가 설치를 거부/미지원)는 버튼을 다시 보여주지 않는다.
export function isLocalInstallRetryable(reason) {
  return reason === 'timeout' || reason === 'threw' || reason === 'fallback';
}

export function describeLocalInstallFailure(reason, detail) {
  switch (reason) {
    case 'returned-false':
      return '이 브라우저가 한국어 음성팩 설치를 완료하지 않았어요(설치 불가 응답). 온라인 인식으로 계속 듣습니다.';
    case 'timeout':
      return '음성팩 설치 응답이 없어 중단했어요(시간 초과). 온라인 인식으로 계속 듣습니다. 다시 시도할 수 있어요.';
    case 'threw':
      return `음성팩 설치 중 브라우저 오류가 났어요(${detail || '알 수 없음'}). 온라인 인식으로 계속 듣습니다.`;
    case 'fallback':
      return `로컬 인식이 거부돼(${detail || '알 수 없음'}) 온라인 인식으로 되돌렸어요. 한국어 음성팩을 설치하면 다시 시도할 수 있어요.`;
    case 'unsupported':
      return '이 브라우저는 음성팩 설치를 지원하지 않아요. 온라인 인식으로 계속 듣습니다.';
    default:
      return '한국어 음성팩 설치에 실패했어요. 온라인 인식으로 계속 듣습니다.';
  }
}

// 마이크 측정 결과를 원인별로 나눈다. 순서가 중요하다(가장 구체적인 원인부터).
export function classifyMicMeasurement(m = {}) {
  const { ambientRms = 0, voiceRms = 0, contextState, trackMuted } = m;
  if (trackMuted) return 'track-muted';
  if (contextState && contextState !== 'running') return 'context-not-running';
  if (Math.max(ambientRms, voiceRms) < 0.0005) return 'silent-input';
  if (hasMicSignal(ambientRms, voiceRms)) return 'signal-detected';
  if (ambientRms >= 0.02) return 'ambient-loud-or-early-speech';
  return 'signal-low';
}

// SpeechRecognition onerror 코드를 앱이 취할 동작으로 분류한다.
//  no-speech: 정상 무음 타임아웃 / app-abort: 모미가 직접 abort()한 결과(브라우저 오류 아님)
//  local-fallback: 로컬 처리 실패 → 원격으로 복귀 / fatal: 재시작해도 회복 불가(권한·언어 미지원)
//  report: network·audio-capture 등 브라우저/서비스 쪽 오류(앱이 만든 값이 아님)
export function classifyRecognitionError(error, { localMode, abortedByApp } = {}) {
  if (error === 'no-speech') return 'no-speech';
  if (error === 'aborted') return abortedByApp ? 'app-abort' : 'aborted';
  const localFailure = error === 'language-not-supported' || error === 'service-not-allowed';
  if (localMode === 'local' && localFailure) return 'local-fallback';
  if (error === 'not-allowed' || localFailure) return 'fatal';
  return 'report';
}

const fmt = (n) => (Number.isFinite(n) ? n.toFixed(4) : '-');

export function describeMicDiagnostic(result = {}) {
  if (result.reason === 'unsupported') return '이 브라우저에서는 마이크 진단 기능을 사용할 수 없습니다.';
  if (result.reason === 'awaiting-reply') return '확인 답변을 기다리는 중이라 지금은 진단할 수 없어요. 답변이 끝난 뒤 다시 눌러 주세요.';
  if (result.reason) return `마이크 진단 실패: ${result.reason}`;
  const nums = `(주변 ${fmt(result.ambientRms)} → 발화 ${fmt(result.voiceRms)})`;
  switch (result.verdict) {
    case 'signal-detected':
      return `마이크 신호가 들어옵니다 ${nums}. 음성 문장을 못 돌려주는 브라우저 인식 엔진 쪽으로 원인이 좁혀졌습니다.`;
    case 'track-muted':
      return '마이크 입력이 음소거 상태예요(하드웨어 스위치·운영체제 개인정보 설정 확인).';
    case 'context-not-running':
      return `오디오 처리가 시작되지 않았어요(${result.contextState}). 화면을 한 번 클릭한 뒤 다시 시도해 주세요.`;
    case 'silent-input':
      return `입력이 거의 완전한 무음이에요 ${nums}. 운영체제 입력 장치 선택·음소거·마이크 연결을 확인해 주세요.`;
    case 'ambient-loud-or-early-speech':
      return `처음 2초에 이미 소리가 커서 비교할 수 없어요 ${nums}. 2초 동안 조용히 기다린 뒤 말해 주세요.`;
    default:
      return `말할 때 입력 신호 변화가 거의 없습니다 ${nums}. 운영체제 입력 장치와 마이크 연결을 확인해 주세요.`;
  }
}

// 마이크를 열어 처음 ambientMs는 주변, 이후 voiceMs는 발화 구간의 최대 RMS를 잰다.
// 스트림·AudioContext는 항상 정리한다. 오디오 샘플은 어디에도 저장·전송하지 않는다.
export async function measureMicrophone(constraints, { ambientMs = MIC_AMBIENT_MS, voiceMs = MIC_VOICE_MS, onTick } = {}) {
  let stream;
  let audioContext;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) throw new Error('AudioContext is not supported');
    audioContext = new AudioContextCtor();
    await audioContext.resume();
    const source = audioContext.createMediaStreamSource(stream);
    const highPass = audioContext.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = 120;
    const lowPass = audioContext.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = 4000;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(highPass);
    highPass.connect(lowPass);
    lowPass.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let ambientRms = 0;
    let voiceRms = 0;
    const startedAt = Date.now();
    while (Date.now() - startedAt < ambientMs + voiceMs) {
      analyser.getFloatTimeDomainData(samples);
      let sumSquares = 0;
      for (let i = 0; i < samples.length; i += 1) sumSquares += samples[i] * samples[i];
      const rms = Math.sqrt(sumSquares / samples.length);
      const inAmbient = Date.now() - startedAt < ambientMs;
      if (inAmbient) ambientRms = Math.max(ambientRms, rms);
      else voiceRms = Math.max(voiceRms, rms);
      onTick?.({ rms, phase: inAmbient ? 'ambient' : 'voice' });
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    const track = stream.getAudioTracks?.()[0];
    const settings = track?.getSettings?.() || {};
    const measurement = {
      ambientRms,
      voiceRms,
      contextState: audioContext.state,
      sampleRate: audioContext.sampleRate,
      trackMuted: Boolean(track?.muted),
      trackReadyState: track?.readyState,
      deviceLabel: track?.label || '',
      settings: {
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl,
        channelCount: settings.channelCount,
      },
    };
    return { ...measurement, verdict: classifyMicMeasurement(measurement), ok: hasMicSignal(ambientRms, voiceRms) };
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
    if (audioContext && audioContext.state !== 'closed') {
      try { await audioContext.close(); } catch (error) { /* no-op */ }
    }
  }
}
