// src/services/voiceCommandService.js
// "모미야" 이후 들린 말을 처리한다. [무료 우선 2026-08-08] 목적지가 명확한
// "OO 화면 열어줘" 류 명령은 규칙 기반(키워드)으로 먼저 처리해서 API 비용 없이
// $0으로 끝낸다. 애매하거나 자유 질문(코칭 등)일 때만 /api/voice-command(Claude,
// 유료)로 넘어간다. 회원 이름이 포함돼 있으면 실제 회원 목록에서 매칭한다.
import { scopeMembersToTrainer } from '../utils/memberList.js';
import { todayYMD, addDaysYMD } from '../utils/dates.js';
import { findClosestNameFuzzy } from '../utils/hangulSimilarity.js';
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
import { answerFreeDataQuestion } from './freeVoiceDataService.js';
import { cacheVoiceResponse, getCachedVoiceResponse } from './voiceResponseCache.js';

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

  // 3순위: 자모 유사도 — [음성인식률 개선 2026-08-18] extractMemberNameFromText·
  // memberWriteService.js·reservationService.js와 같은 기준(hangulSimilarity.js)을
  // 이 함수(내비게이션 경로)에도 맞춘다. 이 함수는 이미 extractMemberNameFromText가
  // 뽑아준 이름으로 호출되는 경우가 많아 실제로는 자주 안 타지만, data.memberName
  // (Claude 응답에서 직접 온 이름)으로 호출되는 경로도 있어 여기서도 방어한다.
  const fuzzyName = findClosestNameFuzzy(target, members);
  return fuzzyName ? members.find((m) => m.name === fuzzyName) || null : null;
}

// [무료 우선 2026-08-08] 목적지별 키워드. 순서가 우선순위다 — 더 구체적인
// 키워드를 먼저 검사해야 "가상 회원 리포트 열어 줘"처럼 여러 후보가 겹치는
// 문장에서 올바른 쪽("리포트")이 먼저 걸린다("회원"이 먼저 걸리면 회원관리
// 화면으로 잘못 이동함).
const DESTINATION_KEYWORDS = [
  { id: 'report', keywords: ['결과리포트', '분석리포트', '리포트', '결과보고서'] },
  { id: 'ai_measure', keywords: ['에이아이측정', 'ai측정', '측정분석', '측정'] },
  { id: 'schedule', keywords: ['예약목록', '수업일정', '스케줄', '일정', '예약표'] },
  { id: 'settings', keywords: ['환경설정', '설정'] },
  { id: 'trainers', keywords: ['선생님관리', '트레이너관리', '트레이너'] },
  { id: 'revenue', keywords: ['수납관리', '매출관리', '매출'] },
  { id: 'members', keywords: ['회원관리', '회원목록', '회원명단', '회원'] },
  { id: 'home', keywords: ['첫화면', '메인화면', '홈', '대시보드'] },
];

// "화면 이동해줘"라는 의도가 명확할 때만 규칙 기반으로 처리한다 — 목적지
// 키워드만 보고 판단하면 "이 회원한테 어떤 운동을 추천해야 할까요?" 같은
// 코칭 질문(회원이 들어있지만 이동 명령이 아님)도 잘못 화면 이동으로
// 처리해버릴 수 있다. 이동 동사가 없으면 애매한 걸로 보고 Claude로 넘긴다.
const NAVIGATION_VERBS = [
  '열어', '띄워', '보여', '가줘', '가자', '이동', '들어가',
  '켜줘', '찾아줘', '넘어가', '바로가기', '접속해', '꺼내줘',
];

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
  // [2026-08-25 디버깅] registry.js에 'compare'(전/후 비교)·'imaging'(근골격계 영상
  // 판독)이 추가된 뒤 이 목록이 갱신되지 않아 무료 규칙 경로에서 못 잡고 매번
  // Claude(유료) 경로로 넘어가고 있었다 — voice-command.js의 testId enum 확장과
  // 짝을 맞춰 여기도 추가. 'record'(녹화·영상)보다 먼저 검사해야 "영상판독"의
  // "영상"이 record로 먼저 잡히지 않는다(목록 순서 = 매칭 우선순위).
  { id: 'imaging', keywords: ['영상판독', '엑스레이', 'x-ray', 'xray', '초음파', 'mri'] },
  { id: 'compare', keywords: ['전후비교', '전/후비교', '오버레이비교', '어니언스킨'] },
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
  if (best) return best;

  // [음성인식률 개선 2026-08-18] 정확히 일치하는 이름이 없으면 자모 유사도로
  // 한 번 더 시도한다 — STT가 이름 한 글자를 비슷한 발음으로 잘못 들은 경우
  // (예: "정훈"→"정운")까지 구제한다. hangulSimilarity.js가 임계값·안전
  // 마진을 관리하며, 애매하면 null을 돌려줘 여기서도 그대로 null이 된다 —
  // 이 함수를 호출하는 모든 곳(matchRuleBasedSessionAdjust 등)이 이미
  // "회원을 못 찾으면 Claude 경로로 넘긴다"는 안전한 fallback을 갖고 있고,
  // 실제 쓰기 작업은 어차피 트레이너 확인(propose→confirm) 뒤에만 실행되므로
  // 이 fallback이 틀려도 확인 단계에서 바로 잡을 수 있다.
  return findClosestNameFuzzy(normalized, members);
}

