// src/services/reservationService.js
// ════════════════════════════════════════════════════════════════════════
//  [예약 생성 프로젝트 — 1단계 시작 2026-08-08] "모미야, OO님 O일 O시에 예약
//  걸어줘" 요청 대응. 지금까지 만든 모든 Momi 기능은 읽기/이동이었는데, 이건
//  실제로 데이터를 쓰는(Firestore에 예약을 만드는) 첫 기능이라 안전 설계를
//  최우선으로 한다.
//
//  2단계로 나눈다:
//    1) proposeReservation() — 아무것도 저장하지 않는다. 회원 매칭·충돌 검사·
//       세션 잔액 확인까지 전부 마치고 "제안(draft)"만 만든다. 순수 조회만
//       하므로 몇 번을 불러도 안전(부작용 없음).
//    2) confirmReservation() — 트레이너가 화면에서 명시적으로 확인을 누른
//       뒤에만 호출된다. 실제 저장은 이미 검증된 createScheduleWithDeduction
//       (기존 수동 예약 UI가 쓰는 것과 완전히 같은 함수)에 위임한다 — 세션
//       차감 로직을 별도로 재구현하지 않고 기존의, 이미 테스트된 원자적 처리를
//       그대로 재사용한다.
//
//  [범위 — 1단계에서 하는 것과 안 하는 것]
//  이 파일은 "이미 구조화된 값"(memberQuery, trainerId, date, startTime 등)을
//  받는다. "O일 O시" 같은 자연어를 이 구조로 바꾸는 건 이 파일의 역할이
//  아니다 — 그건 Claude가 하기에 맞는 일이라 별도로 연결한다(다음 단계).
//  여기서는 틀리면 안 되는 결정적(deterministic) 로직 — 회원 매칭, 시간 충돌
//  검사, 세션 잔액 확인 — 만 다룬다. LLM에게 맡기면 안 되는 부분을 사람이
//  검증 가능한 순수 로직으로 분리해두는 게 핵심이다.
//
//  충돌 판정 기준은 기존 scheduleAudit.js의 same_slot 규칙과 동일하게
//  맞췄다(같은 날짜·같은 시작시간 — 전체 시간대 겹침이 아니라 정확히 일치하는
//  경우만 충돌로 본다). 다만 audit은 "같은 회원의 중복"만 보는데, 여기서는
//  새 예약을 만드는 시점이라 "같은 트레이너가 다른 회원과 이미 겹치는지"도
//  추가로 확인한다(트레이너 이중 예약은 사전에 막는 게 나으므로).
// ════════════════════════════════════════════════════════════════════════

import { store } from '../demoData';

function normalize(str) {
  return (str || '').replace(/\s+/g, '').toLowerCase();
}

/** 회원 목록에서 이름으로 찾는다. 정확히 일치 → 부분 일치 순. */
function findMemberByName(members, query) {
  if (!query) return null;
  const target = normalize(query);
  const exact = members.find((m) => normalize(m.name) === target);
  if (exact) return exact;
  const partial = members.find(
    (m) => normalize(m.name).includes(target) || target.includes(normalize(m.name))
  );
  return partial || null;
}

/** 트레이너 목록에서 이름으로 찾는다(키오스크 — 말로 트레이너를 지정하는 경우). */
function findTrainerByName(trainers, query) {
  if (!query) return null;
  const target = normalize(query);
  const exact = trainers.find((t) => normalize(t.name) === target);
  if (exact) return exact;
  const partial = trainers.find(
    (t) => normalize(t.name).includes(target) || target.includes(normalize(t.name))
  );
  return partial || null;
}

/**
 * 예약을 제안한다 — 아무 것도 저장하지 않는다(부작용 없음, 여러 번 호출해도 안전).
 * @param {object} params
 * @param {string} [params.memberQuery]  회원 이름(음성/텍스트에서 들어온 그대로)
 * @param {string} [params.trainerId]    폰/태블릿 — 로그인된 트레이너 본인 ID(정확).
 * @param {string} [params.trainerName]  키오스크 — 말로 지정한 트레이너 이름(퍼지 매칭).
 *   trainerId가 있으면 그쪽을 우선한다. 폰에서는 trainerId만, 키오스크에서는
 *   trainerName만 넘기는 게 일반적 — 둘 다 없으면 경고.
 * @param {string} params.date        'YYYY-MM-DD'
 * @param {string} params.startTime   'HH:MM'
 * @param {string} [params.endTime]   생략 시 시작+1시간
 * @param {string} [params.classType] 생략 시 '트레이닝'
 * @returns {{ ready: boolean, warnings: string[], draft: object, remainingAfter: number|null }}
 */
