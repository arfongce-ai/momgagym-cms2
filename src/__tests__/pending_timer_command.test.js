// [음성 타이머 제어 2026-08-09] pendingTimerCommand.js — TimerTool.jsx가 아직
// 화면에 열려있지 않을 때, 화면 이동 후 도착하면 실행할 명령을 1회성으로 담아
// 전달하는 저장소. pendingVoiceTarget.js의 기존 테스트(pending_voice_target_report_kind.test.js)
// 와 동일한 sessionStorage 메모리 스텁 패턴을 쓴다.
import { describe, expect, it, beforeEach } from 'vitest';
import { setPendingTimerCommand, consumePendingTimerCommand } from '../voice/pendingTimerCommand.js';

beforeEach(() => {
  const backing = {};
  global.sessionStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); },
    removeItem: (k) => { delete backing[k]; },
    clear: () => { Object.keys(backing).forEach((k) => delete backing[k]); },
  };
});

describe('pendingTimerCommand — 저장·복원', () => {
  it('tool/action이 있으면 저장하고 그대로 복원한다', () => {
    setPendingTimerCommand({ tool: 'countdown', action: 'start', seconds: 90 });
    const got = consumePendingTimerCommand();
    expect(got.tool).toBe('countdown');
    expect(got.action).toBe('start');
    expect(got.seconds).toBe(90);
  });

  it('tool 또는 action이 없으면 저장하지 않는다', () => {
    setPendingTimerCommand({ action: 'start' });
    expect(consumePendingTimerCommand()).toBeNull();
    setPendingTimerCommand({ tool: 'stopwatch' });
    expect(consumePendingTimerCommand()).toBeNull();
  });

  it('한 번 소비하면 지워진다(1회성)', () => {
    setPendingTimerCommand({ tool: 'metronome', action: 'start', bpm: 120 });
    consumePendingTimerCommand();
    expect(consumePendingTimerCommand()).toBeNull();
  });

  it('ts는 복원 결과에 포함되지 않는다(내부 메타데이터일 뿐)', () => {
    setPendingTimerCommand({ tool: 'stopwatch', action: 'start' });
    const got = consumePendingTimerCommand();
    expect(got.ts).toBeUndefined();
  });

  it('5분 넘게 묵은 값은 무시한다(pendingVoiceTarget.js와 동일 기준)', () => {
    const STORAGE_KEY = 'momi_pending_timer_command';
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      tool: 'interval', action: 'start', workSec: 30, ts: Date.now() - 6 * 60 * 1000,
    }));
    expect(consumePendingTimerCommand()).toBeNull();
  });

  it('저장 키가 pendingVoiceTarget과 다르다(서로 다른 소비 시점을 가져야 하므로 겹치면 안 됨)', () => {
    setPendingTimerCommand({ tool: 'stopwatch', action: 'start' });
    // pendingVoiceTarget의 STORAGE_KEY('momi_pending_voice_target')엔 아무 것도 안 쓰여있어야 한다.
    expect(sessionStorage.getItem('momi_pending_voice_target')).toBeNull();
  });
});
