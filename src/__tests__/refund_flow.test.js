// refund_flow.test.js
// ════════════════════════════════════════════════════════════════════════
//  배경: 회원상세(MemberDetail) 화면에는 결제 삭제(🗑)만 있고 환불 처리가
//  없었다. 매출관리(Revenue)의 RefundableList에만 환불 계산식이 있었는데,
//  그 계산식(부가세·위약금10%·진행분)이 파일 하나에 묶여 있어 회원상세에도
//  같은 기능을 넣으려면 공식을 베껴 써야 했고, 그러면 두 화면의 결과가
//  어긋날 위험이 생긴다.
//  수정: 계산식을 finance.js의 공용 함수(autoRefundUsedAmount,
//  computeRefundEstimate)로 추출하고, 저장 단계는 store.processRefund
//  (결제 환불 필드 + 잔여세션 0 정리를 한 배치로 원자 커밋)로 통일해
//  Revenue.jsx·MemberDetail.jsx 양쪽에서 동일하게 사용한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { autoRefundUsedAmount, computeRefundEstimate } from '../services/finance';

const root = join(process.cwd(), 'src');
const read = (p) => readFileSync(join(root, p), 'utf8');

// ── 1. 순수 계산 함수 단위 테스트 ─────────────────────────────────────
describe('finance.js — 환불 산정 공용 함수', () => {
  const settings = { vatRate: 3.3, cardFeeRate: 2.0 };

  describe('autoRefundUsedAmount — 진행분(출석 회차 × 단가) 자동 계산', () => {
    const members = [{
      id: 'm1',
      trainerSessions: { t1: { total: 10, remaining: 4 }, t2: { total: 5, remaining: 5 } },
    }];

    it('단가 = 입금액 ÷ 등록 총회차, 출석(attended+noshow) 회차만큼 곱한다', () => {
      const payment = { memberId: 'm1', amount: 900000, method: 'cash', trainerIds: [] };
      // cash는 공제 없음(NO_DEDUCT_METHODS) → net = amount = 900000. 총회차 15. 단가 60000.
      const schedules = [
        { memberId: 'm1', trainerId: 't1', status: 'attended' },
        { memberId: 'm1', trainerId: 't1', status: 'noshow' },
        { memberId: 'm1', trainerId: 't2', status: 'booked' }, // 아직 진행 안 함 → 제외
        { memberId: 'm1', trainerId: 't2', status: 'attended' },
      ];
      const used = autoRefundUsedAmount(payment, { members, schedules, settings });
      expect(used).toBe(60000 * 3); // attended 2 + noshow 1 = 3회
    });

    it('결제에 담당 트레이너(trainerIds)가 지정돼 있으면 그 트레이너 출석만 센다', () => {
      const payment = { memberId: 'm1', amount: 900000, method: 'cash', trainerIds: ['t1'] };
      const schedules = [
        { memberId: 'm1', trainerId: 't1', status: 'attended' },
        { memberId: 'm1', trainerId: 't2', status: 'attended' }, // t1 결제와 무관 → 제외
      ];
      const used = autoRefundUsedAmount(payment, { members, schedules, settings });
      expect(used).toBe(60000 * 1);
    });

    it('외부 일정(isExternal)은 출석 회차에서 제외한다', () => {
      const payment = { memberId: 'm1', amount: 900000, method: 'cash', trainerIds: [] };
      const schedules = [
        { memberId: 'm1', trainerId: 't1', status: 'attended', isExternal: true },
        { memberId: 'm1', trainerId: 't1', status: 'attended' },
      ];
      const used = autoRefundUsedAmount(payment, { members, schedules, settings });
      expect(used).toBe(60000 * 1);
    });

    it('등록 총회차가 0이면 0을 반환한다(0으로 나누기 방지)', () => {
      const zeroMembers = [{ id: 'm2', trainerSessions: {} }];
      const payment = { memberId: 'm2', amount: 500000, method: 'cash' };
      expect(autoRefundUsedAmount(payment, { members: zeroMembers, schedules: [], settings })).toBe(0);
    });
  });

  describe('computeRefundEstimate — 계약서 10조 산식(총액 − 부가세 − 위약금10% − 진행분)', () => {
    it('일반적인 부분환불 금액을 정확히 계산한다', () => {
      const payment = { amount: 1000000 };
      const { vat, penalty, usedAmount, refund } = computeRefundEstimate(payment, settings, 300000);
      expect(vat).toBeCloseTo(33000);
      expect(penalty).toBe(100000);
      expect(usedAmount).toBe(300000);
      expect(refund).toBeCloseTo(1000000 - 33000 - 100000 - 300000);
    });

    it('공제 총액이 결제액을 넘어도 환불액은 0 밑으로 내려가지 않는다', () => {
      const payment = { amount: 100000 };
      const { refund } = computeRefundEstimate(payment, settings, 90000);
      expect(refund).toBe(0);
    });

    it('진행분 입력이 없거나(빈 문자열) 숫자가 아니면 0으로 처리한다', () => {
      const payment = { amount: 500000 };
      const a = computeRefundEstimate(payment, settings, '');
      const b = computeRefundEstimate(payment, settings, undefined);
      expect(a.usedAmount).toBe(0);
      expect(b.usedAmount).toBe(0);
    });
  });
});

