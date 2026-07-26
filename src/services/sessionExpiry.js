// sessionExpiry.js — 세션 등록분(lot) 유효기간 관리 (이용약관 3항)
// ════════════════════════════════════════════════════════════════════════
//  배경: 약관 3항은 "10회 등록 시 최대 3개월, 20회 등록 시 최대 6개월 이내 소진
//  (경과 시 자동 소멸)"이라고 명시하지만, 실제 만료 판정 코드(구 dates.js의
//  isMemberExpired)는 회원 단위로 "마지막 결제일로부터 365일 고정"만 봤다 —
//  등록 회차(10회/20회)도, 세션 시작일(sessionStartDate)도 전혀 반영하지 않았다.
//
//  수정: finance.js의 buildTrainerLots(결제별 등록분 분해 — 정산 화면에서 이미 씀)를
//  그대로 재사용해, 등록분(lot) 각각에 "세션 시작일 + 회차 비례 유효기간"을 적용한다.
//  소진(remaining)도 등록 순서대로(FIFO) 배분해, 어느 lot에 잔여가 남아있는지 정확히
//  가려낸다 — finance.js의 회차 매핑(consumedIndex)과 동일한 "소진은 항상 시간순"
//  전제를 공유한다.
//
//  회원상세(MemberDetail)·회원목록(Members)·홈(Home)·매출관리(Revenue) 네 화면 모두
//  이 모듈의 함수를 그대로 써야 한다(공식 불일치 방지 — finance.js와 동일 원칙).
//
//  연장(수동 등록): 약관 3항의 유효기간(10회 3개월/20회 6개월)이 지났거나 임박한
//  등록분(lot)에 한해, 관리자가 건별로 "연장 등록"을 남기면 그 일수만큼 expiresAt이
//  뒤로 밀린다. 자동 연장은 없다 — 등록하지 않으면 원래 유효기간(약관 그대로)이 그대로
//  적용된다. 기본 제안값은 그 lot의 기본 유효기간과 동일(10회 lot→+3개월, 20회 lot→
//  +6개월)이지만 관리자가 등록 시점에 일수를 바꿀 수 있다. 기록 위치는 만료 정산
//  (expirySettlements/legacyExpirySettlements)과 동일한 원칙: legacy lot은
//  member.legacyExpiryExtensions[trainerId], 그 외는 payment.expiryExtensions[lotId].
//  lot당 1건만 허용(demoData.js의 store.registerExpiryExtension/cancelExpiryExtension 참고).
// ════════════════════════════════════════════════════════════════════════
import { buildTrainerLots } from './finance';
import { addDaysYMD, todayYMD, isMonthlyActive, monthlyDueOf } from '../utils/dates';

export const EXPIRY_STATUS_LABEL = {
  ok: '정상',
  warning: '만료 임박',
  expired: '만료됨',
  settled: '만료 정산완료',
};

// 등록 회차 → 유효기간(일수). settings.expiryDaysPer10Sessions(기본 90일=3개월)에
// 선형 비례한다 — 10회=90일(3개월), 20회=180일(6개월)로 약관과 정확히 일치.
// 그 외 회차(5·15·30회 등)는 "10회당 며칠" 비율로 추정한다.
export function expiryDaysForCount(count, settings) {
  const per10 = Number(settings?.expiryDaysPer10Sessions) || 90;
  const n = Number(count) || 0;
  return Math.max(0, Math.round((n / 10) * per10));
}

// 연장 등록 화면의 기본 제안 일수 — "10회 3개월+연장 3개월, 20회 6개월+연장 6개월"
// 정책과 일치하도록, 그 lot의 기본 유효기간과 동일한 일수를 제안한다(관리자가 등록
// 시점에 자유롭게 바꿀 수 있음 — 어디까지나 기본값).
export function suggestedExtensionDays(lot, settings) {
  return expiryDaysForCount(Number(lot?.count) || 0, settings);
}

// lot의 소진 시작일 — buildTrainerLots가 이미 "세션 시작일(sessionStartDate) 우선,
// 없으면 결제일(paidAt)"로 계산해둔 orderDate를 그대로 쓴다. legacy lot은 orderDate가
// 없으므로 paidAt으로, 그마저 없으면(결제 기록 자체가 없는 초기등록) fallback(회원
// 가입일)으로 보정한다 — 신규 등록 화면(MemberRegister)은 세션만 만들고 결제를 남기지
// 않는 경우가 있어(수납은 회원상세에서 별도 등록) 이 보정이 필요하다.
function lotStartDate(lot, fallback) {
  return (lot.orderDate || lot.paidAt || fallback || '');
}

