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
export function calcNet(payment, settings) {
  const amount = payment.amount || 0;
  const m = payment.method;
  const isCard = CARD_METHODS.includes(m);
  const isVatOnly = VAT_ONLY_METHODS.includes(m);
  const cardFee = isCard ? amount * (settings.cardFeeRate/100) : 0;
  const vat     = (isCard || isVatOnly) ? amount * (settings.vatRate/100) : 0;
  const net     = amount - cardFee - vat;
  return { amount, cardFee, vat, net };
}

// ── 트레이너별 정산은 회당단가×횟수 방식 한 가지로 일원화함.
//    (옛 비율기반 정산 함수들은 제거)

// ── 회당 단가 × 월 수업횟수 기반 정산 (실제 시트 방식) ──────────────
export function computeSessionSettlement({ trainers, members, schedules, payments, records, settings, ym, getOverride }) {
  const inMonth = (d) => d && d.slice(0,7) === ym;
  const memberMap = Object.fromEntries(members.map(m=>[m.id, m]));

  // 회원×트레이너별 귀속 결제액 (단가 트레이너별 분리 계산용)
  //  · 결제수단별 공제(부가세/카드수수료) 적용한 입금금액 기준
  //  · 결제에 담당 트레이너(trainerIds)가 있으면 그 트레이너들에게 1/n 귀속
  //  · trainerIds가 없는 구버전 결제는 회원의 트레이너별 등록횟수 비율로 안분
  const memberTrainerPay = {}; // mid -> { tid: netAmount }
  members.forEach(m => {
    const ts = m.trainerSessions || {};
    const tids = Object.keys(ts);
    const totalReg = Object.values(ts).reduce((s,v)=>s+(v.total||0),0);
    const acc = {};
    tids.forEach(tid => acc[tid] = 0);
    (payments[m.id]||[]).filter(p=>!p.isUnpaid && !p.isRefunded).forEach(p=>{
      const amt = calcNet(p, settings).net; // 카드1·2: 부가세+카드세 / 페이·현금영수증: 부가세 / 계좌·현금: 공제 없음
      const pTids = (p.trainerIds && p.trainerIds.length) ? p.trainerIds : null;
      if (pTids) {
        const per = amt / pTids.length;
        pTids.forEach(tid => { acc[tid] = (acc[tid]||0) + per; });
      } else if (totalReg > 0) {
        // 담당 트레이너 미지정 → 등록횟수 비율로 안분
        tids.forEach(tid => { acc[tid] = (acc[tid]||0) + amt * ((ts[tid].total||0)/totalReg); });
      } else if (tids.length) {
        // 등록횟수 정보도 없으면 균등 분배
        const per = amt / tids.length;
        tids.forEach(tid => { acc[tid] = (acc[tid]||0) + per; });
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

    let blogCount=0, instaCount=0;
    (records||[]).filter(r=>r.trainerId===t.id && inMonth(r.date)).forEach(r=>{
      if (r.channel==='blog') blogCount++;
      if (r.channel==='insta') instaCount++;
    });
    const fBlog = ov?.blogCount ?? blogCount;
    const fInsta = ov?.instaCount ?? instaCount;
    const blogInc  = fBlog * settings.promoPerPost;
    const instaInc = Math.min(fInsta, settings.snsInstaMax ?? 8) * settings.promoPerPost;
    const promoIncentive = blogInc + instaInc;
    const payout = sessionTotal + promoIncentive;

    return {
      trainer: t, rows, sessionTotal,
      blogCount: fBlog, instaCount: fInsta,
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