// ── 2. store.processRefund — 원자적 배치 저장 기능 테스트 ─────────────
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
    let shouldFail = globalThis.__refundBatchShouldFail;
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
  globalThis.__refundBatchShouldFail = false;
  await initStore({ force: true });
});

describe('store.processRefund — 결제 환불 필드 + 잔여세션 0 정리를 원자 커밋', () => {
  it('결제건에 환불 필드가 기록되고, 회원의 모든 트레이너 잔여 세션이 0으로 정리된다', async () => {
    const mem = await store.addMember({ name: '홍길동', trainerSessions: { t1: { total: 10, remaining: 4 }, t2: { total: 5, remaining: 3 } } });
    const pay = await store.addPayment(mem.id, { amount: 900000, method: 'cash', paidAt: '2026-07-01' });

    const updated = await store.processRefund(mem.id, pay.id, {
      isRefunded: true, refundAmount: 500000, refundedAt: '2026-07-21',
      refundVat: 30000, refundPenalty: 90000, refundUsed: 180000,
    });

    expect(updated.isRefunded).toBe(true);
    expect(updated.refundAmount).toBe(500000);

    const storedPay = store.getPayments(mem.id).find(p => p.id === pay.id);
    expect(storedPay.isRefunded).toBe(true);
    expect(storedPay.refundAmount).toBe(500000);
    expect(storedPay.refundedAt).toBe('2026-07-21');

    const storedMem = store.getMembers().find(m => m.id === mem.id);
    expect(storedMem.trainerSessions.t1.remaining).toBe(0);
    expect(storedMem.trainerSessions.t2.remaining).toBe(0);
    // total(등록 총회차)은 그대로 보존되어야 한다(정산 단가 계산의 기준값이므로).
    expect(storedMem.trainerSessions.t1.total).toBe(10);
    expect(storedMem.trainerSessions.t2.total).toBe(5);
  });

  it('배치 커밋이 실패하면 결제·회원 캐시가 모두 이전 상태로 롤백된다', async () => {
    const mem = await store.addMember({ name: '김철수', trainerSessions: { t1: { total: 10, remaining: 7 } } });
    const pay = await store.addPayment(mem.id, { amount: 300000, method: 'cash', paidAt: '2026-07-01' });

    globalThis.__refundBatchShouldFail = true;
    await expect(store.processRefund(mem.id, pay.id, {
      isRefunded: true, refundAmount: 100000, refundedAt: '2026-07-21',
    })).rejects.toThrow();

    const storedPay = store.getPayments(mem.id).find(p => p.id === pay.id);
    const storedMem = store.getMembers().find(m => m.id === mem.id);
    expect(storedPay.isRefunded).toBeFalsy();
    expect(storedMem.trainerSessions.t1.remaining).toBe(7); // 롤백되어 그대로
  });

  it('존재하지 않는 결제 id면 아무것도 바꾸지 않고 null을 반환한다', async () => {
    const mem = await store.addMember({ name: '이영희', trainerSessions: {} });
    const result = await store.processRefund(mem.id, 'no-such-payment', { isRefunded: true });
    expect(result).toBeNull();
  });
});

// ── 3. 소스 배선 확인 — 회원상세에 환불 UI가 실제로 연결돼 있는지 ─────
describe('MemberDetail.jsx — 환불 UI 배선 확인(관리자 전용)', () => {
  const src = read('components/members/MemberDetail.jsx');

  it('finance.js의 공용 환불 계산 함수를 가져와 쓴다(로컬 재계산 없음)', () => {
    expect(src).toContain('autoRefundUsedAmount');
    expect(src).toContain('computeRefundEstimate');
  });

  it('환불 처리는 store.processRefund로 원자 저장한다', () => {
    const start = src.indexOf('const handleRefundPayment = async (p) => {');
    const end = src.indexOf('const handleCancelRefund');
    const fn = src.slice(start, end);
    expect(fn).toContain('store.processRefund(');
  });

  it('미수금(isUnpaid) 결제는 환불 버튼 대상에서 제외한다', () => {
    expect(src).toMatch(/!p\.isUnpaid && \(p\.isRefunded/);
  });

  it('환불/환불취소 버튼은 관리자(admin) 권한 블록 안에만 렌더링된다', () => {
    const idx = src.indexOf('handleRefundPayment(p)');
    expect(idx).toBeGreaterThan(-1);
    const before = src.slice(0, idx);
    const lastAdminGuard = before.lastIndexOf("user?.role==='admin'");
    expect(lastAdminGuard).toBeGreaterThan(-1);
  });
});

describe('Revenue.jsx — 환불 계산이 finance.js 공용 함수로 통일됐는지 확인(공식 이원화 방지)', () => {
  const src = read('pages/Revenue.jsx');

  it('RefundableList가 finance.js의 autoRefundUsedAmount/computeRefundEstimate를 사용한다', () => {
    expect(src).toContain('autoRefundUsedAmount(p, {');
    expect(src).toContain('computeRefundEstimate(p, settings, usedInput)');
  });

  it('환불 저장은 store.processRefund로 원자 처리한다(결제 갱신 + 세션 정리 분리 호출 제거)', () => {
    const start = src.indexOf('const handleRefund = async (p) => {');
    const end = src.indexOf('const cancelRefund');
    const fn = src.slice(start, end);
    expect(fn).toContain('store.processRefund(');
    expect(fn).not.toContain('store.updateMember(p.memberId, { trainerSessions: ts })');
  });
});
