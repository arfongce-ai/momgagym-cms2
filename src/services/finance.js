// finance.js — 매출/정산 공통 상수 및 계산 로직
// 결제수단: 페이, 계좌, 현금, 현금영수증, 카드1, 카드2
import { toYMD } from '../utils/dates';

export const METHOD_LBL = {
  pay:'페이', transfer:'계좌', cash:'현금', cash_receipt:'현금영수증',
  card1:'카드1', card2:'카드2',
  // 구버전 호환
  card:'카드',
};
export const METHOD_CLR = {
  pay:'text-purple-400', transfer:'text-amber-400', cash:'text-emerald-400',
  cash_receipt:'text-teal-400', card1:'text-blue-400', card2:'text-sky-400',
  card:'text-blue-400',
};
// 결제수단별 공제 규칙
//  · 카드1·카드2(·구버전 카드): 부가세 + 카드수수료 공제
//  · 페이·현금영수증: 부가세만 공제
//  · 계좌·현금: 공제 없음
export const CARD_METHODS = ['card', 'card1', 'card2'];          // 부가세+카드수수료
export const VAT_ONLY_METHODS = ['pay', 'cash_receipt'];          // 부가세만
export const NO_DEDUCT_METHODS = ['transfer', 'cash'];            // 공제 없음

export const won = (n) => Math.round(n||0).toLocaleString('ko-KR') + '원';
// CV-A: toISOString()은 UTC 기준이라 한국 새벽(00~09시)에 달/연도가 밀리는 버그 → 로컬 기준으로 수정
export const monthKey = (d) => toYMD(d).slice(0,7);
export const yearKey  = (d) => toYMD(d).slice(0,4);

// 입금금액 = 결제금액 − (수단별 공제)
//  · 단일수단: p.method 하나로 공제
//  · 복합수단(p.methods=[{method,amount}]): 수단별 금액에 각각 공제 적용 후 합산
//    (예: 카드 80만 + 페이 20만 → 카드부분은 부가세+카드수수료, 페이부분은 부가세만)
function deductFor(method, amount, settings) {
  const isCard = CARD_METHODS.includes(method);
  const isVatOnly = VAT_ONLY_METHODS.includes(method);
  const cardFee = isCard ? amount * (settings.cardFeeRate/100) : 0;
  const vat     = (isCard || isVatOnly) ? amount * (settings.vatRate/100) : 0;
  return { cardFee, vat };
}
export function calcNet(payment, settings) {
  const methods = Array.isArray(payment.methods) && payment.methods.length ? payment.methods : null;
  if (methods) {
    const amount = methods.reduce((s,x)=>s+(Number(x.amount)||0),0);
    let cardFee=0, vat=0;
    methods.forEach(x=>{
      const d = deductFor(x.method, Number(x.amount)||0, settings);
      cardFee += d.cardFee; vat += d.vat;
    });
    return { amount, cardFee, vat, net: amount - cardFee - vat };
  }
  const amount = payment.amount || 0;
  const d = deductFor(payment.method, amount, settings);
  return { amount, cardFee:d.cardFee, vat:d.vat, net: amount - d.cardFee - d.vat };
}

// ── 트레이너별 정산은 회당단가×횟수 방식 한 가지로 일원화함.
//    (옛 비율기반 정산 함수들은 제거)

// ── 매월(1일~말일) 정산비율 자동 판정 (계약서 4조) ───────────────────
// 해당 월의 "그 트레이너 귀속 입금금액 / 블로그 횟수 / 스터디 횟수"만으로 판정한다.
//  · 수동 지정(trainerSplitRates[tid])이 있으면 기준선으로 삼되, 자동조건이 더 높으면 상향
//  · 자동 규칙:
//      - 조건A: 블로그 ≥ rate50MinBlog AND 스터디 ≥ rate50MinStudy
//      - 조건B: 신규 또는 재등록 매출 ≥ rate60MinSales(기본 300만)
//      - 두 조건 모두 충족 → 60% / 하나만 충족 → 50% / 둘 다 미달 → 하한(40%)
// 반환: { rate, mode:'manual'|'auto', reason, monthNet, blogCount, studyCount }
export function determineSplitRate({ settings, trainerId, monthNet, newSales=0, reEnrollSales=0, blogCount, studyCount }) {
  const floor   = Number(settings.lowSplitRate ?? 40);   // 하한 40%
  const min60   = Number(settings.rate60MinSales ?? 3000000);
  const minBlog = Number(settings.rate50MinBlog ?? 2);
  const minStudy= Number(settings.rate50MinStudy ?? 1);

  // 비율 판정 규칙 (변경):
  //  · 조건A: 블로그 ≥ minBlog AND 스터디 ≥ minStudy
  //  · 조건B: 신규 또는 재등록 매출 ≥ 임계(min60)
  //  → 두 조건 모두 충족: 60% / 하나만 충족: 50% / 둘 다 미달: 하한(40%)
  const condA = (blogCount >= minBlog && studyCount >= minStudy);
  const condB = (newSales >= min60 || reEnrollSales >= min60);
  const metCount = (condA ? 1 : 0) + (condB ? 1 : 0);

  let autoRate, autoReason;
  if (metCount === 2) {
    autoRate = 60;
    autoReason = `블로그·스터디(${blogCount}/${studyCount})와 매출 조건 모두 충족 → 60%`;
  } else if (metCount === 1) {
    autoRate = 50;
    autoReason = condA
      ? `블로그 ${blogCount}회·스터디 ${studyCount}회 충족 → 50%`
      : `매출 ${won(min60)} 이상 충족 → 50%`;
  } else {
    autoRate = floor;
    autoReason = `조건 미달(블로그·스터디 / 매출 모두 미달) → ${floor}%`;
  }

  // 수동 지정이 있으면 그 값을 '기준선(floor)'으로 삼고, 조건이 더 높으면 올린다(낮추지는 않음).
  //  · 일반: 자동판정(autoRate)이 수동값보다 높으면 그 값으로 상향
  //  · 특례: 수동 50% 인 트레이너는 조건A(블로그·스터디)만 충족해도 60%로 상향한다.
  //          (일반 자동규칙은 조건A·B 둘 다여야 60%이지만, 수동 50% 한정 예외)
  //  · 예) 수동 50% + 조건A만 충족 → 60% (특례) / 수동 50% + 조건 미달 → 50% 유지
  const manual = settings.trainerSplitRates?.[trainerId];
  const hasManual = manual !== undefined && manual !== null && manual !== '';
  if (hasManual) {
    const manualRate = Number(manual);
    // 특례: 수동 50% + 조건A 충족 → 60%
    if (manualRate === 50 && condA) {
      return { rate: 60, mode: 'manual', reason: `수동 50% → 블로그·스터디(${blogCount}/${studyCount}) 충족으로 60% 상향(특례)`,
               monthNet, newSales, reEnrollSales, blogCount, studyCount };
    }
    if (autoRate > manualRate) {
      // 조건이 수동값보다 높음 → 상향
      return { rate: autoRate, mode: 'manual', reason: `수동 ${manualRate}% → 조건 충족으로 ${autoRate}% 상향 (${autoReason})`,
               monthNet, newSales, reEnrollSales, blogCount, studyCount };
    }
    return { rate: manualRate, mode: 'manual', reason: `수동 지정 ${manualRate}%`,
             monthNet, newSales, reEnrollSales, blogCount, studyCount };
  }

  return { rate: autoRate, mode: 'auto', reason: autoReason, monthNet, newSales, reEnrollSales, blogCount, studyCount };
}

