// src/services/memberWriteService.js
// ════════════════════════════════════════════════════════════════════════
//  [momi 쓰기 권한 확장 2026-08-10] 지금까지 momi가 실제로 데이터를 쓰는 건
//  예약(생성/취소/변경)과 타이머 제어(순수 UI, 저장 데이터 아님)뿐이었다.
//  이번에 사장님이 명시적으로 고른 3가지 — 회원 메모 추가 / 세션 횟수 조정
//  (추가·차감) / 회원 기본정보 수정(전화번호 등) — 를 추가한다.
//
//  reservationService.js와 완전히 같은 2단계 원칙을 그대로 따른다:
//    1) proposeX() — 아무것도 저장하지 않는다. 회원(+필요시 트레이너) 매칭,
//       입력값 검증까지 마치고 "제안(draft)"만 만든다. 순수 조회라 몇 번을
//       불러도 안전하다.
//    2) confirmX() — 트레이너가 음성으로 "네"라고 확인한 뒤에만 호출된다.
//       실제 저장은 이미 있는 store.updateMember()에 위임한다 — 회원 화면
//       (MemberDetail.jsx)이 쓰는 것과 완전히 같은 함수라 별도 로직을 새로
//       만들지 않는다.
//
//  타이머 제어와 다른 점: 타이머는 순수 UI 상태라 확인 없이 바로 실행했지만,
//  이 셋은 전부 Firestore에 실제로 남는 회원 데이터라 예약류와 동일하게
//  반드시 "제안→확인→저장" 3단계를 거친다(트레이너의 명시적 "네" 없이는
//  절대 저장 안 함).
// ════════════════════════════════════════════════════════════════════════

import { store } from '../demoData';

function normalize(str) {
  return (str || '').replace(/\s+/g, '').toLowerCase();
}

/** 회원 목록에서 이름으로 찾는다 — reservationService.js findMemberByName과 동일 로직. */
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

/** 트레이너 목록에서 이름으로 찾는다 — reservationService.js findTrainerByName과 동일 로직. */
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

// ════════════════════════════════════════════════════════════════════════
//  1) 회원 메모 추가 — "덮어쓰기"가 아니라 "이어붙이기". MemberDetail.jsx의
//  메모 탭은 텍스트 전체를 통째로 바꾸는 방식(store.updateMember(id,{memo}))
//  이라, 여기서도 그 함수를 그대로 쓰되 기존 메모 뒤에 새 줄로 덧붙인
//  전체 텍스트를 만들어서 넘긴다 — 기존 메모를 실수로 지우는 일이 없도록.
//  [모미] 표시를 붙이는 이유: 트레이너가 손으로 쓴 메모와 음성으로 momi가
//  추가한 메모를 구분할 수 있게(신뢰·감사 목적) — 날짜는 굳이 안 붙인다
//  (기존 메모들도 날짜 표기 관례가 없어서 스타일을 맞춤).
// ════════════════════════════════════════════════════════════════════════

export function proposeAddMemberMemo({ memberQuery, memoText } = {}) {
  const warnings = [];
  const trimmedMemo = (memoText || '').trim();
  if (!trimmedMemo) warnings.push('추가할 메모 내용을 알아듣지 못했어요.');

  const members = store.getMembers();
  const member = memberQuery ? findMemberByName(members, memberQuery) : null;
  if (memberQuery && !member) {
    warnings.push(`"${memberQuery}"와(과) 일치하는 회원을 찾지 못했습니다.`);
  } else if (!memberQuery) {
    warnings.push('메모를 추가할 회원을 지정해주세요.');
  }

  return {
    ready: warnings.length === 0,
    warnings,
    member,
    memoText: trimmedMemo,
  };
}

export async function confirmAddMemberMemo({ member, memoText }) {
  if (!member?.id || !memoText) {
    throw new Error('member/memoText 없이는 메모를 추가할 수 없습니다.');
  }
  // [경합 방지] propose 시점과 confirm 시점 사이(음성으로 "네" 대답을 기다리는
  // 몇 초) 다른 트레이너가 같은 회원 메모를 화면에서 직접 고쳤을 수 있다 —
  // MemberDetail.jsx의 기존 핸들러들과 동일하게 confirm 시점에 store에서
  // 다시 최신값을 읽어온 뒤(fresh) 그 위에 이어붙인다(propose 때의 오래된
  // member 스냅샷을 그대로 믿지 않음).
  const fresh = store.getMembers().find((m) => m.id === member.id) || member;
  const line = `[모미] ${memoText}`;
  const newMemo = fresh.memo ? `${fresh.memo}\n${line}` : line;
  await store.updateMember(member.id, { memo: newMemo });
  return newMemo;
}

export function buildAddMemoSummary({ member, memoText, warnings } = {}) {
  if (!member) return '메모를 추가할 회원을 찾지 못했어요.';
  const base = `${member.name}님 메모에 "${memoText}" 추가할까요?`;
  if (warnings && warnings.length > 0) return `${base} 다만 ${warnings.join(' ')}`;
  return base;
}

