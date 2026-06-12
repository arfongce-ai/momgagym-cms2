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
