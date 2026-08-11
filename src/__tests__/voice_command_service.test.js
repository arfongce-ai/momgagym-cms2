// voiceCommandService.js — 명령 처리 실패 시 원인(detail)을 그대로 삼키지 않고
// Error 메시지에 담아 넘기는지 확인. 다른 voice 관련 테스트와 마찬가지로 vitest
// 환경이 'node'라 정적 소스 패턴을 따른다(momi_voice.test.js 참고). 단, 이 파일의
// matchRuleBasedDestination·extractMemberNameFromText는 firebase.js를 통째로
// import해도 vitest 'node' 환경에서 문제없이 동작함을 확인해서(zzz_import_check로
// 검증 후 제거), matchWakeWord와 마찬가지로 실제 함수를 직접 불러와 검증한다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  matchRuleBasedDestination,
  matchRuleBasedSubKind,
  matchRuleBasedTimerControl,
  extractMemberNameFromText,
  matchRuleBasedSessionAdjust,
  matchRuleBasedPhoneUpdate,
  matchRuleBasedMemoAdd,
} from '../services/voiceCommandService.js';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

// [버그 수정 2026-08-08] "명령이 실행 안 된다"는 문의 대응 — 예전엔 res.ok가
// false면 상태 코드만 담아 던져서, 백엔드(functions/api/voice-command.js)가
// 실패 응답에 이미 담아 보내주는 detail(예: Anthropic API 크레딧 부족 등 실제
// 원인)이 화면까지 전혀 전달되지 않았다.
describe('voiceCommandService.js — 실패 응답의 detail을 삼키지 않는다(회귀 방지)', () => {
  const src = readSrc('src', 'services', 'voiceCommandService.js');

  it('res.ok가 false면 응답 본문을 읽어서 detail/error를 뽑아낸다', () => {
    const start = src.indexOf('if (!res.ok) {');
    const end = src.indexOf('const data = await res.json();', start);
    const body = src.slice(start, end);
    expect(body).toContain('await res.json()');
    expect(body).toContain('body?.detail || body?.error');
  });

  it('추출한 detail을 Error 메시지에 포함해서 던진다', () => {
    const start = src.indexOf('if (!res.ok) {');
    const end = src.indexOf('const data = await res.json();', start);
    const body = src.slice(start, end);
    expect(body).toMatch(/throw new Error\(`.*\$\{detail/);
  });

  it('응답이 JSON이 아니어도(네트워크 레벨 오류 등) try/catch로 방어해 죽지 않는다', () => {
    const start = src.indexOf('if (!res.ok) {');
    const end = src.indexOf('const data = await res.json();', start);
    const body = src.slice(start, end);
    expect(body).toContain('try {');
    expect(body).toContain('catch (e) {');
  });
});

// [무료 우선 2026-08-08] Claude(유료) 호출 전에 규칙 기반(키워드)으로 먼저 처리해서
// 목적지가 명확한 명령은 API 비용 없이 $0으로 끝낸다. 실제 신고된 명령
// 문장들("가상 회원 리포트 열어 줘" 등)로 검증한다.
describe('matchRuleBasedDestination() — 무료 규칙 기반 목적지 매칭', () => {
  it('실제 신고된 문장 "가상 회원 리포트 열어 줘"는 report로 간다(회원이 아니라)', () => {
    // "회원"도 들어있지만 "리포트"가 우선순위가 높아야 한다 — 실제 의도는 리포트 조회.
    expect(matchRuleBasedDestination('가상 회원 리포트 열어 줘')).toBe('report');
  });

  it('실제 신고된 문장 "종합 리포트 열어 줘"는 report로 간다', () => {
    expect(matchRuleBasedDestination('종합 리포트 열어 줘')).toBe('report');
  });

  it('"가상 회원 결과 리포트 띄워 줘"(다른 이동 동사)도 report로 간다', () => {
    expect(matchRuleBasedDestination('가상 회원 결과 리포트 띄워 줘')).toBe('report');
  });

  it('"회원관리 열어줘"는 members로 간다', () => {
    expect(matchRuleBasedDestination('회원관리 열어줘')).toBe('members');
  });

  it('"스케줄 보여줘"는 schedule로 간다', () => {
    expect(matchRuleBasedDestination('스케줄 보여줘')).toBe('schedule');
  });

  it('"AI측정 화면 열어줘"는 ai_measure로 간다', () => {
    expect(matchRuleBasedDestination('AI측정 화면 열어줘')).toBe('ai_measure');
  });

  it('이동 동사가 없으면(의도 불명확) null — Claude로 넘어감', () => {
    expect(matchRuleBasedDestination('리포트')).toBeNull();
    expect(matchRuleBasedDestination('회원')).toBeNull();
  });

  it('목적지 키워드가 전혀 없으면 null — Claude로 넘어감(코칭 질문 등)', () => {
    expect(matchRuleBasedDestination('오늘 컨디션 어때요')).toBeNull();
  });

  it('[보안] 관리자 전용 화면(트레이너관리·매출관리)은 이동 동사가 있어도 null — 반드시 Claude(서버 검증) 경로로 보낸다', () => {
    // 여기서 role 없이도 매치를 안 시켜야 한다 — 클라이언트 role은 조작 가능해서
    // 규칙 기반 경로에서 그냥 통과시키면 안 됨(verifyFirebaseToken.js가 지키는 것과 같은 이유).
    expect(matchRuleBasedDestination('트레이너 관리 화면 열어 줘')).toBeNull();
    expect(matchRuleBasedDestination('매출관리 열어줘')).toBeNull();
  });

  it('코칭 질문에 목적지 키워드가 우연히 섞여도(이동 동사 없으면) 오작동 안 함', () => {
    expect(matchRuleBasedDestination('이 회원한테 어떤 운동을 추천해야 할까요')).toBeNull();
  });
});

// [무료 확장 2026-08-10] 목적지는 정해졌는데 화면 안 세부 탭/측정 종류를 예전엔
// 규칙 기반이 못 뽑아 항상 Claude(유료)로 넘겼다. "정해진 단어 목록 중 하나
// 찾기"는 목적지 매칭과 원리가 같아서 무료로도 충분히 가능함을 확인한다.
describe('matchRuleBasedSubKind() — 무료 규칙 기반 세부 탭/측정 종류 매칭(2026-08-10)', () => {
  it('회원관리: "수납"/"결제"는 payments 탭으로 간다', () => {
    expect(matchRuleBasedSubKind('members', '김철수님 수납 내역 보여줘')).toBe('payments');
    expect(matchRuleBasedSubKind('members', '결제 탭 열어줘')).toBe('payments');
  });

  it('회원관리: "세션"/"잔여횟수"는 sessions 탭으로 간다', () => {
    expect(matchRuleBasedSubKind('members', '김철수님 세션 보여줘')).toBe('sessions');
    expect(matchRuleBasedSubKind('members', '잔여횟수 확인해줘')).toBe('sessions');
  });

  it('회원관리: "신체정보"/"체성분"은 body 탭으로 간다', () => {
    expect(matchRuleBasedSubKind('members', '신체정보 열어줘')).toBe('body');
    expect(matchRuleBasedSubKind('members', '체성분 보여줘')).toBe('body');
  });

  it('회원관리: "메모"는 memo 탭으로 간다', () => {
    expect(matchRuleBasedSubKind('members', '메모 확인해줘')).toBe('memo');
  });

  it('회원관리: "기본정보"는 info 탭으로 간다', () => {
    expect(matchRuleBasedSubKind('members', '기본정보 열어줘')).toBe('info');
  });

  it('[보안 아님, 정확도 문제] 회원관리에서 "측정이력"은 일부러 매칭하지 않는다(ai_measure 키워드와 겹쳐 오작동 위험)', () => {
    expect(matchRuleBasedSubKind('members', '측정이력 보여줘')).toBeNull();
  });

  it('리포트: 7종 측정 종류를 키워드로 찾는다', () => {
    expect(matchRuleBasedSubKind('report', '점프 리포트 보여줘')).toBe('jump');
    expect(matchRuleBasedSubKind('report', '자세 리포트 열어줘')).toBe('posture');
    expect(matchRuleBasedSubKind('report', 'ROM 리포트 보여줘')).toBe('rom');
    expect(matchRuleBasedSubKind('report', '보행 리포트 열어줘')).toBe('gait');
    expect(matchRuleBasedSubKind('report', '바벨 리포트 보여줘')).toBe('lifting');
    expect(matchRuleBasedSubKind('report', '한다리서기 리포트 열어줘')).toBe('stance');
    expect(matchRuleBasedSubKind('report', '오버헤드스쿼트 리포트 보여줘')).toBe('squat');
  });

  it('AI측정: 리포트와 같은 7종에 더해 body·record·timer도 찾는다', () => {
    expect(matchRuleBasedSubKind('ai_measure', '신체정보 측정하게 해줘')).toBe('body');
    expect(matchRuleBasedSubKind('ai_measure', '녹화 열어줘')).toBe('record');
    expect(matchRuleBasedSubKind('ai_measure', '초시계 열어줘')).toBe('timer');
    expect(matchRuleBasedSubKind('ai_measure', '점프 측정하게 해줘')).toBe('jump');
  });

  it('세부 키워드가 전혀 없으면 null(기존처럼 목적지 화면만 열림 — 회귀 아님)', () => {
    expect(matchRuleBasedSubKind('members', '회원관리 열어줘')).toBeNull();
    expect(matchRuleBasedSubKind('report', '리포트 열어줘')).toBeNull();
  });

  it('회원관리·리포트·AI측정이 아닌 목적지는 항상 null(적용 대상 아님)', () => {
    expect(matchRuleBasedSubKind('home', '홈 열어줘')).toBeNull();
    expect(matchRuleBasedSubKind('schedule', '점프 스케줄 보여줘')).toBeNull();
  });

  it('processVoiceCommand의 규칙 기반 분기가 matchRuleBasedSubKind를 실제로 호출해서 배선한다', () => {
    const src = readSrc('src', 'services', 'voiceCommandService.js');
    const start = src.indexOf('const ruleDestId = matchRuleBasedDestination(transcript);');
    const end = src.indexOf('if (navigate) navigate(destination.path);', start);
    const body = src.slice(start, end);
    expect(body).toContain('const subKind = matchRuleBasedSubKind(ruleDestId, transcript);');
    expect(body).toContain("testId: ruleDestId === 'ai_measure' ? subKind : null,");
    expect(body).toContain("openReportKind: ruleDestId === 'report' ? subKind : null,");
    expect(body).toContain("memberTab: ruleDestId === 'members' ? subKind : null,");
  });
});

// [무료 확장 2026-08-10] 숫자 설정이 없는 단순 타이머 명령(도구+동작만)은
// 목적지 매칭과 같은 원리의 단어 목록 문제라 무료로 가능하다.
describe('matchRuleBasedTimerControl() — 무료 규칙 기반 단순 타이머 제어(2026-08-10)', () => {
  it('초시계 시작/정지/리셋/랩을 전부 인식한다', () => {
    expect(matchRuleBasedTimerControl('초시계 시작해줘')).toEqual({ tool: 'stopwatch', action: 'start' });
    expect(matchRuleBasedTimerControl('초시계 멈춰줘')).toEqual({ tool: 'stopwatch', action: 'pause' });
    expect(matchRuleBasedTimerControl('초시계 리셋해줘')).toEqual({ tool: 'stopwatch', action: 'reset' });
    expect(matchRuleBasedTimerControl('초시계 랩 기록해줘')).toEqual({ tool: 'stopwatch', action: 'lap' });
  });

  it('타이머(카운트다운)·인터벌·메트로놈도 인식한다', () => {
    expect(matchRuleBasedTimerControl('타이머 시작해줘')).toEqual({ tool: 'countdown', action: 'start' });
    expect(matchRuleBasedTimerControl('인터벌 시작해줘')).toEqual({ tool: 'interval', action: 'start' });
    expect(matchRuleBasedTimerControl('메트로놈 꺼줘')).toEqual({ tool: 'metronome', action: 'pause' });
  });

  it('타이머(카운트다운)에 초 단위 숫자가 있으면 seconds까지 뽑는다(2026-08-10 확장)', () => {
    expect(matchRuleBasedTimerControl('타이머 30초로 시작해줘')).toEqual({
      tool: 'countdown', action: 'start', seconds: 30,
    });
  });

  it('타이머에 분 단위, 또는 분+초 조합도 뽑는다', () => {
    expect(matchRuleBasedTimerControl('타이머 3분으로 시작해줘')).toEqual({
      tool: 'countdown', action: 'start', seconds: 180,
    });
    expect(matchRuleBasedTimerControl('타이머 2분 30초로 시작해줘')).toEqual({
      tool: 'countdown', action: 'start', seconds: 150,
    });
  });

  it('메트로놈에 bpm 숫자가 있으면(40~220 범위 안) bpm까지 뽑는다(2026-08-10 확장)', () => {
    expect(matchRuleBasedTimerControl('메트로놈 120bpm으로 켜줘')).toEqual({
      tool: 'metronome', action: 'start', bpm: 120,
    });
    expect(matchRuleBasedTimerControl('메트로놈 90으로 시작해줘')).toEqual({
      tool: 'metronome', action: 'start', bpm: 90,
    });
  });

  it('메트로놈 bpm이 정상 범위(40~220) 밖이면 확신 없는 걸로 보고 null(잘못 읽었을 가능성)', () => {
    expect(matchRuleBasedTimerControl('메트로놈 500으로 켜줘')).toBeNull();
    expect(matchRuleBasedTimerControl('메트로놈 10으로 켜줘')).toBeNull();
  });

  it('타이머에 숫자는 있는데 분/초 단위를 못 읽으면(예: 순번) 확신 없는 걸로 null', () => {
    expect(matchRuleBasedTimerControl('타이머 2번째로 시작해줘')).toBeNull();
  });

  it('인터벌은 운동/휴식/라운드 숫자가 전부 라벨과 붙어 있으면 규칙 기반으로 뽑는다(2026-08-10 추가 확장)', () => {
    expect(matchRuleBasedTimerControl('인터벌 운동40초 휴식20초 8라운드로 시작해줘')).toEqual({
      tool: 'interval', action: 'start', workSec: 40, restSec: 20, rounds: 8,
    });
    expect(matchRuleBasedTimerControl('인터벌 3라운드로 시작해줘')).toEqual({
      tool: 'interval', action: 'start', rounds: 3,
    });
    expect(matchRuleBasedTimerControl('타바타 운동 40초 휴식 20초로 시작해줘')).toEqual({
      tool: 'interval', action: 'start', workSec: 40, restSec: 20,
    });
    expect(matchRuleBasedTimerControl('서킷 6세트로 시작해줘')).toEqual({
      tool: 'interval', action: 'start', rounds: 6,
    });
    // 운동/휴식 값이 같아도(둘 다 30초) 각자 라벨로 정확히 구분되는지(오매칭 회귀 방지)
    expect(matchRuleBasedTimerControl('운동30초 휴식30초 10라운드로 인터벌 시작해줘')).toEqual({
      tool: 'interval', action: 'start', workSec: 30, restSec: 30, rounds: 10,
    });
    // 말하는 순서가 바뀌어도(휴식을 먼저 언급) 라벨로 정확히 구분되는지
    expect(matchRuleBasedTimerControl('인터벌 휴식20초 운동40초 8라운드로 시작해줘')).toEqual({
      tool: 'interval', action: 'start', workSec: 40, restSec: 20, rounds: 8,
    });
  });

  it('인터벌 숫자 중 라벨 없는 게 하나라도 섞이면(뭔지 확신 못 함) 여전히 null', () => {
    expect(matchRuleBasedTimerControl('인터벌 운동40초 휴식20초 8라운드로 3번째 시작해줘')).toBeNull();
    expect(matchRuleBasedTimerControl('인터벌 20초만 하고 시작해줘')).toBeNull();
  });

  it('인터벌 숫자는 start 동작일 때만 뽑는다 — pause/reset에 숫자가 섞이면 null(의도 불명)', () => {
    expect(matchRuleBasedTimerControl('인터벌 8라운드 멈춰줘')).toBeNull();
    expect(matchRuleBasedTimerControl('인터벌 8라운드 리셋해줘')).toBeNull();
  });

  it('초시계(랩 포함)에 숫자가 섞이면 여전히 null(초시계엔 숫자 설정 개념이 없음)', () => {
    expect(matchRuleBasedTimerControl('초시계 2번 시작해줘')).toBeNull();
  });

  it('도구는 있는데 동작이 없으면(애매함) null', () => {
    expect(matchRuleBasedTimerControl('타이머')).toBeNull();
    expect(matchRuleBasedTimerControl('초시계 열어줘')).toBeNull(); // "열어줘"는 화면 이동 동사지 타이머 동작이 아님
  });

  it('동작은 있는데 도구가 없으면(애매함) null', () => {
    expect(matchRuleBasedTimerControl('시작해줘')).toBeNull();
  });

  it('랩(구간기록)은 초시계 전용 — 다른 도구에 요청하면 null(control_timer 도구 정의와 동일 규칙)', () => {
    expect(matchRuleBasedTimerControl('타이머 랩 기록해줘')).toBeNull();
    expect(matchRuleBasedTimerControl('인터벌 랩 기록해줘')).toBeNull();
  });

  it('아무 타이머 관련 단어가 없으면(코칭 질문 등) null', () => {
    expect(matchRuleBasedTimerControl('이 회원한테 어떤 운동을 추천해야 할까요')).toBeNull();
  });

  it('processVoiceCommand가 매치되면 Claude 경로와 같은 publishTimerControl/setPendingTimerCommand 흐름을 재사용한다', () => {
    const src = readSrc('src', 'services', 'voiceCommandService.js');
    const start = src.indexOf('const ruleTimerCmd = matchRuleBasedTimerControl(transcript);');
    const end = src.indexOf('// 규칙 기반으로 확신 있게 못 찾았으면', start);
    const body = src.slice(start, end);
    expect(body).toContain('const deliveredLive = publishTimerControl(cmd);');
    expect(body).toContain('setPendingTimerCommand(cmd);');
    expect(body).toContain("setPendingVoiceTarget({ testId: 'timer' });");
    expect(body).toContain("return { type: 'timer_control', cmd, deliveredLive };");
  });

  it('규칙 기반으로 뽑은 seconds/bpm이 그대로 cmd에 실려간다(파싱만 하고 안 쓰는 회귀 방지)', () => {
    const src = readSrc('src', 'services', 'voiceCommandService.js');
    const start = src.indexOf('const ruleTimerCmd = matchRuleBasedTimerControl(transcript);');
    const end = src.indexOf('const deliveredLive = publishTimerControl(cmd);', start);
    const body = src.slice(start, end);
    expect(body).toContain("seconds: typeof ruleTimerCmd.seconds === 'number' ? ruleTimerCmd.seconds : null,");
    expect(body).toContain("workSec: typeof ruleTimerCmd.workSec === 'number' ? ruleTimerCmd.workSec : null,");
    expect(body).toContain("restSec: typeof ruleTimerCmd.restSec === 'number' ? ruleTimerCmd.restSec : null,");
    expect(body).toContain("rounds: typeof ruleTimerCmd.rounds === 'number' ? ruleTimerCmd.rounds : null,");
    expect(body).toContain("bpm: typeof ruleTimerCmd.bpm === 'number' ? ruleTimerCmd.bpm : null,");
  });
});

describe('extractMemberNameFromText() — 명령 텍스트에서 등록된 회원 이름 추출', () => {
  const members = [
    { name: '김철수' },
    { name: '김철수민' }, // 부분 문자열 겹침 케이스(더 긴 쪽을 골라야 함)
    { name: '박영희' },
  ];

  it('명령 안에 포함된 회원 이름을 찾는다', () => {
    expect(extractMemberNameFromText('김철수님 리포트 열어줘', members)).toBe('김철수');
  });

  it('여러 이름이 부분적으로 겹치면 더 긴(더 구체적인) 쪽을 고른다', () => {
    expect(extractMemberNameFromText('김철수민님 리포트 열어줘', members)).toBe('김철수민');
  });

  it('일치하는 이름이 없으면 null', () => {
    expect(extractMemberNameFromText('가상 회원 리포트 열어줘', members)).toBeNull();
  });

  it('회원 목록이 비어있으면 null(에러 없이)', () => {
    expect(extractMemberNameFromText('김철수님 리포트 열어줘', [])).toBeNull();
  });
});

// [무료 확장 2026-08-11] momi 쓰기 권한 3종(세션조정/전화번호/메모)도 아주
// 명확한 패턴일 때만 무료로 처리한다. 세 함수 다 사전에 Node 프로브 스크립트로
// 직접 실행해서 검증한 뒤 코드에 반영했다(특히 "복합 문장이면 문장 끝 앵커가
// 안 맞아서 자동으로 Claude로 넘어가는지"가 가장 까다로운 부분이었다).
const WMEMBERS = [{ name: '김철수' }, { name: '강성심' }, { name: '정훈' }, { name: '김영희' }];
const WTRAINERS = [{ name: '박병준' }, { name: '김동규' }];

describe('matchRuleBasedSessionAdjust() — 무료 규칙 기반 세션 횟수 조정(2026-08-11)', () => {
  it('"N회 추가/더해/늘려"를 양수 delta로 잡는다', () => {
    expect(matchRuleBasedSessionAdjust('김철수님 세션 2회 추가해줘', WMEMBERS, WTRAINERS)).toEqual({ memberName: '김철수', delta: 2 });
    expect(matchRuleBasedSessionAdjust('강성심님 세션 3회 늘려줘', WMEMBERS, WTRAINERS)).toEqual({ memberName: '강성심', delta: 3 });
  });

  it('"N회 차감/빼/줄여"를 음수 delta로 잡는다', () => {
    expect(matchRuleBasedSessionAdjust('정훈님 세션 1회 차감해줘', WMEMBERS, WTRAINERS)).toEqual({ memberName: '정훈', delta: -1 });
    expect(matchRuleBasedSessionAdjust('김영희님 세션 2회 빼줘', WMEMBERS, WTRAINERS)).toEqual({ memberName: '김영희', delta: -2 });
  });

  it('"해주세요"/"줄래요" 등 다른 정중한 종결어미도 받는다', () => {
    expect(matchRuleBasedSessionAdjust('김철수님 세션 2회 추가해주세요', WMEMBERS, WTRAINERS)).toEqual({ memberName: '김철수', delta: 2 });
    expect(matchRuleBasedSessionAdjust('김철수님 세션 2회 늘려줄래요', WMEMBERS, WTRAINERS)).toEqual({ memberName: '김철수', delta: 2 });
  });

  it('트레이너 이름이 문장에 있으면(누구 세션인지 애매해질 여지) 안전하게 포기하고 Claude로', () => {
    expect(matchRuleBasedSessionAdjust('박병준 트레이너 김철수님 세션 2회 추가해줘', WMEMBERS, WTRAINERS)).toBeNull();
  });

  it('추가/차감 동사 자체가 없으면(단순 조회) 포기한다', () => {
    expect(matchRuleBasedSessionAdjust('김철수님 세션 얼마 남았어', WMEMBERS, WTRAINERS)).toBeNull();
  });

  it('추가와 차감 문구가 동시에 매치되면(모순) 포기한다', () => {
    expect(matchRuleBasedSessionAdjust('김철수님 세션 2회 추가하고 3회 차감해줘', WMEMBERS, WTRAINERS)).toBeNull();
  });

  it('복합 문장(추가 요청 뒤에 다른 요청이 더 붙음)은 문장 끝 앵커가 안 맞아서 자동으로 포기한다(회귀 방지 — 가장 중요한 안전장치)', () => {
    expect(matchRuleBasedSessionAdjust('김철수님 세션 2회 추가하고 트레이너도 바꿔줘', WMEMBERS, WTRAINERS)).toBeNull();
    expect(matchRuleBasedSessionAdjust('김철수님 세션 2회 추가해줘 그리고 정훈님도 2회 추가해줘', WMEMBERS, WTRAINERS)).toBeNull();
  });

  it('등록 안 된 이름이면 포기한다', () => {
    expect(matchRuleBasedSessionAdjust('없는사람님 세션 2회 추가해줘', WMEMBERS, WTRAINERS)).toBeNull();
  });

  it('"세션" 키워드 자체가 없으면 즉시 포기한다', () => {
    expect(matchRuleBasedSessionAdjust('김철수님 리포트 보여줘', WMEMBERS, WTRAINERS)).toBeNull();
  });
});

describe('matchRuleBasedPhoneUpdate() — 무료 규칙 기반 전화번호 변경(2026-08-11)', () => {
  it('하이픈 있는 번호를 표준 형식으로 잡는다', () => {
    expect(matchRuleBasedPhoneUpdate('김철수님 전화번호 010-9999-8888로 바꿔줘', WMEMBERS)).toEqual({ memberName: '김철수', field: 'phone', newValue: '010-9999-8888' });
  });

  it('하이픈 없이 붙여 말해도(01099998888) 표준 형식으로 정리해서 잡는다', () => {
    expect(matchRuleBasedPhoneUpdate('정훈님 연락처 01099998888로 바꿔줘', WMEMBERS)).toEqual({ memberName: '정훈', field: 'phone', newValue: '010-9999-8888' });
  });

  it('띄어써도(010 1234 5678) 잡히고, "비상연락처"는 phone2로 구분한다', () => {
    expect(matchRuleBasedPhoneUpdate('강성심님 비상연락처 010 1234 5678로 바꿔줘', WMEMBERS)).toEqual({ memberName: '강성심', field: 'phone2', newValue: '010-1234-5678' });
  });

  it('번호 없이 "바꿔줘"만 있으면 포기한다', () => {
    expect(matchRuleBasedPhoneUpdate('김철수님 전화번호 바꿔줘', WMEMBERS)).toBeNull();
  });

  it('"전화번호/연락처/휴대폰" 키워드 자체가 없으면 포기한다', () => {
    expect(matchRuleBasedPhoneUpdate('김철수님 이메일 바꿔줘', WMEMBERS)).toBeNull();
  });

  it('복합 문장(번호 변경 뒤에 다른 요청이 더 붙음)은 문장 끝 앵커가 안 맞아서 포기한다', () => {
    expect(matchRuleBasedPhoneUpdate('김철수님 전화번호 010-9999-8888로 바꾸고 메모도 추가해줘', WMEMBERS)).toBeNull();
  });

  it('번호 뒤에 상관없는 숫자가 하나라도 더 섞이면(전체 자릿수 불일치) 포기한다', () => {
    expect(matchRuleBasedPhoneUpdate('김철수님 전화번호 010-9999-8888로 바꾸고 2반 등록해줘', WMEMBERS)).toBeNull();
  });
});

describe('matchRuleBasedMemoAdd() — 무료 규칙 기반 메모 추가(2026-08-11, 셋 중 가장 보수적)', () => {
  it('"메모에 X라고 추가해줘" 정형 문형을 잡는다', () => {
    expect(matchRuleBasedMemoAdd('김철수님 메모에 무릎 조심이라고 추가해줘', WMEMBERS)).toEqual({ memberName: '김철수', memoText: '무릎 조심' });
  });

  it('"적어줘"/"남겨줘"도 같은 동사군으로 받는다', () => {
    expect(matchRuleBasedMemoAdd('정훈님 메모에 다음주부터 3회로 늘림 적어줘', WMEMBERS)).toEqual({ memberName: '정훈', memoText: '다음주부터 3회로 늘림' });
  });

  it('"메모"가 문장 앞쪽에 오는 등 정형 문형을 벗어나면 포기한다(자유 문장은 애초에 시도 안 함)', () => {
    expect(matchRuleBasedMemoAdd('강성심님 메모 좀 남길게 무릎 조심하라고', WMEMBERS)).toBeNull();
  });

  it('단순 조회("메모 보여줘")는 포기한다', () => {
    expect(matchRuleBasedMemoAdd('김철수님 메모 보여줘', WMEMBERS)).toBeNull();
  });

  it('복합 문장(메모 추가 뒤에 다른 요청이 더 붙음)은 문장 끝 앵커가 안 맞아서 포기한다', () => {
    expect(matchRuleBasedMemoAdd('김철수님 메모에 무릎조심이라고 추가해줘 그리고 세션도 2회 늘려줘', WMEMBERS)).toBeNull();
  });

  it('"메모" 키워드 자체가 없으면 즉시 포기한다', () => {
    expect(matchRuleBasedMemoAdd('김철수님 리포트 보여줘', WMEMBERS)).toBeNull();
  });
});
