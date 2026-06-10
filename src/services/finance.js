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

// 트레이너별 정산 비율(%) — 수동 지정이 있으면 우선, 없으면 조건 자동판정
// 계약서 4조: 기본 40%(팀원)/50%(팀장) → 조건 충족 시 승급
//  · 50%: 블로그 월2회 + 스터디 월1회 이상
//  · 60%: 월 매출(입금금액) 300만원 이상
export function autoRate(stats, settings) {
  // stats: { net, blogCount, studyCount }
  if ((stats.net||0) >= (settings.rate60MinSales ?? 3000000)) return 60;
  if ((stats.blogCount||0) >= (settings.rate50MinBlog ?? 2) &&
      (stats.studyCount||0) >= (settings.rate50MinStudy ?? 1)) return 50;
  return 40;
}

// 최종 적용 비율: 수동 지정(설정) 우선 → 없으면 자동판정
export function splitRate(trainerId, settings, stats) {
  const manual = settings.trainerSplitRates?.[trainerId];
  if (manual !== undefined && manual !== null && manual !== '') return manual;
  if (stats) return autoRate(stats, settings);
  return settings.defaultSplitRate ?? 50;
}

// 결제 1건의 입금금액을 담당 트레이너에게 1/n 귀속
// returns { [trainerId]: { net } }  (정산금은 비율 확정 후 계산)
export function attributePayment(payment, settings) {
  const { net } = calcNet(payment, settings);
  const ids = payment.trainerIds && payment.trainerIds.length ? payment.trainerIds : [];
  if (!ids.length) return {};
  const per = net / ids.length;
  const out = {};
  ids.forEach(tid => { out[tid] = { net: per }; });
  return out;
}

// 트레이너별 정산 집계 (개요·정산 탭 공통)
// payments: 평탄화된 결제, records: 블로그/스터디 기록, inPeriod: (dateStr)=>bool
export function computeSettlement(payments, records, trainers, settings, inPeriod) {
  const acc = {};
  trainers.forEach(t=>{ acc[t.id] = {
    trainer:t, net:0, eduCenterNet:0, eduExtNet:0,
    newSales:0, reSales:0, normalSales:0, blogCount:0, instaCount:0, studyCount:0,
  };});

  payments.filter(p=>!p.isUnpaid && !p.isRefunded && inPeriod(p.paidAt)).forEach(p=>{
    const attr = attributePayment(p, settings);
    Object.entries(attr).forEach(([tid,{net}])=>{
      if (!acc[tid]) return;
      const cat = p.category||'normal';
      if (cat==='edu_center')        acc[tid].eduCenterNet += net;
      else if (cat==='edu_external') acc[tid].eduExtNet += net;
      else {
        acc[tid].net += net;
        if (p.isNew)            acc[tid].newSales += net;
        else if (p.isReEnroll)  acc[tid].reSales += net;
        else                    acc[tid].normalSales += net;
      }
    });
  });

  (records||[]).filter(r=>inPeriod(r.date)).forEach(r=>{
    if (!acc[r.trainerId]) return;
    if (r.channel==='blog')  acc[r.trainerId].blogCount++;
    if (r.channel==='insta') acc[r.trainerId].instaCount++;
    if (r.channel==='study') acc[r.trainerId].studyCount++;
  });

  Object.values(acc).forEach(r=>{
    const rate = splitRate(r.trainer.id, settings, { net:r.net, blogCount:r.blogCount, studyCount:r.studyCount });
    r.rate = rate;
    r.auto = !(settings.trainerSplitRates?.[r.trainer.id] != null && settings.trainerSplitRates?.[r.trainer.id] !== '');
    r.settle = r.net * (rate/100);
    r.eduSettle = r.eduCenterNet*(settings.eduCenterRate/100) + r.eduExtNet*(settings.eduExternalRate/100);
    // SNS 인센티브
    //  · 블로그: 1회차부터 전부 지급(상한 없음)
    //  · 인스타: 최대 8회까지 지급
    const instaMax  = settings.snsInstaMax ?? 8;
    const blogInc   = r.blogCount * settings.promoPerPost;
    const instaInc  = Math.min(r.instaCount, instaMax) * settings.promoPerPost;
    const newInc    = Math.floor(r.newSales / settings.incentivePer) * settings.incentiveAmount;
    const reInc     = Math.floor(r.reSales  / settings.reEnrollPer)  * settings.reEnrollAmount;
    r.blogIncentive  = blogInc;
    r.instaIncentive = instaInc;
    r.promoIncentive = blogInc + instaInc;
    r.salesIncentive = newInc + reInc;
    r.incentive = r.promoIncentive + r.salesIncentive;
    r.payout = r.settle + r.eduSettle + r.incentive;
  });

  return Object.values(acc);
}

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