// ── 특정 월(ym)의 트레이너별 정산비율을 일괄 계산 ──────────────────
// 결제 저장 시 "그 결제월의 비율"을 박제(snapshot)하기 위해 사용한다.
//  · monthNet: 그 달 결제들의 트레이너 귀속 입금액(공제 후), promos: 그 달 블로그/스터디
// 반환: { [trainerId]: { rate, reason } }
export function computeMonthRates({ trainers, members, payments, records, settings, ym }) {
  const inMonth = (d) => d && d.slice(0,7) === ym;
  const monthNet = {};   // tid -> 그 달 귀속 입금액
  const newSales = {};   // tid -> 신규(isNew) 귀속 입금액
  const reSales  = {};   // tid -> 재등록(isReEnroll) 귀속 입금액
  const addTo = (bucket, tid, v) => { bucket[tid] = (bucket[tid]||0) + v; };
  members.forEach(m => {
    const ts = m.trainerSessions || {};
    const tids = Object.keys(ts);
    const totalReg = Object.values(ts).reduce((s,v)=>s+(v.total||0),0);
    (payments[m.id]||[]).filter(p=>!p.isUnpaid && !p.isRefunded && !p.isMonthly && inMonth(p.paidAt)).forEach(p=>{
      const amt = calcNet(p, settings).net;
      // 트레이너별 귀속분을 [tid, part]로 산출
      const parts = [];
      const splitList = Array.isArray(p.split) && p.split.length ? p.split : null;
      const pTids = (p.trainerIds && p.trainerIds.length) ? p.trainerIds : null;
      if (splitList) {
        const gross = splitList.reduce((s,x)=>s+(Number(x.amount)||0),0) || (p.amount||0) || 1;
        splitList.forEach(({trainerId, amount}) => parts.push([trainerId, amt*((Number(amount)||0)/gross)]));
      } else if (pTids) {
        const per = amt/pTids.length; pTids.forEach(tid=>parts.push([tid, per]));
      } else if (totalReg > 0) {
        tids.forEach(tid=>parts.push([tid, amt*((ts[tid].total||0)/totalReg)]));
      } else if (tids.length) {
        const per = amt/tids.length; tids.forEach(tid=>parts.push([tid, per]));
      }
      parts.forEach(([tid, part]) => {
        addTo(monthNet, tid, part);
        if (p.isReEnroll) addTo(reSales, tid, part); // 재등록 → 담당
      });
      // 신규매출 → 상담 트레이너 1명에게 전액 귀속
      if (p.isNew && p.consultTrainerId) addTo(newSales, p.consultTrainerId, amt);
    });
  });
  const out = {};
  trainers.forEach(t => {
    let blog=0, study=0;
    (records||[]).filter(r=>r.trainerId===t.id && inMonth(r.date)).forEach(r=>{
      if (r.channel==='blog') blog++; if (r.channel==='study') study++;
    });
    const d = determineSplitRate({ settings, trainerId:t.id,
      monthNet:Math.round(monthNet[t.id]||0),
      newSales:Math.round(newSales[t.id]||0),
      reEnrollSales:Math.round(reSales[t.id]||0),
      blogCount:blog, studyCount:study });
    out[t.id] = { rate: d.rate, reason: d.reason, mode: d.mode };
  });
  return out;
}

// ── 월말 정산비율 확정(재박제) 계획 생성 ────────────────────────────
// 선택한 달(ym)에 결제가 발생한 모든 회원의 결제 건을, 그 달 "전체 실적"으로
// 다시 판정해 splitRateAtPay를 갱신할 계획(patch 목록)을 만든다.
//  · 그 달(ym)에 paidAt이 속한 결제만 대상 — 다른 달 결제는 건드리지 않는다.
//  · 미수금/환불 결제도 비율 자체는 다시 박제(지급 계산에서 별도 처리되므로 비율은 보존).
//  · 한 회원이 여러 달에 결제했어도 각 결제는 자기 결제월 비율을 유지(이 함수는 ym만 본다).
// 반환: { patches:[{mid,pid,memberName,splitRateAtPay,prev}], rateMap, count }
//   - patches는 비율이 실제로 바뀌는 건만 포함(변동 없으면 제외).
export function buildRefreezePlan({ trainers, members, payments, records, settings, ym }) {
  const inMonth = (d) => d && d.slice(0,7) === ym;
  // 그 달 전체 결제로 트레이너별 비율 판정 (저장 시점과 동일한 함수 재사용)
  const rateMap = computeMonthRates({ trainers, members, payments, records, settings, ym });

  const memberMap = Object.fromEntries(members.map(m=>[m.id, m]));
  const patches = [];
  members.forEach(m => {
    (payments[m.id]||[]).forEach(p => {
      if (!inMonth(p.paidAt)) return;
      // 이 결제에 관여하는 트레이너: trainerIds → 없으면 회원 담당 트레이너 전체
      const involved = (p.trainerIds && p.trainerIds.length)
        ? p.trainerIds
        : Object.keys(m.trainerSessions || {});
      if (!involved.length) return;
      const next = {};
      involved.forEach(tid => {
        // 수동 고정(🔒)된 트레이너 비율은 자동 재판정에서 제외 → 기존 값 유지.
        if (p.rateManualFrozen && p.rateManualFrozen[tid]) {
          if (p.splitRateAtPay && p.splitRateAtPay[tid] != null) next[tid] = Number(p.splitRateAtPay[tid]);
        } else if (rateMap[tid]) {
          next[tid] = rateMap[tid].rate;
        }
      });
      const prev = p.splitRateAtPay || {};
      // 변동 여부 판정 (involved 트레이너 비율이 하나라도 달라지면 갱신)
      const changed = involved.some(tid => Number(prev[tid]) !== Number(next[tid]));
      if (changed) {
        patches.push({
          mid: m.id, pid: p.id, memberName: memberMap[m.id]?.name || '?',
          paidAt: p.paidAt, splitRateAtPay: next, prev,
        });
      }
    });
  });
  return { patches, rateMap, count: patches.length };
}

