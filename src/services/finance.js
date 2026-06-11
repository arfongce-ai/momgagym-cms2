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
export function determineSplitRate({ settings, trainerId, monthNet, blogCount, studyCount }) {
  const manual = settings.trainerSplitRates?.[trainerId];
  if (manual !== undefined && manual !== null && manual !== '') {
    return { rate: Number(manual), mode: 'manual', reason: '수동 지정',
             monthNet, blogCount, studyCount };
  }
  const base   = Number(settings.lowSplitRate ?? settings.defaultSplitRate ?? 40); // 하한
  const min60  = Number(settings.rate60MinSales ?? 3000000);
  const minBlog= Number(settings.rate50MinBlog ?? 2);
  const minStudy=Number(settings.rate50MinStudy ?? 1);

  let rate = base, reason = `기본(하한) ${base}%`;
  // 50% 조건: 블로그 AND 스터디 동시 충족
  if (blogCount >= minBlog && studyCount >= minStudy) {
    rate = 50; reason = `블로그 ${blogCount}회·스터디 ${studyCount}회 → 50%`;
  }
  // 60% 조건: 월 매출(입금금액). 50%보다 우선(더 높은 비율).
  if (monthNet >= min60) {
    rate = 60; reason = `월 입금 ${won(monthNet)} ≥ ${won(min60)} → 60%`;
  }
  return { rate, mode: 'auto', reason, monthNet, blogCount, studyCount };
}

// ── 회당 단가 × 월 수업횟수 기반 정산 (실제 시트 방식) ──────────────
export function computeSessionSettlement({ trainers, members, schedules, payments, records, settings, ym, getOverride }) {
  const inMonth = (d) => d && d.slice(0,7) === ym;
  const memberMap = Object.fromEntries(members.map(m=>[m.id, m]));

  // 회원×트레이너별 귀속 결제액 (단가 트레이너별 분리 계산용)
  //  · 결제수단별 공제(부가세/카드수수료) 적용한 입금금액 기준
  //  · 결제에 담당 트레이너(trainerIds)가 있으면 그 트레이너들에게 1/n 귀속
  //  · trainerIds가 없는 구버전 결제는 회원의 트레이너별 등록횟수 비율로 안분
  const memberTrainerPay = {}; // mid -> { tid: netAmount }  (전체기간 — 단가 계산용)
  const trainerMonthNet  = {}; // tid -> 그 달(ym) 귀속 입금금액 합계 (정산비율 판정용)
  members.forEach(m => {
    const ts = m.trainerSessions || {};
    const tids = Object.keys(ts);
    const totalReg = Object.values(ts).reduce((s,v)=>s+(v.total||0),0);
    const acc = {};
    tids.forEach(tid => acc[tid] = 0);
    (payments[m.id]||[]).filter(p=>!p.isUnpaid && !p.isRefunded).forEach(p=>{
      const amt = calcNet(p, settings).net; // 카드1·2: 부가세+카드세 / 페이·현금영수증: 부가세 / 계좌·현금: 공제 없음
      const isMonth = inMonth(p.paidAt);     // 정산비율은 "그 달 결제"만 반영
      const pTids = (p.trainerIds && p.trainerIds.length) ? p.trainerIds : null;
      // 트레이너별 분배 금액(p.split)이 있으면 그 비율대로 귀속(공제 후 net에 동일 비율 적용)
      const splitList = Array.isArray(p.split) && p.split.length ? p.split : null;
      if (splitList) {
        const gross = splitList.reduce((s,x)=>s+(Number(x.amount)||0),0) || (p.amount||0) || 1;
        splitList.forEach(({trainerId, amount}) => {
          const part = amt * ((Number(amount)||0) / gross); // 공제 후 금액을 분배비율대로
          acc[trainerId] = (acc[trainerId]||0) + part;
          if (isMonth) trainerMonthNet[trainerId] = (trainerMonthNet[trainerId]||0) + part;
        });
      } else if (pTids) {
        const per = amt / pTids.length;
        pTids.forEach(tid => {
          acc[tid] = (acc[tid]||0) + per;
          if (isMonth) trainerMonthNet[tid] = (trainerMonthNet[tid]||0) + per;
        });
      } else if (totalReg > 0) {
        // 담당 트레이너 미지정 → 등록횟수 비율로 안분
        tids.forEach(tid => {
          const part = amt * ((ts[tid].total||0)/totalReg);
          acc[tid] = (acc[tid]||0) + part;
          if (isMonth) trainerMonthNet[tid] = (trainerMonthNet[tid]||0) + part;
        });
      } else if (tids.length) {
        // 등록횟수 정보도 없으면 균등 분배
        const per = amt / tids.length;
        tids.forEach(tid => {
          acc[tid] = (acc[tid]||0) + per;
          if (isMonth) trainerMonthNet[tid] = (trainerMonthNet[tid]||0) + per;
        });
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
      return {
        memberId: mid, memberName: m?.name || '?',
        regTotal: trainerReg, autoUnit, unit, autoCnt, cnt,
        amount: unit * cnt,
      };
    }).filter(r => r.cnt>0 || r.regTotal>0);

    const sessionTotal = rows.reduce((s,r)=>s+r.amount, 0);

    let blogCount=0, instaCount=0, studyCount=0;
    (records||[]).filter(r=>r.trainerId===t.id && inMonth(r.date)).forEach(r=>{
      if (r.channel==='blog') blogCount++;
      if (r.channel==='insta') instaCount++;
      if (r.channel==='study') studyCount++;
    });
    const fBlog = ov?.blogCount ?? blogCount;
    const fInsta = ov?.instaCount ?? instaCount;
    const fStudy = ov?.studyCount ?? studyCount;
    const blogInc  = fBlog * settings.promoPerPost;
    const instaInc = Math.min(fInsta, settings.snsInstaMax ?? 8) * settings.promoPerPost;
    const promoIncentive = blogInc + instaInc;

    // 매월 자동 정산비율 판정 (수동 지정이 있으면 그 값 우선)
    const split = determineSplitRate({
      settings, trainerId: t.id,
      monthNet: Math.round(trainerMonthNet[t.id] || 0),
      blogCount: fBlog, studyCount: fStudy,
    });
    // 수업료 합계 × 정산비율 = 실지급 수업료
    const sessionPayout = Math.round(sessionTotal * (split.rate / 100));
    const payout = sessionPayout + promoIncentive;

    return {
      trainer: t, rows, sessionTotal,
      splitRate: split.rate, splitMode: split.mode, splitReason: split.reason,
      sessionPayout,
      blogCount: fBlog, instaCount: fInsta, studyCount: fStudy,
      blogInc, instaInc, promoIncentive, payout, hasOverride: !!ov,
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
