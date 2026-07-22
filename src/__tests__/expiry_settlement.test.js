// expiry_settlement.test.js
// ════════════════════════════════════════════════════════════════════════
//  배경: 이용약관 3항 "미소진 잔여를 기존 %로 한번에 정산"의 계산 함수
//  (computeExpirySettlement/expirySettlementRate, sessionExpiry.js)는 있었지만
//  실제로 정산을 "처리"하고(store), 트레이너 월 지급액에 "반영"하는(finance.js)
//  코드가 없었다. 이 파일은 그 두 층을 검증한다:
//   1) finance.js — sumExpirySettlementsByMonth / computeSessionSettlementWithExpiry
//   2) demoData.js — store.processExpirySettlement (원자 배치 처리)
//   3) UI 배선 — MemberDetail.jsx/Members.jsx/Revenue.jsx가 실제로 이 함수들을 쓰는지
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { sumExpirySettlementsByMonth, computeSessionSettlementWithExpiry } from '../services/finance';

const root = join(process.cwd(), 'src');
const read = (p) => readFileSync(join(root, p), 'utf8');

// ── 1. sumExpirySettlementsByMonth — 순수 함수 단위 테스트 ────────────────
describe('sumExpirySettlementsByMonth — 만료 정산 기록을 처리월(settledAt) 기준 트레이너별 합산', () => {
  it('결제 문서(expirySettlements)의 기록을 그 달 기준으로 트레이너별 합산한다', () => {
    const members = [{ id: 'm1', name: '홍길동' }];
    const payments = { m1: [{ id: 'p1', expirySettlements: {
      'p1:t1:0': { trainerId: 't1', sessions: 3, unit: 20000, rate: 40, amount: 24000, settledAt: '2026-07-15' },
    } }] };
    const result = sumExpirySettlementsByMonth({ members, payments, ym: '2026-07' });
    expect(result.t1.total).toBe(24000);
    expect(result.t1.items).toHaveLength(1);
    expect(result.t1.items[0]).toMatchObject({ memberId: 'm1', memberName: '홍길동', amount: 24000, source: 'lot' });
  });

  it('다른 달에 처리된 기록은 집계하지 않는다', () => {
    const members = [{ id: 'm1', name: '홍길동' }];
    const payments = { m1: [{ id: 'p1', expirySettlements: {
      'p1:t1:0': { trainerId: 't1', sessions: 3, unit: 20000, rate: 40, amount: 24000, settledAt: '2026-06-30' },
    } }] };
    const result = sumExpirySettlementsByMonth({ members, payments, ym: '2026-07' });
    expect(result.t1).toBeUndefined();
  });

  it('회원 문서의 legacyExpirySettlements도 함께 합산한다', () => {
    const members = [{ id: 'm1', name: '김철수', legacyExpirySettlements: {
      t2: { trainerId: 't2', sessions: 2, unit: 30000, rate: 50, amount: 30000, settledAt: '2026-07-05' },
    } }];
    const result = sumExpirySettlementsByMonth({ members, payments: {}, ym: '2026-07' });
    expect(result.t2.total).toBe(30000);
    expect(result.t2.items[0].source).toBe('legacy');
  });

  it('여러 회원·트레이너가 섞여도 트레이너별로 정확히 나뉜다', () => {
    const members = [
      { id: 'm1', name: '회원A' },
      { id: 'm2', name: '회원B', legacyExpirySettlements: { t1: { trainerId: 't1', sessions: 1, unit: 10000, rate: 40, amount: 4000, settledAt: '2026-07-01' } } },
    ];
    const payments = {
      m1: [{ id: 'p1', expirySettlements: {
        'p1:t1:0': { trainerId: 't1', sessions: 2, unit: 10000, rate: 40, amount: 8000, settledAt: '2026-07-02' },
        'p1:t2:0': { trainerId: 't2', sessions: 5, unit: 20000, rate: 60, amount: 60000, settledAt: '2026-07-03' },
      } }],
    };
    const result = sumExpirySettlementsByMonth({ members, payments, ym: '2026-07' });
    expect(result.t1.total).toBe(12000); // 8000 + 4000
    expect(result.t1.items).toHaveLength(2);
    expect(result.t2.total).toBe(60000);
  });

  it('입력이 비어 있으면 빈 객체를 반환한다', () => {
    expect(sumExpirySettlementsByMonth({ members: [], payments: {}, ym: '2026-07' })).toEqual({});
  });
});