// ── 전체 기간 일괄 재박제 계획 ──────────────────────────────────────
// 모든 결제를 "각자의 결제월(paidAt YYYY-MM) 조건%"로 한 번에 박제한다.
//  · 결제월별로 그 달 전체 실적으로 비율 판정(computeMonthRates) → 그 달 결제들에 적용.
//  · 비율은 결제월 기준(세션 시작월과 무관). 소진 순서만 세션 시작일을 따른다.
//  · 이미 같은 값이면 제외(불필요한 쓰기 방지).
//  · 미래 자동운영에선 결제 시 자동 박제 + 월말 확정으로 충분하지만,
//    시스템 도입 이전의 과거 결제들을 소급 정리할 때 쓴다.
// 반환: { patches:[{mid,pid,memberName,paidAt,splitRateAtPay,prev}], count, months }
export function buildRefreezeAllPlan({ trainers, members, payments, records, settings }) {
  // 결제월 수집
  const monthsSet = new Set();
  members.forEach(m => (payments[m.id] || []).forEach(p => {
    const ym = (p.paidAt || '').slice(0, 7);
    if (ym) monthsSet.add(ym);
  }));
  const months = [...monthsSet].sort();
  // 달마다 비율맵 산출
  const rateByMonth = {};
  months.forEach(ym => {
    rateByMonth[ym] = computeMonthRates({ trainers, members, payments, records, settings, ym });
  });
  const memberMap = Object.fromEntries(members.map(m => [m.id, m]));
  const patches = [];
  members.forEach(m => {
    (payments[m.id] || []).forEach(p => {
      const ym = (p.paidAt || '').slice(0, 7);
      const rateMap = rateByMonth[ym];
      if (!rateMap) return;
      const involved = (p.trainerIds && p.trainerIds.length)
        ? p.trainerIds
        : Object.keys(m.trainerSessions || {});
      if (!involved.length) return;
      const next = {};
      involved.forEach(tid => {
        if (p.rateManualFrozen && p.rateManualFrozen[tid]) {
          if (p.splitRateAtPay && p.splitRateAtPay[tid] != null) next[tid] = Number(p.splitRateAtPay[tid]);
        } else if (rateMap[tid]) {
          next[tid] = rateMap[tid].rate;
        }
      });
      const prev = p.splitRateAtPay || {};
      const changed = involved.some(tid => Number(prev[tid]) !== Number(next[tid]));
      if (changed) {
        patches.push({
          mid: m.id, pid: p.id, memberName: memberMap[m.id]?.name || '?',
          paidAt: p.paidAt, splitRateAtPay: next, prev,
        });
      }
    });
  });
  return { patches, count: patches.length, months };
}

// ── 회당 단가 × 월 수업횟수 기반 정산 (실제 시트 방식) ──────────────
// 정산비율은 "결제월에 박제된 비율(splitRateAtPay)"을 회원별로 적용한다.
// ── 등록분(lot) 재구성 — 예약·정산이 동일 로직을 공유 ───────────────────
// 한 회원의 특정 트레이너 결제들에서 "재등록 회차별 등록분(lot)"을 만든다.
//  · sessionAdds 가 있는 결제는 회차별 lot 으로 분해(라벨·비율·단가·회차번호 포함).
//  · sessionAdds 가 없는 구버전 결제는 legacy lot 하나로 뭉친다.
//  · 정렬: 소진순서일(sessionStartDate 있으면 그 값, 없으면 결제일 paidAt) 오름차순 → 같은 날 order.
//    "먼저 소진되는 등록분이 앞". 결제는 늦게 했지만 수업은 먼저 시작한 경우(sessionStartDate)를 반영.
//    매출·정산비율은 여전히 결제일(paidAt) 기준 — 이 정렬은 회차 소진 순서에만 쓴다.
// 반환: [{ id, paymentId, paidAt, orderDate, count, rate, reEnrollNo, label, ... }]
export function buildTrainerLots({ payments = [], trainerId, settings, trainerRegTotal }) {
  const tid = trainerId;
  const frozenRate = (p) => {
    const r = p.splitRateAtPay && p.splitRateAtPay[tid];
    return (r === undefined || r === null || r === '') ? null : Number(r);
  };
  // 소진 순서 판정용 날짜: 세션 시작일 우선, 없으면 결제일.
  const orderDateOf = (p) => (p.sessionStartDate && String(p.sessionStartDate)) || p.paidAt || '';
  const explicit = [];
  let legacyPaid = 0, legacyRateW = 0, legacyRateBase = 0, legacyHasFrozen = false, legacyPaidAt = '';
  (payments || []).filter(p => !p.isUnpaid && !p.isMonthly).forEach(p => {
    const net = settings ? calcNet(p, settings).net : (Number(p.amount) || 0);
    // 이 결제에서 이 트레이너 귀속분(간단화: trainerIds 1/n, 없으면 전액)
    const pTids = Array.isArray(p.trainerIds) && p.trainerIds.length ? p.trainerIds : null;
    const part = pTids ? (pTids.includes(tid) ? net / pTids.length : 0) : net;
    if (pTids && !pTids.includes(tid)) return;
    const adds = Array.isArray(p.sessionAdds)
      ? p.sessionAdds.map((sa, idx) => ({ ...sa, idx, count: Number(sa.count) || 0 }))
          .filter(sa => sa.trainerId === tid && sa.count > 0)
      : [];
    if (adds.length) {
      const addTotal = adds.reduce((s, sa) => s + sa.count, 0) || 1;
      adds.forEach(sa => {
        const paid = part * (sa.count / addTotal);
        const r = frozenRate(p);
        explicit.push({
          id: `${p.id || p.paidAt || 'payment'}:${tid}:${sa.idx}`,
          paymentId: p.id || null,
          paidAt: p.paidAt || '',
          orderDate: orderDateOf(p),
          order: sa.idx,
          count: sa.count,
          paid,
          unit: sa.count > 0 ? paid / sa.count : 0,
          rate: r,
          hasFrozen: r != null,
          label: p.isReEnroll ? (p.reEnrollNo ? `재등록 ${p.reEnrollNo}회차` : '재등록')
            : p.isNew ? '신규' : '등록',
          reEnrollNo: p.reEnrollNo || null,
        });
      });
    } else {
      const r = frozenRate(p);
      legacyPaid += part;
      if (r != null) { legacyRateW += r * part; legacyRateBase += part; legacyHasFrozen = true; }
      if (!legacyPaidAt || (p.paidAt && p.paidAt < legacyPaidAt)) legacyPaidAt = p.paidAt || '';
    }
  });
  explicit.sort((a, b) => (a.orderDate || '').localeCompare(b.orderDate || '') || (a.order || 0) - (b.order || 0));
  const explicitCount = explicit.reduce((s, l) => s + (Number(l.count) || 0), 0);
  const lots = [];
  const legacyCount = Math.max(0, (Number(trainerRegTotal) || 0) - explicitCount);
  if (legacyCount > 0 || legacyPaid > 0) {
    lots.push({
      id: `legacy:${tid}`,
      paymentId: null,
      paidAt: legacyPaidAt || '',
      order: -1,
      count: legacyCount,
      paid: legacyPaid,
      unit: legacyCount > 0 ? legacyPaid / legacyCount : 0,
      rate: legacyRateBase > 0 ? Math.round(legacyRateW / legacyRateBase) : null,
      hasFrozen: legacyHasFrozen,
      label: null,
      reEnrollNo: null,
      legacy: true,
    });
  }
  return [...lots, ...explicit].filter(l => (Number(l.count) || 0) > 0 || (Number(l.paid) || 0) > 0);
}

