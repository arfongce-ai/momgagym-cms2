import { describe, expect, it } from 'vitest';
import {
  buildTrainerLots, lotForConsumedIndex, computeSessionSettlement,
  planConsumedIndexBackfill,
} from '../services/finance.js';

// 근본 수정 검증: 재등록 회차가 비연속으로 등록돼도(8회차 소진 후 9회차 등록)
// 누적 소진 인덱스 기반 매핑으로 회차가 정확히 갈리고, 회차별 박제비율이 유지된다.

const settings = {
  withholdingRate: 3.3, promoPerPost: 10000, snsInstaMax: 8,
  lowSplitRate: 40, rate60MinSales: 3000000, rate50MinBlog: 2, rate50MinStudy: 1,
  trainerSplitRates: {},
};
const trainers = [{ id: 't1', name: '황지영', color: '#f00' }];

const payments8and9 = [
  { id: 'p8', paidAt: '2026-02-06', amount: 600000, method: 'transfer', trainerIds: ['t1'],
    isReEnroll: true, reEnrollNo: 8, splitRateAtPay: { t1: 50 },
    sessionAdds: [{ trainerId: 't1', count: 10 }] },
  { id: 'p9', paidAt: '2026-05-20', amount: 500000, method: 'transfer', trainerIds: ['t1'],
    isReEnroll: true, reEnrollNo: 9, splitRateAtPay: { t1: 40 },
    sessionAdds: [{ trainerId: 't1', count: 10 }] },
];

describe('buildTrainerLots / lotForConsumedIndex — 회차 분리', () => {
  const lots = buildTrainerLots({ payments: payments8and9, trainerId: 't1', settings, trainerRegTotal: 20 });

  it('두 회차가 각각 별도 lot 으로 만들어진다', () => {
    expect(lots.length).toBe(2);
    expect(lots[0].reEnrollNo).toBe(8);
    expect(lots[1].reEnrollNo).toBe(9);
    expect(lots[0].rate).toBe(50);
    expect(lots[1].rate).toBe(40);
  });

  it('누적 소진 인덱스 0~9 → 8회차(50%), 10~19 → 9회차(40%)', () => {
    for (let i = 0; i < 10; i++) expect(lotForConsumedIndex(lots, i).reEnrollNo).toBe(8);
    for (let i = 10; i < 20; i++) expect(lotForConsumedIndex(lots, i).reEnrollNo).toBe(9);
  });
});

// 스케줄 헬퍼: 날짜순으로 출석 수업을 만든다. consumedIndexAtBooking 을 명시(예약 시 기록된 값).
function sched(id, date, consumedIndex) {
  return { id, memberId: 'm1', trainerId: 't1', date, status: 'attended',
    isExternal: false, consumedIndexAtBooking: consumedIndex };
}

describe('computeSessionSettlement — 회차별 정산 + 박제비율 유지', () => {
  // 8회차 10회: 2~4월 소진(idx 0~9). 9회차 10회: 5~6월 소진(idx 10~).
  const schedules = [
    sched('s1', '2026-02-06', 0), sched('s2', '2026-02-13', 1), sched('s3', '2026-02-20', 2),
    sched('s4', '2026-03-06', 3), sched('s5', '2026-03-13', 4), sched('s6', '2026-03-20', 5),
    sched('s7', '2026-04-03', 6), sched('s8', '2026-04-10', 7), sched('s9', '2026-04-17', 8),
    sched('s10', '2026-04-24', 9),                 // 8회차 마지막(10번째)
    sched('s11', '2026-05-01', 10), sched('s12', '2026-05-08', 11), sched('s13', '2026-05-15', 12),
    sched('s14', '2026-05-29', 13),                // 5월 9회차 4회
    sched('s15', '2026-06-05', 14),
  ];
  const members = [{ id: 'm1', name: '한도현', isActive: true,
    trainerSessions: { t1: { total: 20, remaining: 5 } } }];
  const payments = { m1: payments8and9 };

  const rowFor = (ym) => {
    const blocks = computeSessionSettlement({
      trainers, members, schedules, payments, records: [], settings, ym, getOverride: () => null,
    });
    return blocks[0].rows.find(r => r.memberId === 'm1');
  };

  it('5월: 9회차 4회가 40%로 잡힌다(8회차와 안 섞임)', () => {
    const r = rowFor('2026-05');
    expect(r.autoCnt).toBe(4);
    // 5월 소진분(idx 10~13)은 전부 9회차 → breakdown 은 9회차 하나
    const nine = r.settlementBreakdown.filter(b => b.reEnrollNo === 9);
    expect(nine.reduce((s, b) => s + b.count, 0)).toBe(4);
    expect(r.settlementBreakdown.every(b => b.rate === 40)).toBe(true);
  });

  it('3월: 8회차 3회가 50%로 잡힌다', () => {
    const r = rowFor('2026-03');
    expect(r.autoCnt).toBe(3);
    expect(r.settlementBreakdown.every(b => b.reEnrollNo === 8 && b.rate === 50)).toBe(true);
  });

  it('4월: 8회차 4회가 50%로 유지(새로고침해도 splitRateAtPay 로 고정)', () => {
    const r = rowFor('2026-04');
    expect(r.autoCnt).toBe(4);
    expect(r.rate).toBe(50);
  });

  it('consumedIndexAtBooking 이 없어도 날짜순 폴백으로 동일하게 갈린다', () => {
    const legacySched = schedules.map(({ consumedIndexAtBooking, ...rest }) => rest); // 스탬프 제거
    const blocks = computeSessionSettlement({
      trainers, members, schedules: legacySched, payments, records: [], settings, ym: '2026-05',
      getOverride: () => null,
    });
    const r = blocks[0].rows.find(x => x.memberId === 'm1');
    expect(r.autoCnt).toBe(4);
    expect(r.settlementBreakdown.every(b => b.rate === 40)).toBe(true);
  });
});

