// [2026-11-13] "모미야" → "네, 선생님." 뒤 명령이 실행되지 않던 문제의 실행형 검증.
// 대기창(5초)이 호출 확정 시점부터 흘러, 느린 기기에서는 명령이 확정되기 전에 닫혔다.
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
  static available = async () => 'unavailable';
  constructor() { FakeSR.instances.push(this); }
  start() { queueMicrotask(() => this.onstart?.()); }
  stop() { queueMicrotask(() => this.onend?.()); }
  abort() { queueMicrotask(() => { this.onerror?.({ error: 'aborted' }); this.onend?.(); }); }
  emit(text, isFinal) {
    const result = Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal });
    this.onresult?.({ resultIndex: 0, results: [result] });
  }
}

const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

async function mountHook() {
  store.idx = 0;
  store.effects = [];
  const { useMomiVoice: momiVoice } = await import('../hooks/useMomiVoice');
  const commands = [];
  const mismatches = [];
  const wakes = [];
  const api = momiVoice({
    onCommand: (t) => commands.push(t),
    onMismatch: (t) => mismatches.push(t),
    onWakeOnly: () => wakes.push(1),
  });
  store.effects.forEach((fn) => fn());
  const recognition = FakeSR.instances[FakeSR.instances.length - 1];
  await api.startListening();
  await flush();
  return { commands, mismatches, wakes, recognition };
}

describe('모미 호출 뒤 명령 대기창 (실행형)', () => {
  beforeEach(() => {
    store.slots = []; store.idx = 0; store.effects = [];
    FakeSR.instances = [];
    globalThis.window = { SpeechRecognition: FakeSR };
    vi.stubGlobal('navigator', { userAgent: 'test', platform: 'Win32', maxTouchPoints: 0 });
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete globalThis.window; });

  it('대기창 안에 말을 시작했으면, 확정이 5초를 넘겨도 명령으로 실행한다', async () => {
    const { commands, mismatches, wakes, recognition } = await mountHook();
    recognition.emit('모미야', true);
    await vi.advanceTimersByTimeAsync(400);
    expect(wakes.length).toBe(1);
    // 모미 대답 + 마이크 재시작으로 3.6초가 지난 뒤에야 말이 들리기 시작(호출 후 4초)
    await vi.advanceTimersByTimeAsync(3600);
    recognition.emit('회원', false);
    await vi.advanceTimersByTimeAsync(900);
    recognition.emit('회원 관리', false);
    await vi.advanceTimersByTimeAsync(900);
    // 호출 확정 후 약 5.8초 시점에 확정 — 수정 전에는 5초에 창이 닫혀 mismatch로 버려졌다
    recognition.emit('회원 관리 열어 줘', true);
    await vi.advanceTimersByTimeAsync(400);
    expect(commands).toEqual(['회원 관리 열어 줘']);
    expect(mismatches).toEqual([]);
  });

  it('5초 동안 아무 말도 없으면 창이 닫히고, 그 뒤의 말은 명령으로 실행하지 않는다', async () => {
    const { commands, mismatches, recognition } = await mountHook();
    recognition.emit('모미야', true);
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(5100);
    recognition.emit('오늘 점심 뭐 먹지', true);
    await vi.advanceTimersByTimeAsync(400);
    expect(commands).toEqual([]);
    expect(mismatches).toEqual(['오늘 점심 뭐 먹지']);
  });
});
