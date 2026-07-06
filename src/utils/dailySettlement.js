// dailySettlement.js — 특정 날짜의 입금·등록 정산 요약(순수 함수)
//  · 홈 화면의 "전날 정산내역" 카드에서 사용.
//  · 정산 로직(services/finance.js)과 동일한 분류 규칙을 따른다:
//     - 미수금(isUnpaid)·환불(isRefunded)은 합산에서 제외 → 실제 정산 반영분만.
//     - isReEnroll → 재등록 / isNew → 신규 / 그 외 → 일반등록.
//  · '입금액'은 실제 입금 총액(p.amount) 기준(측정 정직성: 추정·환불분 미포함).
//
// 입력:
//   members : [{ id, name }]
//   getPayments : (memberId) => [{ id, paidAt, amount, method, note, isNew, isReEnroll, reEnrollNo, isUnpaid, isRefunded }]
//   ymd : 'YYYY-MM-DD' — 집계 대상 날짜(보통 전날)
export function summarizeDailySettlement(members, getPayments, ymd) {
  let newCnt = 0, reCnt = 0, etcCnt = 0;
  let newAmt = 0, reAmt = 0, etcAmt = 0;
  const methodAmt = {};
  const rows = [];

  (members || []).forEach(m => {
    (getPayments(m.id) || []).forEach(p => {
      if (p.isUnpaid || p.isRefunded) return;
      if ((p.paidAt || '').slice(0, 10) !== ymd) return;
      const amt = Number(p.amount) || 0;
      const kind = p.isReEnroll ? 're' : p.isNew ? 'new' : 'etc';
      if (kind === 'new') { newCnt++; newAmt += amt; }
      else if (kind === 're') { reCnt++; reAmt += amt; }
      else { etcCnt++; etcAmt += amt; }
      const mk = p.method || 'etc';
      methodAmt[mk] = (methodAmt[mk] || 0) + amt;
      rows.push({
        id: p.id, name: m.name, amount: amt, method: mk, note: p.note || '',
        kind,
        label: kind === 're' ? (p.reEnrollNo ? `재등록 ${p.reEnrollNo}회차` : '재등록')
          : kind === 'new' ? '신규' : '등록',
      });
    });
  });

  return {
    ymd,
    newCnt, reCnt, etcCnt,
    newAmt, reAmt, etcAmt,
    total: newAmt + reAmt + etcAmt,
    count: newCnt + reCnt + etcCnt,
    methodAmt,
    rows: rows.sort((a, b) => b.amount - a.amount),
  };
}
