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
