// src/services/voiceCommandService.js
// "모미야" 이후 들린 말을 처리한다. [무료 우선 2026-08-08] 목적지가 명확한
// "OO 화면 열어줘" 류 명령은 규칙 기반(키워드)으로 먼저 처리해서 API 비용 없이
// $0으로 끝낸다. 애매하거나 자유 질문(코칭 등)일 때만 /api/voice-command(Claude,
// 유료)로 넘어간다. 회원 이름이 포함돼 있으면 실제 회원 목록에서 매칭한다.
import { scopeMembersToTrainer } from '../utils/memberList.js';
import { findDestination } from '../voice/commandRegistry.js';
import { setPendingVoiceTarget } from '../voice/pendingVoiceTarget.js';
import { auth } from '../firebase.js';
import { proposeReservation, proposeCancelReservation, proposeRescheduleReservation } from './reservationService.js';
// [momi 쓰기 권한 확장 2026-08-10] 예약류와 같은 propose→confirm 원칙을 따르는
// 새 쓰기 기능 3종(메모 추가/세션 조정/기본정보 수정). confirmX()는 여기서
// 안 부른다 — 트레이너 확인 이후 실제 저장은 UI 컴포넌트(GlobalVoiceCommand.jsx/
// KioskVoiceCommand.jsx)의 책임이라 그쪽에서 직접 가져다 쓴다(예약류와 동일 구조).
import {
  proposeAddMemberMemo,
  proposeAdjustSessionCount,
  proposeUpdateMemberInfo,
} from './memberWriteService.js';
// [음성 타이머 제어 2026-08-09] publishTimerControl은 화면이 이미 열려 있으면
// true를 돌려주며 즉시 실행한다 — 그 경우 pendingTimerCommand(1회성 저장 +
// 화면 이동)까지 갈 필요가 없다. false면(화면이 아직 안 열림) 저장해두고 그
// 화면으로 이동시킨다.
import { publishTimerControl } from '../voice/timerControlBus.js';
import { setPendingTimerCommand } from '../voice/pendingTimerCommand.js';

// 간단한 한글 이름 퍼지 매칭: 공백 제거 + 부분 일치 우선, 없으면 자모 유사도로 fallback.
function normalize(str) {
  return (str || '').replace(/\s+/g, '').toLowerCase();
}

function fuzzyFindMember(members, spokenName) {
  if (!spokenName || !members || members.length === 0) return null;
  const target = normalize(spokenName);

  // 1순위: 정확히 포함
  const exact = members.find((m) => normalize(m.name) === target);
  if (exact) return exact;

  // 2순위: 부분 일치 (예: "김철수님" -> "김철수")
  const partial = members.find(
    (m) => normalize(m.name).includes(target) || target.includes(normalize(m.name))
  );
  if (partial) return partial;

  return null;
}

// [무료 우선 2026-08-08] 목적지별 키워드. 순서가 우선순위다 — 더 구체적인
// 키워드를 먼저 검사해야 "가상 회원 리포트 열어 줘"처럼 여러 후보가 겹치는
// 문장에서 올바른 쪽("리포트")이 먼저 걸린다("회원"이 먼저 걸리면 회원관리
// 화면으로 잘못 이동함).
const DESTINATION_KEYWORDS = [
  { id: 'report', keywords: ['리포트'] },
  { id: 'ai_measure', keywords: ['에이아이측정', 'ai측정', '측정'] },
  { id: 'schedule', keywords: ['스케줄', '일정'] },
  { id: 'settings', keywords: ['설정'] },
  { id: 'trainers', keywords: ['트레이너'] },
  { id: 'revenue', keywords: ['매출'] },
  { id: 'members', keywords: ['회원관리', '회원'] },
  { id: 'home', keywords: ['홈', '대시보드'] },
];

// "화면 이동해줘"라는 의도가 명확할 때만 규칙 기반으로 처리한다 — 목적지
// 키워드만 보고 판단하면 "이 회원한테 어떤 운동을 추천해야 할까요?" 같은
// 코칭 질문(회원이 들어있지만 이동 명령이 아님)도 잘못 화면 이동으로
// 처리해버릴 수 있다. 이동 동사가 없으면 애매한 걸로 보고 Claude로 넘긴다.
const NAVIGATION_VERBS = ['열어', '띄워', '보여', '가줘', '가자', '이동', '들어가'];