/** 명령 텍스트에 실제 등록된 트레이너 이름이 하나라도 포함돼 있는지. */
function mentionsAnyTrainer(commandText, trainers) {
  if (!trainers || trainers.length === 0) return false;
  const normalized = normalize(commandText);
  return trainers.some((t) => normalize(t.name) && normalized.includes(normalize(t.name)));
}

// [무료 확장 2026-08-11] momi 쓰기 권한 3종(메모 추가/세션 조정/전화번호 변경)도
// "아주 명확한 패턴일 때만" 무료로 처리한다. 안전장치는 지금까지의 원칙을
// 그대로 잇는다:
//  (1) 실제 등록된 회원 이름이 문장에 있어야 함(추측 안 함 — extractMemberNameFromText).
//  (2) 숫자/패턴이 "정중한 종결어미로 문장이 끝나야" 매치된다(POLITE_ENDING) —
//      "OO회 추가하고 다른 것도 해줘" 같은 복합 문장은 문장 끝이 그 자리가
//      아니라서 자동으로 매치 실패 → 안전하게 Claude로 넘어간다.
//  (3) 그렇게 매치돼도 절대 바로 저장 안 됨 — memberWriteService.js의 propose→
//      confirm 원칙 그대로, 트레이너가 음성으로 "네" 확인한 뒤에만 저장된다.
//      즉 이 세 함수가 잘못 뽑아도 트레이너가 확인 단계에서 듣고 "아니요"라고
//      하면 그만이라, 100% 확신이 없어도 시도해볼 수 있는 이중 안전장치가 있다.
const POLITE_ENDING = String.raw`(?:\s*(?:해\s*주세요|해\s*줄래[요]?|해\s*줘|줘|주세요|줄래[요]?))?[.!?~]*\s*$`;

/** "OO님 세션 N회 추가/차감해줘" — 트레이너가 언급되면(누구 세션인지 애매해질
 * 여지) 안전하게 Claude로 넘긴다. 숫자가 하나뿐이고 그 숫자가 라벨(추가/차감)
 * 바로 옆에 있을 때만 매치 — 인터벌 타이머 숫자 처리와 동일한 안전 철학. */
export function matchRuleBasedSessionAdjust(commandText, members, trainers) {
  if (!/세션/.test(commandText)) return null;
  const memberName = extractMemberNameFromText(commandText, members);
  if (!memberName) return null;
  if (mentionsAnyTrainer(commandText, trainers)) return null;
  const addMatch = commandText.match(new RegExp(String.raw`(\d+)\s*회\s*(?:추가|더해|늘려)${POLITE_ENDING}`));
  const subMatch = commandText.match(new RegExp(String.raw`(\d+)\s*회\s*(?:차감|빼|줄여)${POLITE_ENDING}`));
  if ((addMatch && subMatch) || (!addMatch && !subMatch)) return null;
  const allDigits = commandText.match(/\d+/g) || [];
  if (allDigits.length !== 1) return null;
  return { memberName, delta: addMatch ? parseInt(addMatch[1], 10) : -parseInt(subMatch[1], 10) };
}

/** "OO님 전화번호/연락처 010-1234-5678로 바꿔줘". 문장 전체 숫자 글자 수가
 * 매치된 번호 자릿수와 정확히 같아야 한다(하이픈 유무 무관하게 안전 — 다른
 * 숫자가 어디든 섞이면 실패해서 Claude로 넘어간다). */
