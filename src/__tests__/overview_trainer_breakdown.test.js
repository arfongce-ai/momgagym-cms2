// overview_trainer_breakdown.test.js
// ════════════════════════════════════════════════════════════════════════
//  기능: 매출 개요(OverviewTab)의 "트레이너 정산" 총액을 트레이너별로
//  분해해서 검증 가능하게 보여준다 (요청 예시: "A트레이너 매출 300만원
//  × 50% = 150만원 ... A+B+C = 410만원").
//
//  OverviewTab은 정산 탭과 동일한 computeSessionSettlementWithExpiry를
//  월별로 호출해 트레이너 id 기준으로 누적한다(연/전체 기간은 여러 달을
//  각각 계산해 합산해야 하므로). 이 테스트는 그 누적 알고리즘이
//  1) 같은 트레이너의 여러 달 실적을 정확히 합산하고(덮어쓰기 없음),
//  2) 트레이너가 없는 달엔 다른 트레이너 집계에 영향을 주지 않으며,
//  3) 트레이너별 합의 총합이 기존 방식(월별 전체 합을 그대로 더한 값)과
//     정확히 같음을 finance.js의 실제 함수로 재현해 확인한다.
//  (Revenue.jsx는 React 컴포넌트라 렌더 테스트 인프라가 없으므로, 여기서는
//  OverviewTab 내부와 동일한 누적 로직을 재현해 수치를 검증하고, 아래
//  두 번째 describe에서 그 로직이 실제로 소스에 반영됐는지 확인한다.)
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { computeSessionSettlementWithExpiry } from '../services/finance';

const settings = {
  withholdingRate: 3.3, promoPerPost: 10000, snsInstaMax: 8,
  lowSplitRate: 40, rate60MinSales: 3000000, rate50MinBlog: 2, rate50MinStudy: 1,
  trainerSplitRates: {},
};
const trainers = [
  { id: 't1', name: '트레이너1', color: '#f00' },
  { id: 't2', name: '트레이너2', color: '#0f0' },
];
const records = [];

const sched = (memberId, trainerId, ym, days) => days.map((d, i) => ({
  id: `${memberId}-${trainerId}-${ym}-${i}`, memberId, memberName: '회원', trainerId,
  date: `${ym}-${String(d).padStart(2, '0')}`, startTime: '10:00', endTime: '11:00',
  status: 'attended', isExternal: false, sessionDeducted: true, statusFinalized: true,
}));

// OverviewTab의 trainerBreakdown과 동일한 누적 로직(월별 계산 → 트레이너 id로 합산).
function accumulateByTrainer(months, members, schedules, payments) {
  const acc = {};
  months.forEach((ym) => {
    const blocks = computeSessionSettlementWithExpiry({
      trainers, members, schedules, payments, records, settings, ym,
      getOverride: () => null,
    });
    blocks.forEach((b) => {
      const tid = b.trainer.id;
      if (!acc[tid]) acc[tid] = { trainer: b.trainer, sessionTotal: 0, sessionPayout: 0, promoIncentive: 0, payout: 0 };
      acc[tid].sessionTotal += b.sessionTotal;
      acc[tid].sessionPayout += b.sessionPayout;
      acc[tid].promoIncentive += b.promoIncentive;
      acc[tid].payout += b.payout;
    });
  });
  return Object.values(acc).map((b) => ({
    ...b, splitRate: b.sessionTotal > 0 ? Math.round((b.sessionPayout / b.sessionTotal) * 100) : 0,
  }));
}

