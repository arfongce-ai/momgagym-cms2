// session_expiry.test.js
// ════════════════════════════════════════════════════════════════════════
//  배경: services/sessionExpiry.js(등록분(lot)별 유효기간 — 이용약관 3항: 10회
//  등록 시 최대 3개월, 20회 등록 시 최대 6개월 이내 소진, 경과 시 자동 소멸)는
//  구현은 돼 있었지만 테스트가 하나도 없었다. 이 파일이 회원 활성/비활성 판정
//  (Members.jsx·Home.jsx·memberList.js)과 만료 정산 지급액(finance.js) 양쪽의
//  기초가 되므로, 핵심 시나리오를 여기서 고정한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { addDaysYMD } from '../utils/dates';
import {
  expiryDaysForCount, buildMemberSessionExpiry, summarizeMemberSessionExpiry,
  isMemberExpired, expirySettlementRate, computeExpirySettlement,
} from '../services/sessionExpiry';

const settings = { vatRate: 3.3, cardFeeRate: 2.0, expiryDaysPer10Sessions: 90, expiryWarnDays: 30, lowSplitRate: 40 };

describe('expiryDaysForCount — 회차 → 유효기간(일수)', () => {
  it('10회=90일(3개월), 20회=180일(6개월) — 이용약관 3항과 정확히 일치', () => {
    expect(expiryDaysForCount(10, settings)).toBe(90);
    expect(expiryDaysForCount(20, settings)).toBe(180);
  });
  it('그 외 회차(5·15·30회 등)는 10회당 비율로 선형 추정한다', () => {
    expect(expiryDaysForCount(5, settings)).toBe(45);
    expect(expiryDaysForCount(15, settings)).toBe(135);
    expect(expiryDaysForCount(30, settings)).toBe(270);
  });
  it('0회 이하는 0일', () => {
    expect(expiryDaysForCount(0, settings)).toBe(0);
    expect(expiryDaysForCount(-5, settings)).toBe(0);
  });
  it('설정값(expiryDaysPer10Sessions)을 바꾸면 그 비율로 재계산된다', () => {
    expect(expiryDaysForCount(10, { ...settings, expiryDaysPer10Sessions: 60 })).toBe(60);
    expect(expiryDaysForCount(20, { ...settings, expiryDaysPer10Sessions: 60 })).toBe(120);
  });
  it('설정이 없으면 기본 90일/10회로 근사한다', () => {
    expect(expiryDaysForCount(10, {})).toBe(90);
    expect(expiryDaysForCount(10, undefined)).toBe(90);
  });
});