export function matchRuleBasedPhoneUpdate(commandText, members) {
  if (!/전화번호|연락처|휴대폰/.test(commandText)) return null;
  const memberName = extractMemberNameFromText(commandText, members);
  if (!memberName) return null;
  const m = commandText.match(new RegExp(
    String.raw`(01[016789])[-\s]?(\d{3,4})[-\s]?(\d{4})\s*(?:로|으로)?\s*(?:바꿔|변경해|고쳐)${POLITE_ENDING}`
  ));
  if (!m) return null;
  const totalDigits = (commandText.match(/\d/g) || []).length;
  const matchedDigits = (m[1] + m[2] + m[3]).length;
  if (totalDigits !== matchedDigits) return null;
  const field = /비상연락처|보호자|연락처\s*2/.test(commandText) ? 'phone2' : 'phone';
  return { memberName, field, newValue: `${m[1]}-${m[2]}-${m[3]}` };
}

/** "OO님 메모에 X라고 추가해줘" 형태의 가장 흔한 문형만 받는다 — 메모 내용은
 * 자유 문장이라 다른 둘보다 훨씬 보수적으로 접근: 이 정확한 템플릿에서 벗어나면
 * (메모 언급이 문장 앞쪽에 오는 등) 바로 포기하고 Claude로 넘긴다. 60자 넘는
 * 추출 결과도 "추출 실패로 문장을 통째로 삼켰을 가능성"으로 보고 버린다. */
export function matchRuleBasedMemoAdd(commandText, members) {
  if (!/메모/.test(commandText)) return null;
  const memberName = extractMemberNameFromText(commandText, members);
  if (!memberName) return null;
  const m = commandText.match(new RegExp(
    String.raw`메모에\s*(.+?)(?:라고|이라고)?\s*(?:추가해|적어|남겨)${POLITE_ENDING}`
  ));
  if (!m) return null;
  const memoText = m[1].trim();
  if (!memoText || memoText.length > 60) return null;
  return { memberName, memoText };
}

/** 명령 텍스트에 실제 등록된 트레이너 이름이 포함돼 있으면 추출한다(extractMemberNameFromText와
 * 완전히 같은 로직이지만 트레이너용 — 의미가 달라 별도 함수로 유지). */
function extractTrainerNameFromText(commandText, trainers) {
  if (!trainers || trainers.length === 0) return null;
  const normalized = normalize(commandText);
  let best = null;
  for (const t of trainers) {
    const n = normalize(t.name);
    if (n && normalized.includes(n) && (!best || n.length > normalize(best).length)) {
      best = t.name;
    }
  }
  return best;
}

// [무료 확장 2026-08-11] 예약 생성도 "아주 명확한 날짜/시각 표현일 때만" 무료로
// 처리한다. 날짜·시간 표현은 한국어로 워낙 다양해서("다음주 화요일", "이번주
// 금요일 저녁" 등) 전부 다루려 하지 않고, 애매함이 없는 가장 좁은 범위만
// 잡는다 — 그 범위를 벗어나면 전부 안전하게 Claude로 넘어간다:
//  · 날짜: "오늘"/"내일"/"모레"만(요일 표현·구체적 날짜(8월15일)는 계산이
//    더 복잡하고 연도 추론 등 애매함이 남아있어 이번엔 범위 밖으로 뒀다).
//  · 시각: "오전"/"오후"가 명시된 "N시"만(반·분 포함). "3시"처럼 오전/오후가
//    없으면 새벽 3시인지 오후 3시인지 알 수 없어 절대 추측하지 않는다.
//  · 문장이 "예약(을/를)? 잡아/걸어/넣어/해"+정중한 종결어미로 끝나야 한다
//    (POLITE_ENDING 재사용) — 뒤에 다른 요청이 더 붙은 복합 문장이면 이
//    패턴 자체가 안 끝나서 자동으로 Claude로 넘어간다.
function parseReservationRelativeDate(commandText, todayISO) {
  if (/모레/.test(commandText)) return addDaysYMD(2, todayISO);
  if (/내일/.test(commandText)) return addDaysYMD(1, todayISO);
  if (/오늘/.test(commandText)) return addDaysYMD(0, todayISO);
  return null;
}

function parseReservationClockTime(commandText) {
  const m = commandText.match(/(오전|오후)\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분|\s*반)?/);
  if (!m) return null;
  let hour = parseInt(m[2], 10);
  if (hour < 1 || hour > 12) return null;
  const minute = m[3] ? parseInt(m[3], 10) : (/시\s*반/.test(m[0]) ? 30 : 0);
  if (minute < 0 || minute > 59) return null;
  if (m[1] === '오후' && hour !== 12) hour += 12;
  if (m[1] === '오전' && hour === 12) hour = 0;
  return { time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, matchText: m[0], matchIndex: m.index };
}

