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
// 카드성 결제수단(카드 수수료 부과 대상)
export const CARD_METHODS = ['card', 'card1', 'card2', 'pay'];

export const won = (n) => Math.round(n||0).toLocaleString('ko-KR') + '원';
export const monthKey = (d) => new Date(d).toISOString().slice(0,7);
export const yearKey  = (d) => new Date(d).toISOString().slice(0,4);

// 입금금액 = 결제금액 − 카드수수료 − 부가세
// 카드성 결제만 카드수수료 부과. 부가세는 전체 부과.
export function calcNet(payment, settings) {
  const amount = payment.amount || 0;
  const isCard = CARD_METHODS.includes(payment.method);
  const cardFee = isCard ? amount * (settings.cardFeeRate/100) : 0;
  const vat     = amount * (settings.vatRate/100);
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
    newSales:0, reSales:0, normalSales:0, blogCount:0, studyCount:0,
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
    if (r.channel==='study') acc[r.trainerId].studyCount++;
  });

  Object.values(acc).forEach(r=>{
    const rate = splitRate(r.trainer.id, settings, { net:r.net, blogCount:r.blogCount, studyCount:r.studyCount });
    r.rate = rate;
    r.auto = !(settings.trainerSplitRates?.[r.trainer.id] != null && settings.trainerSplitRates?.[r.trainer.id] !== '');
    r.settle = r.net * (rate/100);
    r.eduSettle = r.eduCenterNet*(settings.eduCenterRate/100) + r.eduExtNet*(settings.eduExternalRate/100);
    const blogInc = r.blogCount * settings.promoPerPost;
    const newInc  = Math.floor(r.newSales / settings.incentivePer) * settings.incentiveAmount;
    const reInc   = Math.floor(r.reSales  / settings.reEnrollPer)  * settings.reEnrollAmount;
    r.promoIncentive = blogInc;
    r.salesIncentive = newInc + reInc;
    r.incentive = blogInc + newInc + reInc;
    r.payout = r.settle + r.eduSettle + r.incentive;
  });

  return Object.values(acc);
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
