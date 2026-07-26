// dates.js — 로컬(한국) 시간 기준 날짜 유틸
// ⚠️ 교차검증 CV-A: 기존 코드의 new Date().toISOString().slice(0,10)은 UTC 기준이라
//    한국 시간 00:00~08:59 사이에는 "어제" 날짜를 반환하는 치명적 버그가 있었다.
//    (예: 6월 12일 새벽 7시에 출석 처리 → 6월 11일로 기록됨)
//    오늘 날짜·기본 날짜·월 키 등은 반드시 이 유틸을 사용한다.

// Date 또는 날짜 문자열 → 'YYYY-MM-DD' (로컬 시간 기준)
export function toYMD(d) {
  // 이미 'YYYY-MM-DD...' 형태의 문자열이면 그대로 잘라서 반환
  // (문자열을 Date로 파싱하면 UTC 자정으로 해석돼 시간대에 따라 하루가 밀릴 수 있음)
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const dt = d instanceof Date ? d : new Date(d);
  const y  = dt.getFullYear();
  const m  = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// 오늘 날짜 'YYYY-MM-DD' (로컬)
export const todayYMD = () => toYMD(new Date());

// 이번 달 'YYYY-MM' (로컬)
export const thisYM = () => todayYMD().slice(0, 7);

// 올해 'YYYY' (로컬)
export const thisYear = () => todayYMD().slice(0, 4);

// n일 전 날짜 'YYYY-MM-DD' (로컬)
export function daysAgoYMD(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toYMD(d);
}

// 기준일(ymd)에서 n일 뒤 'YYYY-MM-DD' (로컬). base 미지정 시 오늘 기준.
export function addDaysYMD(n, base) {
  const d = base ? new Date(`${toYMD(base)}T00:00:00`) : new Date();
  d.setDate(d.getDate() + n);
  return toYMD(d);
}

// 기준일(ymd)에서 n개월 뒤 'YYYY-MM-DD' (로컬). 말일 보정 포함.
//  · 예: 1/31 + 1개월 → 2/28(또는 2/29). 원래 일자가 다음 달에 없으면 그 달 말일로.
export function addMonthsYMD(n, base) {
  const src = base ? toYMD(base) : todayYMD();
  const [y, m, day] = src.split('-').map(Number);
  const target = new Date(y, (m - 1) + n, 1); // 해당 월 1일
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return toYMD(target);
}

// 회원 결제 만료 판정 (세션제 + 월정액 병행 지원)
//  · 월정액(monthly.active 또는 구버전 membershipType==='monthly'): 다음 결제예정일이
//    임박(기본 7일 이내)했거나 이미 지났으면 만료로 본다.
//  · 세션제: 마지막 결제일이 1년 이전이면 만료(기존 규칙 유지).
//  · 한 회원이 둘 다 가지면, 둘 중 하나라도 만료면 만료로 표시한다.
export function isMonthlyActive(m) {
  if (!m) return false;
  if (m.monthly && m.monthly.active) return true;
  return m.membershipType === 'monthly'; // 구버전 호환
}
export function monthlyDueOf(m) {
  return (m?.monthly && m.monthly.dueDate) || m?.monthlyDueDate || null;
}
export function isMemberExpired(m, warnDays = 7) {
  if (!m) return false;
  // 월정액 만료
  if (isMonthlyActive(m)) {
    const due = monthlyDueOf(m);
    if (due && due <= addDaysYMD(warnDays)) return true;
  }
  // 세션제 만료 (월정액만 있는 회원이면 세션 판정은 건너뜀)
  const hasSession = Object.keys(m.trainerSessions || {})
    .some(tid => !(m.trainerSessions[tid] && m.trainerSessions[tid].monthly));
  if (hasSession && m.membershipType !== 'monthly') {
    if (m.lastPaymentDate && m.lastPaymentDate < daysAgoYMD(365)) return true;
  }
  return false;
}