function hasNavigationVerb(normalizedText) {
  return NAVIGATION_VERBS.some((v) => normalizedText.includes(normalize(v)));
}

/**
 * 규칙 기반으로 목적지를 찾는다. 확신 있게 못 찾으면 null(→ 호출부가 Claude로 넘김).
 * [보안] 관리자 전용 화면(트레이너관리·매출관리)은 절대 여기서 끝내지 않고 null을
 * 반환해 반드시 Claude 경로(서버가 Firebase ID 토큰으로 role을 직접 검증,
 * functions/_shared/verifyFirebaseToken.js)로 넘긴다. 여기서 쓰는 role은 클라이언트
 * 값이라 조작 가능해서, 규칙 기반 경로에서 그대로 통과시키면 예전에 고쳤던 보안
 * 취약점(트레이너가 role만 바꿔 관리자 화면 접근)이 이 경로로 다시 뚫리게 된다.
 */
export function matchRuleBasedDestination(commandText) {
  const normalized = normalize(commandText);
  if (!hasNavigationVerb(normalized)) return null;
  for (const { id, keywords } of DESTINATION_KEYWORDS) {
    if (keywords.some((k) => normalized.includes(normalize(k)))) {
      const destination = findDestination(id);
      if (destination?.adminOnly) return null;
      return id;
    }
  }
  return null;
}

// [무료 확장 2026-08-10] 목적지(members/report/ai_measure)까지는 정해졌는데
// 화면 "안"의 세부 탭·측정 종류는 예전엔 규칙 기반이 안 뽑고(testId 항상 null)
// Claude로 넘겼다. 사실 이것도 "정해진 단어 목록 중 하나 찾기"라 목적지
// 매칭과 원리가 똑같아서, 같은 방식으로 무료 처리를 넓힌다.
const MEMBER_TAB_KEYWORDS = [
  { id: 'payments', keywords: ['수납', '결제'] },
  { id: 'sessions', keywords: ['세션', '잔여횟수'] },
  { id: 'body', keywords: ['신체정보', '체성분'] },
  { id: 'memo', keywords: ['메모'] },
  { id: 'info', keywords: ['기본정보'] },
  // [주의] '측정이력'/'AI측정기록'(tab='ai')은 일부러 안 넣었다 — "측정"이라는
  // 글자가 위 DESTINATION_KEYWORDS의 ai_measure 키워드와 겹쳐서, "회원관리
  // 측정이력 보여줘"가 회원관리가 아니라 AI측정 화면으로 잘못 갈 위험이 있다.
  // 문장 전체 맥락을 봐야 구분되는 경우라 Claude 몫으로 남긴다.
];

// Report·AI측정 둘 다 같은 측정 종류 이름(registry.js 기준)을 쓴다. AI측정에만
// 있는 body(신체정보)·record(녹화)·timer(초시계 등)는 저장된 결과 리포트가
// 없는 종류라 REPORT_TESTID_KEYWORDS엔 안 넣는다(Report 화면엔 없는 선택지).
const TESTID_KEYWORDS = [
  { id: 'squat', keywords: ['오버헤드', '딥스쿼트'] },
  { id: 'stance', keywords: ['한다리서기', 'slst', '균형'] },
  { id: 'lifting', keywords: ['바벨', '리프팅'] },
  { id: 'gait', keywords: ['보행', '런닝'] },
  { id: 'jump', keywords: ['점프', 'rsi'] },
  { id: 'rom', keywords: ['rom', '가동범위'] },
  { id: 'posture', keywords: ['자세', '체형'] },
];
const AI_MEASURE_ONLY_TESTID_KEYWORDS = [
  { id: 'body', keywords: ['신체정보', '체성분'] },
  { id: 'record', keywords: ['녹화', '영상'] },
  { id: 'timer', keywords: ['초시계', '타이머', '인터벌', '메트로놈'] },
];

/**
 * 목적지가 정해진 뒤, 화면 안의 세부 탭/측정 종류를 키워드로 찾는다. 확신 있게
 * 못 찾으면 null — 그러면 예전과 똑같이 목적지 화면만 열리고 세부 지정은 안 된다
 * (동작이 나빠지는 게 아니라 기존 그대로일 뿐이라 안전한 추가다).
 */