// ════════════════════════════════════════════════════════════════════════
//  2) 세션 횟수 조정(추가/차감) — trainerId/trainerName 우선순위 규칙은
//  reservationService.js와 동일(폰=로그인 본인/키오스크=말로 지정). 다만
//  하나 추가: 트레이너를 못 정했는데 이 회원이 세션을 가진 트레이너가
//  정확히 1명뿐이면(후보가 하나뿐이라 애매하지 않음) 자동으로 그 트레이너로
//  본다 — 회원 대부분이 담당 트레이너 1명이라 매번 이름까지 말하게 하는 건
//  불필요한 마찰이기 때문.
//
//  [하드 제약 — 기존 수동 조정 UI와 동일] MemberDetail.jsx의 "세션 직접
//  조정"(saveAdjust)이 이미 "잔여·총 횟수는 0 미만 불가"를 하드 규칙으로
//  막고 있다(경고만 하고 넘어가는 예약의 "세션 부족" 안내와는 성격이 다름
//  — 이건 데이터 정합성 문제라 더 엄격). 음성 경로도 똑같이 막는다: 차감
//  후 음수가 되면 애초에 확인조차 받지 않고(ready:false) 바로 안내한다.
// ════════════════════════════════════════════════════════════════════════

export function proposeAdjustSessionCount({ memberQuery, trainerId, trainerName, delta } = {}) {
  const warnings = [];
  const n = Math.trunc(Number(delta));

  const members = store.getMembers();
  const trainers = store.getTrainers();
  const member = memberQuery ? findMemberByName(members, memberQuery) : null;
  if (memberQuery && !member) {
    warnings.push(`"${memberQuery}"와(과) 일치하는 회원을 찾지 못했습니다.`);
  } else if (!memberQuery) {
    warnings.push('세션을 조정할 회원을 지정해주세요.');
  }

  if (!n) warnings.push('조정할 횟수를 알아듣지 못했어요.');

  let trainer = trainerId ? trainers.find((t) => t.id === trainerId) || null : null;
  if (!trainer && trainerName) trainer = findTrainerByName(trainers, trainerName);
  let resolvedTrainerId = trainer?.id || trainerId || null;
  let ambiguousTrainer = false;
  if (!resolvedTrainerId && member) {
    const tids = Object.keys(member.trainerSessions || {});
    if (tids.length === 1) {
      resolvedTrainerId = tids[0];
      trainer = trainers.find((t) => t.id === resolvedTrainerId) || null;
    } else if (tids.length > 1) {
      ambiguousTrainer = true;
    }
  }

  if (trainerId && !trainer) {
    warnings.push('지정한 트레이너 정보를 찾을 수 없습니다.');
  } else if (!trainerId && trainerName && !trainer) {
    warnings.push(`"${trainerName}"와(과) 일치하는 트레이너를 찾지 못했습니다.`);
  } else if (!resolvedTrainerId) {
    warnings.push(
      ambiguousTrainer
        ? '이 회원을 담당하는 트레이너가 여러 명이라 한 명으로 특정할 수 없습니다. 트레이너를 말씀해주세요.'
        : '담당 트레이너를 지정해주세요.'
    );
  }

  if (warnings.length > 0) {
    return { ready: false, warnings, member, trainer, trainerId: resolvedTrainerId, delta: n || 0 };
  }

  const pkg = member.trainerSessions?.[resolvedTrainerId];
  const currentRemaining = pkg?.remaining ?? 0;
  const currentTotal = pkg?.total ?? 0;
  const afterRemaining = currentRemaining + n;
  const afterTotal = currentTotal + n;

  if (afterRemaining < 0 || afterTotal < 0) {
    warnings.push(
      `차감하면 ${trainer?.name || ''} 세션이 음수가 되어 진행할 수 없어요(현재 잔여 ${currentRemaining}회 / 총 ${currentTotal}회, 최대 ${Math.min(currentRemaining, currentTotal)}회까지만 차감 가능).`
    );
    return {
      ready: false, warnings, member, trainer, trainerId: resolvedTrainerId, delta: n,
      currentRemaining, currentTotal,
    };
  }

  return {
    ready: true,
    warnings: [],
    member,
    trainer,
    trainerId: resolvedTrainerId,
    delta: n,
    currentRemaining,
    currentTotal,
    afterRemaining,
    afterTotal,
  };
}

