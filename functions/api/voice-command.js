// functions/api/voice-command.js
// Cloudflare Pages Function — POST /api/voice-command
// "모미야" 다음에 들린 말(transcript)을 분류한다.
//  · 화면 이동으로 해석되면(tool_use) → { type:'navigate', destinationId, memberName?, testId? }
//  · 그 외(코칭성 질문 등)면 모미 페르소나로 짧게 대답 → { type:'chat', text }
//
// destinationId 목록은 src/voice/commandRegistry.js의 VOICE_DESTINATIONS와 반드시 같은
// id를 써야 한다(백엔드·프론트가 별도 번들이라 직접 import는 안 되고, 값만 동기화해서 씀).
// role에 따라 애초에 후보 도구 자체를 다르게 넘겨서, 트레이너 음성으로는 관리자 전용
// 화면(트레이너 관리·매출관리)이 선택지에 아예 없다.
import { MOMI_SYSTEM_PROMPT } from '../_shared/momiPrompt.js';
import { resolveVerifiedRole } from '../_shared/verifyFirebaseToken.js';

const MODEL = 'claude-sonnet-5';

// commandRegistry.js VOICE_DESTINATIONS 와 id를 맞출 것.
const ALL_TOOLS = [
  { name: 'go_home', destinationId: 'home', roles: ['trainer', 'admin'],
    description: '홈(대시보드) 화면을 연다. 오늘 일정, 이번 주 캘린더 등을 볼 때.',
    input_schema: { type: 'object', properties: {} } },
  // [음성 명령 확장 2026-08-09] "OO님 회원 관리 열어줘"뿐 아니라 "OO님 세션/수납/
  // 신체정보/측정이력/메모 보여줘/확인해줘"처럼 회원 상세의 특정 탭을 바로 요청하는
  // 경우도 이 도구로 처리한다 — tab을 채우면 MemberDetail.jsx가 해당 탭을 열어서
  // 보여준다(components/members/MemberDetail.jsx의 TABS와 id를 맞춤).
  { name: 'go_members', destinationId: 'members', roles: ['trainer', 'admin'],
    description: '회원 관리 화면을 연다. 특정 회원의 세션·수납·신체정보·측정이력·메모를 보여달라는 요청도 이 도구를 쓰고 tab으로 구분한다.',
    input_schema: { type: 'object', properties: {
      memberName: { type: 'string', description: '들린 회원 이름 그대로. 언급 없으면 생략.' },
      tab: { type: 'string', enum: ['info', 'sessions', 'payments', 'body', 'ai', 'memo'],
        description: '회원 상세에서 바로 열 탭. "기본정보"→info, "세션"/"잔여횟수"→sessions, "수납"/"결제"→payments, "신체정보"/"체성분"→body, "측정이력"/"AI측정기록"→ai, "메모"→memo. 특별히 언급 없으면 생략(기본정보 탭으로 열림).' } } } },
  { name: 'go_schedule', destinationId: 'schedule', roles: ['trainer', 'admin'],
    description: '스케줄(수업 일정) 화면을 연다. "OO님 스케줄 확인해줘"처럼 특정 회원의 일정만 보고 싶어하면 memberName도 채운다(그 회원 이름으로 목록이 좁혀짐).',
    input_schema: { type: 'object', properties: {
      memberName: { type: 'string', description: '들린 회원 이름 그대로. 언급 없으면 생략 — 생략하면 전체 스케줄이 보인다.' } } } },
  { name: 'go_settings', destinationId: 'settings', roles: ['trainer', 'admin'],
    description: '설정 화면을 연다.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'go_trainers', destinationId: 'trainers', roles: ['admin'],
    description: '트레이너 관리 화면을 연다. 관리자 전용.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'go_revenue', destinationId: 'revenue', roles: ['admin'],
    description: '매출 관리 화면을 연다. 관리자 전용. "정산"처럼 특정 탭을 콕 집어 요청하면 tab도 채운다.',
    input_schema: { type: 'object', properties: {
      tab: { type: 'string', enum: ['overview', 'settle', 'expense', 'config'],
        description: '바로 열 탭. "개요"/"손익"→overview, "정산"/"트레이너 정산"→settle, "지출"→expense, "설정"→config. 언급 없으면 생략(개요 탭으로 열림).' } } } },
  // [음성 명령 확장 2026-08-09] testId enum을 ai-measure/registry.js의 MEASURE_MENUS
  // 10개 전부(신체정보~초시계·메트로놈)로 맞춘다. AiMeasureHub.jsx는 이미 이 id들을
  // 그대로 매칭해 자동으로 메뉴를 열어주므로(consumePendingVoiceTarget), 여기 enum만
  // 넓히면 프론트 변경 없이 나머지 측정 페이지들도 음성으로 열린다.
  { name: 'go_ai_measure', destinationId: 'ai_measure', roles: ['trainer', 'admin'],
    description: 'AI측정 화면을 연다. "OO님 신체정보/자세/ROM/보행/점프/바벨/한다리서기/오버헤드스쿼트/녹화/초시계 측정하게 해줘" 같은 요청.',
    input_schema: { type: 'object', properties: {
      memberName: { type: 'string', description: '들린 회원 이름 그대로. 언급 없으면 생략.' },
      testId: { type: 'string', enum: ['body', 'posture', 'rom', 'gait', 'jump', 'lifting', 'stance', 'squat', 'record', 'timer'],
        description: '언급된 측정 종류. "신체정보"→body, "자세"/"체형"→posture, "ROM"/"가동범위"→rom, "보행"/"런닝"→gait, "점프"/"RSI"→jump, "바벨"/"리프팅"→lifting, "한다리서기"/"SLST"/"균형"→stance, "오버헤드"/"딥스쿼트"→squat, "녹화"/"영상"→record, "초시계"/"타이머"/"인터벌"/"메트로놈"→timer. 없으면 생략.' } } } },
  { name: 'go_report', destinationId: 'report', roles: ['trainer', 'admin'],
    description: '리포트 화면을 연다. "OO님 리포트 열어줘"·"OO님 점프 리포트 보여줘" 같은 요청.',
    input_schema: { type: 'object', properties: {
      memberName: { type: 'string', description: '들린 회원 이름 그대로. 언급 없으면 생략.' },
      testId: { type: 'string', enum: ['posture', 'rom', 'gait', 'jump', 'lifting', 'stance', 'squat'],
        description: '언급된 측정 종류(저장된 리포트 종류). 언급되면 도착 즉시 그 회원의 가장 최근 해당 리포트를 자동으로 연다. 없으면 생략(회원만 선택된 채로 열림).' } } } },
  // [음성 타이머 제어 2026-08-09] go_ai_measure의 초시계 메뉴 이동은 화면만 열어줄 뿐
  // 실제로 초시계·타이머·인터벌·메트로놈을 시작/정지시키지는 않는다. "타이머 30초
  // 돌려줘"처럼 실제 작동을 요청하면 이 도구를 쓴다 — destinationId가 없어서(화면
  // 이동이 아니라 제어 명령이라) propose_reservation과 같은 방식으로 navigate 매칭
  // 이전에 별도 분기한다.
  { name: 'control_timer', destinationId: null, roles: ['trainer', 'admin'],
    description: 'AI측정 탭의 초시계·타이머·인터벌·메트로놈을 실제로 시작/정지/리셋한다(화면만 여는 게 아니라 실제 작동). "타이머 30초 돌려줘", "메트로놈 120bpm으로 켜줘", "인터벌 운동40초 휴식20초 8라운드로 시작해줘", "초시계 시작해줘/멈춰줘/리셋해줘" 같은 요청일 때 호출.',
    input_schema: { type: 'object', properties: {
      tool: { type: 'string', enum: ['stopwatch', 'countdown', 'interval', 'metronome'],
        description: '조작할 도구. "초시계"→stopwatch, "타이머"/"카운트다운"→countdown, "인터벌"/"타바타"/"HIIT"/"서킷"→interval, "메트로놈"→metronome.' },
      action: { type: 'string', enum: ['start', 'pause', 'reset', 'lap'],
        description: '"시작해줘"/"돌려줘"/"켜줘"/"계속해줘"→start, "멈춰줘"/"정지해줘"/"일시정지"/"꺼줘"→pause, "리셋해줘"/"처음부터"→reset, 초시계에서 "랩"/"구간기록"→lap(초시계 전용, 다른 도구엔 없음).' },
      seconds: { type: 'number', description: 'countdown을 시작할 때 설정할 총 시간(초 단위 정수). "3분"→180, "90초"→90처럼 변환. countdown이 아니거나 특정 시간 언급이 없으면 생략(생략하면 화면에 이미 설정된 시간 또는 일시정지된 남은 시간으로 시작).' },
      workSec: { type: 'number', description: 'interval 운동 구간 길이(초). 언급 없으면 생략(기존 설정 유지).' },
      restSec: { type: 'number', description: 'interval 휴식 구간 길이(초). 언급 없으면 생략(기존 설정 유지).' },
      rounds: { type: 'number', description: 'interval 라운드 수. 언급 없으면 생략(기존 설정 유지).' },
      bpm: { type: 'number', description: 'metronome 템포(40~220). 언급 없으면 생략(기존 템포 유지).' },
    }, required: ['tool', 'action'] } },
  // [예약 생성 프로젝트 2026-08-08] 화면 이동이 아니라 새 예약을 만들어달라는
  // 요청. "OO님 O월 O일 O시에 예약 잡아줘/걸어줘" 같은 요청일 때만 호출 —
  // 이미 있는 예약을 보는 것(스케줄 화면 열기)과 혼동하지 않도록 설명에 명시.
  // 여기서 저장까지 하지 않는다 — 이 도구는 "제안(propose)"만 만들고, 실제
  // 저장은 트레이너 확인 후 클라이언트가 별도로 처리한다(reservationService.js).
  { name: 'propose_reservation', destinationId: null, roles: ['trainer', 'admin'],
    description: '이미 있는 예약을 "보는" 게 아니라(그건 go_schedule) 새 예약을 "만들어달라"는 요청일 때 호출. 예: "OO님 8월 10일 오전 10시에 예약 잡아줘/걸어줘".',
    input_schema: { type: 'object', properties: {
      memberName: { type: 'string', description: '예약할 회원 이름. 언급 없으면 생략(상담 등 회원 없는 예약일 수 있음).' },
      trainerName: { type: 'string', description: '담당 트레이너 이름이 명시적으로 언급된 경우만 채운다. 언급 없으면 생략 — 추측하지 않는다.' },
      date: { type: 'string', description: '예약 날짜, YYYY-MM-DD. 아래 [음성 명령 라우터 모드]에 적힌 오늘 날짜를 기준으로 "내일"·"다음주 화요일" 같은 상대 표현을 절대 날짜로 계산해서 채운다.' },
      startTime: { type: 'string', description: '예약 시작 시각, HH:MM(24시간제). "오후 3시"→"15:00"처럼 변환.' },
      classType: { type: 'string', description: '수업 종류가 언급됐으면 채운다(예: 재활, 트레이닝, 컨디셔닝). 없으면 생략.' },
    }, required: ['date', 'startTime'] } },
  // [예약 생성 프로젝트 3단계 2026-08-09] propose_reservation(새로 만들기)과
  // 정반대 방향 — 이미 있는 예약을 "취소해달라"는 요청. "몇 시로 옮겨줘" 같은
  // 변경 요청은 아직 이 도구 범위가 아니다(취소만) — 헷갈리면 호출하지 않고
  // 자유 발화로 넘어가도록 설명에 명시.
  { name: 'propose_cancel_reservation', destinationId: null, roles: ['trainer', 'admin'],
    description: '이미 있는 예약을 "취소해달라"는 요청일 때만 호출(새로 만드는 건 propose_reservation, 시간을 옮기는 건 propose_reschedule_reservation). 예: "OO님 8월 10일 10시 예약 취소해줘".',
    input_schema: { type: 'object', properties: {
      memberName: { type: 'string', description: '취소할 예약의 회원 이름. 언급 없으면 생략.' },
      trainerName: { type: 'string', description: '담당 트레이너 이름이 명시적으로 언급된 경우만 채운다. 언급 없으면 생략.' },
      date: { type: 'string', description: '취소할 예약 날짜, YYYY-MM-DD. propose_reservation과 동일하게 오늘 날짜 기준 상대 표현을 절대 날짜로 변환.' },
      startTime: { type: 'string', description: '취소할 예약 시작 시각, HH:MM(24시간제).' },
    }, required: ['date', 'startTime'] } },
  // [예약 생성 프로젝트 4단계 2026-08-09] 취소와 헷갈리지 않도록 설명에 명시 —
  // "취소"가 아니라 "시간만 바꿔달라"는 요청일 때만 호출. 기존 예약을 찾는
  // 필드(memberName/trainerName/oldDate/oldStartTime)와 옮길 새 시간
  // 필드(newDate/newStartTime)를 분리해서, Claude가 두 시간을 헷갈려 하나로
  // 합치지 않도록 스키마 단계에서부터 명확히 구분한다.
  { name: 'propose_reschedule_reservation', destinationId: null, roles: ['trainer', 'admin'],
    description: '이미 있는 예약의 "시간을 옮겨달라/변경해달라"는 요청일 때만 호출(취소가 아니라 이동). 예: "OO님 8월 10일 10시 예약을 8월 11일 14시로 옮겨줘".',
    input_schema: { type: 'object', properties: {
      memberName: { type: 'string', description: '옮길 예약의 회원 이름. 언급 없으면 생략.' },
      trainerName: { type: 'string', description: '담당 트레이너 이름이 명시적으로 언급된 경우만 채운다. 언급 없으면 생략.' },
      oldDate: { type: 'string', description: '현재 예약된 날짜(옮기기 전), YYYY-MM-DD.' },
      oldStartTime: { type: 'string', description: '현재 예약된 시작 시각(옮기기 전), HH:MM(24시간제).' },
      newDate: { type: 'string', description: '옮길 새 날짜, YYYY-MM-DD. 오늘 날짜 기준 상대 표현을 절대 날짜로 변환.' },
      newStartTime: { type: 'string', description: '옮길 새 시작 시각, HH:MM(24시간제).' },
    }, required: ['oldDate', 'oldStartTime', 'newDate', 'newStartTime'] } },
  // [momi 쓰기 권한 확장 2026-08-10] 여기부터 3개는 회원 데이터를 실제로 바꾸는
  // 첫 쓰기 기능(예약 외). propose_reservation과 완전히 같은 이유로
  // destinationId:null(화면 이동 아님) + "제안만 하고 실제 저장은 안 함" 원칙을
  // 그대로 따른다 — 실제 저장은 프론트가 트레이너의 명시적 "네" 확인을 받은
  // 뒤에만 src/services/memberWriteService.js의 confirmX()를 호출해서 한다.
  { name: 'propose_add_member_memo', destinationId: null, roles: ['trainer', 'admin'],
    description: '회원 메모에 내용을 "추가"해달라는 요청일 때 호출한다(기존 메모를 지우고 새로 쓰는 게 아니라 뒤에 이어붙이는 것). 예: "OO님 메모에 무릎 조심이라고 추가해줘". 메모를 "보여줘/확인해줘"(조회)는 이 도구가 아니라 go_members(tab:memo)를 쓴다 — 헷갈리지 않는다.',
    input_schema: { type: 'object', properties: {
      memberName: { type: 'string', description: '메모를 추가할 회원 이름.' },
      memoText: { type: 'string', description: '추가할 메모 내용. 불필요한 조사·군더더기는 다듬어도 되지만 의미·수치는 절대 바꾸지 않는다.' },
    }, required: ['memberName', 'memoText'] } },
  { name: 'propose_adjust_session_count', destinationId: null, roles: ['trainer', 'admin'],
    description: '회원의 세션(수업) 잔여·총 횟수를 "추가"하거나 "차감"해달라는 요청일 때 호출한다(단순 조회는 go_members(tab:sessions)). 예: "OO님 세션 2회 추가해줘", "OO님 세션 1회 차감해줘". 담당 트레이너가 명시적으로 언급되면 trainerName도 채운다(언급 없으면 생략 — 그 회원의 담당 트레이너가 1명뿐이면 서버가 자동으로 정한다).',
    input_schema: { type: 'object', properties: {
      memberName: { type: 'string', description: '세션을 조정할 회원 이름.' },
      trainerName: { type: 'string', description: '담당 트레이너 이름이 명시적으로 언급된 경우만 채운다. 언급 없으면 생략.' },
      delta: { type: 'number', description: '조정할 횟수. "추가"/"더해줘"/"늘려줘"는 양수, "차감"/"빼줘"/"줄여줘"는 음수로 채운다. 예: "2회 추가"→2, "1회 차감"→-1.' },
    }, required: ['memberName', 'delta'] } },
  { name: 'propose_update_member_info', destinationId: null, roles: ['trainer', 'admin'],
    description: '회원의 전화번호 또는 비상연락처를 바꿔달라는 요청일 때 호출한다. 예: "OO님 전화번호 010-1234-5678로 바꿔줘". 이름·생년월일·주소 등 다른 정보 수정은 아직 지원 안 함(호출하지 말고 자유 발화로 답하라).',
    input_schema: { type: 'object', properties: {
      memberName: { type: 'string', description: '정보를 수정할 회원 이름.' },
      field: { type: 'string', enum: ['phone', 'phone2'],
        description: '"전화번호"/"연락처"/"휴대폰(번호)"→phone, "비상연락처"/"보호자연락처"/"연락처2"→phone2.' },
      newValue: { type: 'string', description: '새로 바꿀 값. 전화번호는 010-1234-5678처럼 하이픈 포함 형식으로 정리해서 채운다.' },
    }, required: ['memberName', 'field', 'newValue'] } },
];