describe('개요 탭 트레이너별 정산 내역 — 기간(여러 달) 합산이 트레이너별로 정확한지', () => {
  // t1/m1: 50% 고정, 6월 2회 + 7월 3회 (같은 등록건, 단가 50,000)
  // t2/m2: 60% 고정, 7월에만 4회 (단가 60,000)
  const members = [
    { id: 'm1', name: '회원1', isActive: true, trainerSessions: { t1: { total: 10, remaining: 5 } } },
    { id: 'm2', name: '회원2', isActive: true, trainerSessions: { t2: { total: 10, remaining: 6 } } },
  ];
  const payments = {
    m1: [{ id: 'p1', amount: 500000, method: '현금', paidAt: '2026-06-01', trainerIds: ['t1'], splitRateAtPay: { t1: 50 } }],
    m2: [{ id: 'p2', amount: 600000, method: '현금', paidAt: '2026-07-01', trainerIds: ['t2'], splitRateAtPay: { t2: 60 } }],
  };
  const schedules = [
    ...sched('m1', 't1', '2026-06', [10, 11]),       // 6월 2회
    ...sched('m1', 't1', '2026-07', [10, 11, 12]),   // 7월 3회 (같은 t1)
    ...sched('m2', 't2', '2026-07', [5, 6, 7, 8]),   // 7월 4회 (t2)
  ];
  const months = ['2026-06', '2026-07'];
  const breakdown = accumulateByTrainer(months, members, schedules, payments);

  const t1 = breakdown.find((b) => b.trainer.id === 't1');
  const t2 = breakdown.find((b) => b.trainer.id === 't2');

  it('같은 트레이너(t1)의 6월+7월 매출이 덮어쓰이지 않고 합산된다', () => {
    // 6월: 50,000×2=100,000 / 7월: 50,000×3=150,000 → 합 250,000
    expect(t1.sessionTotal).toBe(250000);
    expect(t1.sessionPayout).toBe(125000); // 100,000*0.5 + 150,000*0.5
    expect(t1.payout).toBe(125000);        // 인센티브 없음
  });

  it('한 달만 활동한 트레이너(t2)는 그 달 실적만 정확히 반영된다(다른 트레이너 영향 없음)', () => {
    expect(t2.sessionTotal).toBe(240000);  // 60,000×4
    expect(t2.sessionPayout).toBe(144000); // 240,000*0.6
    expect(t2.payout).toBe(144000);
  });

  it('대표 비율(가중평균 공식)이 고정 비율과 일치한다', () => {
    expect(t1.splitRate).toBe(50);
    expect(t2.splitRate).toBe(60);
  });

  it('트레이너별 합산의 총합이, 월별로 전체를 그대로 더한 기존 방식과 정확히 같다(집계 방식 변경 전과 총액 불변)', () => {
    const flatTotal = months.reduce((s, ym) => {
      const blocks = computeSessionSettlementWithExpiry({
        trainers, members, schedules, payments, records, settings, ym, getOverride: () => null,
      });
      return s + blocks.reduce((s2, b) => s2 + b.payout, 0);
    }, 0);
    const byTrainerTotal = breakdown.reduce((s, b) => s + b.payout, 0);
    expect(byTrainerTotal).toBe(flatTotal);
    expect(byTrainerTotal).toBe(125000 + 144000);
  });
});

describe('Revenue.jsx 소스 배선 — 개요 탭이 실제로 위 알고리즘을 사용하는지', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'pages', 'Revenue.jsx'), 'utf8');

  it('트레이너별 누적은 월별로 computeSessionSettlementWithExpiry를 호출해 트레이너 id로 합산한다', () => {
    expect(src).toContain('const trainerBreakdown = useMemo(');
    expect(src).toContain('acc[tid].sessionTotal   += b.sessionTotal;');
    expect(src).toContain('acc[tid].sessionPayout  += b.sessionPayout;');
    expect(src).toContain('acc[tid].payout         += b.payout;');
  });

  it('"트레이너 정산" 총액(settlePayout)은 trainerBreakdown에서 파생된 단일 소스다(중복 계산 없음)', () => {
    expect(src).toContain('const settlePayout = useMemo(()=>trainerBreakdown.reduce((s,b)=>s+b.payout,0)');
  });

  it('트레이너별 정산 내역 카드의 합계 줄이 별도로 재계산하지 않고 settlePayout을 그대로 표시한다', () => {
    const cardStart = src.indexOf('트레이너별 정산 내역');
    expect(cardStart).toBeGreaterThan(-1);
    const cardEnd = src.indexOf('상세 + 담당 트레이너 + 환불', cardStart);
    const card = src.slice(cardStart, cardEnd);
    expect(card).toContain('{won(settlePayout)}');
    expect(card).toContain('매출');
    expect(card).toContain('정산비율');
  });

  it('트레이너별 정산 내역 카드는 특정 월을 선택했을 때만 노출된다(연/전체 기간엔 숨김)', () => {
    expect(src).toContain('{isMonth && trainerBreakdown.length > 0 && (');
  });
});