// 누적 소진 인덱스(0-기반) → 어느 lot 소속인지.
//  · consumedIndex 0 = 가장 먼저 소진되는 수업(맨 앞 lot의 첫 회).
//  · lot 들을 앞에서부터 count 만큼 배정. 등록분이 비연속으로 추가돼도(8회차 소진 후 9회차 등록)
//    소진 순서(시간순)만 알면 정확히 매핑된다 — 잔여번호 리셋 문제의 근본 해결.
export function lotForConsumedIndex(lots, consumedIndex) {
  const n = Number(consumedIndex);
  if (!Array.isArray(lots) || !Number.isFinite(n) || n < 0) return null;
  let start = 0;
  for (const lot of lots) {
    const count = Number(lot.count) || 0;
    if (n >= start && n < start + count) return lot;
    start += count;
  }
  return null;
}

export function computeSessionSettlement({ trainers, members, schedules, payments, records, settings, ym, getOverride }) {
  const inMonth = (d) => d && d.slice(0,7) === ym;
  const memberMap = Object.fromEntries(members.map(m=>[m.id, m]));

  // 회원×트레이너의 '최근 등록 회차'를 결제 이력에서 찾는다.
  //  · sessionAdds([{trainerId,count}])가 있는 결제 중, 이 트레이너에 횟수를 추가한 가장 최근 결제를 본다.
  //  · isReEnroll이면 재등록 회차(reEnrollNo), isNew면 신규, 그 외 일반 등록.
  //  · 표시는 "그 회차에 등록한 횟수"(전체 누적 total이 아님).
  //  · sessionAdds 정보가 없는 구버전 결제만 있으면 null 반환 → 호출부에서 누적 total로 폴백.
  const regRoundOf = (mid, tid) => {
    const list = (payments[mid] || [])
      .filter(p => !p.isRefunded && Array.isArray(p.sessionAdds)
        && p.sessionAdds.some(sa => sa.trainerId === tid && (Number(sa.count) || 0) > 0))
      .sort((a, b) => (a.paidAt < b.paidAt ? 1 : a.paidAt > b.paidAt ? -1 : 0)); // 최신 우선
    if (!list.length) return null;
    const p = list[0];
    const sa = p.sessionAdds.find(x => x.trainerId === tid);
    const count = Number(sa.count) || 0;
    let label;
    if (p.isReEnroll) label = p.reEnrollNo ? `재등록 ${p.reEnrollNo}회차` : '재등록';
    else if (p.isNew) label = '신규';
    else label = '등록';
    return { label, count, isReEnroll: !!p.isReEnroll, reEnrollNo: p.reEnrollNo || null };
  };

  // 결제 건에 박제된 정산비율(splitRateAtPay[tid])을 읽는다. 없으면 null(폴백 처리).
  const frozenRate = (p, tid) => {
    const r = p.splitRateAtPay && p.splitRateAtPay[tid];
    return (r === undefined || r === null || r === '') ? null : Number(r);
  };

  const paymentParts = (p, ts, tids, totalReg, amt) => {
    const pTids = (p.trainerIds && p.trainerIds.length) ? p.trainerIds : null;
    const splitList = Array.isArray(p.split) && p.split.length ? p.split : null;
    const parts = [];
    if (splitList) {
      const gross = splitList.reduce((s,x)=>s+(Number(x.amount)||0),0) || (p.amount||0) || 1;
      splitList.forEach(({trainerId, amount}) => parts.push([trainerId, amt*((Number(amount)||0)/gross)]));
    } else if (pTids) {
      const per = amt/pTids.length; pTids.forEach(tid=>parts.push([tid, per]));
    } else if (totalReg > 0) {
      tids.forEach(tid=>parts.push([tid, amt*((ts[tid].total||0)/totalReg)]));
    } else if (tids.length) {
      const per = amt/tids.length; tids.forEach(tid=>parts.push([tid, per]));
    }
    return parts;
  };

  // 회원×트레이너별 귀속 결제액 (단가 트레이너별 분리 계산용)
  //  · 결제수단별 공제(부가세/카드수수료) 적용한 입금금액 기준
  //  · 결제에 담당 트레이너(trainerIds)가 있으면 그 트레이너들에게 1/n 귀속
  //  · trainerIds가 없는 구버전 결제는 회원의 트레이너별 등록횟수 비율로 안분
  const memberTrainerPay = {}; // mid -> { tid: netAmount }  (전체기간 — 단가 계산용)
  const trainerMonthNet  = {}; // tid -> 그 달(ym) 귀속 입금금액 합계 (정산비율 판정용·폴백)
  const trainerNewSales  = {}; // tid -> 그 달 신규(isNew) 귀속 입금액
  const trainerReSales   = {}; // tid -> 그 달 재등록(isReEnroll) 귀속 입금액
  const memberTrainerLots = {}; // mid -> { tid: [registration lots] }
  // 회원×트레이너별 박제비율 가중합 — 결제월 비율을 입금액 비중으로 가중평균(rateW/rateBase)
  const memberTrainerRate = {}; // mid -> { tid: { w: 가중합(rate*net), base: net합, hasFrozen } }
  const addRate = (mid, tid, part, p) => {
    const r = frozenRate(p, tid);
    if (!memberTrainerRate[mid]) memberTrainerRate[mid] = {};
    if (!memberTrainerRate[mid][tid]) memberTrainerRate[mid][tid] = { w:0, base:0, hasFrozen:false };
    const slot = memberTrainerRate[mid][tid];
    if (r != null) { slot.w += r * part; slot.base += part; slot.hasFrozen = true; }
  };
  members.forEach(m => {
    const ts = m.trainerSessions || {};
    const tids = Object.keys(ts);
    const totalReg = Object.values(ts).reduce((s,v)=>s+(v.total||0),0);
    const acc = {};
    tids.forEach(tid => acc[tid] = 0);
    const explicitLots = {};
    const legacyLots = {};
    // 환불 결제도 단가 계산에는 포함한다(이미 수업한 진행분은 트레이너 정산에 남김).
    //  · 단가×출석횟수 모델이라, 환불해도 '출석한 회차'만큼만 자동 지급됨(미진행분은 출석 0이라 미지급).
    //  · 미수금(isUnpaid)만 제외. 환불 결제의 매출 차감은 아래 trainerMonthNet에서 별도 처리.
    //  · 월정액 결제(isMonthly)는 트레이너 정산에서 제외 → 센터 수익으로만 합산된다.
    (payments[m.id]||[]).filter(p=>!p.isUnpaid && !p.isMonthly).forEach(p=>{
      const amt = calcNet(p, settings).net; // 카드1·2: 부가세+카드세 / 페이·현금영수증: 부가세 / 계좌·현금: 공제 없음
      const isMonth = inMonth(p.paidAt);     // 폴백 정산비율은 "그 달 결제"만 반영
      const splitList = Array.isArray(p.split) && p.split.length ? p.split : null;
      // 트레이너별 귀속분 [tid, part] 산출
      const parts = paymentParts(p, ts, tids, totalReg, amt);
      parts.forEach(([tid, part]) => {
        acc[tid] = (acc[tid]||0) + part;       // 단가 계산용(전체기간, 환불 포함)
        if (!p.isRefunded) addRate(m.id, tid, part, p); // 비율 박제 가중치는 미환불 결제만
        const additions = Array.isArray(p.sessionAdds)
          ? p.sessionAdds
              .map((sa, idx) => ({ ...sa, idx, count:Number(sa.count)||0 }))
              .filter(sa => sa.trainerId === tid && sa.count > 0)
          : [];
        if (additions.length) {
          const addTotal = additions.reduce((s,sa)=>s+sa.count,0) || 1;
          additions.forEach(sa => {
            const paid = part * (sa.count / addTotal);
            const r = frozenRate(p, tid);
            (explicitLots[tid] = explicitLots[tid] || []).push({
              id: `${p.id || p.paidAt || 'payment'}:${tid}:${sa.idx}`,
              paymentId: p.id || null,
              paidAt: p.paidAt || '',
              orderDate: (p.sessionStartDate && String(p.sessionStartDate)) || p.paidAt || '',
              order: sa.idx,
              count: sa.count,
              paid,
              unit: sa.count > 0 ? paid / sa.count : 0,
              rate: r,
              hasFrozen: r != null,
              label: p.isReEnroll ? (p.reEnrollNo ? `재등록 ${p.reEnrollNo}회차` : '재등록')
                : p.isNew ? '신규' : '등록',
              reEnrollNo: p.reEnrollNo || null,
            });
          });
        } else {
          const r = frozenRate(p, tid);
          const slot = legacyLots[tid] || { paid:0, rateW:0, rateBase:0, hasFrozen:false, paidAt:p.paidAt || '' };
          slot.paid += part;
          if (r != null) { slot.rateW += r * part; slot.rateBase += part; slot.hasFrozen = true; }
          if (!slot.paidAt || (p.paidAt && p.paidAt < slot.paidAt)) slot.paidAt = p.paidAt;
          legacyLots[tid] = slot;
        }
        // 매출/정산비율 판정: 미환불 결제는 결제월에 +, 환불 결제는 '환불한 달'에 −(환불액)
        if (!p.isRefunded && isMonth) {
          trainerMonthNet[tid] = (trainerMonthNet[tid]||0) + part;
          if (p.isReEnroll) trainerReSales[tid] = (trainerReSales[tid]||0) + part;
        }
      });
      // 신규매출 → 상담 트레이너(consultTrainerId) 1명에게 전액 귀속(담당 아님)
      if (!p.isRefunded && isMonth && p.isNew && p.consultTrainerId) {
        trainerNewSales[p.consultTrainerId] = (trainerNewSales[p.consultTrainerId]||0) + amt;
      }
      // 환불 결제: '환불한 달(refundedAt)'의 트레이너 매출에서 환불액을 차감(−).
      //  · 진행분은 위 단가 모델에서 이미 트레이너에게 남으므로, 매출 차감만 환불월에 반영.
      if (p.isRefunded && p.refundedAt && p.refundedAt.slice(0,7) === ym) {
        const refund = Number(p.refundAmount)||0;
        // 트레이너별 안분: split > trainerIds 1/n > 등록횟수 비율
        const rTids = [];
        if (splitList) {
          const gross = splitList.reduce((s,x)=>s+(Number(x.amount)||0),0) || 1;
          splitList.forEach(({trainerId, amount}) => rTids.push([trainerId, refund*((Number(amount)||0)/gross)]));
        } else if (p.trainerIds && p.trainerIds.length) {
          const pTids = p.trainerIds;
          const per = refund/pTids.length; pTids.forEach(tid=>rTids.push([tid, per]));
        } else if (totalReg > 0) {
          tids.forEach(tid=>rTids.push([tid, refund*((ts[tid].total||0)/totalReg)]));
        } else if (tids.length) {
          const per = refund/tids.length; tids.forEach(tid=>rTids.push([tid, per]));
        }
        rTids.forEach(([tid, r]) => { trainerMonthNet[tid] = (trainerMonthNet[tid]||0) - r; });
      }
    });
    memberTrainerPay[m.id] = acc;
    memberTrainerLots[m.id] = {};
    tids.forEach(tid => {
      const trainerReg = Number(ts[tid]?.total) || 0;
      const explicit = (explicitLots[tid] || [])
        .sort((a,b) => (a.orderDate || '').localeCompare(b.orderDate || '') || (a.order||0) - (b.order||0));
      const explicitCount = explicit.reduce((s,l)=>s+(Number(l.count)||0),0);
      const legacy = legacyLots[tid];
      const legacyCount = Math.max(0, trainerReg - explicitCount);
      const lots = [];
      if (legacyCount > 0 || (legacy?.paid || 0) > 0) {
        const paid = legacy?.paid || 0;
        const rate = legacy?.rateBase > 0 ? Math.round(legacy.rateW / legacy.rateBase) : null;
        lots.push({
          id: `legacy:${m.id}:${tid}`,
          paymentId: null,
          paidAt: legacy?.paidAt || '',
          order: -1,
          count: legacyCount,
          paid,
          unit: legacyCount > 0 ? paid / legacyCount : 0,
          rate,
          hasFrozen: !!legacy?.hasFrozen,
          label: null,
          reEnrollNo: null,
          legacy:true,
        });
      }
      memberTrainerLots[m.id][tid] = [...lots, ...explicit].filter(l => (Number(l.count)||0) > 0 || (Number(l.paid)||0) > 0);
    });
  });

  const lotForRemaining = (mid, tid, remainingBefore) => {
    const n = Number(remainingBefore);
    if (!Number.isFinite(n) || n <= 0) return null;
    const lots = memberTrainerLots[mid]?.[tid] || [];
    let start = 1;
    for (let i = lots.length - 1; i >= 0; i--) {
      const lot = lots[i];
      const count = Number(lot.count) || 0;
      const end = start + count - 1;
      if (n >= start && n <= end) return lot;
      start = end + 1;
    }
    return null;
  };

  const nextLotFor = (mid, tid, remaining) => lotForRemaining(mid, tid, remaining)
    || (memberTrainerLots[mid]?.[tid] || []).find(l => (Number(l.count)||0) > 0)
    || null;

  const attended = {};
  const attendedLots = {};

  // 회차별 lot 매핑 — 근본 수정:
  //  · 기존엔 sessionAtBooking(그 시점 잔여)으로 회차를 역산했는데, 등록분마다 잔여가 10→1로
  //    리셋되어 8회차·9회차 번호가 겹치면 뭉개졌다. sessionAtBooking 은 더 이상 신뢰하지 않는다.
  //  · 새 방식(둘 중 하나):
  //     (A) 예약 시 스탬프된 consumedIndexAtBooking(0-기반 누적 소진 인덱스)이 있으면 그대로 사용.
  //     (B) 없으면(구버전 데이터) 회원의 현재 잔여(remaining)를 기준점으로, 그 회원·트레이너의
  //         "출석/노쇼 수업 전체"를 날짜순 정렬해 누적 소진 인덱스를 역산한다.
  //         전체 등록 = totalReg, 앞으로 소진될 잔여 = remaining →
  //         이미 소진된 수 = totalReg − remaining. 날짜순 마지막 수업의 인덱스 = (totalReg − remaining − 1),
  //         거기서 위로 갈수록 −1. (소진은 시간순이므로 등록분 비연속 추가도 정확히 갈린다.)
  // 회차 매핑용 소진 리스트: 출석·노쇼 + "세션이 차감된 예정 수업"(sessionDeducted).
  //  · 예약 시점에 세션이 차감되므로(sessionDeducted:true), 아직 출석 전이어도 그 등록분의
  //    한 회를 이미 점유한 것이다. 세션 차감수와 회차 매핑수를 일치시켜야 완전성 판단이 맞다.
  //    (정민준: 7월 예약 2건이 미출석이지만 세션 차감됨 → 이걸 빼면 매핑이 밀려 회차가 뭉쳤음)
  //  · 이 리스트는 "어느 회차 소진인지"에만 쓰인다. 정산 금액(실지급)은 아래에서 출석·노쇼만
  //    집계하므로, 미출석 예정분은 회차 매핑에는 반영돼도 돈으로는 잡히지 않는다.
  const isConsumedForLot = (s) =>
    s.status === 'attended' || s.status === 'noshow' ||
    (s.status === 'scheduled' && s.sessionDeducted);
  const allConsumed = {}; // tid -> mid -> [schedule...] (전월·이후월 포함 전체, 날짜순)
  schedules
    .filter(s => !s.isExternal && s.memberId && s.trainerId && isConsumedForLot(s))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (String(a.id) < String(b.id) ? -1 : 1)))
    .forEach(s => {
      (allConsumed[s.trainerId] = allConsumed[s.trainerId] || {});
      (allConsumed[s.trainerId][s.memberId] = allConsumed[s.trainerId][s.memberId] || []).push(s);
    });

  Object.entries(allConsumed).forEach(([tid, byMember]) => {
    Object.entries(byMember).forEach(([mid, list]) => {
      const lots = memberTrainerLots[mid]?.[tid] || [];
      // ── 회차 매핑 ────────────────────────────────────────────────────
      // 소진은 항상 시간순이다. 출석/노쇼 수업 "전체"(전월 포함)를 날짜순 정렬한 순서가
      // 누적 소진 인덱스이며, lot 경계(세션 시작일 반영)에 대응시켜 회차를 가른다.
      // 스케줄에 박힌 consumedIndexAtBooking/sessionAtBooking 은 리셋·미반영으로 어긋나므로 무시.
      //
      // 앵커(리스트 첫 수업의 누적 인덱스) — 스케줄 완전성으로 판단:
      //  · list(전월·당월·이후월 포함 전체 소진 스케줄) 개수 >= 실제 소진수(total−remaining):
      //    모든 소진이 스케줄에 있음(완전) → base=0 순수 날짜순. 스케줄 순서가 진실이다.
      //    (정민준: 6월6개+7월2개=8, 사용8과 일치 → 완전 → 정확히 갈림)
      //  · list 개수 < 소진수: 과거 일부 소진이 스케줄 없이 잔여만 차감됨(시스템 도입 전 등) →
      //    잔여 기준으로 뒤에서 앵커(base = 소진수 − list 개수).
      const member = memberMap[mid];
      const totalReg = Number(member?.trainerSessions?.[tid]?.total);
      const remainingNow = Number(member?.trainerSessions?.[tid]?.remaining);
      const consumedSoFar = (Number.isFinite(totalReg) && Number.isFinite(remainingNow))
        ? Math.max(0, totalReg - remainingNow) : list.length;
      const base = list.length >= consumedSoFar ? 0 : Math.max(0, consumedSoFar - list.length);
      list.forEach((s, seqIdx) => {
        if (!inMonth(s.date)) return;            // 인덱스는 전체 순서 기준, 집계는 이번 달만
        // 미출석 예정분(sessionDeducted)은 회차 인덱스 진행에만 기여하고, 실제 카운트·금액에는
        // 넣지 않는다(아직 안 한 수업이 정산 금액에 잡히면 안 됨). 출석·노쇼만 집계.
        const counts = s.status === 'attended' || s.status === 'noshow';
        const lot = lotForConsumedIndex(lots, base + seqIdx);
        const key = lot?.id || '__aggregate__';
        if (!counts) return;
        attended[tid] = attended[tid] || {};
        attended[tid][mid] = (attended[tid][mid] || 0) + 1;
        attendedLots[tid] = attendedLots[tid] || {};
        attendedLots[tid][mid] = attendedLots[tid][mid] || {};
        attendedLots[tid][mid][key] = (attendedLots[tid][mid][key] || 0) + 1;
      });
    });
  });

  const trainerMembers = {};
  members.forEach(m => Object.keys(m.trainerSessions||{}).forEach(tid=>{
    (trainerMembers[tid] = trainerMembers[tid] || new Set()).add(m.id);
  }));
  Object.entries(attended).forEach(([tid, mm])=>{
    trainerMembers[tid] = trainerMembers[tid] || new Set();
    Object.keys(mm).forEach(mid=>trainerMembers[tid].add(mid));
  });

  return trainers.map(t => {
    const ov = getOverride ? getOverride(t.id, ym) : null;
    const ovUnit = ov?.unitPrices || {};
    const ovCnt  = ov?.sessionCounts || {};
    const ovRate = ov?.splitRates || ov?.rates || {};
    const manualRateOf = (mid) => {
      const raw = ovRate[mid];
      if (raw === undefined || raw === null || raw === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
    };
    const mids = [...(trainerMembers[t.id] || [])];

    // 폴백용: 그 결제월의 비율을 박제하지 못한 구버전 결제를 위해, 현재월 자동판정값을 준비
    let blogCount=0, instaCount=0, studyCount=0;
    (records||[]).filter(r=>r.trainerId===t.id && inMonth(r.date)).forEach(r=>{
      if (r.channel==='blog') blogCount++;
      if (r.channel==='insta') instaCount++;
      if (r.channel==='study') studyCount++;
    });
    // 홍보 횟수 override: 값이 있고 0보다 클 때만 수동값으로 사용한다.
    //  · null/undefined: 처음부터 미설정 → 실시간 집계값 사용
    //  · 0: 과거에 자동집계값(당시 0)이 그대로 박제된 경우가 대부분 → 이후 추가한 기록을
    //       영구히 가리는 버그를 막기 위해 '미설정'으로 간주하고 실시간 집계값 사용.
    //       (정말 0으로 묶고 싶은 경우는 거의 없고, 실시간값도 0이면 결과는 동일)
    const ovPromo = (v, auto) => (v == null || Number(v) === 0) ? auto : Number(v);
    const fBlog  = ovPromo(ov?.blogCount,  blogCount);
    const fInsta = ovPromo(ov?.instaCount, instaCount);
    const fStudy = ovPromo(ov?.studyCount, studyCount);
    const fallbackSplit = determineSplitRate({
      settings, trainerId: t.id,
      monthNet: Math.round(trainerMonthNet[t.id] || 0),
      newSales: Math.round(trainerNewSales[t.id] || 0),
      reEnrollSales: Math.round(trainerReSales[t.id] || 0),
      blogCount: fBlog, studyCount: fStudy,
    });

    const rows = mids.map(mid => {
      const m = memberMap[mid];
      const ts = (m?.trainerSessions||{})[t.id] || {};
      // 단가 = (이 트레이너에게 귀속된 결제액) ÷ (이 트레이너의 등록횟수)
      const trainerPaid = (memberTrainerPay[mid]||{})[t.id] || 0;
      const trainerReg  = ts.total || 0;
      const trainerRemain = ts.remaining ?? trainerReg; // 잔여 횟수(정보 없으면 등록횟수로 간주)
      const autoCnt = (attended[t.id]||{})[mid] || 0;
      const aggregateUnit = trainerReg > 0 ? trainerPaid / trainerReg : 0;
      const lotMap = Object.fromEntries((memberTrainerLots[mid]?.[t.id] || []).map(l => [l.id, l]));
      const lotCounts = attendedLots[t.id]?.[mid] || {};
      // A방식(등록월 박제): 이 회원의 이 트레이너 결제 건에 박제된 비율(splitRateAtPay)을 사용.
      //  · 박제 비율은 "그 회원이 등록한 달의 트레이너 실적"으로 판정돼 결제 시 고정된 값.
      //  · 여러 결제가 섞이면 입금액 비중으로 가중평균. 박제값이 없으면(구버전) 그 달 자동판정으로 폴백.
      //  · 트레이너 수동 지정(trainerSplitRates)이 있으면 그게 최우선(fallbackSplit.mode==='manual').
      const rateSlot = (memberTrainerRate[mid]||{})[t.id];
      const hasFrozen = !!(rateSlot && rateSlot.hasFrozen && rateSlot.base > 0);
      const baseRate = fallbackSplit.mode === 'manual'
        ? fallbackSplit.rate                                   // 수동 지정 최우선
        : (hasFrozen ? Math.round(rateSlot.w / rateSlot.base)  // 등록월 박제 비율
                     : fallbackSplit.rate);                    // 폴백: 그 달 자동판정
      let autoAmount = 0;
      let autoPayAmount = 0;
      const settlementBreakdown = [];
      Object.entries(lotCounts).forEach(([lotId, count]) => {
        const c = Number(count) || 0;
        const lot = lotMap[lotId];
        const lotUnit = lot ? Number(lot.unit)||0 : aggregateUnit;
        const lotRate = fallbackSplit.mode === 'manual'
          ? fallbackSplit.rate
          : (lot?.rate != null ? Number(lot.rate) : baseRate);
        const partAmount = lotUnit * c;
        autoAmount += partAmount;
        const partPayAmount = Math.round(partAmount * lotRate / 100);
        autoPayAmount += partPayAmount;
        settlementBreakdown.push({
          id: lotId,
          label: lot ? (lot.label || '기존 등록') : '회차 미확인',
          count: c,
          regCount: lot?.count ?? null,
          unit: lotUnit,
          amount: partAmount,
          rate: lotRate,
          payAmount: partPayAmount,
          reEnrollNo: lot?.reEnrollNo || null,
          hasFrozen: !!lot?.hasFrozen,
          legacy: !!lot?.legacy,
        });
      });
      if (settlementBreakdown.length > 1) {
        settlementBreakdown.forEach(part => {
          if (part.label === '등록' || part.label === '기존 등록') part.label = '전회차';
        });
      }
      const previewLot = nextLotFor(mid, t.id, trainerRemain);
      const previewUnit = previewLot ? Number(previewLot.unit)||0 : aggregateUnit;
      const autoUnit = autoCnt > 0 ? (autoAmount / autoCnt) : previewUnit;
      const unitManual = ovUnit[mid] != null;
      const cntManual = ovCnt[mid] != null;
      const unit = unitManual ? Number(ovUnit[mid]) : autoUnit;
      const cnt = cntManual ? Number(ovCnt[mid]) : autoCnt;
      const manualRate = manualRateOf(mid);
      const rateManual = manualRate != null;
      const autoRate = autoAmount > 0
        ? Math.round(autoPayAmount / autoAmount * 100)
        : (previewLot?.rate != null ? Number(previewLot.rate) : baseRate);
      const effRate = rateManual ? manualRate : autoRate;
      const rateFrozen = !rateManual && fallbackSplit.mode !== 'manual'
        && (autoCnt > 0
          ? Object.keys(lotCounts).some(id => lotMap[id]?.hasFrozen) || hasFrozen
          : !!previewLot?.hasFrozen || hasFrozen);
      const amount = (!unitManual && !cntManual) ? autoAmount : unit * cnt; // 수업료(비율 적용 전)
      const payAmount = rateManual || unitManual || cntManual
        ? Math.round(amount * effRate/100)
        : autoPayAmount; // 자동 계산은 회차별 단가·비율 합산값을 그대로 사용
      const reg = regRoundOf(mid, t.id); // 최근 등록 회차 정보(없으면 null → 누적 total 폴백)
      const activeReg = autoCnt > 0
        ? Object.keys(lotCounts).map(id => lotMap[id]).find(Boolean)
        : previewLot;
      return {
        memberId: mid, memberName: m?.name || '?',
        regTotal: trainerReg, remaining: trainerRemain, autoUnit, unit, autoCnt, cnt,
        unitManual, cntManual,
        amount, rate: effRate, baseRate, autoRate, rateManual, rateFrozen, payAmount,
        // 등록 회차 표시용: 현재 정산에 실제 적용된 회차를 우선 표시한다.
        regRound: settlementBreakdown.length > 1 ? '회차별'
          : activeReg?.label || (reg ? reg.label : null),
        regRoundCount: settlementBreakdown.length > 1 ? autoCnt
          : activeReg?.count || (reg ? reg.count : null),
        regReEnrollNo: activeReg?.reEnrollNo || (reg ? reg.reEnrollNo : null),
        settlementBreakdown,
      };
    })
    // 표시 기준:
    //  · 그 달 출석(cnt>0)이 있으면 항상 표시(마지막 정산달까지 정상 노출).
    //  · 출석이 없어도 '아직 잔여가 남은(진행 중)' 회원은 표시(예정 정산 가늠용).
    //  · 횟수가 끝난(잔여 0) 회원은 그 달 출석이 없으면 제외 → 마지막 정산달 이후 화면에서 사라짐.
    //  · 수동 횟수 지정(ovCnt)이 있으면 표시 유지.
    .filter(r => r.cnt>0 || (r.regTotal>0 && r.remaining>0) || ovCnt[r.memberId] != null || ovRate[r.memberId] != null);

    const sessionTotal  = rows.reduce((s,r)=>s+r.amount, 0);     // 비율 적용 전 합
    const sessionPayout = rows.reduce((s,r)=>s+r.payAmount, 0);  // 비율 적용 후 합(회원별 박제비율)
    const blogInc  = fBlog * settings.promoPerPost;
    const instaInc = Math.min(fInsta, settings.snsInstaMax ?? 8) * settings.promoPerPost;
    // 신규/재등록 매출 인센티브: 단위 매출당 고정액 (기본 100만원당 1만원)
    const newSalesM = Math.round(trainerNewSales[t.id] || 0);
    const reSalesM  = Math.round(trainerReSales[t.id] || 0);
    const newPer = Number(settings.incentivePer ?? 1000000);
    const rePer  = Number(settings.reEnrollPer ?? 1000000);
    const newInc = newPer > 0 ? Math.floor(newSalesM / newPer) * Number(settings.incentiveAmount ?? 10000) : 0;
    const reInc  = rePer  > 0 ? Math.floor(reSalesM  / rePer)  * Number(settings.reEnrollAmount ?? 10000) : 0;
    const promoIncentive = blogInc + instaInc + newInc + reInc;
    const payout = sessionPayout + promoIncentive;   // 세전(총 지급액)
    // 세후 = 세전 − 원천징수(국세+지방세). 세율은 설정값(기본 3.3%), 매달 신고 후 수정 가능.
    const whRate = Number(settings.withholdingRate ?? 3.3);
    const tax = Math.round(payout * whRate / 100);
    const payoutNet = payout - tax;

    // 대표 비율: 회원마다 등록월 박제 비율이 다를 수 있으므로, 다르면 'mixed'(가중평균 표시)
    const distinct = [...new Set(rows.filter(r=>r.amount>0).map(r=>r.rate))];
    const blendedRate = sessionTotal>0 ? Math.round(sessionPayout/sessionTotal*100) : fallbackSplit.rate;
    const splitRate = distinct.length<=1 ? (distinct[0] ?? fallbackSplit.rate) : blendedRate;
    const hasManualRate = rows.some(r=>r.rateManual);
    const splitMode = hasManualRate || fallbackSplit.mode==='manual' ? 'manual' : (rows.some(r=>r.rateFrozen) ? 'frozen' : 'auto');
    const splitReason = hasManualRate
      ? (distinct.length>1 ? `회원별 수동 정산비율 혼합(가중평균 ${blendedRate}%)` : `수동 정산비율 ${splitRate}%`)
      : fallbackSplit.mode==='manual'
      ? fallbackSplit.reason
      : (distinct.length>1
          ? `등록월별 비율 혼합(가중평균 ${blendedRate}%)`
          : (rows.some(r=>r.rateFrozen) ? `등록월 고정 ${splitRate}%` : fallbackSplit.reason));

    return {
      trainer: t, rows, sessionTotal,
      splitRate, splitMode, splitReason, rateMixed: distinct.length>1,
      sessionPayout,
      blogCount: fBlog, instaCount: fInsta, studyCount: fStudy,
      autoBlogCount: blogCount, autoInstaCount: instaCount, autoStudyCount: studyCount,
      blogInc, instaInc,
      newSales: newSalesM, reEnrollSales: reSalesM, newInc, reInc,
      promoIncentive,
      payout, withholdingRate: whRate, tax, payoutNet,
      hasOverride: !!ov,
    };
  }).filter(x => x.rows.length>0 || x.promoIncentive>0);
}