export function proposeReservation({
  memberQuery,
  trainerId,
  trainerName,
  date,
  startTime,
  endTime,
  classType,
} = {}) {
  const warnings = [];

  if (!date || !startTime) {
    warnings.push('날짜와 시작 시간은 필수입니다.');
  }

  const members = store.getMembers();
  const trainers = store.getTrainers();
  const member = memberQuery ? findMemberByName(members, memberQuery) : null;
  if (memberQuery && !member) {
    warnings.push(`"${memberQuery}"와(과) 일치하는 회원을 찾지 못했습니다.`);
  }

  // trainerId(정확한 ID — 폰에서 로그인 정보로 자동 지정)가 있으면 그걸 우선
  // 신뢰한다. 없으면 trainerName(키오스크 — 말로 지정한 이름)으로 찾는다.
  let trainer = trainerId ? trainers.find((t) => t.id === trainerId) || null : null;
  if (!trainer && trainerName) {
    trainer = findTrainerByName(trainers, trainerName);
  }
  const resolvedTrainerId = trainer?.id || trainerId || null;

  if (trainerId && !trainer) {
    warnings.push('지정한 트레이너 정보를 찾을 수 없습니다.');
  } else if (!trainerId && trainerName && !trainer) {
    warnings.push(`"${trainerName}"와(과) 일치하는 트레이너를 찾지 못했습니다.`);
  } else if (!trainerId && !trainerName) {
    warnings.push('담당 트레이너를 지정해주세요.');
  }

  const resolvedEndTime = endTime || addOneHour(startTime);

  // [충돌 검사] scheduleAudit.js의 same_slot과 같은 기준(정확한 날짜+시작시간
  // 일치) — 부분 겹침(예: 9:30 시작이 9:00~10:00과 겹치는 경우)까지는 아직 못
  // 잡는다는 한계가 있음을 알고 있다(기존 감사 도구와 일관성을 우선함).
  const schedules = store.getSchedules().filter((s) => s.status !== 'canceled');
  const sameSlot = (s) => s.date === date && s.startTime === startTime;

  const trainerConflict = resolvedTrainerId
    ? schedules.find((s) => s.trainerId === resolvedTrainerId && sameSlot(s))
    : null;
  if (trainerConflict) {
    warnings.push(
      `${trainer?.name || '해당 트레이너'}님은 ${date} ${startTime}에 이미 다른 예약(${trainerConflict.memberName || '외부/상담'})이 있습니다.`
    );
  }

  const memberConflict = member
    ? schedules.find((s) => s.memberId === member.id && sameSlot(s))
    : null;
  if (memberConflict && (!trainerConflict || memberConflict.id !== trainerConflict.id)) {
    warnings.push(`${member.name}님은 ${date} ${startTime}에 이미 다른 예약이 있습니다.`);
  }

  // [세션 잔액 확인] — 부족해도 막지는 않는다(예: 트레이너가 서비스로 추가
  // 세션을 줄 수도 있음, 정직성 원칙상 판단은 사람에게). 경고만 띄운다.
  let remainingAfter = null;
  if (member && resolvedTrainerId) {
    const pkg = member.trainerSessions?.[resolvedTrainerId];
    if (pkg && typeof pkg.remaining === 'number') {
      remainingAfter = pkg.remaining - 1;
      if (pkg.remaining <= 0) {
        warnings.push(
          `${member.name}님의 ${trainer?.name || ''} 세션 잔여 횟수가 0회입니다. 등록 없이 예약을 진행하면 오류로 표시될 수 있습니다.`
        );
      }
    }
  }

  return {
    ready: warnings.length === 0,
    warnings,
    remainingAfter,
    draft: {
      memberId: member?.id || null,
      memberName: member?.name || memberQuery || null,
      trainerId: resolvedTrainerId,
      trainerName: trainer?.name || trainerName || '',
      trainerColor: trainer?.color || '#94a3b8',
      date: date || null,
      startTime: startTime || null,
      endTime: resolvedEndTime,
      classType: classType || '트레이닝',
      status: 'scheduled',
      sessionDeducted: false,
      isExternal: false,
    },
  };
}

