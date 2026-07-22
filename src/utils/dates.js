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

// 회원 결제 만료 판정 — 월정액 여부/다음 결제예정일 helper.
//  · 세션제 + 월정액을 종합한 실제 만료 판정(isMemberExpired)은 등록분(lot)별 유효기간이
//    필요해 services/sessionExpiry.js로 옮겼다(finance.js의 buildTrainerLots를 재사용해야
//    해서, dates.js에 그대로 두면 순환 참조가 생긴다 — dates.js는 저수준 날짜 유틸로 유지).
export function isMonthlyActive(m) {
  if (!m) return false;
  if (m.monthly && m.monthly.active) return true;
  return m.membershipType === 'monthly'; // 구버전 호환
}
export function monthlyDueOf(m) {
  return (m?.monthly && m.monthly.dueDate) || m?.monthlyDueDate || null;
}
