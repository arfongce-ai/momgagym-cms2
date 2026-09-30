// [2026-09-30] useMomiVoice 실행형 검증 — 가짜 React 훅 + 가짜 SpeechRecognition으로
// 실제 onerror/onend/설치/로컬 복귀 흐름을 돌린다(브라우저·마이크 없이 이벤트 순서 검증).
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const store = { slots: [], idx: 0, effects: [] };
vi.mock('react', () => ({
  useState: (init) => {
    const i = store.idx++;
    if (!(i in store.slots)) store.slots[i] = { v: typeof init === 'function' ? init() : init };
    const slot = store.slots[i];
    return [slot.v, (v) => { slot.v = typeof v === 'function' ? v(slot.v) : v; }];
  },
  useRef: (init) => {
    const i = store.idx++;
    if (!(i in store.slots)) store.slots[i] = { current: init };
    return store.slots[i];
  },
  useCallback: (fn) => fn,
  useEffect: (fn) => { store.effects.push(fn); },
}));

class FakeSR {
  static instances = [];
  static availability = 'downloadable';
  static installImpl = async () => false;
  static available = async () => FakeSR.availability;
  static install = (opts) => FakeSR.installImpl(opts);
  constructor() {
    this.startCount = 0;
    this.abortCount = 0;
    FakeSR.instances.push(this);
  }
  start() { this.startCount += 1; queueMicrotask(() => this.onstart?.()); }
  stop() { queueMicrotask(() => this.onend?.()); }
  // 실제 브라우저처럼 abort()는 aborted 오류 뒤에 end를 낸다.
  abort() {
    this.abortCount += 1;
    queueMicrotask(() => { this.onerror?.({ error: 'aborted' }); this.onend?.(); });
  }
  emitError(error) { this.onerror?.({ error }); this.onend?.(); }
}

async function mountHook(cbs = {}) {
  store.idx = 0;
  store.effects = [];
  // 실제 React 없이 가짜 훅으로 직접 호출하므로, 훅 규칙 린트를 피하려고 별칭을 쓴다.
  const { useMomiVoice: momiVoice } = await import('../hooks/useMomiVoice');
  const statuses = [];
  const errors = [];
  const api = momiVoice({
    onRecognitionStatus: (...a) => statuses.push(a),
    onErrorOccurred: (e) => errors.push(e),
    ...cbs,
  });
  store.effects.forEach((fn) => fn());
  const recognition = FakeSR.instances[FakeSR.instances.length - 1];
  return { api, statuses, errors, recognition };
}

const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

describe('useMomiVoice 실행형 (가짜 SpeechRecognition)', () => {
  let warn; let info;
  beforeEach(() => {
    store.slots = []; store.idx = 0; store.effects = [];
    FakeSR.instances = []; FakeSR.availability = 'downloadable'; FakeSR.installImpl = async () => false;
    globalThis.window = { SpeechRecognition: FakeSR };
    vi.stubGlobal('navigator', { userAgent: 'test', platform: 'Win32', maxTouchPoints: 0 });
    vi.useFakeTimers();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete globalThis.window; });

  it('언어팩이 내려받기 가능이면 설치 안내 상태 후 원격 인식으로 시작한다', async () => {
    const { api, statuses, recognition } = await mountHook();
    await api.startListening();
    await flush();
    expect(statuses.map((s) => s[0])).toEqual(['local-install-required', 'online-listening']);
    expect(recognition.processLocally).toBe(false);
    expect(recognition.startCount).toBe(1);
  });

  it('install()이 false: 사유 returned-false를 전달하고, aborted는 경고가 아니라 정보 로그, 인식은 재개', async () => {
    const { api, statuses, recognition } = await mountHook();
    await api.startListening();
    await flush();
    const result = await api.installLocalRecognition();
    await flush();
    expect(result).toBe(false);
    const failed = statuses.find((s) => s[0] === 'local-install-failed');
    expect(failed[1]).toBe('returned-false');
    expect(recognition.abortCount).toBe(1);
    // 앱이 낸 aborted는 [모미] 인식 오류 경고로 남지 않는다
    expect(warn.mock.calls.some((c) => String(c[0]).includes('인식 오류') && c[1] === 'aborted')).toBe(false);
    expect(info.mock.calls.some((c) => String(c[0]).includes('직접 중단'))).toBe(true);
    // 실패 뒤 300ms 후 청취 재개
    const before = recognition.startCount;
    await vi.advanceTimersByTimeAsync(400);
    await flush();
    expect(recognition.startCount).toBeGreaterThan(before);
  });

  it('install()이 응답하지 않으면 시간 초과로 끝나고 인식이 다시 켜진다', async () => {
    FakeSR.installImpl = () => new Promise(() => {});
    const { api, statuses, recognition } = await mountHook();
    await api.startListening();
    await flush();
    const before = recognition.startCount;
    const pending = api.installLocalRecognition();
    await vi.advanceTimersByTimeAsync(100000);
    await pending;
    await flush();
    const failed = statuses.find((s) => s[0] === 'local-install-failed');
    expect(failed[1]).toBe('timeout');
    // 시간 초과 뒤 인식이 다시 켜졌다(꺼진 채 방치되지 않음)
    expect(recognition.startCount).toBeGreaterThan(before);
  });

  it('로컬 모드에서 language-not-supported면 processLocally=false로 실제 복귀해 재시작한다', async () => {
    FakeSR.availability = 'available';
    const { api, statuses, errors, recognition } = await mountHook();
    await api.startListening();
    await flush();
    expect(recognition.processLocally).toBe(true);
    const before = recognition.startCount;
    recognition.emitError('language-not-supported');
    await flush();
    expect(recognition.processLocally).toBe(false);
    expect(statuses.some((s) => s[0] === 'local-fallback' && s[1] === 'language-not-supported')).toBe(true);
    expect(errors).toEqual([]);
    expect(recognition.startCount).toBe(before + 1);
    // 원격에서도 같은 오류면 무한 재시작하지 않고 중단·보고
    const afterFallback = recognition.startCount;
    recognition.emitError('language-not-supported');
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(errors).toEqual(['language-not-supported']);
    expect(recognition.startCount).toBe(afterFallback);
  });

  it('network 오류는 화면 오류 콜백으로 보고되고 앱이 만든 값이 아니며, 세션은 재시작된다', async () => {
    const { api, errors, recognition } = await mountHook();
    await api.startListening();
    await flush();
    const before = recognition.startCount;
    recognition.emitError('network');
    await flush();
    expect(errors).toEqual(['network']);
    expect(recognition.startCount).toBe(before + 1);
    expect(warn.mock.calls.some((c) => c[1] === 'network')).toBe(true);
  });

  it('권한 거부(not-allowed)는 재시작하지 않는다', async () => {
    const { api, errors, recognition } = await mountHook();
    await api.startListening();
    await flush();
    const before = recognition.startCount;
    recognition.emitError('not-allowed');
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(errors).toEqual(['not-allowed']);
    expect(recognition.startCount).toBe(before);
  });
});
