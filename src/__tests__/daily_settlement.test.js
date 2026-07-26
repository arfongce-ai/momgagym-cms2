// daily_settlement.test.js — 홈 "전날 정산내역" 집계 로직 회귀 보호
//  · 신규/재등록/일반 분류, 미수금·환불 제외, 입금액 합계·결제수단 집계를 검증.
import { describe, it, expect } from 'vitest';
import { summarizeDailySettlement, yesterdayPopupSeenKey, settlementOneLine } from '../utils/dailySettlement';

const YMD = '2026-07-05';

const members = [
  { id: 'm1', name: '김회원' },
  { id: 'm2', name: '이회원' },
  { id: 'm3', name: '박회원' },
];

const payMap = {
  m1: [
    { id: 'p1', paidAt: YMD, amount: 500000, method: 'card1', isNew: true, note: 'PT 20회' },
    { id: 'p2', paidAt: '2026-07-04', amount: 999999, method: 'cash', isNew: true }, // 다른 날 → 제외
  ],
  m2: [
    { id: 'p3', paidAt: YMD + 'T13:20:00', amount: 450000, method: 'transfer', isReEnroll: true, reEnrollNo: 2, note: '재등록' },
    { id: 'p4', paidAt: YMD, amount: 360000, method: 'card2', isUnpaid: true }, // 미수금 → 제외
  ],
  m3: [
    { id: 'p5', paidAt: YMD, amount: 300000, method: 'cash', note: '일반 등록' }, // 신규/재등록 플래그 없음 → etc
    { id: 'p6', paidAt: YMD, amount: 200000, method: 'card1', isNew: true, isRefunded: true }, // 환불 → 제외
  ],
};
const getPayments = (mid) => payMap[mid] || [];

describe('summarizeDailySettlement — 전날 정산 요약', () => {
  const s = summarizeDailySettlement(members, getPayments, YMD);

  it('신규등록은 당일·미환불 건만 집계한다', () => {
    expect(s.newCnt).toBe(1);          // p1만(p6는 환불, p2는 전날)
    expect(s.newAmt).toBe(500000);
  });

  it('재등록은 건수·금액·회차 라벨을 정확히 집계한다', () => {
    expect(s.reCnt).toBe(1);
    expect(s.reAmt).toBe(450000);
    const re = s.rows.find(r => r.id === 'p3');
    expect(re.kind).toBe('re');
    expect(re.label).toBe('재등록 2회차');
  });

  it('플래그 없는 결제는 일반등록(etc)으로 분류한다', () => {
    expect(s.etcCnt).toBe(1);
    expect(s.etcAmt).toBe(300000);
    expect(s.rows.find(r => r.id === 'p5').label).toBe('등록');
  });

  it('미수금·환불·다른 날짜 결제는 입금액 합계에서 제외한다', () => {
    // 500000 + 450000 + 300000 = 1250000 (p2 전날, p4 미수금, p6 환불 제외)
    expect(s.total).toBe(1250000);
    expect(s.count).toBe(3);
    expect(s.rows.some(r => ['p2', 'p4', 'p6'].includes(r.id))).toBe(false);
  });

  it('결제수단별 합계를 집계한다', () => {
    expect(s.methodAmt.card1).toBe(500000);
    expect(s.methodAmt.transfer).toBe(450000);
    expect(s.methodAmt.cash).toBe(300000);
    expect(s.methodAmt.card2).toBeUndefined(); // 미수금 건 제외
  });

  it('상세 행은 금액 내림차순으로 정렬한다', () => {
    expect(s.rows.map(r => r.amount)).toEqual([500000, 450000, 300000]);
  });

  it('내역이 없는 날짜는 빈 요약을 반환한다', () => {
    const empty = summarizeDailySettlement(members, getPayments, '2020-01-01');
    expect(empty.count).toBe(0);
    expect(empty.total).toBe(0);
    expect(empty.rows).toEqual([]);
  });
});

describe('yesterdayPopupSeenKey — 홈 팝업 하루 한 번 키', () => {
  it('계정·날짜별로 고유한 키를 만든다', () => {
    expect(yesterdayPopupSeenKey('u1', '2026-07-08')).toBe('fitcms_yesterday_settle_seen_u1_2026-07-08');
    expect(yesterdayPopupSeenKey('u1', '2026-07-08')).not.toBe(yesterdayPopupSeenKey('u2', '2026-07-08'));
    expect(yesterdayPopupSeenKey('u1', '2026-07-08')).not.toBe(yesterdayPopupSeenKey('u1', '2026-07-09'));
  });

  it('아이디·날짜가 없으면 null을 반환한다(저장 생략)', () => {
    expect(yesterdayPopupSeenKey(null, '2026-07-08')).toBeNull();
    expect(yesterdayPopupSeenKey('u1', '')).toBeNull();
  });
});

describe('settlementOneLine — 홈 카드 한 줄 요약', () => {
  const s = summarizeDailySettlement(members, getPayments, YMD);

  it('신규·재등록·일반 건수와 총액을 한 줄로 정리한다', () => {
    expect(settlementOneLine(s)).toBe('신규 1건 · 재등록 1건 · 등록 1건 · 총 1,250,000원');
  });

  it('없는 분류는 생략한다', () => {
    const only = summarizeDailySettlement([members[0]], getPayments, YMD);
    expect(settlementOneLine(only)).toBe('신규 1건 · 총 500,000원');
  });

  it('내역이 없으면 null을 반환한다(빈 상태 문구는 호출부 처리)', () => {
    const empty = summarizeDailySettlement(members, getPayments, '2020-01-01');
    expect(settlementOneLine(empty)).toBeNull();
    expect(settlementOneLine(null)).toBeNull();
  });
});