// ── 2. computeSessionSettlementWithExpiry — computeSessionSettlement 래퍼 ─────
describe('computeSessionSettlementWithExpiry — 세션 정산 + 만료 정산 합산', () => {
  const trainers = [{ id: 't1', name: '트레이너1', color: '#f00' }, { id: 't2', name: '트레이너2', color: '#0f0' }];
  const settings = { withholdingRate: 3.3, promoPerPost: 10000, snsInstaMax: 8, lowSplitRate: 40, rate60MinSales: 3000000, rate50MinBlog: 2, rate50MinStudy: 1, trainerSplitRates: {} };
  const YM = '2026-07';
  const run = (members, payments, schedules = []) => computeSessionSettlementWithExpiry({
    trainers, members, schedules, payments, records: [], settings, ym: YM, getOverride: () => null,
  });

  it('그 달에 처리된 만료 정산액이 payout/tax/payoutNet에 합산되고 명세(expirySettlement)가 붙는다', () => {
    const members = [{ id: 'm1', name: '회원1', trainerSessions: { t1: { total: 10, remaining: 7 } } }];
    const payments = { m1: [{
      id: 'p1', amount: 540000, method: '현금', paidAt: '2026-06-01', trainerIds: ['t1'], splitRateAtPay: { t1: 50 },
      expirySettlements: { x1: { trainerId: 't1', sessions: 3, unit: 20000, rate: 40, amount: 24000, settledAt: '2026-07-10' } },
    }] };
    const blocks = run(members, payments);
    const b = blocks.find(x => x.trainer.id === 't1');
    expect(b.expirySettlement.total).toBe(24000);
    expect(b.payout).toBe(b.sessionPayout + b.promoIncentive + 24000);
    expect(b.tax).toBe(Math.round(b.payout * 3.3 / 100));
    expect(b.payoutNet).toBe(b.payout - b.tax);
  });

  it('그 달 세션·홍보 실적이 전혀 없는 트레이너도 만료 정산만 있으면 누락 없이 별도 블록으로 나온다', () => {
    // t2는 잔여 0·출석 0이라 원본 computeSessionSettlement에서 완전히 걸러지는 트레이너.
    const members = [{ id: 'm1', name: '회원1', trainerSessions: { t2: { total: 10, remaining: 0 } } }];
    const payments = { m1: [{
      id: 'p1', amount: 540000, method: '현금', paidAt: '2026-01-01', trainerIds: ['t2'],
      expirySettlements: { x1: { trainerId: 't2', sessions: 5, unit: 20000, rate: 40, amount: 40000, settledAt: '2026-07-05' } },
    }] };
    const blocks = run(members, payments);
    const b = blocks.find(x => x.trainer.id === 't2');
    expect(b).toBeTruthy();
    expect(b.rows).toEqual([]);
    expect(b.payout).toBe(40000);
    expect(b.expirySettlement.total).toBe(40000);
    expect(b.tax).toBe(Math.round(40000 * 3.3 / 100));
  });

  it('만료 정산이 없으면 원본 computeSessionSettlement와 동일한 payout을 낸다(회귀 없음)', () => {
    const members = [{ id: 'm1', name: '회원1', trainerSessions: { t1: { total: 10, remaining: 10 } } }];
    const payments = { m1: [{ id: 'p1', amount: 600000, method: '현금', paidAt: '2026-07-01', trainerIds: ['t1'], splitRateAtPay: { t1: 50 } }] };
    const blocks = run(members, payments);
    const b = blocks.find(x => x.trainer.id === 't1');
    expect(b.expirySettlement).toEqual({ total: 0, items: [] });
  });

  it('다른 달에 처리된 만료 정산은 이번 달 합계에서 제외한다', () => {
    const members = [{ id: 'm1', name: '회원1', trainerSessions: { t1: { total: 10, remaining: 7 } } }];
    const payments = { m1: [{
      id: 'p1', amount: 540000, method: '현금', paidAt: '2026-06-01', trainerIds: ['t1'], splitRateAtPay: { t1: 50 },
      expirySettlements: { x1: { trainerId: 't1', sessions: 3, unit: 20000, rate: 40, amount: 24000, settledAt: '2026-05-01' } },
    }] };
    const blocks = run(members, payments);
    const b = blocks.find(x => x.trainer.id === 't1');
    expect(b.expirySettlement).toEqual({ total: 0, items: [] });
    expect(b.payout).toBe(b.sessionPayout + b.promoIncentive);
  });
});