// ── 수동 정산비율을 결제 건에 영구 박제(방향 A) ──────────────────────
// 특정 회원×트레이너의 정산비율을 "소진 끝까지" 고정하려면, 그 트레이너의 세션을
// 공급하는 결제 건들의 splitRateAtPay[tid] 를 직접 rate 로 바꿔야 한다.
// 그래야 그 등록분을 소진하는 모든 달이 같은 비율을 따라간다(월 오버라이드와 달리 소진 전체 유지).
//
//  · 대상: 이 회원의 결제 중 (a) 미환불이고 (b) 이 트레이너에게 귀속된 결제.
//    - trainerIds 에 tid 가 포함되거나(명시 담당), trainerIds 가 비어 있고 회원이 그 트레이너
//      세션을 보유한 경우(등록횟수 안분 결제) 모두 포함한다.
//  · 이미 같은 값이면 patch 에서 제외(불필요한 쓰기 방지).
//  · 반환: { patches:[{ mid, pid, splitRateAtPay, prev }], count }
//    splitRateAtPay 는 기존 값을 보존한 채 tid 키만 갱신한 새 객체다.
export function planRateFreeze({ member, payments, trainerId, rate }) {
  const r = Number(rate);
  const tid = trainerId;
  const patches = [];
  if (!member || !tid || !Number.isFinite(r)) return { patches, count: 0 };
  const hasTrainerSession = !!(member.trainerSessions && member.trainerSessions[tid]);
  (payments || []).forEach(p => {
    if (p.isRefunded) return; // 환불 결제는 지급 계산에서 특수 처리 → 비율 재박제 대상 아님
    const pTids = Array.isArray(p.trainerIds) ? p.trainerIds : [];
    const belongs = pTids.length ? pTids.includes(tid) : hasTrainerSession;
    if (!belongs) return;
    const prev = p.splitRateAtPay || {};
    if (Number(prev[tid]) === r) return; // 이미 같은 값 → 스킵
    patches.push({
      mid: member.id,
      pid: p.id,
      splitRateAtPay: { ...prev, [tid]: r },
      prev,
    });
  });
  return { patches, count: patches.length };
}