export function matchRuleBasedSubKind(destinationId, commandText) {
  const normalized = normalize(commandText);
  const lookup =
    destinationId === 'members'
      ? MEMBER_TAB_KEYWORDS
      : destinationId === 'report'
      ? TESTID_KEYWORDS
      : destinationId === 'ai_measure'
      ? [...TESTID_KEYWORDS, ...AI_MEASURE_ONLY_TESTID_KEYWORDS]
      : null;
  if (!lookup) return null;
  for (const { id, keywords } of lookup) {
    if (keywords.some((k) => normalized.includes(normalize(k)))) return id;
  }
  return null;
}

// [무료 확장 2026-08-10] 숫자 설정이 전혀 없는 단순 타이머 명령("초시계
// 시작해줘"/"타이머 멈춰줘"/"리셋해줘")은 도구+동작만 알아들으면 되는, 목적지
// 매칭과 똑같은 종류의 단어 목록 문제라 무료로 가능하다. 숫자가 하나라도
// 들리면(예: "타이머 30초로 시작해줘", "인터벌 40초 20초 8라운드로 시작해줘")
// 정확한 파싱이 필요해 여기서 시도하지 않고 그대로 Claude 몫으로 남긴다 —
// 잘못 뽑아서 엉뚱한 시간으로 시작시키느니 아예 시도하지 않는 게 안전하다.
const TIMER_TOOL_KEYWORDS = [
  { id: 'interval', keywords: ['인터벌', '타바타', 'hiit', '서킷'] },
  { id: 'countdown', keywords: ['타이머', '카운트다운'] },
  { id: 'stopwatch', keywords: ['초시계'] },
  { id: 'metronome', keywords: ['메트로놈'] },
];
const TIMER_ACTION_KEYWORDS = [
  { id: 'reset', keywords: ['리셋', '처음부터'] },
  { id: 'pause', keywords: ['멈춰', '정지', '일시정지', '꺼'] },
  { id: 'lap', keywords: ['랩', '구간기록'] },
  { id: 'start', keywords: ['시작', '돌려', '켜', '계속'] },
];

/**
 * 도구·동작을 확신 있게 찾으면 { tool, action }(+가능하면 seconds 또는 bpm)을
 * 반환한다. 도구·동작 중 하나라도 못 찾으면 null(→ 호출부가 Claude로 넘김).
 * [무료 확장 2026-08-10] countdown(초시계 아님, 타이머)·metronome은 숫자가
 * "딱 하나의 의미"로만 쓰여서(시간 하나, 템포 하나) 그 숫자까지 규칙 기반으로
 * 안전하게 뽑는다. interval은 운동·휴식·라운드 여러 숫자가 뒤섞여서 어느
 * 숫자가 뭔지 문장을 "이해"해야 구분되므로 숫자가 하나라도 있으면 여전히
 * 시도하지 않고 Claude로 넘긴다(오배정 위험이 더 크기 때문).
 */
