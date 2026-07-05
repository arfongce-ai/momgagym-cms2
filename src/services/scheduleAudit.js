// services/scheduleAudit.js
// ════════════════════════════════════════════════════════════════════════
//  스케줄 중복/이상 점검 (동시 예약 경쟁으로 생긴 유령 항목 탐지)
//
//  배경: 두 예약이 거의 동시에 들어오면 캐시의 같은 잔여값을 읽어 둘 다 같은
//  회차(sessionAtBooking)로 찍히고 차감은 한 번만 반영되는 경쟁이 있었다.
//  (근본 원인은 차감 직렬화로 이미 차단했지만, 그 전에 만들어진 유령 항목을
//   운영자가 찾아 정리할 수 있게 점검 도구를 제공한다.)
//
//  탐지 규칙(회원 세션 수업만 대상; 외부/상담 제외):
//   1) same_lot   — 같은 회원·트레이너·회차(sessionAtBooking)로 '차감됨' 표시된
//                   예약이 2건 이상. → 회차 중복(유령 항목 강력 의심).
//   2) same_slot  — 같은 회원·날짜·시작시간에 예약이 2건 이상(회차 무관).
//                   → 같은 시간 이중 예약(중복 등록 의심).
//
//  판단 재료만 제공하고, 삭제·수정 같은 되돌릴 수 없는 처리는 하지 않는다
//  (운영자가 화면에서 직접 확인 후 처리). 측정·데이터 정직성 원칙.
// ════════════════════════════════════════════════════════════════════════

// 회원 세션 차감 대상 예약만 추림(외부/상담/회원없음 제외).
function isMemberSession(s) {
  return !!s && !s.isExternal && !s.isConsult && !!s.memberId;
}

// 그룹 키 헬퍼
const lotKey = (s) => `${s.memberId}__${s.trainerId}__${s.sessionAtBooking}`;
const slotKey = (s) => `${s.memberId}__${s.date}__${s.startTime}`;

// 중복 그룹을 찾는다. 반환: [{ type, memberId, memberName, label, items: [...schedules] }]
export function findDuplicateSchedules(schedules = []) {
  const sessions = schedules.filter(isMemberSession);

  const groups = [];

  // 1) 같은 회차(sessionAtBooking) + 차감됨 이 2건 이상
  const byLot = new Map();
  for (const s of sessions) {
    if (s.sessionAtBooking == null || !s.sessionDeducted) continue;
    const k = lotKey(s);
    if (!byLot.has(k)) byLot.set(k, []);
    byLot.get(k).push(s);
  }
  for (const [, items] of byLot) {
    if (items.length >= 2) {
      const first = items[0];
      const total = first.sessionTotalAtBooking;
      const n = first.sessionAtBooking;
      const tag = (total != null && n === total) ? '(s)' : (n === 1 ? '(e)' : '');
      groups.push({
        type: 'same_lot',
        memberId: first.memberId,
        memberName: first.memberName || '',
        label: `${first.memberName || '회원'} · ${n}${tag} 회차가 ${items.length}건 중복`,
        reason: '같은 회차가 여러 번 차감된 것으로 표시됩니다. 동시 예약으로 생긴 유령 항목일 수 있습니다.',
        items: sortByDate(items),
      });
    }
  }

  // 2) 같은 회원·날짜·시작시간 2건 이상(회차 무관)
  const bySlot = new Map();
  for (const s of sessions) {
    const k = slotKey(s);
    if (!bySlot.has(k)) bySlot.set(k, []);
    bySlot.get(k).push(s);
  }
  for (const [, items] of bySlot) {
    if (items.length >= 2) {
      const first = items[0];
      groups.push({
        type: 'same_slot',
        memberId: first.memberId,
        memberName: first.memberName || '',
        label: `${first.memberName || '회원'} · ${first.date} ${first.startTime} 같은 시간 ${items.length}건`,
        reason: '같은 회원이 같은 날짜·시간에 여러 번 예약되어 있습니다. 이중 예약일 수 있습니다.',
        items: sortByDate(items),
      });
    }
  }

  // same_lot 을 먼저(더 강한 신호), 그 다음 same_slot. 회원명 순 보조 정렬.
  return groups.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'same_lot' ? -1 : 1;
    return (a.memberName || '').localeCompare(b.memberName || '');
  });
}

function sortByDate(items) {
  return [...items].sort((a, b) => {
    const da = `${a.date} ${a.startTime}`;
    const db = `${b.date} ${b.startTime}`;
    return da < db ? -1 : da > db ? 1 : 0;
  });
}

// 요약: 화면 배지에 쓸 총 그룹/항목 수.
export function summarizeDuplicates(groups = []) {
  const totalItems = groups.reduce((n, g) => n + g.items.length, 0);
  return {
    groupCount: groups.length,
    itemCount: totalItems,
    hasIssues: groups.length > 0,
  };
}