// [무료 확장 2026-08-10] 트레이너관리·매출관리는 "관리자 전용이라 클라이언트가
// 규칙 기반으로 끝내면 안 된다"는 이유로 지금까지 항상 Claude를 거쳤다(위
// commandRegistry.js 주석·src/services/voiceCommandService.js 주석 참고). 하지만
// 그 이유는 어디까지나 "role을 못 믿어서"였지 "문장 이해가 어려워서"가 아니었다.
// 여기 아래 onRequestPost 안에서 role은 이미 resolveVerifiedRole()로 서버가
// 직접 검증을 끝낸 뒤이므로, 그 검증된 role을 갖고 하는 규칙 기반 판단은
// client-side 규칙 기반과 똑같이 안전하다 — 보안 경계(토큰 검증)는 그대로 두고,
// 그 뒤에 "뻔한 문장을 Claude에게 또 물어보지 않는다"는 비용 최적화만 얹는 것.
const ADMIN_NAV_VERBS = ['열어', '띄워', '보여', '가줘', '가자', '이동', '들어가'];
const ADMIN_DESTINATION_KEYWORDS = [
  { id: 'trainers', keywords: ['트레이너'] },
  { id: 'revenue', keywords: ['매출'] },
];
// go_revenue 도구 설명(위 41~45줄)과 같은 키워드 매핑을 그대로 따른다.
const REVENUE_TAB_KEYWORDS = [
  { id: 'settle', keywords: ['정산'] },
  { id: 'expense', keywords: ['지출'] },
  { id: 'config', keywords: ['설정'] },
  { id: 'overview', keywords: ['개요', '손익'] },
];

