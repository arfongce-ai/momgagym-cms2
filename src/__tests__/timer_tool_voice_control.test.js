// [음성 타이머 제어 2026-08-09] TimerTool.jsx — 초시계·타이머·인터벌·메트로놈이
// momi 음성 명령의 command prop을 받아 실제로 시작/정지/리셋되는지 배선을 확인.
// 이 파일은 requestAnimationFrame/AudioContext 등 브라우저 API에 깊게 얽혀있어
// (interval_whistle.test.js 등 기존 테스트도 같은 이유로 렌더링 대신 정적 소스
// 패턴을 쓴다) 여기서도 같은 컨벤션을 따른다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(process.cwd(), 'src/ai-measure/menus/TimerTool.jsx'), 'utf8');

describe('TimerTool.jsx — 실시간 버스·1회성 저장소를 가져와 쓴다', () => {
  it('subscribeTimerControl과 consumePendingTimerCommand를 둘 다 가져온다', () => {
    expect(src).toContain("import { subscribeTimerControl } from '../../voice/timerControlBus';");
    expect(src).toContain("import { consumePendingTimerCommand } from '../../voice/pendingTimerCommand';");
  });
});

describe('TimerTool.jsx — 4개 하위 도구가 전부 command prop을 받는다', () => {
  it('Stopwatch/Countdown/Metronome/IntervalTimer 시그니처에 command = null이 있다', () => {
    expect(src).toContain('export function Stopwatch({ compact = false, command = null }) {');
    expect(src).toContain('export function Countdown({ compact = false, command = null }) {');
    expect(src).toContain('export function Metronome({ compact = false, command = null }) {');
    expect(src).toContain('export function IntervalTimer({ compact = false, command = null }) {');
  });
});

describe('TimerTool.jsx — Stopwatch: start/pause/reset/lap 액션을 command로 실행한다', () => {
  const start = src.indexOf('export function Stopwatch(');
  const end = src.indexOf('export function Metronome(');
  const body = src.slice(start, end);

  it('command?.id를 의존성으로 하는 effect가 있다(같은 액션이 반복돼도 매번 실행되도록)', () => {
    expect(body).toContain('}, [command?.id]);');
  });

  it('기존 버튼 클릭 함수(startStop/reset/lap)를 그대로 재사용한다(새 로직을 따로 만들지 않음)', () => {
    expect(body).toContain("command.action === 'start'");
    expect(body).toContain('startStop()');
    expect(body).toContain("command.action === 'reset'");
    expect(body).toContain('reset();');
    expect(body).toContain("command.action === 'lap'");
    expect(body).toContain('lap();');
  });
});

describe('TimerTool.jsx — Countdown: seconds override로 비동기 state 함정을 피한다', () => {
  const start = src.indexOf('export function Countdown(');
  const end = src.indexOf('export function IntervalTimer(');
  const body = src.slice(start, end);

  it('start가 totalSecOverride를 받아 setMin/setSec state를 거치지 않고 바로 계산한다', () => {
    expect(body).toContain('const start = (totalSecOverride) => {');
    expect(body).toContain("typeof totalSecOverride === 'number' && totalSecOverride > 0");
  });

  it('command.seconds가 있으면 override로 start를 호출한다', () => {
    expect(body).toContain('if (typeof command.seconds === \'number\' && command.seconds > 0) start(command.seconds);');
  });

  it('seconds 없이 start면 기존 상태 기반 동작(else if (!running) start())으로 떨어진다', () => {
    expect(body).toContain('else if (!running) start();');
  });
});