function daysBetween(fromYMD, toYMDStr) {
  if (!fromYMD || !toYMDStr) return null;
  const a = new Date(`${fromYMD}T00:00:00`);
  const b = new Date(`${toYMDStr}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

// 회원의 트레이너별 세션 등록분(lot)에 잔여·만료 정보를 얹어 반환한다.
// 반환: { [trainerId]: [{ ...buildTrainerLots의 lot 필드, trainerId, remaining,
//                          startDate, baseDays, extension, extensionDays,
//                          expiresAt, daysLeft, status, settledInfo }] }
//  · status: 'ok'(잔여 없음 or 유효기간 내) | 'warning'(N일 이내 만료 예정, 잔여 있음)
//            | 'expired'(만료일 경과, 잔여 있음, 미정산) | 'settled'(만료 정산 처리 완료)
//  · baseDays: 약관상 기본 유효기간(일수, 연장 제외). extension: 연장 등록 기록(없으면 null).
//    extensionDays: 연장으로 더해진 일수(0이면 연장 없음). expiresAt = startDate + baseDays + extensionDays.
export function buildMemberSessionExpiry({ member, payments = [], settings, today }) {
  const now = today || todayYMD();
  const ts = member?.trainerSessions || {};
  const warnDays = Number(settings?.expiryWarnDays) || 30;
  const result = {};
  Object.keys(ts).forEach(tid => {
    const slot = ts[tid];
    if (!slot || slot.monthly) return; // 월정액 슬롯은 세션 유효기간 대상 아님(횟수 개념 없음)
    const total = Number(slot.total) || 0;
    if (total <= 0) return;
    const rawLots = buildTrainerLots({ payments, trainerId: tid, settings, trainerRegTotal: total });
    const paymentById = Object.fromEntries((payments || []).filter(p => p.id).map(p => [p.id, p]));
    // FIFO 소진 배분: 이미 소진된 수(total-remaining)를 등록 순서대로 앞 lot부터 채운다.
    // (buildTrainerLots가 이미 legacy → 시간순 explicit 순으로 정렬해 반환한다.)
    let consumedBudget = Math.max(0, total - (Number(slot.remaining) || 0));
    result[tid] = rawLots.map(lot => {
      const count = Number(lot.count) || 0;
      const consumedHere = Math.min(count, consumedBudget);
      consumedBudget -= consumedHere;
      const remaining = count - consumedHere;
      const startDate = lotStartDate(lot, member?.joinDate);
      const payment = lot.legacy ? null : paymentById[lot.paymentId];
      // 연장(수동 등록) — 기록이 있으면 그 일수만큼 기본 유효기간에 더한다. 자동 연장 없음.
      const extension = lot.legacy
        ? (member?.legacyExpiryExtensions?.[tid] || null)
        : (payment?.expiryExtensions?.[lot.id] || null);
      const baseDays = expiryDaysForCount(count, settings);
      const extensionDays = extension ? (Number(extension.days) || 0) : 0;
      const expiresAt = startDate ? addDaysYMD(baseDays + extensionDays, startDate) : '';
      const daysLeft = expiresAt ? daysBetween(now, expiresAt) : null;
      const settledInfo = lot.legacy
        ? (member?.legacyExpirySettlements?.[tid] || null)
        : (payment?.expirySettlements?.[lot.id] || null);
      let status = 'ok';
      if (remaining > 0 && expiresAt) {
        if (settledInfo) status = 'settled';
        else if (expiresAt < now) status = 'expired';
        else if (daysLeft != null && daysLeft <= warnDays) status = 'warning';
      }
      return { ...lot, trainerId: tid, remaining, startDate, baseDays, extension, extensionDays, expiresAt, daysLeft, status, settledInfo };
    });
  });
  return result;
}

// 여러 트레이너·lot 중 표시용으로 가장 급한 것 하나를 대표로 뽑는다.
// (홈 대시보드 카운트, 회원목록 배지에 사용)
export function summarizeMemberSessionExpiry(lotsByTrainer) {
  const all = Object.values(lotsByTrainer || {}).flat();
  const actionable = all.filter(l => l.remaining > 0 && (l.status === 'expired' || l.status === 'warning'));
  if (!actionable.length) return { hasExpired: false, hasWarning: false, nearest: null, actionable: [] };
  actionable.sort((a, b) => (a.expiresAt || '').localeCompare(b.expiresAt || ''));
  return {
    hasExpired: actionable.some(l => l.status === 'expired'),
    hasWarning: actionable.some(l => l.status === 'warning'),
    nearest: actionable[0],
    actionable,
  };
}

// dates.js의 옛 isMemberExpired(회원 단일 인자, 세션제는 365일 고정)를 대체하는 새 버전.
//  · 월정액 판정은 기존 규칙 그대로(다음 결제예정일이 warnDays일 이내거나 지났으면 만료).
//  · 세션제는 등록분(lot)별 유효기간으로 정확히 판정한다("만료 임박"이 아니라 실제로
//    유효기간이 지났고 잔여가 남아있는 경우만 true — 회원목록의 '결제만료' 배지와 동일 의미).
export function isMemberExpired(member, payments, settings, warnDays = 7) {
  if (!member) return false;
  if (isMonthlyActive(member)) {
    const due = monthlyDueOf(member);
    if (due && due <= addDaysYMD(warnDays)) return true;
  }
  const lots = buildMemberSessionExpiry({ member, payments, settings });
  return summarizeMemberSessionExpiry(lots).hasExpired;
}

// ── 만료 정산 (미소진 잔여를 기존 %로 한번에 지급) ────────────────────────
// 정산비율 우선순위: 그 lot에 박제된 비율(splitRateAtPay, hasFrozen) → 트레이너 수동
// 지정 비율(settings.trainerSplitRates) → 정산비율 하한(settings.lowSplitRate).
//  · 일반 월 정산의 자동판정(블로그·매출 조건)까지는 재현하지 않는다 — 1회성 정산이라
//    "그 등록 시점에 확정된 비율"을 우선하는 편이 더 안전하고 결과가 명확하다.
export function expirySettlementRate(lot, settings) {
  if (lot.hasFrozen && lot.rate != null) return Number(lot.rate);
  const manual = settings?.trainerSplitRates?.[lot.trainerId];
  if (manual !== undefined && manual !== null && manual !== '') return Number(manual);
  return Number(settings?.lowSplitRate ?? 40);
}

// 반환: { sessions, unit, rate, amount } — amount = unit × sessions × (rate/100), 반올림.
export function computeExpirySettlement(lot, settings) {
  const sessions = Math.max(0, Math.round(Number(lot.remaining) || 0));
  const unit = Number(lot.unit) || 0;
  const rate = expirySettlementRate(lot, settings);
  const amount = Math.round(unit * sessions * (rate / 100));
  return { sessions, unit, rate, amount };
}
