// [음성 타이머 제어 2026-08-09] timerControlBus.js — TimerTool.jsx가 이미 화면에
// 떠 있을 때 momi 명령을 실시간으로 전달하는 발행-구독 버스. 실제 모듈을 import해서
// 동작을 직접 검증한다(다른 voice 관련 순수 로직 테스트, 예: schedule_voice_target
// 대신 pendingVoiceTarget.test.js 처럼 side-effect가 없는 순수 함수라 정적 패턴이
// 아니라 실제 실행으로 검증하는 편이 더 신뢰도 높다).
import { describe, expect, it, afterEach } from 'vitest';
import {
  subscribeTimerControl,
  publishTimerControl,
  _resetTimerControlBusForTest,
} from '../voice/timerControlBus.js';

afterEach(() => {
  _resetTimerControlBusForTest();
});

describe('timerControlBus — 구독자가 없으면 false(=아직 화면이 안 열려있다는 신호)', () => {
  it('구독자가 하나도 없을 때 publish하면 false를 돌려주고 아무 일도 안 한다', () => {
    expect(publishTimerControl({ tool: 'stopwatch', action: 'start' })).toBe(false);
  });
});

describe('timerControlBus — 구독자가 있으면 즉시 전달하고 true', () => {
  it('구독한 콜백이 publish한 cmd를 그대로 받는다', () => {
    let received = null;
    subscribeTimerControl((cmd) => { received = cmd; });
    const delivered = publishTimerControl({ tool: 'metronome', action: 'start', bpm: 120 });
    expect(delivered).toBe(true);
    expect(received).toEqual({ tool: 'metronome', action: 'start', bpm: 120 });
  });

  it('구독자가 여러 명이면 전부에게 전달된다', () => {
    const calls = [];
    subscribeTimerControl((cmd) => calls.push(['a', cmd]));
    subscribeTimerControl((cmd) => calls.push(['b', cmd]));
    publishTimerControl({ tool: 'countdown', action: 'reset' });
    expect(calls.length).toBe(2);
  });

  it('구독 해제(unsubscribe) 후에는 더 이상 받지 않는다', () => {
    let count = 0;
    const unsubscribe = subscribeTimerControl(() => { count += 1; });
    publishTimerControl({ tool: 'stopwatch', action: 'start' });
    unsubscribe();
    publishTimerControl({ tool: 'stopwatch', action: 'start' });
    expect(count).toBe(1);
  });

  it('구독자가 전부 해제되면 다시 false로 돌아간다(화면이 닫혔다는 신호)', () => {
    const unsubscribe = subscribeTimerControl(() => {});
    unsubscribe();
    expect(publishTimerControl({ tool: 'interval', action: 'reset' })).toBe(false);
  });
});