// ── 3. store.processExpirySettlement — 원자 배치 처리 ─────────────────────
vi.mock('../firebase', () => ({ db: { __mock: true }, auth: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ __coll: name }),
  doc: (_db, name, id) => ({ name, id }),
  query: (coll, ...clauses) => ({ ...coll, __clauses: clauses }),
  where: (field, op, value) => ({ field, op, value }),
  getDocs: async () => ({ empty: true, docs: [] }),
  setDoc: async () => {},
  deleteDoc: async () => {},
  writeBatch: () => {
    let shouldFail = globalThis.__expiryBatchShouldFail;
    const ops = [];
    return {
      set(ref, data) { ops.push({ type: 'set', ref, data }); },
      delete(ref) { ops.push({ type: 'delete', ref }); },
      async commit() {
        if (shouldFail) throw new Error('네트워크 오류(테스트)');
        return ops;
      },
    };
  },
}));

const { store, initStore } = await import('../demoData.js');

beforeEach(async () => {
  globalThis.__expiryBatchShouldFail = false;
  await initStore({ force: true });
});

describe('store.processExpirySettlement', () => {
  it('explicit lot(결제와 연결됨)을 정산하면 payment.expirySettlements에 기록되고, 그 lot만큼 잔여가 줄어든다', async () => {
    const mem = await store.addMember({ name: '홍길동', trainerSessions: { t1: { total: 10, remaining: 10 } } });
    const pay = await store.addPayment(mem.id, { amount: 600000, method: 'cash', paidAt: '2026-01-01', sessionAdds: [{ trainerId: 't1', count: 10 }] });
    const lotId = `${pay.id}:t1:0`;

    const result = await store.processExpirySettlement(mem.id, {
      trainerId: 't1', lotId, paymentId: pay.id, legacy: false,
      remaining: 10, sessions: 10, unit: 60000, rate: 40, amount: 240000,
    });

    expect(result).toBeTruthy();
    expect(result.record.amount).toBe(240000);
    expect(result.record.settledAt).toBeTruthy();

    const storedPay = store.getPayments(mem.id).find(p => p.id === pay.id);
    expect(storedPay.expirySettlements[lotId].amount).toBe(240000);
    expect(storedPay.expirySettlements[lotId].trainerId).toBe('t1');

    const storedMem = store.getMembers().find(m => m.id === mem.id);
    expect(storedMem.trainerSessions.t1.remaining).toBe(0); // 10 - 10
  });

  it('legacy lot(결제와 직접 연결 안 됨)을 정산하면 member.legacyExpirySettlements에 기록된다', async () => {
    const mem = await store.addMember({ name: '김철수', trainerSessions: { t1: { total: 10, remaining: 4 } } });

    const result = await store.processExpirySettlement(mem.id, {
      trainerId: 't1', lotId: 'legacy:t1', paymentId: null, legacy: true,
      remaining: 4, sessions: 4, unit: 50000, rate: 40, amount: 80000,
    });

    expect(result).toBeTruthy();
    const storedMem = store.getMembers().find(m => m.id === mem.id);
    expect(storedMem.legacyExpirySettlements.t1.amount).toBe(80000);
    expect(storedMem.trainerSessions.t1.remaining).toBe(0); // 4 - 4
  });

  it('같은 lot을 다시 정산하려 하면 null을 반환하고 아무것도 바꾸지 않는다(이중 지급 방지)', async () => {
    const mem = await store.addMember({ name: '이영희', trainerSessions: { t1: { total: 10, remaining: 5 } } });
    const pay = await store.addPayment(mem.id, { amount: 500000, method: 'cash', paidAt: '2026-01-01', sessionAdds: [{ trainerId: 't1', count: 10 }] });
    const lotId = `${pay.id}:t1:0`;
    const params = { trainerId: 't1', lotId, paymentId: pay.id, legacy: false, remaining: 5, sessions: 5, unit: 50000, rate: 40, amount: 100000 };

    const first = await store.processExpirySettlement(mem.id, params);
    expect(first).toBeTruthy();
    const second = await store.processExpirySettlement(mem.id, params);
    expect(second).toBeNull();

    // 두 번째 시도로 잔여가 추가로 깎이지 않아야 한다(이미 0이므로 변화 없음이 맞지만, 명시적으로 확인).
    const storedMem = store.getMembers().find(m => m.id === mem.id);
    expect(storedMem.trainerSessions.t1.remaining).toBe(0);
  });

  it('한 트레이너의 lot만 정산해도 다른 트레이너의 잔여는 건드리지 않는다', async () => {
    const mem = await store.addMember({
      name: '박서준',
      trainerSessions: { t1: { total: 10, remaining: 3 }, t2: { total: 8, remaining: 6 } },
    });
    await store.processExpirySettlement(mem.id, {
      trainerId: 't1', lotId: 'legacy:t1', paymentId: null, legacy: true,
      remaining: 3, sessions: 3, unit: 40000, rate: 40, amount: 48000,
    });
    const storedMem = store.getMembers().find(m => m.id === mem.id);
    expect(storedMem.trainerSessions.t1.remaining).toBe(0);
    expect(storedMem.trainerSessions.t2.remaining).toBe(6); // 그대로
  });

  it('배치 커밋이 실패하면 결제·회원 캐시가 모두 이전 상태로 롤백된다', async () => {
    const mem = await store.addMember({ name: '정우성', trainerSessions: { t1: { total: 10, remaining: 4 } } });
    const pay = await store.addPayment(mem.id, { amount: 400000, method: 'cash', paidAt: '2026-01-01', sessionAdds: [{ trainerId: 't1', count: 10 }] });
    const lotId = `${pay.id}:t1:0`;

    globalThis.__expiryBatchShouldFail = true;
    await expect(store.processExpirySettlement(mem.id, {
      trainerId: 't1', lotId, paymentId: pay.id, legacy: false,
      remaining: 4, sessions: 4, unit: 40000, rate: 40, amount: 64000,
    })).rejects.toThrow();

    const storedPay = store.getPayments(mem.id).find(p => p.id === pay.id);
    const storedMem = store.getMembers().find(m => m.id === mem.id);
    expect(storedPay.expirySettlements).toBeUndefined();
    expect(storedMem.trainerSessions.t1.remaining).toBe(4); // 롤백되어 그대로
  });

  it('존재하지 않는 회원이면 null을 반환한다', async () => {
    const result = await store.processExpirySettlement('no-such-member', {
      trainerId: 't1', lotId: 'legacy:t1', legacy: true, remaining: 3, sessions: 3, unit: 10000, rate: 40, amount: 12000,
    });
    expect(result).toBeNull();
  });

  it('그 트레이너의 세션 슬롯 자체가 없으면 null을 반환한다', async () => {
    const mem = await store.addMember({ name: '한소희', trainerSessions: {} });
    const result = await store.processExpirySettlement(mem.id, {
      trainerId: 't1', lotId: 'legacy:t1', legacy: true, remaining: 3, sessions: 3, unit: 10000, rate: 40, amount: 12000,
    });
    expect(result).toBeNull();
  });

  it('금액·세션 수가 0 이하면 처리하지 않고 null을 반환한다', async () => {
    const mem = await store.addMember({ name: '오유진', trainerSessions: { t1: { total: 10, remaining: 4 } } });
    const result = await store.processExpirySettlement(mem.id, {
      trainerId: 't1', lotId: 'legacy:t1', legacy: true, remaining: 4, sessions: 0, unit: 10000, rate: 40, amount: 0,
    });
    expect(result).toBeNull();
  });
});