// CSV 다운로드 (Excel에서 한글 깨짐 방지 위해 UTF-8 BOM 포함)
// ── 과거 스케줄 회차 인덱스 소급 부여(마이그레이션) ─────────────────────
// 기존 수업들은 consumedIndexAtBooking 이 없고 sessionAtBooking 이 등록분마다 리셋된
// 잘못된 값일 수 있다. 회원·트레이너별로 출석/노쇼 수업을 날짜순 정렬해, 현재 잔여를
// 기준점으로 0-기반 누적 소진 인덱스를 다시 매긴다(먼저 한 수업이 먼저 소진).
//  · 반환: [{ id, consumedIndexAtBooking }]  — 값이 바뀌는 수업만.
//  · 전제: 소진이 시간순(정상 운영). "잔여 남은 채 다음 회차 미리 등록"이 섞여도
//    시간순 소진이면 결과는 동일하다(누적 인덱스는 순서만 본다).
export function planConsumedIndexBackfill({ members, schedules }) {
  const byMT = {}; // `${mid}::${tid}` -> [schedule...]
  schedules
    .filter(s => !s.isExternal && s.memberId && s.trainerId && (s.status === 'attended' || s.status === 'noshow'))
    .forEach(s => {
      const k = `${s.memberId}::${s.trainerId}`;
      (byMT[k] = byMT[k] || []).push(s);
    });
  const memberMap = Object.fromEntries((members || []).map(m => [m.id, m]));
  const patches = [];
  Object.entries(byMT).forEach(([k, list]) => {
    const [mid, tid] = k.split('::');
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (String(a.id) < String(b.id) ? -1 : 1)));
    const ts = memberMap[mid]?.trainerSessions?.[tid] || {};
    const totalReg = Number(ts.total);
    const remainingNow = Number(ts.remaining);
    const consumedSoFar = (Number.isFinite(totalReg) && Number.isFinite(remainingNow))
      ? Math.max(0, totalReg - remainingNow) : list.length;
    const base = consumedSoFar - list.length; // 첫(가장 이른) 수업의 누적 인덱스
    list.forEach((s, i) => {
      const idx = Math.max(0, base + i);
      if (Number(s.consumedIndexAtBooking) !== idx) {
        patches.push({ id: s.id, consumedIndexAtBooking: idx });
      }
    });
  });
  return patches;
}

export function downloadCSV(filename, rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const csv = rows.map(r => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}
