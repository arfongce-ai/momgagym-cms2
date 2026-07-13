// revenue_refund_accounting.test.js
// ════════════════════════════════════════════════════════════════════════
//  버그: 매출 개요(OverviewTab)에서 부분환불된 결제가 매출 집계에서
//  통째로 제외(!p.isRefunded)된 채, 환불액이 refundTotal로 한 번 더
//  차감되고 있었다. 환불은 대부분 부분환불(부가세·위약금·진행분 공제 후)
//  이라 결제액 중 상당액은 여전히 매출로 남아야 하는데, 이 버그로 그
//  결제의 매출 기여가 0을 넘어 음수가 될 수 있었다.
//  (finance.js의 computeSessionSettlement는 이미 "환불 결제도 단가
//  계산엔 포함하고, 환불액만 환불월에 차감"하는 올바른 2단계 방식이라
//  트레이너 정산과 매출 개요 사이에 불일치가 있었다.)
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { calcNet } from '../services/finance';

const root = join(process.cwd(), 'src');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('매출 개요 소스 배선 — 이중차감 제거 확인', () => {
  const src = read('pages/Revenue.jsx');

  it('paid 목록이 더 이상 isRefunded를 통째로 제외하지 않는다(미수금만 제외)', () => {
    expect(src).toContain('const paid   = filtered.filter(p=>!p.isUnpaid);');
    expect(src).not.toMatch(/const paid\s*=\s*filtered\.filter\(p=>!p\.isUnpaid && !p\.isRefunded\)/);
  });

  it('byMonth도 결제월엔 전액 반영 + 환불월엔 환불액만 차감하는 2단계 방식이다', () => {
    expect(src).toContain('allPayments.filter(p=>!p.isUnpaid).forEach(p=>{');
    expect(src).toContain('allPayments.filter(p=>p.isRefunded && p.refundedAt).forEach(p=>{');
    expect(src).not.toMatch(/allPayments\.filter\(p=>!p\.isUnpaid && !p\.isRefunded\)/);
  });
});

describe('매출 계산 로직 재현 — 부분환불 금액 검증(finance.js calcNet 사용)', () => {
  const settings = { vatRate: 3.3, cardFeeRate: 2.0 };

  // OverviewTab의 totals 계산과 동일한 2단계 로직(전액 포함 → 환불액만 차감).
  function computeNet(payments) {
    const paid = payments.filter(p => !p.isUnpaid);
    let net = 0;
    paid.forEach(p => { net += calcNet(p, settings).net; });
    const refundTotal = payments
      .filter(p => p.isRefunded && p.refundedAt)
      .reduce((s, p) => s + (Number(p.refundAmount) || 0), 0);
    return net - refundTotal;
  }

  it('부분환불 결제는 (결제액 − 환불액)만큼 매출에 남는다(수정 전엔 음수가 나왔다)', () => {
    const payment = {
      amount: 500000, method: 'cash', isUnpaid: false,
      isRefunded: true, refundAmount: 283500, refundedAt: '2026-07-20', paidAt: '2026-07-01',
    };
    // cash는 공제 없음(NO_DEDUCT_METHODS) → net(공제 전) = amount.
    expect(computeNet([payment])).toBe(500000 - 283500); // 216,500 — 수정 전엔 -283,500
    expect(computeNet([payment])).toBeGreaterThan(0);
  });

  it('환불 없는 일반 결제는 기존과 동일하게 전액이 매출로 잡힌다(회귀 방지)', () => {
    const payment = { amount: 300000, method: 'cash', isUnpaid: false, isRefunded: false, paidAt: '2026-07-01' };
    expect(computeNet([payment])).toBe(300000);
  });

  it('미수금(isUnpaid)은 여전히 매출에서 제외된다', () => {
    const payment = { amount: 300000, method: 'cash', isUnpaid: true, paidAt: '2026-07-01' };
    expect(computeNet([payment])).toBe(0);
  });

  it('전액환불(refundAmount === amount)이어도 순매출 기여는 0으로 수렴한다(음수로 빠지지 않음)', () => {
    const payment = {
      amount: 400000, method: 'cash', isUnpaid: false,
      isRefunded: true, refundAmount: 400000, refundedAt: '2026-07-15', paidAt: '2026-07-01',
    };
    expect(computeNet([payment])).toBe(0);
  });

  it('여러 회원의 결제가 섞여도 환불 회원분만 정확히 차감된다', () => {
    const payments = [
      { amount: 300000, method: 'cash', isUnpaid: false, isRefunded: false, paidAt: '2026-07-02' },
      {
        amount: 500000, method: 'cash', isUnpaid: false,
        isRefunded: true, refundAmount: 283500, refundedAt: '2026-07-20', paidAt: '2026-07-01',
      },
    ];
    expect(computeNet(payments)).toBe(300000 + (500000 - 283500));
  });
});
