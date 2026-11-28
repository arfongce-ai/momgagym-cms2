// 만료 정산 — '센터 귀속' / '트레이너 정산' 선택
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { sumExpirySettlementsByMonth, listCenterExpiryByMonth, computeSessionSettlementWithExpiry } from '../services/finance';

const read = (p) => readFileSync(join(process.cwd(), 'src', p), 'utf8');
const rec = (extra) => ({ trainerId: 't1', sessions: 3, unit: 20000, rate: 0, amount: 0, settledAt: '2026-11-28', ...extra });
const members = [
  { id: 'm1', name: '회원A' },
  { id: 'm2', name: '회원B', legacyExpirySettlements: { t1: rec({ disposition: 'center', sessions: 1, centerAmount: 20000 }) } },
];
const payments = { m1: [{ id: 'p1', expirySettlements: {
  a: rec({ disposition: 'center', centerAmount: 60000 }),
  b: rec({ rate: 40, amount: 24000 }), // 예전 기록(disposition 없음) = 트레이너 정산
} }] };

describe('센터 귀속 / 트레이너 정산', () => {
  it('트레이너 지급 합계에는 센터 귀속이 빠지고 예전 기록은 그대로 지급', () => {
    const r = sumExpirySettlementsByMonth({ members, payments, ym: '2026-11' });
    expect(r.t1.total).toBe(24000);
    expect(r.t1.items).toHaveLength(1);
  });
  it('센터 귀속 명세는 처리월 기준으로 따로 모은다', () => {
    const r = listCenterExpiryByMonth({ members, payments, ym: '2026-11' });
    expect(r.total).toBe(80000);
    expect(r.items).toHaveLength(2);
    expect(listCenterExpiryByMonth({ members, payments, ym: '2026-10' }).total).toBe(0);
  });
  it('센터 귀속만 있는 트레이너는 정산 블록이 생기지 않는다', () => {
    const blocks = computeSessionSettlementWithExpiry({
      trainers: [{ id: 't1', name: 'T' }], members: [members[1]], schedules: [], payments: {}, records: [],
      settings: { withholdingRate: 3.3, trainerSplitRates: {} }, ym: '2026-11', getOverride: () => null,
    });
    expect(blocks).toHaveLength(0);
  });
  it('두 화면 모두 선택 창을 거친다', () => {
    for (const f of ['components/members/MemberDetail.jsx', 'pages/Members.jsx']) {
      expect(read(f)).toContain('<ExpirySettleModal');
      expect(read(f)).toContain('disposition,');
    }
  });
});

// store 저장 동작 — Firestore 는 메모리 대역
vi.mock('../firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => {
  const data = {
    members: [{ id: 'm9', name: '회원', trainerSessions: { t1: { total: 10, remaining: 3 } } }],
    payments: [{ id: 'p9', __mid: 'm9', amount: 200000 }],
  };
  return {
    collection: (_d, name) => ({ name }), doc: (_d, name, id) => ({ name, id }),
    query: (c) => c, where: () => null,
    getDocs: async (c) => { const docs = (data[c.name] || []).map(x => ({ id: x.id, data: () => ({ ...x }) })); return { docs, size: docs.length, empty: !docs.length }; },
    setDoc: async () => {}, deleteDoc: async () => {},
    writeBatch: () => ({ set() {}, delete() {}, commit: async () => {} }),
  };
});

describe('store.processExpirySettlement — 센터 귀속 저장', () => {
  it('지급 0원·센터 금액 기록·잔여 차감, 같은 건 재처리 불가', async () => {
    const { store, initStore } = await import('../demoData');
    await initStore({ force: true });
    const params = { trainerId: 't1', lotId: 'L1', paymentId: 'p9', sessions: 3, unit: 20000, rate: 40, amount: 24000, disposition: 'center' };
    const out = await store.processExpirySettlement('m9', params);
    expect(out.record).toMatchObject({ disposition: 'center', amount: 0, rate: 0, centerAmount: 60000 });
    expect(store.getMembers()[0].trainerSessions.t1.remaining).toBe(0);
    expect(await store.processExpirySettlement('m9', { ...params, disposition: 'trainer' })).toBeNull();
  });
});
