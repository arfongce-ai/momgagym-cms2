// services/scheduleAudit.js
// ════════════════════════════════════════════════════════════════════════
//  스케줄 중복/이상 점검 (동시 예약 경쟁으로 생긴 유령 항목 탐지)
//
//  배경: 두 예약이 거의 동시에 들어오면 캐시의 같은 잔여값을 읽어 둘 다 같은
//  회차로 찍히고 차감은 한 번만 반영되는 경쟁이 있었다. (근본 원인은 차감
//  직렬화로 이미 차단했지만, 그 전에 만들어진 유령 항목을 운영자가 찾아
//  정리할 수 있게 점검 도구를 제공한다.)
//
//  ★ 재등록 대응(중요):
//   회차 번호로 흔히 쓰는 sessionAtBooking(예약 시점 잔여)은 재등록 때 리셋된다.
//   예) 10회 등록 → 다 소진 → 10회 재등록하면 total=20, remaining=10 이 되어
//       6회차(잔여 6)가 첫 등록분과 재등록분에서 각각 생겨 번호가 겹친다.
//   따라서 sessionAtBooking 으로 중복을 판정하면 '재등록으로 번호만 같은' 서로
//   다른 수업을 중복으로 오판한다.
//   → 재등록에도 단조 증가하는 consumedIndexAtBooking(0-기반 누적 소진 인덱스)로
//     판정한다. 이 값이 같으면 '동일한 그 회차 한 칸'을 두 번 점유한 것이므로
//     진짜 중복이다. (finance.js 회차 매핑과 동일 기준)
//
//  탐지 규칙(회원 세션 수업만 대상; 외부/상담 제외):
//   1) same_lot   — 같은 회원·트레이너·누적소진인덱스(consumedIndexAtBooking)로
//                   '차감됨' 표시된 예약이 2건 이상. → 회차 중복(유령 항목 의심).
//                   consumedIndexAtBooking 이 없는 구버전 예약은 이 규칙에서 제외
//                   (잘못 겹칠 수 있어 추측하지 않음 — 측정 정직성).
//   2) same_slot  — 같은 회원·트레이너·날짜·시작시간에 예약이 2건 이상.
//                   → 같은 트레이너와 같은 시간 이중 예약(중복 등록 의심).
//                   서로 다른 트레이너의 같은 시간 수업은 정상으로 허용(오탐 방지).
//
//  판단 재료만 제공하고, 삭제·수정 같은 되돌릴 수 없는 처리는 하지 않는다
//  (운영자가 화면에서 직접 확인 후 처리). 데이터 정직성 원칙.
// ════════════════════════════════════════════════════════════════════════

// 회원 세션 차감 대상 예약만 추림(외부/상담/회원없음 제외).
function isMemberSession(s) {
  return !!s && !s.isExternal && !s.isConsult && !!s.memberId;
}

// 그룹 키 헬퍼
//  · 회차 중복 판정은 재등록에 안전한 consumedIndexAtBooking 을 쓴다.
//  · 같은 시간 이중예약 판정에는 trainerId 를 포함한다 — 한 회원이 같은 시간에
//    서로 다른 트레이너 수업을 받는 건 정상이므로(트레이너 다르면 OK), 같은
//    트레이너·같은 시간에 2건 잡힌 경우만 이중예약으로 본다.
const lotKey = (s) => `${s.memberId}__${s.trainerId}__ci${s.consumedIndexAtBooking}`;
const slotKey = (s) => `${s.memberId}__${s.trainerId}__${s.date}__${s.startTime}`;

// 중복 그룹을 찾는다. 반환: [{ type, memberId, memberName, label, items: [...schedules] }]
export function findDuplicateSchedules(schedules = []) {
  const sessions = schedules.filter(isMemberSession);

  const groups = [];

  // 1) 같은 누적 소진 인덱스(consumedIndexAtBooking) + 차감됨 이 2건 이상.
  //    재등록으로 번호만 겹치는 경우와 진짜 중복을 이 인덱스로 구분한다.
  const byLot = new Map();
  for (const s of sessions) {
    // 구버전(consumedIndexAtBooking 없음)은 재등록 겹침을 구분할 수 없어 제외.
    if (s.consumedIndexAtBooking == null || !s.sessionDeducted) continue;
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
      const lotLabel = n != null ? `${n}${tag} 회차` : `${first.consumedIndexAtBooking + 1}번째 소진`;
      groups.push({
        type: 'same_lot',
        memberId: first.memberId,
        memberName: first.memberName || '',
        label: `${first.memberName || '회원'} · ${lotLabel}가 ${items.length}건 중복`,
        reason: '같은 회차(누적 소진 기준)가 여러 번 차감된 것으로 표시됩니다. 동시 예약으로 생긴 유령 항목일 수 있습니다. (재등록으로 번호만 같은 경우는 제외됨)',
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
        label: `${first.memberName || '회원'} · ${first.date} ${first.startTime} · ${first.trainerName || '트레이너'} ${items.length}건`,
        reason: '같은 회원이 같은 트레이너·같은 날짜·시간에 여러 번 예약되어 있습니다. 이중 예약일 수 있습니다. (트레이너가 다른 같은 시간 수업은 정상으로 제외됩니다.)',
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
