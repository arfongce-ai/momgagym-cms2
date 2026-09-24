// review_R1_attribution.test.js
// ════════════════════════════════════════════════════════════════════════
//  R1(매출관리 개요 — 선생님별 월 매출) 회귀 테스트.
//  Codex 보완(08be0eb) + Claude 교차확인 보완(2026-09-23)을 실제 함수 실행으로 잠근다.
//  (재현 스크립트 review_R1_reproduction.mjs는 vitest 대상이 아니라 CI에서 돌지 않아
//   같은 내용을 여기로 옮기고 경계값을 보강했다.)
//
//  규칙 — 2026-09-23 대표님 결정:
//   · 월 결제(isMonthly)는 담당 선생님 "표시" 매출(depositRevenue)에 포함한다.
//     단, 정산비율(40/50/60%) 판정 입력에는 넣지 않는다 — 보완 전과 동일(비율·지급액 불변).
//   · 환불 처리된 결제의 남은 금액, 담당 정보가 없는 결제, 선생님 목록 밖 몫은 센터 귀속 —
//     선생님별 매출로 표시하지 않는다(그래서 합계가 상단 입금금액과 다를 수 있다).
//   · 공동 담당 분배는 원 단위로 나눠 결제별 합계가 그 결제 순매출(반올림)과 정확히 같다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { computeMonthRates, calcNet } from '../services/finance';

const settings = {
  withholdingRate: 3.3, promoPerPost: 10000, snsInstaMax: 8,
  lowSplitRate: 40, rate60MinSales: 3000000, rate50MinBlog: 2, rate50MinStudy: 1,
  trainerSplitRates: {}, vatRate: 10, cardFeeRate: 0.8,
};
const trainers = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
const ym = '2026-09';

const run = ({ members, payments, records = [], list = trainers }) =>
  computeMonthRates({ trainers: list, members, payments, records, settings, ym });
const shownTotal = (rates, list = trainers) =>
  list.reduce((s, t) => s + (rates[t.id]?.depositRevenue || 0), 0);
// 개요 상단 "입금금액(순매출)"과 같은 규칙(Revenue.jsx totals): 결제월에 전액, 환불월에 환불액만 차감
const topNet = (list) => {
  const paid = list.filter(p => !p.isUnpaid && (p.paidAt || '').slice(0, 7) === ym);
  const refunds = list
    .filter(p => p.isRefunded && p.refundedAt && p.refundedAt.slice(0, 7) === ym)
    .reduce((s, p) => s + (Number(p.refundAmount) || 0), 0);
  return paid.reduce((s, p) => s + calcNet(p, settings).net, 0) - refunds;
};
const m1 = { id: 'm1', trainerSessions: { t1: { total: 10 } } };

