// scripts/dashboard-snapshot/memberStatus.mjs
// CMS 회원 목록과 같은 "활성 회원" 기준 (src/utils/dates.js isMemberExpired +
// src/utils/memberList.js isSessionExhausted/isMemberInactive 의 복사본).
// ⚠️ 순수 Node(GitHub Actions)는 Vite 확장자 없는 import 를 못 읽어 src 를 직접 가져올 수 없다 →
//    로직을 여기에 인라인한다. 원본이 바뀌면 이 파일도 같이 고칠 것(테스트가 같은 입력으로 비교).
// 날짜는 모두 'YYYY-MM-DD'(KST) 문자열로만 다룬다.

export function shiftYMD(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function isMonthlyActive(m) {
  if (!m) return false;
  if (m.monthly && m.monthly.active) return true;
  return m.membershipType === 'monthly';
}

export function isMemberExpired(m, todayYMD, warnDays = 7) {
  if (!m) return false;
  if (isMonthlyActive(m)) {
    const due = (m.monthly && m.monthly.dueDate) || m.monthlyDueDate || null;
    if (due && due <= shiftYMD(todayYMD, warnDays)) return true;
  }
  const ts = m.trainerSessions || {};
  const hasSession = Object.keys(ts).some((tid) => !(ts[tid] && ts[tid].monthly));
  if (hasSession && m.membershipType !== 'monthly') {
    if (m.lastPaymentDate && m.lastPaymentDate < shiftYMD(todayYMD, -365)) return true;
  }
  return false;
}

export function isSessionExhausted(m) {
  if (!m || isMonthlyActive(m)) return false;
  const slots = Object.values(m.trainerSessions || {}).filter((s) => s && !s.monthly);
  if (slots.length === 0) return false;
  return slots.every((s) => (s.remaining ?? 0) <= 0);
}

// 전체/활성/만료/세션마감 집계 + 활성 회원의 트레이너별 인원.
export function summarizeMembers(members, todayYMD) {
  let active = 0, expired = 0, exhausted = 0;
  const activeByTrainer = {};
  members.forEach((m) => {
    const e = isMemberExpired(m, todayYMD);
    const x = isSessionExhausted(m);
    if (e) expired += 1;
    if (x) exhausted += 1;
    if (!e && !x) {
      active += 1;
      Object.keys(m.trainerSessions || {}).forEach((tid) => {
        activeByTrainer[tid] = (activeByTrainer[tid] || 0) + 1;
      });
    }
  });
  return { total: members.length, active, expired, exhausted, activeByTrainer };
}