describe('planConsumedIndexBackfill — 과거 데이터 회차 인덱스 소급 정리', () => {
  it('잘못된 sessionAtBooking(리셋값)을 무시하고 날짜순 누적 인덱스로 바로잡는다', () => {
    // 8회차 수업 sessionAtBooking=10..1, 9회차도 10..1 로 겹쳐 저장된 과거 데이터
    const bad = [
      { id: 'a1', memberId: 'm1', trainerId: 't1', date: '2026-02-06', status: 'attended', sessionAtBooking: 10 },
      { id: 'a2', memberId: 'm1', trainerId: 't1', date: '2026-03-06', status: 'attended', sessionAtBooking: 9 },
      { id: 'b1', memberId: 'm1', trainerId: 't1', date: '2026-05-29', status: 'attended', sessionAtBooking: 10 },
      { id: 'b2', memberId: 'm1', trainerId: 't1', date: '2026-06-05', status: 'attended', sessionAtBooking: 9 },
    ];
    const members = [{ id: 'm1', trainerSessions: { t1: { total: 20, remaining: 16 } } }];
    const patches = planConsumedIndexBackfill({ members, schedules: bad });
    // 소진 4건 → 인덱스 0,1,2,3 (날짜순)
    const byId = Object.fromEntries(patches.map(p => [p.id, p.consumedIndexAtBooking]));
    expect(byId.a1).toBe(0);
    expect(byId.a2).toBe(1);
    expect(byId.b1).toBe(2);
    expect(byId.b2).toBe(3);
  });
});

describe('한도현 실제 시나리오 — sessionAtBooking 리셋값 + 회차정리', () => {
  const settings2 = {
    withholdingRate: 3.3, promoPerPost: 10000, snsInstaMax: 8,
    lowSplitRate: 40, rate60MinSales: 3000000, rate50MinBlog: 2, rate50MinStudy: 1, trainerSplitRates: {},
  };
  const sc = (id, date, at) => ({ id, memberId: 'm1', trainerId: 't1', date, status: 'attended',
    isExternal: false, ...(at != null ? { sessionAtBooking: at } : {}) });
  // 8회차 10세션(remaining 10..1) → 9회차 10세션(remaining 리셋 10,9). sessionAtBooking 겹침.
  const eight = [
    sc('e10', '2026-02-06', 10), sc('e9', '2026-02-13', 9), sc('e8', '2026-02-20', 8),
    sc('e7', '2026-03-06', 7), sc('e6', '2026-03-13', 6), sc('e5', '2026-03-20', 5),
    sc('e4', '2026-04-11', 4), sc('e3', '2026-05-01', 3), sc('e2', '2026-05-08', 2), sc('e1', '2026-05-15', 1),
  ];
  const nine = [sc('n10', '2026-05-29', 10), sc('n9', '2026-06-05', 9)];
  const schedules = [...eight, ...nine];
  const members = [{ id: 'm1', name: '한도현', isActive: true, trainerSessions: { t1: { total: 20, remaining: 8 } } }];
  const payments = { m1: [
    { id: 'p8', paidAt: '2026-02-06', amount: 600000, method: 'transfer', trainerIds: ['t1'],
      isReEnroll: true, reEnrollNo: 8, splitRateAtPay: { t1: 50 }, sessionAdds: [{ trainerId: 't1', count: 10 }] },
    { id: 'p9', paidAt: '2026-05-20', amount: 500000, method: 'transfer', trainerIds: ['t1'],
      isReEnroll: true, reEnrollNo: 9, splitRateAtPay: { t1: 40 }, sessionAdds: [{ trainerId: 't1', count: 10 }] },
  ] };

  it('회차정리(backfill) 후 5월이 8회차 3회(50%) + 9회차 1회(40%)로 갈린다', () => {
    const patches = planConsumedIndexBackfill({ members, schedules });
    const map = Object.fromEntries(patches.map(p => [p.id, p.consumedIndexAtBooking]));
    const fixed = schedules.map(s => map[s.id] != null ? { ...s, consumedIndexAtBooking: map[s.id] } : s);
    const b = computeSessionSettlement({ trainers, members, schedules: fixed, payments,
      records: [], settings: settings2, ym: '2026-05', getOverride: () => null });
    const r = b[0].rows.find(x => x.memberId === 'm1');
    expect(r.autoCnt).toBe(4);
    const eightPart = r.settlementBreakdown.find(x => x.reEnrollNo === 8);
    const ninePart = r.settlementBreakdown.find(x => x.reEnrollNo === 9);
    expect(eightPart.count).toBe(3);
    expect(eightPart.rate).toBe(50);
    expect(ninePart.count).toBe(1);
    expect(ninePart.rate).toBe(40);
  });
});

