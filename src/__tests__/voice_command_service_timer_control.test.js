// [음성 타이머 제어 2026-08-09] voiceCommandService.js — timer_control 응답 처리와
// buildTimerControlMessage 문구 생성. 도구 호출 자체(publishTimerControl/
// setPendingTimerCommand)는 timer_control_bus.test.js/pending_timer_command.test.js에서
// 이미 단위 검증했으므로, 여기서는 (1) voiceCommandService.js가 그 두 함수를 올바르게
// 가져다 쓰는지(정적 소스 패턴, 다른 voiceCommandService 테스트와 동일 컨벤션),
// (2) buildTimerControlMessage는 실제 함수를 실행해서 검증한다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildTimerControlMessage } from '../services/voiceCommandService.js';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');
const src = readSrc('src', 'services', 'voiceCommandService.js');

describe('voiceCommandService.js — timer_control 응답 처리(정적 소스 패턴)', () => {
  const start = src.indexOf("if (data.type === 'timer_control') {");
  const end = src.indexOf('\n  // type ===', start);
  const body = src.slice(start, end);

  it('timer_control 분기를 찾는다', () => {
    expect(start).toBeGreaterThan(-1);
  });

  it('tool/action이 없으면 chat으로 대체 응답한다(못 알아들은 경우)', () => {
    expect(body).toContain('if (!cmd.tool || !cmd.action) {');
    expect(body).toContain("return { type: 'chat',");
  });

  it('publishTimerControl로 먼저 실시간 전달을 시도한다', () => {
    expect(body).toContain('const deliveredLive = publishTimerControl(cmd);');
  });

  it('실시간 전달이 안 됐으면(false) setPendingTimerCommand로 저장하고 /ai로 이동시킨다', () => {
    expect(body).toContain('if (!deliveredLive) {');
    expect(body).toContain('setPendingTimerCommand(cmd);');
    expect(body).toContain("navigate('/ai')");
  });

  it('testId:\'timer\'로 pendingVoiceTarget도 같이 채운다(AiMeasureHub.jsx가 이미 지원하는 이동 경로 재사용)', () => {
    expect(body).toContain("setPendingVoiceTarget({ testId: 'timer' });");
  });

  it('publishTimerControl/setPendingTimerCommand를 올바른 모듈에서 가져온다', () => {
    expect(src).toContain("import { publishTimerControl } from '../voice/timerControlBus.js';");
    expect(src).toContain("import { setPendingTimerCommand } from '../voice/pendingTimerCommand.js';");
  });
});

describe('buildTimerControlMessage — 음성 안내 문구 생성', () => {
  it('tool/action이 없으면 실패 문구를 돌려준다', () => {
    expect(buildTimerControlMessage(null)).toContain('타이머를 조작하지 못했어요');
    expect(buildTimerControlMessage({})).toContain('타이머를 조작하지 못했어요');
  });

  it('초시계 시작/정지/리셋/랩 — 도구·동작 라벨을 자연스럽게 조합한다', () => {
    expect(buildTimerControlMessage({ tool: 'stopwatch', action: 'start' })).toBe('초시계 시작할게요.');
    expect(buildTimerControlMessage({ tool: 'stopwatch', action: 'pause' })).toBe('초시계 정지할게요.');
    expect(buildTimerControlMessage({ tool: 'stopwatch', action: 'reset' })).toBe('초시계 리셋할게요.');
    expect(buildTimerControlMessage({ tool: 'stopwatch', action: 'lap' })).toBe('초시계 랩 기록할게요.');
  });

  it('타이머(countdown) 시작 시 분·초를 사람이 읽기 좋은 형태로 붙인다', () => {
    expect(buildTimerControlMessage({ tool: 'countdown', action: 'start', seconds: 90 })).toBe('타이머 1분 30초로 시작할게요.');
    expect(buildTimerControlMessage({ tool: 'countdown', action: 'start', seconds: 45 })).toBe('타이머 45초로 시작할게요.');
    expect(buildTimerControlMessage({ tool: 'countdown', action: 'start', seconds: 120 })).toBe('타이머 2분으로 시작할게요.');
  });

  it('메트로놈 시작 시 BPM을 붙인다', () => {
    expect(buildTimerControlMessage({ tool: 'metronome', action: 'start', bpm: 120 })).toBe('메트로놈 120BPM로 시작할게요.');
  });

  it('인터벌 시작 시 운동·휴식·라운드를 언급된 것만 붙인다', () => {
    expect(buildTimerControlMessage({ tool: 'interval', action: 'start', workSec: 40, restSec: 20, rounds: 8 }))
      .toBe('인터벌 운동 40초 휴식 20초 8라운드로 시작할게요.');
    expect(buildTimerControlMessage({ tool: 'interval', action: 'start' })).toBe('인터벌 시작할게요.');
  });

  it('세부 파라미터 없이 도구/동작만 있어도 자연스러운 문장이 나온다', () => {
    expect(buildTimerControlMessage({ tool: 'metronome', action: 'pause' })).toBe('메트로놈 정지할게요.');
  });
});
