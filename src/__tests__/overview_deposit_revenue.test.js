// overview_deposit_revenue.test.js
// ════════════════════════════════════════════════════════════════════════
//  기능(2026-09-16): 매출 개요(OverviewTab)의 "선생님별 월 매출(입금매출 기준)".
//
//  배경 — 그 전까지 개요에 있던 "트레이너별 정산 내역"은 세션 소진(그 달 출석)
//  기준이라, 이번 달 결제가 하나도 없는 트레이너도 과거 결제분을 이번 달에
//  소진했으면 매출이 잡혀 목록에 나왔다(실사례: 9월 결제가 없는 정주인·김현진·
//  김현우가 9월 개요에 노출). 대표님 기준은 "그 달 매출(입금)이 없으면 개요에
//  보이면 안 된다"였으므로,
//    · finance.js computeMonthRates()가 트레이너별 depositRevenue(그 달 결제
//      기준 순매출)를 함께 반환하고,
//    · 개요는 depositRevenue > 0 인 트레이너만 "입금매출 × 확정% = 지급액"으로
//      표시하도록 바꿨다(세션 소진 기준 상세는 "정산" 탭에 그대로 남아 있다).
//
//  이 테스트가 지키는 것:
//   1) depositRevenue는 그 달 결제(paidAt)만 본다 — 지난달 결제 + 이번 달 출석인
//      트레이너는 0원이어야 한다(= 개요에서 사라져야 한다).
//   2) 트레이너별 depositRevenue 합 = 그 달 순매출 합(개요 상단 "입금금액"과 일치).
//   3) 결제총액이 아니라 공제 후 순매출(calcNet)이다.
//   4) 한 결제에 트레이너가 여럿이면 지분대로 나뉜다.
//   5) Revenue.jsx가 실제로 그렇게 배선돼 있다(0원 트레이너 필터 + 옛 카드 제거).
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { computeMonthRates, computeSessionSettlementWithExpiry, calcNet } from '../services/finance';

const settings = {
  withholdingRate: 3.3, promoPerPost: 10000, snsInstaMax: 8,
  lowSplitRate: 40, rate60MinSales: 3000000, rate50MinBlog: 2, rate50MinStudy: 1,
  trainerSplitRates: {}, vatRate: 10, cardFeeRate: 0.8,
};
const trainers = [
  { id: 't1', name: '결제있는트레이너', color: '#f00' },
  { id: 't2', name: '결제없는트레이너', color: '#0f0' },  // 정주인 케이스
  { id: 't3', name: '공동담당트레이너', color: '#00f' },
];
const records = [];
const ym = '2026-09';

const sched = (memberId, trainerId, days) => days.map((d, i) => ({
  id: `${memberId}-${trainerId}-${i}`, memberId, memberName: '회원', trainerId,
  date: `${ym}-${String(d).padStart(2, '0')}`, startTime: '10:00', endTime: '11:00',
  status: 'attended', isExternal: false, sessionDeducted: true, statusFinalized: true,
}));

const members = [
  { id: 'm1', name: '회원1', isActive: true, trainerSessions: { t1: { total: 10, remaining: 8 } } },
  // m2: 결제는 지난달(8월), 수업만 이번 달(9월) — 정주인 케이스
  { id: 'm2', name: '회원2', isActive: true, trainerSessions: { t2: { total: 10, remaining: 7 } } },
  // m3: 이번 달 결제 1건을 t1·t3 두 명이 공동 담당
  { id: 'm3', name: '회원3', isActive: true, trainerSessions: { t1: { total: 5, remaining: 4 }, t3: { total: 5, remaining: 4 } } },
];
const payments = {
  m1: [{ id: 'p1', amount: 600000, method: 'account', paidAt: '2026-09-05', trainerIds: ['t1'], splitRateAtPay: { t1: 50 } }],
  m2: [{ id: 'p2', amount: 400000, method: 'account', paidAt: '2026-08-05', trainerIds: ['t2'], splitRateAtPay: { t2: 50 } }],
  m3: [{ id: 'p3', amount: 1000000, method: 'card1', paidAt: '2026-09-10', trainerIds: ['t1', 't3'], splitRateAtPay: { t1: 50, t3: 50 } }],
};
const schedules = [
  ...sched('m1', 't1', [10, 11]),
  ...sched('m2', 't2', [12, 13, 14]),   // 지난달 결제분을 이번 달에 소진
  ...sched('m3', 't1', [15]),
  ...sched('m3', 't3', [16]),
];

