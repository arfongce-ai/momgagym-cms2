// utils/memberList.js
// 회원 목록 공통 헬퍼: 트레이너 모드 필터, 가나다 정렬, 비활성(만료·세션마감) 회원 하단 정렬.
import { isMemberExpired, isMonthlyActive } from './dates';

// 트레이너로 로그인한 경우 본인 ID. 관리자/직원은 null(전체 노출).
export const getUserTrainerId = user =>
  (user?.role === 'trainer' ? (user.trainerId || user.id) : null);

// 트레이너 모드면 담당 회원만 남긴다. 관리자/직원은 전체 그대로 반환.
export function scopeMembersToTrainer(members, user) {
  const tid = getUserTrainerId(user);
  if (!tid) return members;
  return members.filter(m => Object.keys(m.trainerSessions || {}).includes(tid));
}

// 세션 마감(횟수 소진): 세션제 슬롯이 하나 이상 있고, 그 모든 세션제 슬롯의 잔여가 0.
//  · 월정액 슬롯(monthly)은 횟수 개념이 없으므로 판정에서 제외한다.
//  · 월정액 활성 회원은 세션마감으로 보지 않는다.
export function isSessionExhausted(m) {
  if (!m || isMonthlyActive(m)) return false;
  const slots = Object.values(m.trainerSessions || {}).filter(s => s && !s.monthly);
  if (slots.length === 0) return false;
  return slots.every(s => (s.remaining ?? 0) <= 0);
}

// 비활성 회원 = 결제 만료 OR 세션 마감. (명단 하단으로 모으는 기준)
export function isMemberInactive(m) {
  return isMemberExpired(m) || isSessionExhausted(m);
}

// 한글 가나다 → 영문 → 숫자 순으로 정렬(로케일 기반).
const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
export function sortByName(members) {
  return [...members].sort((a, b) =>
    collator.compare(a.name || '', b.name || ''));
}

// 가나다 정렬 후, 비활성(만료·세션마감) 회원을 하단으로 모은다(각 그룹 내부는 가나다 유지).
export function sortExpiredLast(members) {
  const sorted = sortByName(members);
  const active = [], inactive = [];
  for (const m of sorted) (isMemberInactive(m) ? inactive : active).push(m);
  return [...active, ...inactive];
}