// ── 4. UI 배선 확인 — 실제 화면이 이 함수들을 쓰는지 소스 검사 ────────────
describe('만료 정산 UI 배선 확인', () => {
  const memberDetailSrc = read('components/members/MemberDetail.jsx');
  const membersSrc = read('pages/Members.jsx');
  const revenueSrc = read('pages/Revenue.jsx');

  it('MemberDetail.jsx는 sessionExpiry.js의 만료 정산 함수를 가져와 쓴다', () => {
    expect(memberDetailSrc).toContain("from '../../services/sessionExpiry'");
    expect(memberDetailSrc).toContain('buildMemberSessionExpiry');
    expect(memberDetailSrc).toContain('computeExpirySettlement');
  });

  it('MemberDetail.jsx의 만료 정산 처리는 store.processExpirySettlement로 원자 저장하고, 관리자 권한 블록 안에서만 버튼을 노출한다', () => {
    const start = memberDetailSrc.indexOf('const handleExpirySettlement = async (lot) => {');
    expect(start).toBeGreaterThan(-1);
    const end = memberDetailSrc.indexOf('\n  };', start);
    const fn = memberDetailSrc.slice(start, end);
    expect(fn).toContain('store.processExpirySettlement(');

    const btnIdx = memberDetailSrc.indexOf('handleExpirySettlement(l)');
    expect(btnIdx).toBeGreaterThan(-1);
    const before = memberDetailSrc.slice(0, btnIdx);
    expect(before.lastIndexOf("user?.role==='admin'")).toBeGreaterThan(-1);
  });

  it('Members.jsx의 일괄 만료 정산 버튼은 handleSettleExpiredSessions를 호출하고, 더 이상 전체 세션을 0으로 미는 옛 로직(handleZeroSessions)을 쓰지 않는다', () => {
    expect(membersSrc).toContain('onClick={handleSettleExpiredSessions}');
    expect(membersSrc).not.toContain('handleZeroSessions');
    expect(membersSrc).toContain('store.processExpirySettlement(');
    // 예전 버그(회원의 트레이너별 잔여 전체를 무조건 0으로 미는 방식)가 재도입되지 않았는지 확인.
    expect(membersSrc).not.toMatch(/ts\[k\]\s*=\s*\{\s*\.\.\.v,\s*remaining:\s*0\s*\}/);
  });

  it('Members.jsx는 실제로 만료된(status===\'expired\') lot만 골라 처리한다(임박·정상 lot은 건드리지 않음)', () => {
    const start = membersSrc.indexOf('const handleSettleExpiredSessions = async () => {');
    const end = membersSrc.indexOf('\n  };', start);
    const fn = membersSrc.slice(start, end);
    expect(fn).toContain("lot.status === 'expired'");
  });

  it('Revenue.jsx는 개요·정산 탭 모두 computeSessionSettlementWithExpiry를 쓴다(만료 정산 누락 방지)', () => {
    const occurrences = revenueSrc.match(/computeSessionSettlementWithExpiry\(/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2); // OverviewTab + SettleTab
  });

  it('TrainerSettleCard는 편집 중 미리보기 총액(liveTotal)에도 만료 정산액을 포함한다', () => {
    const start = revenueSrc.indexOf('function TrainerSettleCard(');
    const end = revenueSrc.indexOf('\nfunction ExpenseTab');
    const fn = revenueSrc.slice(start, end);
    expect(fn).toContain('liveExpiryTotal');
    expect(fn).toMatch(/liveSessionPayout \+ liveBlogInc \+ liveInstaInc \+ liveSalesInc \+ liveExpiryTotal/);
  });
});