describe('R1 선생님별 월 매출(depositRevenue) — 귀속 규칙', () => {
  it('월 결제(isMonthly)도 담당 선생님 표시 매출에 포함된다', () => {
    const p = { id: 'p1', amount: 1000, method: 'cash', paidAt: '2026-09-05', isMonthly: true, trainerIds: ['t1'] };
    const r = run({ members: [m1], payments: { m1: [p] } });
    expect(r.t1.depositRevenue).toBe(1000);
  });

  it('환불 처리된 결제는 남은 금액까지 센터 귀속 — 선생님 매출에서 빠지고, 그 차이만큼 상단 입금금액과 달라진다', () => {
    const mA = { id: 'mA', trainerSessions: { t1: { total: 10 } } };
    const mB = { id: 'mB', trainerSessions: { t2: { total: 10 } } };
    const pA = { id: 'pA', amount: 1000000, method: 'cash', paidAt: '2026-09-05', trainerIds: ['t1'] };
    const pB = { id: 'pB', amount: 500000, method: 'cash', paidAt: '2026-09-10', trainerIds: ['t2'],
      isRefunded: true, refundAmount: 200000, refundedAt: '2026-09-20' };
    const r = run({ members: [mA, mB], payments: { mA: [pA], mB: [pB] } });
    expect(r.t1.depositRevenue).toBe(1000000);
    expect(r.t2.depositRevenue).toBe(0);             // 남은 30만도 센터 귀속
    expect(shownTotal(r)).toBe(1000000);
    expect(topNet([pA, pB])).toBe(1300000);          // 상단은 130만 → 두 숫자가 다른 게 정상
  });

  it('담당 정보(split·trainerIds·trainerSessions)가 없는 결제는 센터 귀속 — 어떤 선생님에게도 표시되지 않는다', () => {
    const m0 = { id: 'm0' };
    const p = { id: 'p0', amount: 1000, method: 'cash', paidAt: '2026-09-05' };
    const r = run({ members: [m0], payments: { m0: [p] } });
    expect(shownTotal(r)).toBe(0);
  });

  it('선생님 목록에 없는 ID의 몫은 센터 귀속 — 목록 안 선생님 몫만 표시된다', () => {
    const p = { id: 'p1', amount: 1000, method: 'cash', paidAt: '2026-09-05', trainerIds: ['t1', 'gone'] };
    const r = run({ members: [m1], payments: { m1: [p] } });
    expect(r.t1.depositRevenue).toBe(500);
    expect(r.gone).toBeUndefined();
    expect(shownTotal(r)).toBe(500);
  });

  it('3명 균등 분할(100원)도 합계가 정확히 100원 — 원 단위 누수 없음', () => {
    const p = { id: 'p1', amount: 100, method: 'cash', paidAt: '2026-09-05', trainerIds: ['t1', 't2', 't3'] };
    const r = run({ members: [m1], payments: { m1: [p] } });
    const vals = trainers.map(t => r[t.id].depositRevenue).sort((a, b) => a - b);
    expect(vals).toEqual([33, 33, 34]);
    expect(shownTotal(r)).toBe(100);
  });

  it('카드·페이처럼 순매출에 소수점이 생겨도 선생님 합계 = 결제별 반올림 순매출 합(정수만 표시)', () => {
    const mm = { id: 'mm', trainerSessions: { t1: { total: 7 }, t2: { total: 5 }, t3: { total: 3 } } };
    const list = [
      { id: 'a', amount: 123457, method: 'card1', paidAt: '2026-09-02', trainerIds: ['t1', 't2', 't3'] },
      { id: 'b', amount: 99999, method: 'pay', paidAt: '2026-09-03', trainerIds: ['t2', 't3'] },
      { id: 'c', amount: 777777, method: 'card2', paidAt: '2026-09-04' },   // 등록횟수 비율 7:5:3
      { id: 'd', amount: 1000001, method: 'cash_receipt', paidAt: '2026-09-05',
        split: [{ trainerId: 't1', amount: 333333 }, { trainerId: 't3', amount: 666668 }] },
      { id: 'e', amount: 55555, method: 'card1', paidAt: '2026-09-06',
        methods: [{ method: 'card1', amount: 33333 }, { method: 'pay', amount: 22222 }], trainerIds: ['t2'] },
    ];
    const r = run({ members: [mm], payments: { mm: list } });
    const expected = list.reduce((s, p) => s + Math.round(calcNet(p, settings).net), 0);
    trainers.forEach(t => expect(Number.isInteger(r[t.id].depositRevenue)).toBe(true));
    expect(shownTotal(r)).toBe(expected);
  });

  it('split(지분 금액) 방식은 지분 비율대로 나뉜다', () => {
    const mm = { id: 'mm', trainerSessions: { t1: { total: 10 }, t2: { total: 10 } } };
    const p = { id: 'p1', amount: 1000000, method: 'card1', paidAt: '2026-09-05',
      split: [{ trainerId: 't1', amount: 700000 }, { trainerId: 't2', amount: 300000 }] };
    const r = run({ members: [mm], payments: { mm: [p] } });
    expect(r.t1.depositRevenue).toBe(624400);   // 순매출 892,000 × 70%
    expect(r.t2.depositRevenue).toBe(267600);   // 순매출 892,000 × 30%
  });
});