/** "OO님 내일 오후 3시에 예약 잡아줘" 형태만 받는다. todayISO는 호출부가
 * 넘긴다(voiceCommandService.js는 브라우저에서 실행되므로 new Date() 자체는
 * 문제없지만, dates.js의 UTC 시간대 버그 이력 때문에 반드시 todayYMD()를
 * 거쳐서 넘기도록 강제 — 직접 new Date().toISOString()을 쓰지 않는다). */
export function matchRuleBasedReservationCreate(commandText, members, trainers, todayISO) {
  if (!/예약/.test(commandText)) return null;
  const memberName = extractMemberNameFromText(commandText, members);
  const date = parseReservationRelativeDate(commandText, todayISO);
  if (!date) return null;
  const timeInfo = parseReservationClockTime(commandText);
  if (!timeInfo) return null;
  const tail = commandText.slice(timeInfo.matchIndex + timeInfo.matchText.length);
  // [트레이너 언급 어순 보강] "내일 오후 3시에 이서연 트레이너로 예약 잡아줘"처럼
  // 시간과 "예약" 사이에 트레이너 이름이 끼어드는 자연스러운 어순도 있어서,
  // 그 사이 최대 20자까지는(lazy .{0,20}?) 허용한다 — 그래도 "예약(을/를)?
  // 동사+종결어미"가 문장 맨 끝(POLITE_ENDING의 $ 앵커)까지 그대로 이어져야
  // 하므로, 복합 문장("...잡아줘 그리고 메모도...") 거부 안전장치는 그대로다.
  const endRe = new RegExp(String.raw`^.{0,20}?예약\s*(?:을|를)?\s*(?:잡아|걸어|넣어|해)${POLITE_ENDING}`);
  if (!endRe.test(tail)) return null;
  const trainerName = extractTrainerNameFromText(commandText, trainers);
  return { memberName, trainerName, date, startTime: timeInfo.time };
}

/** "OO님 내일 오후 3시 예약 취소해줘" — 날짜·시각 파서는 propose_reservation과
 * 완전히 동일(parseReservationRelativeDate/parseReservationClockTime 재사용).
 * "취소" 키워드로만 구분되고, 나머지 안전장치(오전/오후 필수·문장 끝 앵커·
 * 트레이너 언급 시 어순 유연성)는 전부 동일하게 적용된다. */
export function matchRuleBasedReservationCancel(commandText, members, trainers, todayISO) {
  if (!/취소/.test(commandText)) return null;
  const memberName = extractMemberNameFromText(commandText, members);
  const date = parseReservationRelativeDate(commandText, todayISO);
  if (!date) return null;
  const timeInfo = parseReservationClockTime(commandText);
  if (!timeInfo) return null;
  const tail = commandText.slice(timeInfo.matchIndex + timeInfo.matchText.length);
  const endRe = new RegExp(String.raw`^.{0,20}?예약\s*(?:을|를)?\s*취소${POLITE_ENDING}`);
  if (!endRe.test(tail)) return null;
  const trainerName = extractTrainerNameFromText(commandText, trainers);
  return { memberName, trainerName, date, startTime: timeInfo.time };
}

// [무료 확장 2026-08-11] 예약 변경(reschedule) — "OO님 내일 오후 3시 예약을
// 모레 오전 10시로 옮겨줘"처럼 날짜·시각이 "기존→새" 두 쌍 나온다. create/
// cancel과 달리 문장 안에서 같은 종류(날짜/시각) 표현이 두 번 나오는 걸
// 순서대로 기존/새로 배정해야 해서 전용 파서가 필요하다.
// 안전장치: 날짜·시각 각각 "정확히 2개"일 때만(그 이상·이하는 확신 없음),
// 기존 것이 새 것보다 문장에서 먼저 나와야(어순이 뒤바뀐 특이 문장은 제외).
function findAllReservationDates(commandText, todayISO) {
  const found = [];
  const re = /모레|내일|오늘/g;
  let m;
  while ((m = re.exec(commandText))) {
    const value = m[0] === '모레' ? addDaysYMD(2, todayISO) : m[0] === '내일' ? addDaysYMD(1, todayISO) : addDaysYMD(0, todayISO);
    found.push({ value, index: m.index, length: m[0].length });
  }
  return found;
}