describe('buildMemberSessionExpiry — 등록분(lot)별 유효기간·상태 판정', () => {
  const member = {
    id: 'm1', joinDate: '2026-01-01',
    trainerSessions: { t1: { total: 10, remaining: 4 } },
  };
  const payments = [
    { id: 'p1', paidAt: '2026-01-05', amount: 600000, method: 'cash', sessionAdds: [{ trainerId: 't1', count: 10 }] },
  ];
  // startDate = orderDate(sessionStartDate 없으면 paidAt) = '2026-01-05'. expiresAt = +90일 = '2026-04-05'.

  it('만료까지 여유가 많으면(경고 기간 밖) 상태는 ok', () => {
    const lots = buildMemberSessionExpiry({ member, payments, settings, today: '2026-02-01' });
    const lot = lots.t1[0];
    expect(lot.expiresAt).toBe('2026-04-05');
    expect(lot.status).toBe('ok');
  });

  it('경고 기간(기본 30일) 이내면 warning, daysLeft가 정확히 계산된다', () => {
    const lots = buildMemberSessionExpiry({ member, payments, settings, today: '2026-03-20' });
    const lot = lots.t1[0];
    expect(lot.status).toBe('warning');
    expect(lot.daysLeft).toBe(16); // 3/20 → 4/5
  });

  it('유효기간이 지났는데 잔여가 남아 있으면 expired', () => {
    const lots = buildMemberSessionExpiry({ member, payments, settings, today: '2026-04-10' });
    const lot = lots.t1[0];
    expect(lot.status).toBe('expired');
    expect(lot.remaining).toBe(4);
  });

  it('잔여가 0이면(완전 소진) 유효기간이 지나도 ok — 정산 대상 아님', () => {
    const usedUpMember = { ...member, trainerSessions: { t1: { total: 10, remaining: 0 } } };
    const lots = buildMemberSessionExpiry({ member: usedUpMember, payments, settings, today: '2026-04-10' });
    expect(lots.t1[0].status).toBe('ok');
  });

  it('정산 기록(expirySettlements)이 있으면 만료가 지났어도 settled로 표시된다', () => {
    const settledPayments = [{
      ...payments[0],
      expirySettlements: { 'p1:t1:0': { trainerId: 't1', sessions: 4, amount: 100000, rate: 40, unit: 25000, settledAt: '2026-04-11' } },
    }];
    const lots = buildMemberSessionExpiry({ member, payments: settledPayments, settings, today: '2026-04-15' });
    expect(lots.t1[0].status).toBe('settled');
    expect(lots.t1[0].settledInfo).toBeTruthy();
  });

  it('legacy 등록분(sessionAdds 없는 구버전 결제)은 회원의 legacyExpirySettlements로 정산 여부를 판정한다', () => {
    const legacyMember = {
      ...member,
      legacyExpirySettlements: { t1: { trainerId: 't1', sessions: 4, amount: 90000, rate: 40, unit: 22500, settledAt: '2026-04-11' } },
    };
    const legacyPayments = [{ id: 'p0', paidAt: '2026-01-05', amount: 600000, method: 'cash' }]; // sessionAdds 없음 → legacy lot
    const lots = buildMemberSessionExpiry({ member: legacyMember, payments: legacyPayments, settings, today: '2026-04-15' });
    expect(lots.t1[0].legacy).toBe(true);
    expect(lots.t1[0].status).toBe('settled');
  });

  it('월정액(monthly) 슬롯은 세션 유효기간 판정에서 제외된다(횟수 개념 없음)', () => {
    const monthlyMember = { id: 'm2', trainerSessions: { t1: { monthly: true, active: true } } };
    const lots = buildMemberSessionExpiry({ member: monthlyMember, payments: [], settings, today: '2026-04-15' });
    expect(lots.t1).toBeUndefined();
  });

  it('FIFO 소진 배분 — 재등록 등 여러 등록분이 있으면 먼저 등록된(=먼저 소진되는) lot부터 잔여를 채운다', () => {
    // 1차 10회(1/5 시작, +90일=4/5 만료) 소진 8회 남음 2 → 이어서 2차 재등록 10회(2/1 시작)
    const twoLotMember = { id: 'm3', trainerSessions: { t1: { total: 20, remaining: 12 } } }; // 소진 8 = 1차 8+2차 0
    const twoLotPayments = [
      { id: 'p1', paidAt: '2026-01-05', amount: 600000, method: 'cash', sessionAdds: [{ trainerId: 't1', count: 10 }] },
      { id: 'p2', paidAt: '2026-02-01', amount: 600000, method: 'cash', sessionAdds: [{ trainerId: 't1', count: 10 }] },
    ];
    const lots = buildMemberSessionExpiry({ member: twoLotMember, payments: twoLotPayments, settings, today: '2026-04-10' });
    const [lot1, lot2] = lots.t1;
    expect(lot1.remaining).toBe(2);  // 10 - 8 소진
    expect(lot2.remaining).toBe(10); // 전혀 소진 안 됨(2차는 아직 시작 안 함)
    expect(lot1.status).toBe('expired'); // 1/5+90일=4/5 지남, 잔여 2 있음
    expect(lot2.status).toBe('warning'); // 2/1+90일=5/2, 4/10 기준 D-22 → 경고기간(30일) 이내
  });
});

describe('summarizeMemberSessionExpiry — 가장 급한 lot 대표 선정', () => {
  it('만료·임박 등록분이 없으면 hasExpired/hasWarning 모두 false', () => {
    const summary = summarizeMemberSessionExpiry({ t1: [{ remaining: 5, status: 'ok' }] });
    expect(summary.hasExpired).toBe(false);
    expect(summary.hasWarning).toBe(false);
    expect(summary.nearest).toBeNull();
  });
  it('잔여 0인 lot은 상태와 무관하게 대상에서 제외한다', () => {
    const summary = summarizeMemberSessionExpiry({ t1: [{ remaining: 0, status: 'expired' }] });
    expect(summary.hasExpired).toBe(false);
    expect(summary.actionable).toEqual([]);
  });
  it('여러 트레이너·lot 중 만료일이 가장 이른 것을 nearest로 뽑는다', () => {
    const lots = {
      t1: [{ id: 'a', remaining: 3, status: 'warning', expiresAt: '2026-05-01' }],
      t2: [{ id: 'b', remaining: 2, status: 'expired', expiresAt: '2026-03-01' }],
    };
    const summary = summarizeMemberSessionExpiry(lots);
    expect(summary.hasExpired).toBe(true);
    expect(summary.hasWarning).toBe(true);
    expect(summary.nearest.id).toBe('b'); // 더 이른 만료일
    expect(summary.actionable).toHaveLength(2);
  });
  it('settled 상태는 actionable에서 제외된다(이미 처리됨)', () => {
    const summary = summarizeMemberSessionExpiry({ t1: [{ remaining: 3, status: 'settled', expiresAt: '2026-01-01' }] });
    expect(summary.hasExpired).toBe(false);
    expect(summary.actionable).toEqual([]);
  });
});

