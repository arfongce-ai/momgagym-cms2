// finance.js — 매출/정산 공통 상수 및 계산 로직
// 결제수단: 페이, 계좌, 현금, 현금영수증, 카드1, 카드2

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
export const monthKey = (d) => new Date(d).toISOString().slice(0,7);
export const yearKey  = (d) => new Date(d).toISOString().slice(0,4);

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
//  · 수동 지정(trainerSplitRates[tid])이 있으면 그 값을 그대로 사용(자동판정 무시)
//  · 자동: 기본=하한(40%) → 블로그≥조건 AND 스터디≥조건 이면 50% → 월매출≥조건 이면 60%
//  · 60%와 50% 조건을 동시에 만족하면 더 높은 60% 우선
// 반환: { rate, mode:'manual'|'auto', reason, monthNet, blogCount, studyCount }
export function determineSplitRate({ settings, trainerId, monthNet, newSales=0, reEnrollSales=0, blogCount, studyCount }) {
  const manual = settings.trainerSplitRates?.[trainerId];
  if (manual !== undefined && manual !== null && manual !== '') {
    return { rate: Number(manual), mode: 'manual', reason: '수동 지정',
             monthNet, blogCount, studyCount };
  }
  const floor   = Number(settings.lowSplitRate ?? 40);   // 하한 40%
  const min60   = Number(settings.rate60MinSales ?? 3000000);
  const minBlog = Number(settings.rate50MinBlog ?? 2);
  const minStudy= Number(settings.rate50MinStudy ?? 1);

  // 두 조건을 본다.
  //  · 조건A: 블로그 ≥2 AND 스터디 ≥1
  //  · 조건B: 신규 또는 재등록 매출 ≥ 임계(300만)
  // 둘 다 충족 → 60% / 하나만 → 50% / 둘 다 미달 → 40%
  const condA = (blogCount >= minBlog && studyCount >= minStudy);
  const condB = (newSales >= min60 || reEnrollSales >= min60);
  const metCount = (condA?1:0) + (condB?1:0);

  let rate, reason;
  if (metCount === 2) {
    rate = 60;
    reason = `블로그·스터디 + 매출(${won(min60)} 이상) 둘 다 충족 → 60%`;
  } else if (metCount === 1) {
    rate = 50;
    reason = condA
      ? `블로그 ${blogCount}회·스터디 ${studyCount}회 충족(매출 조건 1개) → 50%`
      : `매출 ${won(min60)} 이상 충족(조건 1개) → 50%`;
  } else {
    rate = floor;
    reason = `조건 미달(블로그·스터디 / 매출 모두 미달) → ${floor}%`;
  }
  return { rate, mode: 'auto', reason, monthNet, newSales, reEnrollSales, blogCount, studyCount };
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
    (payments[m.id]||[]).filter(p=>!p.isUnpaid && !p.isRefunded && inMonth(p.paidAt)).forEach(p=>{
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
      involved.forEach(tid => { if (rateMap[tid]) next[tid] = rateMap[tid].rate; });
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

// ── 회당 단가 × 월 수업횟수 기반 정산 (실제 시트 방식) ──────────────
// 정산비율은 "결제월에 박제된 비율(splitRateAtPay)"을 회원별로 적용한다.
export function computeSessionSettlement({ trainers, members, schedules, payments, records, settings, ym, getOverride }) {
  const inMonth = (d) => d && d.slice(0,7) === ym;
  const memberMap = Object.fromEntries(members.map(m=>[m.id, m]));

  // 결제 건에 박제된 정산비율(splitRateAtPay[tid])을 읽는다. 없으면 null(폴백 처리).
  const frozenRate = (p, tid) => {
    const r = p.splitRateAtPay && p.splitRateAtPay[tid];
    return (r === undefined || r === null || r === '') ? null : Number(r);
  };

  // 회원×트레이너별 귀속 결제액 (단가 트레이너별 분리 계산용)
  //  · 결제수단별 공제(부가세/카드수수료) 적용한 입금금액 기준
  //  · 결제에 담당 트레이너(trainerIds)가 있으면 그 트레이너들에게 1/n 귀속
  //  · trainerIds가 없는 구버전 결제는 회원의 트레이너별 등록횟수 비율로 안분
  const memberTrainerPay = {}; // mid -> { tid: netAmount }  (전체기간 — 단가 계산용)
  const trainerMonthNet  = {}; // tid -> 그 달(ym) 귀속 입금금액 합계 (정산비율 판정용·폴백)
  const trainerNewSales  = {}; // tid -> 그 달 신규(isNew) 귀속 입금액
  const trainerReSales   = {}; // tid -> 그 달 재등록(isReEnroll) 귀속 입금액
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
    // 환불 결제도 단가 계산에는 포함한다(이미 수업한 진행분은 트레이너 정산에 남김).
    //  · 단가×출석횟수 모델이라, 환불해도 '출석한 회차'만큼만 자동 지급됨(미진행분은 출석 0이라 미지급).
    //  · 미수금(isUnpaid)만 제외. 환불 결제의 매출 차감은 아래 trainerMonthNet에서 별도 처리.
    (payments[m.id]||[]).filter(p=>!p.isUnpaid).forEach(p=>{
      const amt = calcNet(p, settings).net; // 카드1·2: 부가세+카드세 / 페이·현금영수증: 부가세 / 계좌·현금: 공제 없음
      const isMonth = inMonth(p.paidAt);     // 폴백 정산비율은 "그 달 결제"만 반영
      const pTids = (p.trainerIds && p.trainerIds.length) ? p.trainerIds : null;
      const splitList = Array.isArray(p.split) && p.split.length ? p.split : null;
      // 트레이너별 귀속분 [tid, part] 산출
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
      parts.forEach(([tid, part]) => {
        acc[tid] = (acc[tid]||0) + part;       // 단가 계산용(전체기간, 환불 포함)
        if (!p.isRefunded) addRate(m.id, tid, part, p); // 비율 박제 가중치는 미환불 결제만
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
        } else if (pTids) {
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
  });

  const attended = {};
  schedules.filter(s=>!s.isExternal && s.memberId && s.trainerId && (s.status==='attended' || s.status==='noshow') && inMonth(s.date))
    .forEach(s=>{
      attended[s.trainerId] = attended[s.trainerId] || {};
      attended[s.trainerId][s.memberId] = (attended[s.trainerId][s.memberId]||0) + 1;
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
    const mids = [...(trainerMembers[t.id] || [])];

    // 폴백용: 그 결제월의 비율을 박제하지 못한 구버전 결제를 위해, 현재월 자동판정값을 준비
    let blogCount=0, instaCount=0, studyCount=0;
    (records||[]).filter(r=>r.trainerId===t.id && inMonth(r.date)).forEach(r=>{
      if (r.channel==='blog') blogCount++;
      if (r.channel==='insta') instaCount++;
      if (r.channel==='study') studyCount++;
    });
    const ovBlog = ov?.blogCount, ovInsta = ov?.instaCount, ovStudy = ov?.studyCount;
    const fBlog = ovBlog ?? blogCount;
    const fInsta = ovInsta ?? instaCount;
    const fStudy = ovStudy ?? studyCount;
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
      const autoUnit = trainerReg > 0 ? Math.round(trainerPaid / trainerReg) : 0;
      const unit = ovUnit[mid] != null ? Number(ovUnit[mid]) : autoUnit;
      const autoCnt = (attended[t.id]||{})[mid] || 0;
      const cnt = ovCnt[mid] != null ? Number(ovCnt[mid]) : autoCnt;
      // A방식(등록월 박제): 이 회원의 이 트레이너 결제 건에 박제된 비율(splitRateAtPay)을 사용.
      //  · 박제 비율은 "그 회원이 등록한 달의 트레이너 실적"으로 판정돼 결제 시 고정된 값.
      //  · 여러 결제가 섞이면 입금액 비중으로 가중평균. 박제값이 없으면(구버전) 그 달 자동판정으로 폴백.
      //  · 트레이너 수동 지정(trainerSplitRates)이 있으면 그게 최우선(fallbackSplit.mode==='manual').
      const rateSlot = (memberTrainerRate[mid]||{})[t.id];
      const hasFrozen = !!(rateSlot && rateSlot.hasFrozen && rateSlot.base > 0);
      const effRate = fallbackSplit.mode === 'manual'
        ? fallbackSplit.rate                                   // 수동 지정 최우선
        : (hasFrozen ? Math.round(rateSlot.w / rateSlot.base)  // 등록월 박제 비율
                     : fallbackSplit.rate);                    // 폴백: 그 달 자동판정
      const rateFrozen = fallbackSplit.mode !== 'manual' && hasFrozen;
      const amount = unit * cnt;                       // 수업료(비율 적용 전)
      const payAmount = Math.round(amount * effRate/100); // 실지급(비율 적용)
      return {
        memberId: mid, memberName: m?.name || '?',
        regTotal: trainerReg, autoUnit, unit, autoCnt, cnt,
        amount, rate: effRate, rateFrozen, payAmount,
      };
    }).filter(r => r.cnt>0 || r.regTotal>0);

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
    const splitMode = fallbackSplit.mode==='manual' ? 'manual' : (rows.some(r=>r.rateFrozen) ? 'frozen' : 'auto');
    const splitReason = fallbackSplit.mode==='manual'
      ? fallbackSplit.reason
      : (distinct.length>1
          ? `등록월별 비율 혼합(가중평균 ${blendedRate}%)`
          : (rows.some(r=>r.rateFrozen) ? `등록월 고정 ${splitRate}%` : fallbackSplit.reason));

    return {
      trainer: t, rows, sessionTotal,
      splitRate, splitMode, splitReason, rateMixed: distinct.length>1,
      sessionPayout,
      blogCount: fBlog, instaCount: fInsta, studyCount: fStudy,
      blogInc, instaInc,
      newSales: newSalesM, reEnrollSales: reSalesM, newInc, reInc,
      promoIncentive,
      payout, withholdingRate: whRate, tax, payoutNet,
      hasOverride: !!ov,
    };
  }).filter(x => x.rows.length>0 || x.promoIncentive>0);
}

// CSV 다운로드 (Excel에서 한글 깨짐 방지 위해 UTF-8 BOM 포함)
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
