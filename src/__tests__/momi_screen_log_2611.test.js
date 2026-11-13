// [2026-11-13] 모미 화면 진단 기록(momiLog) — 꺼져 있으면 아무것도 안 하고, 켜면 최근 줄만 보관한다.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

function fakeWindow(search, stored = {}) {
  const store = { ...stored };
  return {
    location: { search },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
  };
}

describe('momiLog 화면 진단 기록', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { delete globalThis.window; });

  it('기본은 꺼져 있고 기록하지 않는다', async () => {
    globalThis.window = fakeWindow('');
    const { momiLog, getMomiLogEntries, isMomiLogEnabled } = await import('../utils/momiLog');
    momiLog('마이크 켜짐');
    expect(isMomiLogEnabled()).toBe(false);
    expect(getMomiLogEntries()).toEqual([]);
  });

  it('?momilog=1 로 켜면 기록하고, 같은 줄 반복은 횟수로 합치며, 최근 14줄만 남긴다', async () => {
    globalThis.window = fakeWindow('?momilog=1');
    const { momiLog, getMomiLogEntries, isMomiLogEnabled } = await import('../utils/momiLog');
    expect(isMomiLogEnabled()).toBe(true);
    momiLog('마이크 켜짐');
    momiLog('마이크 켜짐');
    expect(getMomiLogEntries().map((e) => [e.text, e.count])).toEqual([['마이크 켜짐', 2]]);
    for (let i = 0; i < 20; i += 1) momiLog(`줄 ${i}`);
    const entries = getMomiLogEntries();
    expect(entries.length).toBe(14);
    expect(entries[entries.length - 1].text).toBe('줄 19');
  });

  it('한 번 켜면 이 기기에 기억하고, ?momilog=0 으로 끈다', async () => {
    globalThis.window = fakeWindow('', { momiLog: '1' });
    let mod = await import('../utils/momiLog');
    expect(mod.isMomiLogEnabled()).toBe(true);
    vi.resetModules();
    globalThis.window = fakeWindow('?momilog=0', { momiLog: '1' });
    mod = await import('../utils/momiLog');
    expect(mod.isMomiLogEnabled()).toBe(false);
  });
});