describe('isMemberExpired — 세션제·월정액 통합 판정', () => {
  // 실행 시점(today)과 무관하게 항상 같은 결과가 나오도록 절대 날짜 대신
  // addDaysYMD(상대 일수)로 기준일을 잡는다.
  it('세션제: 등록일이 유효기간(90일)보다 훨씬 전이라 실제로 만료됐으면 true', () => {
    const member = { id: 'm1', joinDate: addDaysYMD(-200), trainerSessions: { t1: { total: 10, remaining: 3 } } };
    const payments = [{ id: 'p1', paidAt: addDaysYMD(-200), amount: 600000, method: 'cash', sessionAdds: [{ trainerId: 't1', count: 10 }] }];
    expect(isMemberExpired(member, payments, settings)).toBe(true);
  });

  it('세션제: 등록 직후라 유효기간이 한참 남았으면 false', () => {
    const member = { id: 'm1', joinDate: addDaysYMD(-1), trainerSessions: { t1: { total: 10, remaining: 3 } } };
    const payments = [{ id: 'p1', paidAt: addDaysYMD(-1), amount: 600000, method: 'cash', sessionAdds: [{ trainerId: 't1', count: 10 }] }];
    expect(isMemberExpired(member, payments, settings)).toBe(false);
  });

  it('세션제: 만료 임박(warning)일 뿐 아직 안 지났으면 false — "임박"과 "만료"는 다른 판정', () => {
    // 유효기간 90일 중 75일 경과 지점(경고기간 30일 이내지만 아직 안 지남).
    const member = { id: 'm1', joinDate: addDaysYMD(-75), trainerSessions: { t1: { total: 10, remaining: 3 } } };
    const payments = [{ id: 'p1', paidAt: addDaysYMD(-75), amount: 600000, method: 'cash', sessionAdds: [{ trainerId: 't1', count: 10 }] }];
    expect(isMemberExpired(member, payments, settings)).toBe(false);
  });

  it('세션제: 잔여가 이미 0이면(완전 소진) 등록일이 아무리 오래돼도 false', () => {
    const member = { id: 'm1', joinDate: addDaysYMD(-500), trainerSessions: { t1: { total: 10, remaining: 0 } } };
    const payments = [{ id: 'p1', paidAt: addDaysYMD(-500), amount: 600000, method: 'cash', sessionAdds: [{ trainerId: 't1', count: 10 }] }];
    expect(isMemberExpired(member, payments, settings)).toBe(false);
  });

  it('회원이 없으면 false', () => {
    expect(isMemberExpired(null, [], settings)).toBe(false);
  });

  it('월정액: 다음 결제예정일이 warnDays 이내면 true', () => {
    const member = { id: 'm1', monthly: { active: true, dueDate: addDaysYMD(3) } };
    expect(isMemberExpired(member, [], settings, 7)).toBe(true);
  });

  it('월정액: 다음 결제예정일이 warnDays보다 많이 남았으면 false', () => {
    const member = { id: 'm1', monthly: { active: true, dueDate: addDaysYMD(60) } };
    expect(isMemberExpired(member, [], settings, 7)).toBe(false);
  });
});

describe('expirySettlementRate — 만료 정산 비율 우선순위', () => {
  it('lot에 박제된 비율(hasFrozen)이 있으면 그 값을 최우선으로 쓴다', () => {
    const lot = { trainerId: 't1', hasFrozen: true, rate: 55 };
    expect(expirySettlementRate(lot, { trainerSplitRates: { t1: 40 }, lowSplitRate: 30 })).toBe(55);
  });
  it('박제 비율이 없으면 트레이너 수동 지정 비율(settings.trainerSplitRates)을 쓴다', () => {
    const lot = { trainerId: 't1', hasFrozen: false };
    expect(expirySettlementRate(lot, { trainerSplitRates: { t1: 50 }, lowSplitRate: 30 })).toBe(50);
  });
  it('둘 다 없으면 정산비율 하한(lowSplitRate)으로 폴백한다', () => {
    const lot = { trainerId: 't1', hasFrozen: false };
    expect(expirySettlementRate(lot, { trainerSplitRates: {}, lowSplitRate: 35 })).toBe(35);
  });
  it('설정 자체가 없으면 기본 40%로 폴백한다', () => {
    const lot = { trainerId: 't1', hasFrozen: false };
    expect(expirySettlementRate(lot, {})).toBe(40);
  });
});

describe('computeExpirySettlement — 만료 정산액 계산', () => {
  it('반환값: sessions=반올림된 잔여, unit=lot.unit, rate=우선순위 규칙, amount=단가×횟수×비율', () => {
    const lot = { trainerId: 't1', remaining: 4, unit: 25000, hasFrozen: true, rate: 40 };
    const result = computeExpirySettlement(lot, settings);
    expect(result).toEqual({ sessions: 4, unit: 25000, rate: 40, amount: 40000 }); // 25000×4×0.4=40000
  });
  it('잔여가 소수(부정확한 데이터)여도 반올림해 세션 수를 정한다', () => {
    const lot = { trainerId: 't1', remaining: 3.6, unit: 10000, hasFrozen: true, rate: 50 };
    expect(computeExpirySettlement(lot, settings).sessions).toBe(4);
  });
  it('단가가 없으면(0) 정산액도 0원', () => {
    const lot = { trainerId: 't1', remaining: 5, unit: 0, hasFrozen: true, rate: 50 };
    expect(computeExpirySettlement(lot, settings).amount).toBe(0);
  });
});
