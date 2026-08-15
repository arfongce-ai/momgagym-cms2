// timer_hud_kiosk.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-16] '초시계 · 타이머 · 메트로놈' 시각/청각 HUD 강화 회귀 테스트.
//   · 메트로놈: 모양 없이 공이 좌우로 왕복(메트로놈 케이스/진자 SVG 없음)
//   · 초시계: 0.001초(ms) 표시 + 코너 펄스
//   · 타이머: 아날로그 다이얼(줄어드는 파이) + 30/60/90/120초 프리셋 +
//     ±10초 수동 조정(실행 중 비활성화) + 10초 미만 긴급 펄스
//   · 오디오: 소음/음악 위에서도 들리도록 리미터(컴프레서)를 거쳐 출력
//   · 컨트롤 버튼 용어 영어화(-10s/+10s/Start/Stop/Reset)
//   기존 record_measure_skeleton_quality.test.js/timer_tool_voice_control.test.js
//   같은 파일들처럼 렌더링 대신 정적 소스 패턴으로 검증한다(브라우저 API 의존).
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p) => readFileSync(join(process.cwd(), 'src', p), 'utf8');
const timerSrc = read('ai-measure/menus/TimerTool.jsx');
const audioSrc = read('ai-measure/core/audioCue.js');

describe('audioCue.js — 소음/음악 위에서도 들리는 리미터', () => {
  it('getLimiterNode를 export한다(다이내믹스 컴프레서, 미지원 환경은 destination 폴백)', () => {
    expect(audioSrc).toContain('export function getLimiterNode(ctx)');
    expect(audioSrc).toContain("typeof ctx.createDynamicsCompressor === 'function'");
    // 미지원/모의 컨텍스트에서도 조용히 destination으로 폴백 — 기존 회귀 테스트의
    // 모의 AudioContext(createDynamicsCompressor 없음)와 100% 호환.
    expect(audioSrc).toContain('node = ctx.destination;');
  });

  it('기존 tone()/whistle()이 ctx.destination 대신 리미터를 거친다(getLimiterNode 내부의 컴프레서→destination 연결은 예외)', () => {
    const uses = audioSrc.match(/\.connect\(getLimiterNode\(ctx\)\);/g) || [];
    // tone() 1곳 + whistle()의 blast() 1곳 = 최소 2곳.
    expect(uses.length).toBeGreaterThanOrEqual(2);
    // getLimiterNode 함수 정의 구간만 잘라내고 나머지 코드에는 ctx.destination 직결이 없어야 한다.
    const fnStart = audioSrc.indexOf('export function getLimiterNode');
    const fnEnd = audioSrc.indexOf('\n}\n', fnStart) + 3;
    const rest = audioSrc.slice(0, fnStart) + audioSrc.slice(fnEnd);
    expect(rest).not.toMatch(/connect\(ctx\.destination\)/);
  });
});