describe('TimerTool.jsx — Metronome: 기존 bpm/playing 이펙트를 재사용한다(start/stop 함수 자체는 안 건드림)', () => {
  const start = src.indexOf('export function Metronome(');
  const end = src.indexOf('export function Countdown(');
  const body = src.slice(start, end);

  it('command 핸들러가 setBpm/setPlaying(true)만 호출하고, 실제 재생은 기존 useEffect([bpm, playing, start, stop])에 맡긴다', () => {
    const cmdEffectStart = body.indexOf('if (!command) return;');
    expect(cmdEffectStart).toBeGreaterThan(-1);
    const cmdEffectBody = body.slice(cmdEffectStart, cmdEffectStart + 400);
    expect(cmdEffectBody).toContain('setPlaying(true);');
    expect(cmdEffectBody).not.toContain('start();'); // 직접 start()를 부르지 않는다 — 자기수정 effect에 위임.
  });

  it('bpm 범위(40~220) 밖의 값은 무시한다', () => {
    expect(body).toContain('command.bpm >= 40 && command.bpm <= 220');
  });
});

describe('TimerTool.jsx — IntervalTimer: 설정 변경 후 다음 렌더에서 자동 시작(2단계 패턴)', () => {
  const start = src.indexOf('export function IntervalTimer(');
  const end = src.indexOf('export default function TimerTool(');
  const body = src.slice(start, end);

  it('pendingStartToken state로 "설정 반영 후 자동 시작"을 신호한다', () => {
    expect(body).toContain('const [pendingStartToken, setPendingStartToken] = useState(0);');
    expect(body).toContain('setPendingStartToken((t) => t + 1);');
  });

  it('startPause/enterPhase/advance/tick 등 기존 인터벌 엔진 함수는 시그니처를 바꾸지 않는다(회귀 방지 — interval_whistle.test.js가 지키는 tick 내부 whistle 배선과 충돌하면 안 됨)', () => {
    expect(body).toContain('const startPause = () => {');
    expect(body).not.toContain('const startPause = (overrideCfg)');
  });

  it('pendingStartToken이 바뀌면 startPause()를 호출해 새 설정으로 시작한다(0이면 마운트 시 자동 시작 방지)', () => {
    const tokenEffectStart = body.indexOf('if (pendingStartToken === 0) return;');
    expect(tokenEffectStart).toBeGreaterThan(-1);
    const tokenEffectBody = body.slice(tokenEffectStart, tokenEffectStart + 100);
    expect(tokenEffectBody).toContain('startPause();');
  });

  it('설정 오버라이드가 있으면 진행 중이던 것부터 완전히 멈추고 idle로 되돌린다(진행 중 라운드 설정이 뒤섞이지 않도록)', () => {
    const overrideStart = body.indexOf('const hasOverride =');
    const overrideEnd = body.indexOf('setPendingStartToken((t) => t + 1);', overrideStart);
    const overrideBody = body.slice(overrideStart, overrideEnd);
    expect(overrideBody).toContain("setPhase('idle');");
    expect(overrideBody).toContain('cancelAnimationFrame(rafRef.current);');
  });
});

describe('TimerTool.jsx — 기본 export: 탭 전환 + 명령 전달', () => {
  const start = src.indexOf('export default function TimerTool(');
  const body = src.slice(start);

  it('마운트 시 pending 명령을 소비해서 해당 탭을 열고 실행한다', () => {
    expect(body).toContain('const pending = consumePendingTimerCommand();');
    expect(body).toContain('setTab(pending.tool);');
  });

  it('실시간 버스를 구독하고, 언마운트 시 구독 해제한다', () => {
    expect(body).toContain('const unsubscribe = subscribeTimerControl((cmd) => {');
    expect(body).toContain('return unsubscribe;');
  });

  it('실시간 명령이 오면 해당 tool로 탭을 전환한다(다른 탭을 보고 있어도 명령이 온 도구로 자동 전환)', () => {
    const busStart = body.indexOf('subscribeTimerControl((cmd) => {');
    const busEnd = body.indexOf('return unsubscribe;', busStart);
    const busBody = body.slice(busStart, busEnd);
    expect(busBody).toContain('setTab(cmd.tool);');
  });

  it('현재 탭에 해당하는 컴포넌트에만 liveCommand를 command prop으로 내려준다', () => {
    expect(body).toContain('<Stopwatch command={liveCommand} />');
    expect(body).toContain('<Countdown command={liveCommand} />');
    expect(body).toContain('<IntervalTimer command={liveCommand} />');
    expect(body).toContain('<Metronome command={liveCommand} />');
  });
});
