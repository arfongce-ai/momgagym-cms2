// utils/memberList.js
// 회원 목록 공통 헬퍼: 트레이너 모드 필터, 가나다 정렬, 만료 회원 하단 정렬.
import { isMemberExpired } from './dates';

// 트레이너로 로그인한 경우 본인 ID. 관리자/직원은 null(전체 노출).
export const getUserTrainerId = user =>
  (user?.role === 'trainer' ? (user.trainerId || user.id) : null);

// 트레이너 모드면 담당 회원만 남긴다. 관리자/직원은 전체 그대로 반환.
export function scopeMembersToTrainer(members, user) {
  const tid = getUserTrainerId(user);
  if (!tid) return members;
  return members.filter(m => Object.keys(m.trainerSessions || {}).includes(tid));
}

// 한글 가나다 → 영문 → 숫자 순으로 정렬(로케일 기반).
const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
export function sortByName(members) {
  return [...members].sort((a, b) =>
    collator.compare(a.name || '', b.name || ''));
}

// 가나다 정렬 후, 결제 만료 회원을 하단으로 모은다(각 그룹 내부는 가나다 유지).
export function sortExpiredLast(members) {
  const sorted = sortByName(members);
  const active = [], expired = [];
  for (const m of sorted) (isMemberExpired(m) ? expired : active).push(m);
  return [...active, ...expired];
}