describe('sessionStartDate — 결제일과 세션 소진 순서 분리', () => {
  const settings3 = {
    withholdingRate: 3.3, promoPerPost: 10000, snsInstaMax: 8,
    lowSplitRate: 40, rate60MinSales: 3000000, rate50MinBlog: 2, rate50MinStudy: 1, trainerSplitRates: {},
  };
  const s3 = (id, date) => ({ id, memberId: 'm1', trainerId: 't1', date, status: 'attended', isExternal: false });
  const schedules = [
    s3('e10', '2026-02-06'), s3('e9', '2026-02-13'), s3('e8', '2026-02-20'), s3('e7', '2026-03-06'),
    s3('e6', '2026-03-13'), s3('e5', '2026-03-20'), s3('e4', '2026-04-11'),
    s3('e3', '2026-05-01'), s3('e2', '2026-05-08'), s3('e1', '2026-05-15'),
    s3('n10', '2026-05-29'), s3('n9', '2026-06-05'),
  ];
  const members = [{ id: 'm1', name: '한도현', isActive: true, trainerSessions: { t1: { total: 20, remaining: 8 } } }];
  // 9회차 결제일은 6/5(매출 6월)지만 세션 시작은 5/20
  const payments = { m1: [
    { id: 'p8', paidAt: '2026-02-06', amount: 600000, method: 'transfer', trainerIds: ['t1'],
      isReEnroll: true, reEnrollNo: 8, splitRateAtPay: { t1: 50 }, sessionAdds: [{ trainerId: 't1', count: 10 }] },
    { id: 'p9', paidAt: '2026-06-05', sessionStartDate: '2026-05-20', amount: 600000, method: 'transfer',
      trainerIds: ['t1'], isReEnroll: true, reEnrollNo: 9, splitRateAtPay: { t1: 40 },
      sessionAdds: [{ trainerId: 't1', count: 10 }] },
  ] };

  it('5월: 8회차 3회(50%) + 9회차 1회(40%)로 갈린다 (결제 6월이어도)', () => {
    const patches = planConsumedIndexBackfill({ members, schedules });
    const map = Object.fromEntries(patches.map(p => [p.id, p.consumedIndexAtBooking]));
    const fixed = schedules.map(s => map[s.id] != null ? { ...s, consumedIndexAtBooking: map[s.id] } : s);
    const b = computeSessionSettlement({ trainers, members, schedules: fixed, payments,
      records: [], settings: settings3, ym: '2026-05', getOverride: () => null });
    const r = b[0].rows.find(x => x.memberId === 'm1');
    expect(r.settlementBreakdown.find(x => x.reEnrollNo === 8)?.count).toBe(3);
    expect(r.settlementBreakdown.find(x => x.reEnrollNo === 8)?.rate).toBe(50);
    expect(r.settlementBreakdown.find(x => x.reEnrollNo === 9)?.count).toBe(1);
    expect(r.settlementBreakdown.find(x => x.reEnrollNo === 9)?.rate).toBe(40);
  });

  it('sessionStartDate 없어도 8회차가 10회로 차면 11번째 소진은 9회차', () => {
    const p2 = { m1: payments.m1.map(p => { const { sessionStartDate, ...rest } = p; return rest; }) };
    const patches = planConsumedIndexBackfill({ members, schedules });
    const map = Object.fromEntries(patches.map(p => [p.id, p.consumedIndexAtBooking]));
    const fixed = schedules.map(s => map[s.id] != null ? { ...s, consumedIndexAtBooking: map[s.id] } : s);
    const b = computeSessionSettlement({ trainers, members, schedules: fixed, payments: p2,
      records: [], settings: settings3, ym: '2026-05', getOverride: () => null });
    const r = b[0].rows.find(x => x.memberId === 'm1');
    // 8회차는 10회로 가득 → 11번째(5/29, idx10)는 9회차로 넘어감. sessionStartDate 유무와 무관.
    expect(r.settlementBreakdown.find(x => x.reEnrollNo === 8)?.count).toBe(3);
    expect(r.settlementBreakdown.find(x => x.reEnrollNo === 9)?.count).toBe(1);
  });
});