// [무료 확장 2026-08-10 추가분] interval은 원래 "숫자가 하나라도 있으면 무조건
// Claude"였다 — 운동/휴식/라운드 숫자가 뒤섞이면 어느 게 뭔지 "이해"가 필요해서다.
// 하지만 "운동40초 휴식20초 8라운드"처럼 숫자마다 라벨(운동/휴식/라운드)이 바로
// 붙어 있으면 얘기가 다르다 — 그건 더 이상 "이해"가 아니라 countdown의 "3분"·
// metronome의 "120bpm"과 똑같은 "라벨 옆 숫자 하나 읽기" 문제라 똑같이 안전하다.
// 안전장치: 문장에 있는 숫자 개수와 라벨로 잡아낸 숫자 개수가 정확히 같을 때만
// 통과시킨다 — 라벨 없는 숫자가 하나라도 섞여 있으면(개수가 안 맞으면) 여전히
// 확신 없는 걸로 보고 Claude로 넘긴다(기존 안전 철학 그대로 유지).
function matchIntervalNumbers(commandText) {
  const allDigitGroups = commandText.match(/\d+/g) || [];
  if (allDigitGroups.length === 0) return null;

  // [주의] "역순"(예: "40초 운동")은 일부러 안 받는다 — "운동40초 휴식20초"처럼
  // 두 라벨이 붙어 나오면 앞 필드의 "초"가 뒤 라벨 바로 앞자리라, 역순 패턴이
  // "(숫자)초(다음라벨)"을 그 다음 라벨 것으로 잘못 먹어버리는(운동 값이 휴식
  // 값으로 새는) 사고가 있었다. 라벨-먼저 순서만 받으면 이 겹침이 아예 없다.
  const workMatch = commandText.match(/운동\s*(\d+)\s*초/);
  const restMatch = commandText.match(/휴식\s*(\d+)\s*초/);
  const roundMatch = commandText.match(/(\d+)\s*(?:라운드|세트)/);

  const workSec = workMatch ? parseInt(workMatch[1], 10) : null;
  const restSec = restMatch ? parseInt(restMatch[1], 10) : null;
  const rounds = roundMatch ? parseInt(roundMatch[1], 10) : null;

  const labeledCount = [workSec, restSec, rounds].filter((v) => v != null).length;
  if (labeledCount === 0 || labeledCount !== allDigitGroups.length) return null;

  const result = {};
  if (workSec != null) result.workSec = workSec;
  if (restSec != null) result.restSec = restSec;
  if (rounds != null) result.rounds = rounds;
  return result;
}

export function matchRuleBasedTimerControl(commandText) {
  const normalized = normalize(commandText);
  let tool = null;
  for (const { id, keywords } of TIMER_TOOL_KEYWORDS) {
    if (keywords.some((k) => normalized.includes(normalize(k)))) {
      tool = id;
      break;
    }
  }
  if (!tool) return null;
  let action = null;
  for (const { id, keywords } of TIMER_ACTION_KEYWORDS) {
    if (keywords.some((k) => normalized.includes(normalize(k)))) {
      action = id;
      break;
    }
  }
  if (!action) return null;
  // 랩(구간기록)은 초시계 전용 — control_timer 도구 설명(functions/api/voice-command.js)과
  // 동일 규칙. 다른 도구에 랩을 요청하면 확신 없는 걸로 보고 Claude로 넘긴다.
  if (action === 'lap' && tool !== 'stopwatch') return null;

  const hasDigit = /\d/.test(commandText);

  if (tool === 'interval') {
    if (!hasDigit) return { tool, action };
    // start가 아닌데 숫자가 섞이면(예: "인터벌 20초 멈춰줘" — 의도 불명) 여전히 Claude로.
    if (action !== 'start') return null;
    const numbers = matchIntervalNumbers(commandText);
    if (!numbers) return null;
    return { tool, action, ...numbers };
  }

  if (tool === 'countdown' && action === 'start' && hasDigit) {
    const minMatch = commandText.match(/(\d+)\s*분/);
    const secMatch = commandText.match(/(\d+)\s*초/);
    if (!minMatch && !secMatch) return null; // 숫자는 있는데 분/초 단위를 못 읽으면 확신 없는 걸로.
    const min = minMatch ? parseInt(minMatch[1], 10) : 0;
    const sec = secMatch ? parseInt(secMatch[1], 10) : 0;
    return { tool, action, seconds: min * 60 + sec };
  }

  if (tool === 'metronome' && action === 'start' && hasDigit) {
    const bpmMatch = commandText.match(/(\d+)/);
    const bpm = bpmMatch ? parseInt(bpmMatch[1], 10) : null;
    // control_timer 도구 설명의 허용 범위(40~220)와 동일 — 범위 밖이면
    // 숫자를 엉뚱하게 읽었을 가능성이 있으니 확신 없는 걸로 보고 Claude로.
    if (!bpm || bpm < 40 || bpm > 220) return null;
    return { tool, action, bpm };
  }

  // 그 외 조합(stopwatch/pause/reset/lap 등, 또는 위에서 안 걸린 나머지)에
  // 숫자가 섞이면 다른 의도일 수 있으니 안전하게 Claude로 넘긴다.
  if (hasDigit) return null;

  return { tool, action };
}