const rates = computeMonthRates({ trainers, members, payments, records, settings, ym });

describe('선생님별 월 매출(입금매출) — computeMonthRates().depositRevenue', () => {
  it('이번 달 결제가 없는 트레이너는 0원이다(지난달 결제 + 이번 달 출석이어도)', () => {
    expect(rates.t2.depositRevenue).toBe(0);
  });

  it('반면 세션 소진 기준(정산 탭 방식)으로는 같은 트레이너에게 매출이 잡힌다 — 두 기준의 차이가 바로 이 화면 변경의 이유', () => {
    const blocks = computeSessionSettlementWithExpiry({
      trainers, members, schedules, payments, records, settings, ym, getOverride: () => null,
    });
    const t2Block = blocks.find(b => b.trainer.id === 't2');
    expect(t2Block.sessionTotal).toBeGreaterThan(0);   // 세션 소진 기준: 매출 있음
    expect(rates.t2.depositRevenue).toBe(0);           // 입금 기준: 매출 없음 → 개요에서 숨김
  });

  it('이번 달 결제가 있는 트레이너는 그 결제의 순매출이 잡힌다(결제총액 아님)', () => {
    // p1: 계좌 60만 → 공제 없음 / p3: 카드 100만의 t1 지분 1/2 = 50만의 순매출
    const p3Net = calcNet(payments.m3[0], settings).net;   // 100만 − 부가세 10% − 카드수수료 0.8%
    expect(p3Net).toBeLessThan(1000000);
    expect(rates.t1.depositRevenue).toBe(Math.round(600000 + p3Net / 2));
  });

  it('한 결제에 트레이너가 여럿이면 지분대로 나뉜다(중복 계상 없음)', () => {
    const p3Net = calcNet(payments.m3[0], settings).net;
    expect(rates.t3.depositRevenue).toBe(Math.round(p3Net / 2));
  });

  it('트레이너별 입금매출 합계 = 그 달 전체 순매출(개요 상단 "입금금액"과 일치)', () => {
    const monthNetTotal = Object.values(payments)
      .flat()
      .filter(p => p.paidAt.slice(0, 7) === ym)
      .reduce((s, p) => s + calcNet(p, settings).net, 0);
    const sumByTrainer = trainers.reduce((s, t) => s + (rates[t.id].depositRevenue || 0), 0);
    expect(sumByTrainer).toBe(Math.round(monthNetTotal));
  });

  it('확정 정산비율(40/50/60%)은 그대로 함께 반환된다 — 화면의 "입금매출 × 확정%"에 쓰인다', () => {
    trainers.forEach(t => {
      expect([40, 50, 60]).toContain(rates[t.id].rate);
    });
  });
});

describe('Revenue.jsx 소스 배선 — 개요 탭이 입금매출 기준으로 표시하는지', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'pages', 'Revenue.jsx'), 'utf8');

  it('입금매출이 0원인 트레이너는 목록에서 제외된다', () => {
    expect(src).toContain('const depositBreakdown = useMemo(');
    expect(src).toContain('.filter(d => (d.depositRevenue||0) > 0)');
  });

  it('카드는 특정 월을 선택했을 때만, 표시할 트레이너가 있을 때만 노출된다', () => {
    expect(src).toContain('{isMonth && depositBreakdown.length > 0 && (');
  });

  it('트레이너별로 "입금매출 × 확정%" 와 합계를 표시한다', () => {
    expect(src).toContain('입금매출 {won(d.depositRevenue)} × {d.rate}%');
    expect(src).toContain('{won(depositRevenueTotal)}');
    expect(src).toContain('{won(depositPayoutTotal)}');
  });

  it('세션 소진 기준 "트레이너별 정산 내역" 카드는 개요에서 제거됐다(정산 탭에만 남김)', () => {
    expect(src).not.toContain('{isMonth && trainerBreakdown.length > 0 && (');
    expect(src).not.toContain('>트레이너별 정산 내역</h2>');
  });

  it('손익 요약의 "트레이너 정산"·순익은 종전대로 실지급액(settlePayout) 기준을 유지한다', () => {
    expect(src).toContain('const settlePayout = useMemo(()=>trainerBreakdown.reduce((s,b)=>s+b.payout,0)');
    expect(src).toContain('const netProfit = totals.net - settlePayout - totalExpense;');
  });
});