/**
 * proposeReservation()이 만든 draft를 실제로 저장한다. 트레이너의 명시적
 * 확인 뒤에만 호출해야 한다 — 이 함수 자체는 확인 여부를 모르므로(그건 UI
 * 책임), warnings가 있어도 호출하면 그대로 진행한다(강제로 안 막음 — 사람의
 * 최종 판단을 존중).
 */
export async function confirmReservation(draft) {
  if (!draft?.date || !draft?.startTime) {
    throw new Error('date/startTime이 없는 draft는 저장할 수 없습니다.');
  }
  return store.createScheduleWithDeduction(draft);
}

function addOneHour(hhmm) {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  const next = (h + 1) % 24;
  return `${String(next).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ════════════════════════════════════════════════════════════════════════
//  [예약 생성 프로젝트 2단계 2026-08-08] 확인 흐름(propose → 음성으로 요약
//  읽어주기 → "네/아니요" 대답 대기 → confirm/취소) 연결에 필요한 순수
//  함수 둘. 둘 다 음성인식·TTS와 직접 얽히지 않는 순수 로직만 담당한다 —
//  실제로 speak()·awaitReply()를 부르는 건 이 함수들을 쓰는 쪽(voice
//  컴포넌트)의 책임이다. 사람이 검증 가능한 형태로 분리해두는 게 핵심
//  원칙(위 파일 상단 설명과 동일한 이유).
// ════════════════════════════════════════════════════════════════════════

/**
 * proposeReservation()의 결과를 트레이너에게 음성으로 확인받을 문장으로
 * 만든다. "맞으실까요?"로 끝나야 아래 interpretConfirmationReply()가 자연스러운
 * "네/아니요" 대답을 기대할 수 있다. 경고(warnings)가 있으면(예: 세션 잔여
 * 0회, 시간 충돌) 질문 뒤에 이어 붙여서 트레이너가 듣고 최종 판단하게 한다 —
 * 여기서 경고 유무로 진행 여부를 대신 막지 않는다(그건 사람 판단).
 */
export function buildReservationSummary({ draft, warnings } = {}) {
  if (!draft) return '예약 정보를 만들지 못했어요.';
  const who = draft.memberName ? `${draft.memberName}님` : '회원 미지정으로';
  const when = draft.date && draft.startTime ? `${draft.date} ${draft.startTime}` : '일시 미정으로';
  const withTrainer = draft.trainerName ? `${draft.trainerName} 트레이너` : '트레이너 미지정으로';
  const classType = draft.classType || '트레이닝';
  const base = `${who} ${when} ${withTrainer} ${classType} 예약, 맞으실까요?`;
  if (warnings && warnings.length > 0) {
    return `${base} 다만 ${warnings.join(' ')}`;
  }
  return base;
}

// [버그 수정 2026-08-08] 처음엔 YES 패턴(해줘 포함)을 먼저 검사했더니 "취소해줘"가
// "취소"보다 "해줘"에 먼저 걸려 confirm으로 잘못 해석되는 순서 버그가 있었다.
// NO 패턴을 항상 먼저 검사해서, "취소해줘"가 "취소"에 걸려 cancel로 먼저
// 확정되고 "해줘" 쪽은 아예 검사되지 않도록 순서를 고정한다.
const CONFIRM_NO_PATTERNS = ['아니요', '아니오', '아니', '취소', '그만', '안돼', '안할래', '노'];
const CONFIRM_YES_PATTERNS = ['네', '예', '응', '맞아', '맞습니다', '좋아', '진행', '해줘', '해주세요', '확인'];

/**
 * awaitReply()로 받은 다음 발화(heard)를 확인/취소/불명확/시간초과로 해석한다.
 * heard가 null(시간초과) 또는 빈 문자열(무음 인식)이면 'timeout' — 둘 다
 * "판단할 근거가 없다"는 점에서 동일하게 다룬다(예약을 만들지 않고 다시
 * 물어보는 쪽이 안전하므로 이후 처리는 호출부에서 unclear와 동일하게 취급해도 됨).
 */
export function interpretConfirmationReply(heard) {
  if (heard === null || heard === undefined || !heard.trim()) return 'timeout';
  const normalized = normalize(heard);
  if (CONFIRM_NO_PATTERNS.some((p) => normalized.includes(normalize(p)))) return 'cancel';
  if (CONFIRM_YES_PATTERNS.some((p) => normalized.includes(normalize(p)))) return 'confirm';
  return 'unclear';
}

// ════════════════════════════════════════════════════════════════════════
//  [예약 생성 프로젝트 3단계 2026-08-09] "OO님 O일 O시 예약 취소해줘" — 만들기의
//  반대 방향. 처음 설계했던 원칙을 그대로 따른다: propose(순수 조회, 부작용
//  없음) → 확인 → 실제 취소는 확인 후에만. 세션 복원 로직은 절대 새로 안 짠다
//  — Schedule.jsx가 이미 쓰고 있는 store.deleteScheduleWithRestore()를 그대로
//  위임한다(같은 원자적 batch 처리를 그대로 재사용).
// ════════════════════════════════════════════════════════════════════════

/**
 * 취소할 예약을 찾는다 — 아무 것도 지우지 않는다(부작용 없음).
 * @param {object} params
 * @param {string} [params.memberQuery]
 * @param {string} [params.trainerId]    폰 — 로그인된 본인.
 * @param {string} [params.trainerName]  키오스크 — 말로 지정.
 * @param {string} params.date        'YYYY-MM-DD'
 * @param {string} params.startTime   'HH:MM'
 * @returns {{ ready: boolean, warnings: string[], schedule: object|null }}
 */
export function proposeCancelReservation({ memberQuery, trainerId, trainerName, date, startTime } = {}) {
  const warnings = [];
  if (!date || !startTime) {
    warnings.push('날짜와 시작 시간은 필수입니다.');
    return { ready: false, warnings, schedule: null };
  }

  const members = store.getMembers();
  const trainers = store.getTrainers();
  const member = memberQuery ? findMemberByName(members, memberQuery) : null;
  if (memberQuery && !member) {
    warnings.push(`"${memberQuery}"와(과) 일치하는 회원을 찾지 못했습니다.`);
  }

  let trainer = trainerId ? trainers.find((t) => t.id === trainerId) || null : null;
  if (!trainer && trainerName) {
    trainer = findTrainerByName(trainers, trainerName);
  }
  const resolvedTrainerId = trainer?.id || trainerId || null;
  if (!trainerId && trainerName && !trainer) {
    warnings.push(`"${trainerName}"와(과) 일치하는 트레이너를 찾지 못했습니다.`);
  }

  // 이미 취소된 건 애초에 취소 대상이 아니다.
  const activeSchedules = store.getSchedules().filter((s) => s.status !== 'canceled');
  const candidates = activeSchedules.filter((s) => {
    if (s.date !== date || s.startTime !== startTime) return false;
    if (member && s.memberId !== member.id) return false;
    if (resolvedTrainerId && s.trainerId !== resolvedTrainerId) return false;
    return true;
  });

  if (candidates.length === 0) {
    warnings.push(`${date} ${startTime}에 해당하는 예약을 찾지 못했습니다.`);
    return { ready: false, warnings, schedule: null };
  }
  // [정직성 원칙] 여러 건이 걸리면 임의로 하나를 골라 지우지 않는다 — 잘못
  // 지우면 되돌릴 방법이 없는 파괴적 작업이라, 애매하면 반드시 사람이 더
  // 구체적으로 말하게 한다.
  if (candidates.length > 1) {
    warnings.push('같은 시간에 일치하는 예약이 여러 건이라 하나로 특정할 수 없습니다. 회원이나 트레이너를 더 정확히 말씀해주세요.');
    return { ready: false, warnings, schedule: null };
  }

  return { ready: warnings.length === 0, warnings, schedule: candidates[0] };
}

/**
 * proposeCancelReservation()이 찾은 schedule을 실제로 취소(삭제+세션 복원)한다.
 * 트레이너의 명시적 확인 뒤에만 호출해야 한다(그건 UI 책임). 세션 복원 로직은
 * store.deleteScheduleWithRestore()에 전부 위임 — 재구현하지 않는다.
 */
export async function cancelReservation(scheduleId) {
  if (!scheduleId) throw new Error('scheduleId 없이는 취소할 수 없습니다.');
  return store.deleteScheduleWithRestore(scheduleId);
}

/**
 * proposeCancelReservation()의 결과를 트레이너에게 음성으로 확인받을 문장으로
 * 만든다. buildReservationSummary()와 같은 이유로 순수 함수로 분리한다.
 */
export function buildCancelSummary({ schedule } = {}) {
  if (!schedule) return '취소할 예약 정보를 찾지 못했어요.';
  const who = schedule.memberName ? `${schedule.memberName}님` : '회원 미지정';
  const when = `${schedule.date} ${schedule.startTime}`;
  const withTrainer = schedule.trainerName ? ` (${schedule.trainerName} 트레이너)` : '';
  return `${who} ${when}${withTrainer} 예약을 취소할까요?`;
}

// ════════════════════════════════════════════════════════════════════════
//  [예약 생성 프로젝트 4단계 2026-08-09] "OO님 예약 O일 O시로 옮겨줘" — 만들기·
//  취소에 이은 세 번째 축(변경). 앞의 둘과 원칙은 동일: propose(순수 조회) →
//  확인 → 확인 후에만 실제 변경. 두 단계로 구성된다 — proposeCancelReservation과
//  같은 방식으로 "옮길 대상"을 정확히 한 건으로 특정하고, proposeReservation과
//  같은 충돌 검사 기준으로 "새 시간대"가 비어있는지 확인한다. 저장은
//  Schedule.jsx가 이미 쓰는 store.updateSchedule()에 그대로 위임 — 새 로직
//  재구현 안 함.
// ════════════════════════════════════════════════════════════════════════

/**
 * 예약 시간 변경을 제안한다 — 아무 것도 바꾸지 않는다(부작용 없음).
 * @param {object} params
 * @param {string} [params.memberQuery]
 * @param {string} [params.trainerId]     폰 — 로그인된 본인.
 * @param {string} [params.trainerName]   키오스크 — 말로 지정.
 * @param {string} params.oldDate      옮기려는 기존 예약의 날짜 'YYYY-MM-DD'
 * @param {string} params.oldStartTime 옮기려는 기존 예약의 시작 시각 'HH:MM'
 * @param {string} params.newDate      옮길 새 날짜
 * @param {string} params.newStartTime 옮길 새 시작 시각
 * @param {string} [params.newEndTime] 생략 시 새 시작시간 +1시간
 * @returns {{ ready: boolean, warnings: string[], schedule: object|null, newDraft: object|null }}
 */
export function proposeRescheduleReservation({
  memberQuery, trainerId, trainerName, oldDate, oldStartTime, newDate, newStartTime, newEndTime,
} = {}) {
  const warnings = [];
  if (!oldDate || !oldStartTime) {
    warnings.push('옮기려는 기존 예약의 날짜와 시간은 필수입니다.');
    return { ready: false, warnings, schedule: null, newDraft: null };
  }
  if (!newDate || !newStartTime) {
    warnings.push('옮길 새 날짜와 시간은 필수입니다.');
    return { ready: false, warnings, schedule: null, newDraft: null };
  }

  const members = store.getMembers();
  const trainers = store.getTrainers();
  const member = memberQuery ? findMemberByName(members, memberQuery) : null;
  if (memberQuery && !member) {
    warnings.push(`"${memberQuery}"와(과) 일치하는 회원을 찾지 못했습니다.`);
  }
  let trainer = trainerId ? trainers.find((t) => t.id === trainerId) || null : null;
  if (!trainer && trainerName) {
    trainer = findTrainerByName(trainers, trainerName);
  }
  const resolvedTrainerId = trainer?.id || trainerId || null;
  if (!trainerId && trainerName && !trainer) {
    warnings.push(`"${trainerName}"와(과) 일치하는 트레이너를 찾지 못했습니다.`);
  }

  // [1단계] proposeCancelReservation과 동일한 방식으로 "옮길 대상"을 특정한다.
  const activeSchedules = store.getSchedules().filter((s) => s.status !== 'canceled');
  const candidates = activeSchedules.filter((s) => {
    if (s.date !== oldDate || s.startTime !== oldStartTime) return false;
    if (member && s.memberId !== member.id) return false;
    if (resolvedTrainerId && s.trainerId !== resolvedTrainerId) return false;
    return true;
  });

  if (candidates.length === 0) {
    warnings.push(`${oldDate} ${oldStartTime}에 해당하는 예약을 찾지 못했습니다.`);
    return { ready: false, warnings, schedule: null, newDraft: null };
  }
  if (candidates.length > 1) {
    warnings.push('같은 시간에 일치하는 예약이 여러 건이라 하나로 특정할 수 없습니다. 회원이나 트레이너를 더 정확히 말씀해주세요.');
    return { ready: false, warnings, schedule: null, newDraft: null };
  }

  const schedule = candidates[0];
  const resolvedNewEndTime = newEndTime || addOneHour(newStartTime);

  // [2단계] proposeReservation과 동일한 충돌 검사 기준(정확한 날짜+시작시간
  // 일치) — 다만 옮기는 그 예약 자신은 비교 대상에서 제외한다(제자리로
  // "이동"해도 스스로와 충돌 처리되지 않도록).
  const sameSlot = (s) => s.id !== schedule.id && s.date === newDate && s.startTime === newStartTime;
  const trainerConflict = schedule.trainerId
    ? activeSchedules.find((s) => s.trainerId === schedule.trainerId && sameSlot(s))
    : null;
  if (trainerConflict) {
    warnings.push(
      `${schedule.trainerName || '해당 트레이너'}님은 ${newDate} ${newStartTime}에 이미 다른 예약(${trainerConflict.memberName || '외부/상담'})이 있습니다.`
    );
  }
  const memberConflict = schedule.memberId
    ? activeSchedules.find((s) => s.memberId === schedule.memberId && sameSlot(s))
    : null;
  if (memberConflict && (!trainerConflict || memberConflict.id !== trainerConflict.id)) {
    warnings.push(`${schedule.memberName}님은 ${newDate} ${newStartTime}에 이미 다른 예약이 있습니다.`);
  }

  return {
    ready: warnings.length === 0,
    warnings,
    schedule,
    newDraft: { date: newDate, startTime: newStartTime, endTime: resolvedNewEndTime },
  };
}

/**
 * proposeRescheduleReservation()이 만든 newDraft로 실제 시간을 변경한다.
 * 트레이너의 명시적 확인 뒤에만 호출해야 한다. Schedule.jsx가 이미 쓰는
 * store.updateSchedule()에 그대로 위임 — 재구현하지 않는다.
 */
export async function rescheduleReservation(scheduleId, { date, startTime, endTime } = {}) {
  if (!scheduleId || !date || !startTime) {
    throw new Error('scheduleId/date/startTime 없이는 시간을 옮길 수 없습니다.');
  }
  return store.updateSchedule(scheduleId, { date, startTime, endTime });
}

/**
 * proposeRescheduleReservation()의 결과를 트레이너에게 음성으로 확인받을
 * 문장으로 만든다. buildReservationSummary()/buildCancelSummary()와 같은 이유로
 * 순수 함수로 분리한다.
 */
export function buildRescheduleSummary({ schedule, newDraft, warnings } = {}) {
  if (!schedule || !newDraft) return '옮길 예약 정보를 찾지 못했어요.';
  const who = schedule.memberName ? `${schedule.memberName}님` : '회원 미지정';
  const from = `${schedule.date} ${schedule.startTime}`;
  const to = `${newDraft.date} ${newDraft.startTime}`;
  const base = `${who} 예약을 ${from}에서 ${to}로 옮길까요?`;
  if (warnings && warnings.length > 0) {
    return `${base} 다만 ${warnings.join(' ')}`;
  }
  return base;
}