/** 명령 텍스트 안에 실제 등록된 회원 이름이 포함돼 있으면 가장 긴 매치를 추출한다. */
export function extractMemberNameFromText(commandText, members) {
  if (!members || members.length === 0) return null;
  const normalized = normalize(commandText);
  let best = null;
  for (const m of members) {
    const n = normalize(m.name);
    if (n && normalized.includes(n) && (!best || n.length > normalize(best).length)) {
      best = m.name;
    }
  }
  return best;
}

// [예약 생성 프로젝트 2026-08-08] "폰: trainerId(로그인 정보로 자동 지정) /
// 키오스크: trainerName(말로 지정)" — 사용자가 명시적으로 확정한 구분. 어느
// 쪽인지는 호출부(컴포넌트)가 mode로 알려준다. 기본값은 'phone' — 기존
// GlobalVoiceCommand.jsx 호출부가 mode를 안 넘겨도 그대로 동작하게 하기 위함.
export async function processVoiceCommand({
  transcript, role, currentUser, allMembers, navigate, mode = 'phone', history = [],
}) {
  // [무료 우선 2026-08-08] 규칙 기반으로 먼저 시도 — 매치되면 API 호출 자체가
  // 없어서 비용이 전혀 안 든다.
  const ruleDestId = matchRuleBasedDestination(transcript);
  if (ruleDestId) {
    const destination = findDestination(ruleDestId);
    const scopedMembers =
      role === 'admin' ? allMembers : scopeMembersToTrainer(allMembers, currentUser);
    const memberName = extractMemberNameFromText(transcript, scopedMembers);
    const matchedMember = memberName ? fuzzyFindMember(scopedMembers, memberName) : null;
    // [무료 확장 2026-08-10] 세부 탭/측정 종류까지 키워드로 잡히면 같이 넘긴다
    // (아래 Claude 경로의 navigate 분기와 완전히 같은 필드 매핑 — destination.id
    // 별로 자기 필드만 채우고 나머지는 null인 패턴을 그대로 재사용).
    const subKind = matchRuleBasedSubKind(ruleDestId, transcript);

    setPendingVoiceTarget({
      memberName: matchedMember ? matchedMember.name : null,
      testId: ruleDestId === 'ai_measure' ? subKind : null,
      openReportKind: ruleDestId === 'report' ? subKind : null,
      memberTab: ruleDestId === 'members' ? subKind : null,
    });

    if (navigate) navigate(destination.path);

    return {
      type: 'navigate',
      destination,
      matchedMember,
      requestedName: memberName,
    };
  }

  // [무료 확장 2026-08-10] 숫자 없는 단순 타이머 제어도 API 호출 없이 처리한다.
  // 아래 Claude 경로의 timer_control 분기와 실행 로직(publishTimerControl →
  // 실패 시 setPendingTimerCommand+화면 이동)을 그대로 재사용해서, 두 경로의
  // 실제 동작이 갈라지지 않게 한다.
  const ruleTimerCmd = matchRuleBasedTimerControl(transcript);
  if (ruleTimerCmd) {
    const cmd = {
      tool: ruleTimerCmd.tool,
      action: ruleTimerCmd.action,
      seconds: typeof ruleTimerCmd.seconds === 'number' ? ruleTimerCmd.seconds : null,
      workSec: typeof ruleTimerCmd.workSec === 'number' ? ruleTimerCmd.workSec : null,
      restSec: typeof ruleTimerCmd.restSec === 'number' ? ruleTimerCmd.restSec : null,
      rounds: typeof ruleTimerCmd.rounds === 'number' ? ruleTimerCmd.rounds : null,
      bpm: typeof ruleTimerCmd.bpm === 'number' ? ruleTimerCmd.bpm : null,
    };
    const deliveredLive = publishTimerControl(cmd);
    if (!deliveredLive) {
      setPendingTimerCommand(cmd);
      setPendingVoiceTarget({ testId: 'timer' });
      if (navigate) navigate('/ai');
    }
    return { type: 'timer_control', cmd, deliveredLive };
  }

  // 규칙 기반으로 확신 있게 못 찾았으면(자유 질문·코칭·애매한 표현·관리자 전용
  // 화면 등) 기존처럼 Claude(/api/voice-command)로 넘어간다.
  // [보안 수정] 서버는 이제 이 role 문자열을 그대로 믿지 않고, 아래 idToken을 직접
  // 검증해서 진짜 role을 구한다(functions/_shared/verifyFirebaseToken.js 참고).
  // role은 과도기 호환용으로만 계속 같이 보낸다.
  let idToken = null;
  try { idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null; }
  catch (e) { console.warn('[voiceCommandService] ID 토큰 발급 실패:', e?.message || e); }

  const res = await fetch('/api/voice-command', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ transcript, role, history }),
  });

  if (!res.ok) {
    // [진단용 2026-08-08] "명령 실행이 안 된다"는 문의 대응 — 예전엔 상태 코드만
    // 담아 던져서 정작 왜 실패했는지(예: Anthropic API 크레딧 부족 등 서버 쪽
    // 문제)는 화면에 안 보였다. 백엔드(functions/api/voice-command.js)가 실패
    // 응답에 detail을 이미 담아 보내주므로, 그걸 읽어서 에러 메시지에 포함한다.
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.detail || body?.error || '';
    } catch (e) {
      // 응답이 JSON이 아닌 경우(네트워크 레벨 오류 등) — 상태 코드만으로 넘어간다.
    }
    throw new Error(`음성 명령 처리 실패 (status ${res.status})${detail ? ` — ${detail}` : ''}`);
  }

  const data = await res.json();

  if (data.type === 'chat') {
    return { type: 'chat', text: data.text };
  }

  // [예약 생성 프로젝트 2026-08-08] 화면 이동이 아니라 예약 제안 — 여기서는
  // 아직 아무것도 저장하지 않는다(proposeReservation은 순수 조회). 실제 저장
  // (confirmReservation)은 호출부(voice 컴포넌트)가 요약을 말해주고 트레이너의
  // "네/아니요" 확인을 받은 뒤에만 별도로 호출한다.
  // 트레이너 지정: 키오스크(mode='kiosk')는 여러 트레이너가 같이 쓰는 공용
  // 기기라 로그인 정보를 신뢰하면 안 된다 — 반드시 말로 지정한 trainerName만
  // 쓴다. 폰(mode='phone')은 로그인된 본인 trainerId를 우선 쓰되, 관리자처럼
  // trainerId가 없는 계정이 다른 트레이너 이름을 명시적으로 말한 경우엔
  // trainerName으로 자연스럽게 폴백된다(proposeReservation의 우선순위 로직).
  if (data.type === 'reservation_propose') {
    const trainerId = mode === 'kiosk' ? null : currentUser?.trainerId || null;
    const propose = proposeReservation({
      memberQuery: data.memberName || undefined,
      trainerId: trainerId || undefined,
      trainerName: data.trainerName || undefined,
      date: data.date,
      startTime: data.startTime,
      classType: data.classType || undefined,
    });
    return { type: 'reservation_propose', propose };
  }

  // [예약 생성 프로젝트 3단계 2026-08-09] 취소 — 위 propose_reservation 분기와
  // 완전히 같은 이유·같은 mode 분기(폰=trainerId/키오스크=trainerName)를 쓴다.
  // 여기서도 아직 아무것도 지우지 않는다(proposeCancelReservation은 순수 조회).
  if (data.type === 'reservation_cancel_propose') {
    const trainerId = mode === 'kiosk' ? null : currentUser?.trainerId || null;
    const propose = proposeCancelReservation({
      memberQuery: data.memberName || undefined,
      trainerId: trainerId || undefined,
      trainerName: data.trainerName || undefined,
      date: data.date,
      startTime: data.startTime,
    });
    return { type: 'reservation_cancel_propose', propose };
  }

  // [예약 생성 프로젝트 4단계 2026-08-09] 변경(시간 이동) — 위 둘과 완전히 같은
  // 이유·같은 mode 분기를 쓴다. 여기서도 아직 아무것도 바꾸지 않는다
  // (proposeRescheduleReservation은 순수 조회).
  if (data.type === 'reservation_reschedule_propose') {
    const trainerId = mode === 'kiosk' ? null : currentUser?.trainerId || null;
    const propose = proposeRescheduleReservation({
      memberQuery: data.memberName || undefined,
      trainerId: trainerId || undefined,
      trainerName: data.trainerName || undefined,
      oldDate: data.oldDate,
      oldStartTime: data.oldStartTime,
      newDate: data.newDate,
      newStartTime: data.newStartTime,
    });
    return { type: 'reservation_reschedule_propose', propose };
  }

  // [momi 쓰기 권한 확장 2026-08-10] 회원 메모 추가 — 여기서도 아직 저장하지
  // 않는다(proposeAddMemberMemo는 순수 조회). 실제 저장(confirmAddMemberMemo)은
  // 호출부가 트레이너의 "네" 확인을 받은 뒤에만 별도로 호출한다.
  if (data.type === 'memo_add_propose') {
    const propose = proposeAddMemberMemo({
      memberQuery: data.memberName || undefined,
      memoText: data.memoText || undefined,
    });
    return { type: 'memo_add_propose', propose };
  }

  // 세션 횟수 조정 — 예약류와 완전히 같은 mode 분기(폰=trainerId/키오스크=trainerName).
  // 이것도 순수 조회일 뿐, "음수가 되지 않는지"까지 포함한 실제 검증은
  // proposeAdjustSessionCount 안에서 끝내고 아직 저장은 안 한다.
  if (data.type === 'session_adjust_propose') {
    const trainerId = mode === 'kiosk' ? null : currentUser?.trainerId || null;
    const propose = proposeAdjustSessionCount({
      memberQuery: data.memberName || undefined,
      trainerId: trainerId || undefined,
      trainerName: data.trainerName || undefined,
      delta: data.delta,
    });
    return { type: 'session_adjust_propose', propose };
  }

  // 회원 기본정보(전화번호 등) 수정 — 위와 같은 이유로 아직 저장하지 않는다.
  if (data.type === 'member_info_update_propose') {
    const propose = proposeUpdateMemberInfo({
      memberQuery: data.memberName || undefined,
      field: data.field || undefined,
      newValue: data.newValue || undefined,
    });
    return { type: 'member_info_update_propose', propose };
  }

  // [음성 타이머 제어 2026-08-09] 화면 이동이 아니라 초시계·타이머·인터벌·
  // 메트로놈을 실제로 시작/정지/리셋하는 명령. 예약류와 달리 되돌릴 수 없는
  // 데이터 변경이 아닌 순수 UI 제어라 트레이너 확인 없이 바로 실행한다.
  if (data.type === 'timer_control') {
    const cmd = {
      tool: data.tool || null,
      action: data.action || null,
      seconds: typeof data.seconds === 'number' ? data.seconds : null,
      workSec: typeof data.workSec === 'number' ? data.workSec : null,
      restSec: typeof data.restSec === 'number' ? data.restSec : null,
      rounds: typeof data.rounds === 'number' ? data.rounds : null,
      bpm: typeof data.bpm === 'number' ? data.bpm : null,
    };
    if (!cmd.tool || !cmd.action) {
      return { type: 'chat', text: '어떤 도구를 어떻게 조작할지 못 알아들었어요. 다시 말씀해주세요.' };
    }
    // 화면(TimerTool.jsx)이 이미 열려 있으면 실시간 버스로 즉시 전달된다(true).
    // 아직 안 열려 있으면(false) 1회성으로 저장해두고 그 화면으로 이동시킨다 —
    // AiMeasureHub.jsx가 이미 지원하는 testId:'timer' 이동을 그대로 재사용한다.
    const deliveredLive = publishTimerControl(cmd);
    if (!deliveredLive) {
      setPendingTimerCommand(cmd);
      setPendingVoiceTarget({ testId: 'timer' });
      if (navigate) navigate('/ai');
    }
    return { type: 'timer_control', cmd, deliveredLive };
  }

  // type === 'navigate'
  const destination = findDestination(data.destinationId);
  if (!destination) {
    return { type: 'chat', text: '어디로 이동해야 할지 못 알아들었어요. 다시 말씀해주세요.' };
  }

  // role에 안 맞는 목적지는 백엔드에서도 걸러지지만, 프론트에서도 한 번 더 방어.
  if (destination.adminOnly && role !== 'admin') {
    return { type: 'chat', text: '죄송해요, 그 화면은 권한이 없어서 열어드릴 수 없어요.' };
  }

  let matchedMember = null;
  if (data.memberName) {
    const scopedMembers =
      role === 'admin' ? allMembers : scopeMembersToTrainer(allMembers, currentUser);
    matchedMember = fuzzyFindMember(scopedMembers, data.memberName);
  }

  // [음성 명령 확장 2026-08-09] data.testId/data.tab은 어느 화면으로 가느냐에 따라
  // 서로 다른 필드로 소비된다 — AiMeasureHub.jsx는 testId를, Report.jsx는
  // openReportKind를(pending_voice_target_report_kind.test.js 참고 — 이전엔 여기서
  // testId로만 저장해 Report.jsx가 절대 못 읽는 버그가 있었다), Members.jsx는
  // memberTab을, Revenue.jsx는 revenueTab을 읽는다. 목적지 하나당 값 하나만 채워서
  // 화면마다 자기 필드만 보게 한다.
  setPendingVoiceTarget({
    memberName: matchedMember ? matchedMember.name : null,
    testId: destination.id === 'ai_measure' ? data.testId || null : null,
    openReportKind: destination.id === 'report' ? data.testId || null : null,
    memberTab: destination.id === 'members' ? data.tab || null : null,
    revenueTab: destination.id === 'revenue' ? data.tab || null : null,
  });

  if (navigate) navigate(destination.path);

  return {
    type: 'navigate',
    destination,
    matchedMember,
    requestedName: data.memberName || null,
  };
}

