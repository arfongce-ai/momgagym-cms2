// sales_ref_payout.test.js
// ════════════════════════════════════════════════════════════════════════
//  기능: 매출 개요(Revenue.jsx) "트레이너별 정산 내역" 카드에 참고용 숫자를
//  추가한다 — "이번 달 신규+재등록 순매출(부가세·카드수수료 제외) × 그 달
//  정산비율". 실제 지급액(payout/settlePayout)에는 절대 가산되지 않는,
//  화면 표시 전용 파생값이다.
//
//  요청 예시 그대로 검증:
//    A트레이너 7월 매출(신규+재등록) 300만원 × 50% = 150만원
//    B트레이너 7월 매출(신규+재등록) 200만원 × 40% =  80만원
//    C트레이너 7월 매출(신규+재등록) 300만원 × 60% = 180만원
//    A+B+C = 410만원
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { computeSessionSettlement, computeSessionSettlementWithExpiry } from '../services/finance';

const settings = {
  withholdingRate: 3.3, promoPerPost: 10000, snsInstaMax: 8,
  lowSplitRate: 40, rate60MinSales: 3000000, rate50MinBlog: 2, rate50MinStudy: 1,
  trainerSplitRates: {},
};
const trainers = [
  { id: 't1', name: 'A트레이너', color: '#f00' },
  { id: 't2', name: 'B트레이너', color: '#0f0' },
  { id: 't3', name: 'C트레이너', color: '#00f' },
];
const records = [];
const ym = '2026-07';

const sched = (memberId, trainerId, days) => days.map((d, i) => ({
  id: `${memberId}-${trainerId}-${i}`, memberId, memberName: '회원', trainerId,
  date: `${ym}-${String(d).padStart(2, '0')}`, startTime: '10:00', endTime: '11:00',
  status: 'attended', isExternal: false, sessionDeducted: true, statusFinalized: true,
}));

// 회원마다 한 트레이너에게 재등록 결제(신규+재등록 매출 집계용) + 그 달 출석 1회(비율 확정용).
const members = [
  { id: 'mA', name: '회원A', isActive: true, trainerSessions: { t1: { total: 10, remaining: 9 } } },
  { id: 'mB', name: '회원B', isActive: true, trainerSessions: { t2: { total: 10, remaining: 9 } } },
  { id: 'mC', name: '회원C', isActive: true, trainerSessions: { t3: { total: 10, remaining: 9 } } },
];
const payments = {
  mA: [{ id: 'pA', amount: 3000000, method: 'transfer', paidAt: `${ym}-05`, trainerIds: ['t1'], isReEnroll: true, reEnrollNo: 2, splitRateAtPay: { t1: 50 } }],
  mB: [{ id: 'pB', amount: 2000000, method: 'transfer', paidAt: `${ym}-05`, trainerIds: ['t2'], isReEnroll: true, reEnrollNo: 2, splitRateAtPay: { t2: 40 } }],
  mC: [{ id: 'pC', amount: 3000000, method: 'transfer', paidAt: `${ym}-05`, trainerIds: ['t3'], isReEnroll: true, reEnrollNo: 2, splitRateAtPay: { t3: 60 } }],
};
const schedules = [
  ...sched('mA', 't1', [10]),
  ...sched('mB', 't2', [10]),
  ...sched('mC', 't3', [10]),
];

const blocks = computeSessionSettlement({
  trainers, members, schedules, payments, records, settings, ym, getOverride: () => null,
});
const byId = Object.fromEntries(blocks.map(b => [b.trainer.id, b]));

describe('신규+재등록 참고 정산액(salesRefPayout) — 요청 예시 그대로', () => {
  it('트레이너별 (신규+재등록 순매출) × 정산비율이 정확히 계산된다', () => {
    expect(byId.t1.newSales + byId.t1.reEnrollSales).toBe(3000000);
    expect(byId.t1.splitRate).toBe(50);
    expect(byId.t1.salesRefPayout).toBe(1500000);

    expect(byId.t2.newSales + byId.t2.reEnrollSales).toBe(2000000);
    expect(byId.t2.splitRate).toBe(40);
    expect(byId.t2.salesRefPayout).toBe(800000);

    expect(byId.t3.newSales + byId.t3.reEnrollSales).toBe(3000000);
    expect(byId.t3.splitRate).toBe(60);
    expect(byId.t3.salesRefPayout).toBe(1800000);
  });

  it('세 트레이너 합계가 410만원과 정확히 일치한다', () => {
    const total = blocks.reduce((s, b) => s + b.salesRefPayout, 0);
    expect(total).toBe(4100000);
  });

  it('참고용 숫자는 실제 지급액(payout)에 전혀 가산되지 않는다(기존 공식 그대로 유지)', () => {
    blocks.forEach(b => {
      expect(b.payout).toBe(b.sessionPayout + b.promoIncentive);
      expect(b.payout).not.toBe(b.salesRefPayout);
    });
  });

  it('computeSessionSettlementWithExpiry로 감싼 결과에도 salesRefPayout이 그대로 전달된다(스프레드 유지)', () => {
    const merged = computeSessionSettlementWithExpiry({
      trainers, members, schedules, payments, records, settings, ym, getOverride: () => null,
    });
    const mById = Object.fromEntries(merged.map(b => [b.trainer.id, b]));
    expect(mById.t1.salesRefPayout).toBe(1500000);
    expect(mById.t2.salesRefPayout).toBe(800000);
    expect(mById.t3.salesRefPayout).toBe(1800000);
  });
});

describe('Revenue.jsx 소스 배선 — 개요 탭이 참고용 숫자를 실제로 표시하는지', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'pages', 'Revenue.jsx'), 'utf8');

  it('트레이너별 누적에 salesRefPayout(및 newSales/reEnrollSales)이 포함된다', () => {
    expect(src).toContain('acc[tid].salesRefPayout += b.salesRefPayout;');
    expect(src).toContain('acc[tid].newSales       += b.newSales;');
    expect(src).toContain('acc[tid].reEnrollSales  += b.reEnrollSales;');
  });

  it('settlePayout(실지급 합계)은 salesRefPayout을 더하지 않는다(별개 파생)', () => {
    expect(src).toContain('const settlePayout = useMemo(()=>trainerBreakdown.reduce((s,b)=>s+b.payout,0)');
    expect(src).not.toContain('s+b.payout+b.salesRefPayout');
  });

  it('카드에 "참고" 라벨과 "지급액 아님" 문구로 명시적으로 구분해 표시한다', () => {
    const cardStart = src.indexOf('트레이너별 정산 내역');
    const cardEnd = src.indexOf('상세 + 담당 트레이너 + 환불', cardStart);
    const card = src.slice(cardStart, cardEnd);
    expect(card).toContain('참고');
    expect(card).toContain('지급액 아님');
    expect(card).toContain('salesRefPayout');
  });
});