describe('R1 정산비율(40/50/60%) — 월 결제로는 바뀌지 않는다(비율·지급액 보호)', () => {
  const big = { amount: 3000000, method: 'cash', paidAt: '2026-09-05', trainerIds: ['t1'] };

  it('월 결제 + 재등록 300만 → 40% 유지 (월 결제가 아니면 50%)', () => {
    const monthly = run({ members: [m1], payments: { m1: [{ id: 'p', ...big, isReEnroll: true, isMonthly: true }] } });
    const normal  = run({ members: [m1], payments: { m1: [{ id: 'p', ...big, isReEnroll: true }] } });
    expect(monthly.t1.rate).toBe(40);
    expect(normal.t1.rate).toBe(50);
  });

  it('월 결제 + 신규 300만(상담 선생님) → 40% 유지 (월 결제가 아니면 50%)', () => {
    const base = { id: 'p', ...big, isNew: true, consultTrainerId: 't1' };
    const monthly = run({ members: [m1], payments: { m1: [{ ...base, isMonthly: true }] } });
    const normal  = run({ members: [m1], payments: { m1: [base] } });
    expect(monthly.t1.rate).toBe(40);
    expect(normal.t1.rate).toBe(50);
  });

  it('월 결제가 섞여도 비율은 "월 결제를 뺀 결제만으로" 판정한 값과 항상 같다(무작위 100세트)', () => {
    let seed = 20260923;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = a => a[Math.floor(rnd() * a.length)];
    for (let w = 0; w < 100; w++) {
      const members = []; const withMonthly = {}; const withoutMonthly = {};
      for (let i = 0; i < 12; i++) {
        const ts = {}; ts[pick(['t1', 't2', 't3'])] = { total: pick([5, 10, 20]) };
        const m = { id: `m${i}`, trainerSessions: ts };
        members.push(m);
        const list = [];
        for (let j = 0; j < 3; j++) {
          const p = { id: `p${i}_${j}`, amount: pick([550000, 1100000, 1650000, 3300000]),
            method: pick(['cash', 'card1', 'pay', 'transfer']), paidAt: '2026-09-1' + j, trainerIds: Object.keys(ts) };
          if (rnd() < 0.4) p.isReEnroll = true; else if (rnd() < 0.4) { p.isNew = true; p.consultTrainerId = pick(['t1', 't2', 't3']); }
          if (rnd() < 0.35) p.isMonthly = true;
          list.push(p);
        }
        withMonthly[m.id] = list;
        withoutMonthly[m.id] = list.filter(p => !p.isMonthly);
      }
      const records = [{ trainerId: pick(['t1', 't2', 't3']), date: '2026-09-15', channel: 'blog' }];
      const a = run({ members, payments: withMonthly, records });
      const b = run({ members, payments: withoutMonthly, records });
      trainers.forEach(t => {
        expect(a[t.id].rate).toBe(b[t.id].rate);
        expect(a[t.id].reason).toBe(b[t.id].reason);
      });
    }
  });
});

describe('Revenue.jsx 안내 문구 — 합계가 상단 입금금액과 "일치"한다고 단정하지 않는다', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'pages', 'Revenue.jsx'), 'utf8');
  it('옛 "일치" 문구가 사라지고 센터 귀속 안내가 있다', () => {
    expect(src).not.toContain('(= 위 손익 요약 입금금액과 일치)');
    expect(src).not.toContain('전체 합계는 상단 손익 요약의 입금금액(순매출)과 일치합니다');
    expect(src).toContain('선생님별 입금매출 합계 (환불·담당 미지정분은 센터 귀속으로 제외)');
  });
});