describe('TimerTool.jsx — 리미터를 별도 import로 가져온다(기존 import 라인은 그대로 유지)', () => {
  it('기존 boostedGain/whistle/primeAudio import 라인을 건드리지 않는다', () => {
    // interval_whistle.test.js가 이 정확한 문자열을 검증하므로 절대 변경 금지.
    expect(timerSrc).toContain("import { boostedGain, whistle, primeAudio } from '../core/audioCue';");
  });

  it('getLimiterNode를 새 import로 가져와 3개 사운드 소스(메트로놈/타이머/인터벌) 모두에서 쓴다', () => {
    expect(timerSrc).toContain('import { getLimiterNode } from \'../core/audioCue\';');
    const uses = timerSrc.match(/getLimiterNode\(ctx\)/g) || [];
    expect(uses.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Metronome — 메트로놈 모양 없이 공이 좌우로 왕복', () => {
  const start = timerSrc.indexOf('export function Metronome(');
  const end = timerSrc.indexOf('export function Countdown(');
  const body = timerSrc.slice(start, end);

  it('진자/케이스 SVG 없이 트랙 위 공(.metro-ball)을 좌우로 translateX 한다', () => {
    expect(body).toContain('metro-ball');
    expect(body).toContain('metro-track');
    expect(body).toContain('translateX(');
    expect(body).not.toMatch(/rodGroup|pendulum|metronome-case/i);
  });

  it('오디오 클럭(ctx.currentTime) 기준으로 공 스윙을 스케줄해 소리와 어긋나지 않는다', () => {
    expect(body).toContain('nextNoteRef.current - ctx.currentTime');
    expect(body).toContain('swingBall(isDownBeat)');
  });

  it('Start/Stop 버튼이 영어로 표시된다', () => {
    expect(body).toContain("{playing ? 'Stop' : 'Start'}");
  });

  it('command 이펙트(음성 제어)는 손대지 않았다 — setBpm/setPlaying(true)만, start()는 직접 안 부름', () => {
    const cmdEffectStart = body.indexOf('if (!command) return;');
    expect(cmdEffectStart).toBeGreaterThan(-1);
    const cmdEffectBody = body.slice(cmdEffectStart, cmdEffectStart + 400);
    expect(cmdEffectBody).toContain('setPlaying(true);');
    expect(cmdEffectBody).not.toContain('start();');
  });
});

describe('Countdown(타이머) — 아날로그 다이얼 + 프리셋 + 수동 조정', () => {
  const start = timerSrc.indexOf('export function Countdown(');
  const end = timerSrc.indexOf('export function IntervalTimer(');
  const body = timerSrc.slice(start, end);

  it('30/60/90/120초 프리셋을 "Ns" 라벨로 보여준다(30초 단위, 2분까지)', () => {
    expect(body).toContain('[30, 60, 90, 120].map((sec)');
    expect(body).toContain('{sec}s');
  });

  it('-10s/+10s 수동 조정 버튼이 있고, 10초~20분으로 클램프한다', () => {
    expect(body).toContain('const TM_MIN_SEC = 10;');
    expect(body).toContain('const TM_MAX_SEC = 20 * 60;');
    expect(body).toContain('>-10s</button>');
    expect(body).toContain('>+10s</button>');
  });

  it('실행 중(running)에는 프리셋·수동 조정 버튼이 비활성화된다', () => {
    expect(body).toContain('const adjustDisabled = running;');
    expect(body).toContain('disabled={adjustDisabled}');
  });

  it('아날로그 다이얼(줄어드는 파이)이 --tm-pct/--tm-color CSS 변수로 진행률을 표시한다', () => {
    expect(body).toContain('tm-dial-wrap');
    expect(body).toContain("'--tm-pct': pct");
    expect(body).toContain("'--tm-color'");
  });

  it('10초 미만이면 다이얼이 빨간색 + 펄스(urgent-pulse)로 바뀐다', () => {
    expect(body).toContain('const urgent = remain > 0 && remain < 10000;');
    expect(body).toContain('urgent-pulse');
  });

  it('Start/Stop, Reset 버튼이 영어로 표시된다', () => {
    expect(body).toContain('>Reset</button>');
    expect(body).toContain("{running ? 'Stop' : 'Start'}");
  });

  it('기존 음성 제어 계약(totalSecOverride/command.seconds)은 그대로 유지된다', () => {
    expect(body).toContain('const start = (totalSecOverride) => {');
    expect(body).toContain("typeof totalSecOverride === 'number' && totalSecOverride > 0");
    expect(body).toContain('if (typeof command.seconds === \'number\' && command.seconds > 0) start(command.seconds);');
    expect(body).toContain('else if (!running) start();');
  });
});

describe('IntervalTimer — 키오스크 고대비 색상 + whistle 배선 불변', () => {
  const start = timerSrc.indexOf('export function IntervalTimer(');
  const end = timerSrc.indexOf('export default function TimerTool(');
  const body = timerSrc.slice(start, end);

  it('구간 배경/테두리가 더 진하고 뚜렷하다(/10→/20 배경, /40→ 실선 테두리)', () => {
    expect(body).toContain('bg-emerald-500/20 border-emerald-500');
    expect(body).toContain('bg-sky-500/20 border-sky-500');
    expect(body).toContain('bg-amber-500/20 border-amber-500');
  });

  it('interval_whistle.test.js가 고정한 whistle 배선(advance 이전 호출)은 그대로다', () => {
    const clean = timerSrc.replace(/\r/g, '');
    const idx = clean.indexOf('lastTickRef.current = -1;\n      whistle();');
    expect(idx).toBeGreaterThan(-1);
  });
});