function normalizeForMatch(s) {
  return (s || '').replace(/\s+/g, '').toLowerCase();
}

/**
 * role이 이미 'admin'으로 검증된 요청에서만 호출한다(호출부 가드 참고).
 * 확신 있게 못 찾으면 null을 반환해서, 호출부가 기존처럼 Claude 경로로 넘긴다
 * — 즉 이 함수가 틀려도(매치 실패) 동작이 나빠지는 게 아니라 예전 그대로일 뿐이다.
 */
function matchAdminRuleBasedDestination(transcript) {
  const normalized = normalizeForMatch(transcript);
  if (!ADMIN_NAV_VERBS.some((v) => normalized.includes(normalizeForMatch(v)))) return null;
  for (const { id, keywords } of ADMIN_DESTINATION_KEYWORDS) {
    if (keywords.some((k) => normalized.includes(normalizeForMatch(k)))) return id;
  }
  return null;
}

function matchRevenueTab(transcript) {
  const normalized = normalizeForMatch(transcript);
  for (const { id, keywords } of REVENUE_TAB_KEYWORDS) {
    if (keywords.some((k) => normalized.includes(normalizeForMatch(k)))) return id;
  }
  return null;
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    // [음성 대화형 2026-08-09] history?: [{role, content}, ...] — 이전 음성
    // 대화 턴(functions/api/momi.js의 Axis4와 완전히 같은 패턴 재사용).
    // 여태 이 엔드포인트는 매 호출이 무상태(stateless)라 "그럼 그건?" 같은
    // 자연스러운 후속 질문을 못 알아들었다 — 매번 처음 보는 사람 취급하는
    // 셈이었다. 화면 이동·예약류는 대화 맥락이 필요 없는 단발성 액션이라
    // history에 안 쌓지만(클라이언트 책임), 자유 질문(coaching Q&A) 답변은
    // 여기 쌓여서 다음 질문에 이어붙는다.
    const { transcript, history } = body || {};

    if (!transcript) {
      return new Response(JSON.stringify({ error: 'transcript가 필요합니다.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // [보안 수정] 예전엔 body.role을 클라이언트가 보낸 그대로 믿었다 — 트레이너 계정에서
    // role 값만 조작해 보내면 관리자 전용 화면(트레이너관리·매출관리)으로 음성 이동이
    // 가능한 취약점이었다. 이제는 Authorization 헤더의 Firebase ID 토큰을 서버가 직접
    // 서명 검증해서 role을 구한다(위조 불가 — resolveVerifiedRole 헤더 주석 참고).
    const { role: effectiveRole } = await resolveVerifiedRole(request.headers.get('Authorization'));

    // [무료 확장 2026-08-10] role이 진짜 admin으로 검증된 경우에만(가드) 트레이너
    // 관리·매출관리 이동을 규칙 기반으로 먼저 시도한다 — 매치되면 Claude를 아예
    // 안 불러서 크레딧이 없어도 동작하고, 매치 안 되면(애매한 표현·다른 요청 등)
    // 그냥 아래로 흘러가 기존 Claude 경로를 그대로 탄다.
    if (effectiveRole === 'admin') {
      const adminDestId = matchAdminRuleBasedDestination(transcript);
      if (adminDestId) {
        const navBody = { type: 'navigate', destinationId: adminDestId };
        if (adminDestId === 'revenue') {
          const tab = matchRevenueTab(transcript);
          if (tab) navBody.tab = tab;
        }
        return new Response(JSON.stringify(navBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // role에 안 맞는 도구는 애초에 Claude에게 후보로도 전달하지 않는다.
    const tools = ALL_TOOLS.filter((t) => t.roles.includes(effectiveRole)).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));

    // [예약 생성 프로젝트 2026-08-08] "내일"·"다음주 화요일" 같은 상대 날짜를
    // Claude가 절대 날짜로 바꾸려면 "오늘이 며칠인지" 알아야 한다. Cloudflare
    // Functions 서버 시각은 UTC라 그냥 new Date()를 쓰면 한국 자정 근처에서
    // 하루가 밀리는 오차가 생긴다 — KST(UTC+9)로 보정한 뒤 날짜만 뽑는다.
    const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // [음성 대화형 2026-08-09] momi.js와 동일한 방어적 필터 — 클라이언트가 보낸
    // history를 그대로 신뢰하지 않고 형식이 맞는 턴만 통과시킨다.
    const validHistory = Array.isArray(history)
      ? history.filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
      : [];

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        system:
          MOMI_SYSTEM_PROMPT +
          `\n\n---\n\n[음성 명령 라우터 모드] 사용자가 "모미야" 다음에 한 말이 위 도구 목록 중 하나로 화면 이동을 요청하는 것이면 해당 도구를 호출하세요. 화면 이동 요청이 아니라 코칭 질문 등 자유 발화라면 도구를 호출하지 말고, 위 시스템 프롬프트의 모미 페르소나로 1~2문장 이내로 짧게 답하세요.\n\n오늘 날짜는 ${todayKST}(한국 시간 기준)입니다. propose_reservation을 호출할 때 "내일"·"다음주 화요일" 같은 상대적 날짜 표현은 이 기준으로 계산해서 절대 날짜(YYYY-MM-DD)로 변환하세요.`,
        tools,
        messages: [...validHistory, { role: 'user', content: transcript }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return new Response(JSON.stringify({ error: 'Anthropic API 호출 실패', detail: errText }), {
        status: anthropicRes.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await anthropicRes.json();
    const toolUse = (data.content || []).find((block) => block.type === 'tool_use');

    if (toolUse) {
      // [예약 생성 프로젝트 2026-08-08] 화면 이동(navigate)이 아니라 예약 제안
      // 응답 — destinationId가 없어서 아래 navigate 매칭 로직과 섞이면 안 되므로
      // 먼저 분기한다. 여기서 실제 저장은 안 한다 — 클라이언트가 이 값을 받아
      // reservationService.proposeReservation()으로 회원/트레이너 매칭·충돌
      // 검사까지 마친 뒤 트레이너 확인을 받고서야 저장한다.
      if (toolUse.name === 'propose_reservation') {
        return new Response(
          JSON.stringify({
            type: 'reservation_propose',
            memberName: toolUse.input?.memberName || null,
            trainerName: toolUse.input?.trainerName || null,
            date: toolUse.input?.date || null,
            startTime: toolUse.input?.startTime || null,
            classType: toolUse.input?.classType || null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      // [예약 생성 프로젝트 3단계 2026-08-09] 위와 대칭 — 여기서도 저장(삭제)은
      // 안 한다. 클라이언트가 reservationService.proposeCancelReservation()으로
      // 대상을 특정(회원/트레이너/일시로 좁혀서 정확히 한 건인지 확인)한 뒤,
      // 트레이너 확인을 받고서야 실제로 취소한다.
      if (toolUse.name === 'propose_cancel_reservation') {
        return new Response(
          JSON.stringify({
            type: 'reservation_cancel_propose',
            memberName: toolUse.input?.memberName || null,
            trainerName: toolUse.input?.trainerName || null,
            date: toolUse.input?.date || null,
            startTime: toolUse.input?.startTime || null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      // [예약 생성 프로젝트 4단계 2026-08-09] 위 둘과 같은 이유로 여기서도
      // 저장(변경)은 안 한다. 클라이언트가
      // reservationService.proposeRescheduleReservation()으로 옮길 대상을
      // 특정하고 새 시간대 충돌까지 확인한 뒤, 트레이너 확인을 받고서야 실제로
      // 변경한다.
      if (toolUse.name === 'propose_reschedule_reservation') {
        return new Response(
          JSON.stringify({
            type: 'reservation_reschedule_propose',
            memberName: toolUse.input?.memberName || null,
            trainerName: toolUse.input?.trainerName || null,
            oldDate: toolUse.input?.oldDate || null,
            oldStartTime: toolUse.input?.oldStartTime || null,
            newDate: toolUse.input?.newDate || null,
            newStartTime: toolUse.input?.newStartTime || null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      // [momi 쓰기 권한 확장 2026-08-10] 위 예약 3개와 완전히 같은 이유로 여기서도
      // 저장은 안 한다 — 클라이언트가 memberWriteService.proposeAddMemberMemo()로
      // 회원 매칭까지 마친 뒤, 트레이너 확인을 받고서야 confirmAddMemberMemo()로 저장한다.
      if (toolUse.name === 'propose_add_member_memo') {
        return new Response(
          JSON.stringify({
            type: 'memo_add_propose',
            memberName: toolUse.input?.memberName || null,
            memoText: toolUse.input?.memoText || null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      // 세션 횟수 조정 — memberWriteService.proposeAdjustSessionCount()가 회원·
      // 트레이너 매칭과 "음수가 되지 않는지" 하드 검증까지 전부 담당한다.
      if (toolUse.name === 'propose_adjust_session_count') {
        return new Response(
          JSON.stringify({
            type: 'session_adjust_propose',
            memberName: toolUse.input?.memberName || null,
            trainerName: toolUse.input?.trainerName || null,
            delta: typeof toolUse.input?.delta === 'number' ? toolUse.input.delta : null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      // 회원 기본정보(전화번호 등) 수정 — memberWriteService.proposeUpdateMemberInfo()가
      // 지원 필드(phone/phone2) 검증까지 담당한다.
      if (toolUse.name === 'propose_update_member_info') {
        return new Response(
          JSON.stringify({
            type: 'member_info_update_propose',
            memberName: toolUse.input?.memberName || null,
            field: toolUse.input?.field || null,
            newValue: toolUse.input?.newValue || null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      // [음성 타이머 제어 2026-08-09] 화면 이동(navigate)이 아니라 초시계·타이머·
      // 인터벌·메트로놈을 실제로 조작하는 명령 — destinationId가 없어서(제어
      // 명령이지 화면 이동이 아니므로) navigate 매칭보다 먼저 분기한다. 저장할
      // 데이터가 없는 순수 UI 제어(되돌릴 수 없는 부작용 없음)라 예약류와 달리
      // 트레이너 확인 없이 바로 실행한다 — 실제 시작/정지는 클라이언트
      // (TimerTool.jsx)가 담당한다.
      if (toolUse.name === 'control_timer') {
        return new Response(
          JSON.stringify({
            type: 'timer_control',
            tool: toolUse.input?.tool || null,
            action: toolUse.input?.action || null,
            seconds: typeof toolUse.input?.seconds === 'number' ? toolUse.input.seconds : null,
            workSec: typeof toolUse.input?.workSec === 'number' ? toolUse.input.workSec : null,
            restSec: typeof toolUse.input?.restSec === 'number' ? toolUse.input.restSec : null,
            rounds: typeof toolUse.input?.rounds === 'number' ? toolUse.input.rounds : null,
            bpm: typeof toolUse.input?.bpm === 'number' ? toolUse.input.bpm : null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      const matched = ALL_TOOLS.find((t) => t.name === toolUse.name);
      // role 필터링을 우회해 도구가 호출되더라도 이중 방어.
      if (!matched || !matched.roles.includes(effectiveRole)) {
        return new Response(
          JSON.stringify({ type: 'chat', text: '죄송해요, 그 화면은 권한이 없어서 열어드릴 수 없어요.' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          type: 'navigate',
          destinationId: matched.destinationId,
          memberName: toolUse.input?.memberName || null,
          testId: toolUse.input?.testId || null,
          // [음성 명령 확장 2026-08-09] go_members(세션·수납·신체정보·측정이력·메모)와
          // go_revenue(정산 등)만 tab을 쓴다 — 나머지 도구는 애초에 tab을 안 물어보므로
          // toolUse.input?.tab이 항상 undefined라 null로 자연히 떨어진다.
          tab: toolUse.input?.tab || null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const textBlock = (data.content || []).find((block) => block.type === 'text');
    return new Response(
      JSON.stringify({ type: 'chat', text: textBlock ? textBlock.text : '네, 말씀하세요!' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: '서버 오류', detail: String(err && err.message ? err.message : err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