function findAllReservationTimes(commandText) {
  const found = [];
  const re = /(오전|오후)\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분|\s*반)?/g;
  let m;
  while ((m = re.exec(commandText))) {
    let hour = parseInt(m[2], 10);
    if (hour < 1 || hour > 12) continue;
    const minute = m[3] ? parseInt(m[3], 10) : (/시\s*반/.test(m[0]) ? 30 : 0);
    if (minute < 0 || minute > 59) continue;
    if (m[1] === '오후' && hour !== 12) hour += 12;
    if (m[1] === '오전' && hour === 12) hour = 0;
    found.push({ value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, index: m.index, length: m[0].length });
  }
  return found;
}

export function matchRuleBasedReservationReschedule(commandText, members, trainers, todayISO) {
  if (!/옮겨|변경|바꿔/.test(commandText)) return null;
  if (!/예약/.test(commandText)) return null;
  const memberName = extractMemberNameFromText(commandText, members);
  const dates = findAllReservationDates(commandText, todayISO);
  const times = findAllReservationTimes(commandText);
  if (dates.length !== 2 || times.length !== 2) return null;
  const [oldDate, newDate] = dates;
  const [oldTime, newTime] = times;
  if (oldDate.index > newDate.index || oldTime.index > newTime.index) return null;
  const tail = commandText.slice(newTime.index + newTime.length);
  const endRe = new RegExp(String.raw`^.{0,10}?(?:으로|로)?\s*(?:옮겨|변경해|바꿔)${POLITE_ENDING}`);
  if (!endRe.test(tail)) return null;
  const trainerName = extractTrainerNameFromText(commandText, trainers);
  return {
    memberName, trainerName,
    oldDate: oldDate.value, oldStartTime: oldTime.value,
    newDate: newDate.value, newStartTime: newTime.value,
  };
}