// [음성 타이머 제어 2026-08-09] GlobalVoiceCommand.jsx/KioskVoiceCommand.jsx가
// 공통으로 쓰는 음성 안내 문구 생성기 — buildReservationSummary(reservationService.js)
// 와 같은 이유로 여기 한 곳에만 두고 두 컴포넌트가 같이 가져다 쓴다(중복 방지).
const TIMER_TOOL_LABEL = { stopwatch: '초시계', countdown: '타이머', interval: '인터벌', metronome: '메트로놈' };
const TIMER_ACTION_LABEL = { start: '시작', pause: '정지', reset: '리셋', lap: '랩 기록' };

export function buildTimerControlMessage(cmd) {
  if (!cmd?.tool || !cmd?.action) return '타이머를 조작하지 못했어요.';
  const toolLabel = TIMER_TOOL_LABEL[cmd.tool] || cmd.tool;
  const actionLabel = TIMER_ACTION_LABEL[cmd.action] || cmd.action;
  const extras = [];
  if (cmd.tool === 'countdown' && cmd.action === 'start' && cmd.seconds) {
    const m = Math.floor(cmd.seconds / 60);
    const s = cmd.seconds % 60;
    extras.push(m > 0 ? `${m}분${s > 0 ? ` ${s}초` : ''}` : `${s}초`);
  }
  if (cmd.tool === 'metronome' && cmd.action === 'start' && cmd.bpm) {
    extras.push(`${cmd.bpm}BPM`);
  }
  if (cmd.tool === 'interval' && cmd.action === 'start' && (cmd.workSec || cmd.restSec || cmd.rounds)) {
    const parts = [];
    if (cmd.workSec) parts.push(`운동 ${cmd.workSec}초`);
    if (cmd.restSec) parts.push(`휴식 ${cmd.restSec}초`);
    if (cmd.rounds) parts.push(`${cmd.rounds}라운드`);
    if (parts.length) extras.push(parts.join(' '));
  }
  const extraText = extras.length ? ` ${withRoParticle(extras.join(', '))}` : '';
  return `${toolLabel}${extraText} ${actionLabel}할게요.`;
}

// 한글 받침 유무에 따라 "로"/"으로"를 골라 붙인다("2분로"가 아니라 "2분으로"가
// 맞는 것처럼, 마지막 글자가 받침으로 끝나면 "으로"가 필요하다). 한글이 아닌
// 문자로 끝나면(예: "120BPM") 안전하게 "로"를 붙인다.
function withRoParticle(text) {
  if (!text) return text;
  const last = text[text.length - 1];
  const code = last.charCodeAt(0) - 0xac00;
  const hasBatchim = code >= 0 && code <= 11171 && code % 28 !== 0;
  return `${text}${hasBatchim ? '으로' : '로'}`;
}