export async function confirmAdjustSessionCount({ member, trainerId, delta }) {
  if (!member?.id || !trainerId || !delta) {
    throw new Error('member/trainerId/delta 없이는 세션을 조정할 수 없습니다.');
  }
  // [경합 방지] confirmAddMemberMemo와 동일한 이유 — 확인 대기 중 다른 화면
  // (예: 트레이너 정산, 세션 직접 조정 UI)에서 같은 값이 바뀌었을 수 있으니
  // confirm 시점에 다시 읽어온 fresh 값 위에 delta를 적용한다.
  const fresh = store.getMembers().find((m) => m.id === member.id) || member;
  const ts = JSON.parse(JSON.stringify(fresh.trainerSessions || {}));
  const pkg = ts[trainerId] || { total: 0, remaining: 0 };
  // [방어적 하한] propose에서 이미 음수 케이스를 막았지만, confirm 시점에
  // fresh 값이 propose 때와 달라졌을 수 있어(경합) 한 번 더 0 미만을 막는다
  // — MemberDetail.jsx saveAdjust와 동일한 하드 제약을 여기서도 유지.
  ts[trainerId] = {
    ...pkg,
    total: Math.max(0, (pkg.total || 0) + delta),
    remaining: Math.max(0, (pkg.remaining || 0) + delta),
  };
  await store.updateMember(member.id, { trainerSessions: ts });
  return ts[trainerId];
}

export function buildAdjustSessionSummary({ member, trainer, delta, currentRemaining, afterRemaining, warnings } = {}) {
  if (!member) return '세션을 조정할 회원을 찾지 못했어요.';
  const action = delta > 0 ? '추가' : '차감';
  const count = Math.abs(delta || 0);
  const withTrainer = trainer?.name ? `${trainer.name} 트레이너 ` : '';
  const change =
    currentRemaining != null && afterRemaining != null
      ? `(잔여 ${currentRemaining}회 → ${afterRemaining}회)`
      : '';
  const base = `${member.name}님 ${withTrainer}세션 ${count}회 ${action}할까요? ${change}`.trim();
  if (warnings && warnings.length > 0) return `${base} 다만 ${warnings.join(' ')}`;
  return base;
}

// ════════════════════════════════════════════════════════════════════════
//  3) 회원 기본정보 수정 — 처음엔 전화번호(phone/phone2)만 연다. 이름·생년
//  월일·주소·성별·수업종류는 일부러 뺐다: 이름은 회원 매칭(fuzzyFind) 자체가
//  이름 기준이라 잘못 바뀌면 연쇄적으로 문제가 커지고, 나머지는 음성 인식
//  오류의 여파가 상대적으로 크거나(주소처럼 긴 문장) 굳이 음성으로 급하게
//  바꿀 이유가 적은 필드라 우선순위가 낮다고 판단했다 — 필요해지면 이
//  MEMBER_INFO_FIELDS만 넓히면 된다(나머지 로직은 필드에 무관하게 동작).
// ════════════════════════════════════════════════════════════════════════

const MEMBER_INFO_FIELDS = {
  phone: { label: '전화번호' },
  phone2: { label: '비상연락처' },
};

export function proposeUpdateMemberInfo({ memberQuery, field, newValue } = {}) {
  const warnings = [];
  const fieldDef = MEMBER_INFO_FIELDS[field];
  if (!field || !fieldDef) warnings.push('어떤 정보를 바꿀지 알아듣지 못했어요.');

  const trimmedValue = (newValue || '').trim();
  if (!trimmedValue) warnings.push('새로 바꿀 값을 알아듣지 못했어요.');

  const members = store.getMembers();
  const member = memberQuery ? findMemberByName(members, memberQuery) : null;
  if (memberQuery && !member) {
    warnings.push(`"${memberQuery}"와(과) 일치하는 회원을 찾지 못했습니다.`);
  } else if (!memberQuery) {
    warnings.push('정보를 수정할 회원을 지정해주세요.');
  }

  // [소프트 경고] 전화번호류는 숫자 8~11자리가 일반적 — 벗어나면 음성인식이
  // 잘못 받아적었을 가능성을 안내만 하고(하드 블록 아님), 최종 판단은
  // "네"로 확인하는 트레이너에게 맡긴다(세션 횟수처럼 되돌리기 어려운 데이터
  // 정합성 문제가 아니라 단순 연락처라 예약류의 소프트 경고 방식과 동일하게 취급).
  if (fieldDef && trimmedValue) {
    const digits = trimmedValue.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 11) {
      warnings.push(`"${trimmedValue}"가 전화번호치고 자릿수가 어색해요. 잘못 알아들었을 수 있어요.`);
    }
  }

  return {
    ready: warnings.length === 0,
    warnings,
    member,
    field: fieldDef ? field : null,
    fieldLabel: fieldDef?.label || null,
    oldValue: member && fieldDef ? member[field] || '' : null,
    newValue: trimmedValue,
  };
}

export async function confirmUpdateMemberInfo({ member, field, newValue }) {
  if (!member?.id || !field || !newValue) {
    throw new Error('member/field/newValue 없이는 정보를 수정할 수 없습니다.');
  }
  await store.updateMember(member.id, { [field]: newValue });
  return newValue;
}

export function buildUpdateInfoSummary({ member, fieldLabel, oldValue, newValue, warnings } = {}) {
  if (!member) return '정보를 수정할 회원을 찾지 못했어요.';
  const from = oldValue ? `${oldValue}에서 ` : '';
  const base = `${member.name}님 ${fieldLabel || '정보'}를 ${from}${newValue}로 바꿀까요?`;
  if (warnings && warnings.length > 0) return `${base} 다만 ${warnings.join(' ')}`;
  return base;
}