// [예약 생성 프로젝트 2026-08-08] "폰: trainerId(로그인 정보로 자동 지정) /
// 키오스크: trainerName(말로 지정)" — 사용자가 명시적으로 확정한 구분. 어느
// 쪽인지는 호출부(컴포넌트)가 mode로 알려준다. 기본값은 'phone' — 기존
// GlobalVoiceCommand.jsx 호출부가 mode를 안 넘겨도 그대로 동작하게 하기 위함.
export async function processVoiceCommand({
  transcript,
  role,
  currentUser,
  allMembers,
  allTrainers = [],
  allSchedules = [],
  allPayments = [],
  navigate,
  mode = 'phone',
  history = [],
}) {
  const freeDataAnswer = answerFreeDataQuestion({
    transcript,
    role,
    currentUser,
    members: allMembers,
    schedules: allSchedules,
    payments: allPayments,
  });
  if (freeDataAnswer) return freeDataAnswer;

  // 인사·감사·사용법처럼 의미가 확실한 짧은 대화는 서버 AI를 부르지 않는다.
  // 자연스러운 응답은 유지하면서 반복 호출 비용과 네트워크 오류 가능성을 없앤다.
  const shortText = (transcript || '').trim().replace(/[.!?~]+$/g, '');
  if (shortText.length <= 18 && /^(안녕(?:하세요)?|반가워(?:요)?|모미 안녕)$/u.test(shortText)) {
    return { type: 'chat', text: '안녕하세요, 선생님. 무엇을 도와드릴까요?' };
  }
  if (shortText.length <= 18 && /^(고마워(?:요)?|감사(?:해요|합니다)?|도움됐어(?:요)?)$/u.test(shortText)) {
    return { type: 'chat', text: '도움이 됐다니 좋아요. 더 필요한 게 있으면 말씀해 주세요.' };
  }
  if (shortText.length <= 28 && /(뭘|뭐를?|무엇을).*(할 수|도와)|사용법|어떻게 써/u.test(shortText)) {
    return {
      type: 'chat',
      text: '화면 이동, 예약·메모·세션 변경, 타이머 제어와 간단한 코칭 질문을 도와드릴 수 있어요.',
    };
  }

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

  // [무료 확장 2026-08-11] momi 쓰기 권한 3종도 아주 명확한 패턴일 때만 무료로
  // 처리한다. 아래 세 분기는 Claude 경로의 memo_add_propose/session_adjust_propose/
  // member_info_update_propose 분기와 똑같이 memberWriteService.js의 proposeX()를
  // 그대로 호출한다 — "아직 저장 안 함, 회원·값 검증까지만" 원칙이 무료/유료
  // 경로 양쪽에서 완전히 동일하게 유지된다(로직 이원화 없음).
  const scopedMembersForWrite =
    role === 'admin' ? allMembers : scopeMembersToTrainer(allMembers, currentUser);

  const ruleSessionAdjust = matchRuleBasedSessionAdjust(transcript, scopedMembersForWrite, allTrainers);
  if (ruleSessionAdjust) {
    const trainerId = mode === 'kiosk' ? null : currentUser?.trainerId || null;
    const propose = proposeAdjustSessionCount({
      memberQuery: ruleSessionAdjust.memberName,
      trainerId: trainerId || undefined,
      delta: ruleSessionAdjust.delta,
    });
    return { type: 'session_adjust_propose', propose };
  }

  const rulePhoneUpdate = matchRuleBasedPhoneUpdate(transcript, scopedMembersForWrite);
  if (rulePhoneUpdate) {
    const propose = proposeUpdateMemberInfo({
      memberQuery: rulePhoneUpdate.memberName,
      field: rulePhoneUpdate.field,
      newValue: rulePhoneUpdate.newValue,
    });
    return { type: 'member_info_update_propose', propose };
  }

  const ruleMemoAdd = matchRuleBasedMemoAdd(transcript, scopedMembersForWrite);
  if (ruleMemoAdd) {
    const propose = proposeAddMemberMemo({
      memberQuery: ruleMemoAdd.memberName,
      memoText: ruleMemoAdd.memoText,
    });
    return { type: 'memo_add_propose', propose };
  }

  // [무료 확장 2026-08-11] 예약 생성 — Claude 경로의 reservation_propose 분기와
  // 완전히 동일하게 proposeReservation()을 그대로 호출한다(계산 로직 재사용,
  // 저장은 여전히 트레이너의 "네" 확인 뒤에만 — 다른 무료 확장들과 동일 원칙).
  const ruleReservation = matchRuleBasedReservationCreate(transcript, scopedMembersForWrite, allTrainers, todayYMD());
  if (ruleReservation) {
    const trainerId = mode === 'kiosk' ? null : currentUser?.trainerId || null;
    const propose = proposeReservation({
      memberQuery: ruleReservation.memberName || undefined,
      trainerId: trainerId || undefined,
      trainerName: ruleReservation.trainerName || undefined,
      date: ruleReservation.date,
      startTime: ruleReservation.startTime,
    });
    return { type: 'reservation_propose', propose };
  }

  // [무료 확장 2026-08-11] 예약 취소 — Claude 경로의 reservation_cancel_propose
  // 분기와 완전히 동일하게 proposeCancelReservation()을 그대로 호출한다.
  const ruleCancel = matchRuleBasedReservationCancel(transcript, scopedMembersForWrite, allTrainers, todayYMD());
  if (ruleCancel) {
    const trainerId = mode === 'kiosk' ? null : currentUser?.trainerId || null;
    const propose = proposeCancelReservation({
      memberQuery: ruleCancel.memberName || undefined,
      trainerId: trainerId || undefined,
      trainerName: ruleCancel.trainerName || undefined,
      date: ruleCancel.date,
      startTime: ruleCancel.startTime,
    });
    return { type: 'reservation_cancel_propose', propose };
  }

  // [무료 확장 2026-08-11] 예약 변경 — Claude 경로의 reservation_reschedule_propose
  // 분기와 완전히 동일하게 proposeRescheduleReservation()을 그대로 호출한다.
  const ruleReschedule = matchRuleBasedReservationReschedule(transcript, scopedMembersForWrite, allTrainers, todayYMD());
  if (ruleReschedule) {
    const trainerId = mode === 'kiosk' ? null : currentUser?.trainerId || null;
    const propose = proposeRescheduleReservation({
      memberQuery: ruleReschedule.memberName || undefined,
      trainerId: trainerId || undefined,
      trainerName: ruleReschedule.trainerName || undefined,
      oldDate: ruleReschedule.oldDate,
      oldStartTime: ruleReschedule.oldStartTime,
      newDate: ruleReschedule.newDate,
      newStartTime: ruleReschedule.newStartTime,
    });
    return { type: 'reservation_reschedule_propose', propose };
  }

  // 개인정보·실시간 데이터·후속 맥락이 없는 센터 FAQ만 기기 캐시에서 재사용한다.
  // 회원 이름이 한 글자라도 포함되면 캐시 대상에서 제외한다.
  const cacheOptions = { memberNames: (allMembers || []).map((member) => member.name), history };
  const cached = getCachedVoiceResponse(transcript, cacheOptions);
  if (cached) return cached;

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
    cacheVoiceResponse(transcript, data.text, cacheOptions);
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
