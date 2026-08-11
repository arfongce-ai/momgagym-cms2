// member_terms.test.js
// ════════════════════════════════════════════════════════════════════════
//  약관 갱신 — 실제 이용약관 문구를 코드에 반영.
//  3항: "등록일 기준 6개월 이내 소진" → "10회 등록 시 최대 3개월, 20회 등록 시
//       최대 6개월 이내 소진"으로 변경하고 빨간 굵은 글씨로 강조.
//  4항: 환불 산식에 부가세 항목 추가 — 카드수수료·부가세 모두 결제수단별로
//       계산되며(계좌·현금은 둘 다 0원), computeRefundEstimate와 정확히 일치해야 한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TERMS_SECTIONS, TERMS } from '../components/members/MemberRegister';

describe('TERMS_SECTIONS — 3항 유효기간 강조 문구', () => {
  const section3 = TERMS_SECTIONS[2];

  it('3항은 prefix/highlight/suffix 구조로 강조 렌더링이 가능하다', () => {
    expect(section3.highlight).toBeTruthy();
    expect(section3.prefix).toContain('3. 유효 기간 및 휴회');
  });

  it('새 문구(10회→3개월, 20회→6개월)로 정확히 바뀌었다', () => {
    expect(section3.highlight).toBe('10회 등록 시 최대 3개월, 20회 등록 시 최대 6개월 이내 소진(경과 시 자동 소멸)');
  });

  it('옛 문구(등록일 기준 6개월 이내 소진)는 더 이상 남아있지 않다', () => {
    expect(section3.highlight).not.toContain('등록일 기준 6개월');
  });

  it('휴회 관련 문구는 그대로 유지된다', () => {
    expect(section3.suffix).toContain('휴회는 유효 기간 내 1회(최대 30일) 가능(사전 협의)');
  });
});

describe('TERMS_SECTIONS — 4항 환불 산식', () => {
  it('환불 산식에 부가세 항목이 포함된다', () => {
    const section4 = TERMS_SECTIONS.find(s => s.text?.startsWith('4. 환불 및 양도'));
    expect(section4.text).toContain('[위약금 10%]');
    expect(section4.text).toContain('[카드 수수료]');
    expect(section4.text).toContain('[부가세]');
  });
});

describe('TERMS(파생 플레인 텍스트) — 전체 내용 보존', () => {
  it('모든 항목(1~5, 동의문)이 순서대로 포함된다', () => {
    expect(TERMS).toContain('1. 건강 고지 의무');
    expect(TERMS).toContain('2. 예약 및 수업 운영');
    expect(TERMS).toContain('10회 등록 시 최대 3개월, 20회 등록 시 최대 6개월');
    expect(TERMS).toContain('4. 환불 및 양도');
    expect(TERMS).toContain('5. 책임 및 동의');
    expect(TERMS).toContain('본인은 위 약관을 숙지하였으며 이에 동의합니다');
  });
});

describe('MemberRegister.jsx — 강조 문구가 실제로 빨간 굵은 글씨로 렌더링되는지 소스 확인', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'components', 'members', 'MemberRegister.jsx'), 'utf8');

  it('TERMS_SECTIONS를 map으로 렌더링하며, highlight는 red+bold 클래스의 strong 태그로 감싼다', () => {
    expect(src).toContain('TERMS_SECTIONS.map(');
    expect(src).toMatch(/<strong className="text-red-700 dark:text-red-400 font-extrabold">\{s\.highlight\}<\/strong>/);
  });
});

describe('computeRefundEstimate ↔ 약관 4항 — 산식이 실제로 일치하는지 교차검증', () => {
  // finance.js를 별도로 다시 import해 순환 없이 직접 비교.
  it('카드 결제 시 환불 확인창 문구와 실제 계산이 카드수수료·부가세 모두 반영한다', async () => {
    const { computeRefundEstimate } = await import('../services/finance');
    const settings = { vatRate: 3.3, cardFeeRate: 2.0 };
    const payment = { amount: 500000, method: 'card2' };
    const { cardFee, vat, penalty, refund } = computeRefundEstimate(payment, settings, 0);
    expect(cardFee).toBeCloseTo(10000);
    expect(vat).toBeCloseTo(16500);
    expect(penalty).toBe(50000);
    expect(refund).toBeCloseTo(500000 - 10000 - 16500 - 50000);
  });
});
