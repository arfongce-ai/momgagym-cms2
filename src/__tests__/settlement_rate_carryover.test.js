// settlement_rate_carryover.test.js
// ════════════════════════════════════════════════════════════════════════
//  실제 프로덕션에서 사장님이 발견한 버그: 6월에 60%로 박제(고정)된 회원의
//  정산비율이, 7월 정산에서 50%로 표시됨(등록월 고정이 지켜지지 않음).
//
//  원인: computeSessionSettlement가 등록월 박제 비율(lot.rate/splitRateAtPay)을
//  적용할지 결정할 때, "그 트레이너가 트레이너 레벨 수동 floor(trainerSplitRates)를
//  하나라도 갖고 있으면(fallbackSplit.mode==='manual') 무조건 그 달 값을 쓴다"는
//  조건이 있었다. 이 gym은 거의 모든 트레이너에게 수동 floor가 설정돼 있어서,
//  등록월에 조건 충족으로 60%까지 올라갔던 회차가, 다음 달에 조건 미달로 floor인
//  50%까지 깎여 보였다 — "등록월 고정"이라는 기능 자체가 사실상 작동하지 않았다.
//
//  수정: 박제값과 "그 달 값(수동floor/자동판정)" 중 더 높은 쪽을 쓴다.
//  determineSplitRate 자체가 "수동 지정은 하한이고 조건이 좋으면 상향, 낮추지
//  않는다"는 원칙을 쓰므로, 박제값도 같은 원칙의 연장으로 다룬다:
//    · 등록월에 잠긴 비율이 그 달 값보다 높으면 → 등록월 비율 유지 (이번에 고친 부분)
//    · 등록월에 잠긴 비율이 그 달 값보다 낮으면 → 그 달의 더 나은 값으로 상향
//      (기존에도 있던, 이미 테스트로 보호되던 동작 — store.test.js
//      '수동 지정이 있으면 박제보다 우선' 케이스와 정확히 대칭)
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { computeSessionSettlement } from '../services/finance';

describe('정산비율 등록월 고정 — 이후 달로 정확히 이월되는지', () => {
  // 실제 스크린샷 사례를 그대로 재현: 최흥식(회원) - 김나영(트레이너), 20회 등록,
  // 6월에 조건 충족으로 60% 박제, 6월 5회+7월 5회 진행(총 10회, 잔여 10).
  const settings = {
    vatRate: 3.3, cardFeeRate: 2.0,
    trainerSplitRates: { kim: 50 }, // 김나영 수동 floor 50%
    rate60MinSales: 3000000, rate50MinBlog: 2, rate50MinStudy: 1, lowSplitRate: 40,
  };
  const trainers = [{ id: 'kim', name: '김나영' }];
  const members = [
    { id: 'm1', name: '최흥식', trainerSessions: { kim: { total: 20, remaining: 10 } } },
    { id: 'm2', name: '더미신규', trainerSessions: { kim: { total: 1, remaining: 1 } } },
  ];
  const p1 = {
    id: 'p1', memberId: 'm1', paidAt: '2026-06-08', amount: 1100000, method: 'transfer',
    trainerIds: ['kim'], isNew: true, consultTrainerId: 'kim',
    sessionAdds: [{ trainerId: 'kim', count: 20 }],
    splitRateAtPay: { kim: 60 }, // 6월 실적으로 60% 박제
  };
  // 6월 조건B(매출 300만) 충족용 별도 신규결제(다른 회원, 김나영 상담) — 6월에만 존재.
  const p2 = {
    id: 'p2', memberId: 'm2', paidAt: '2026-06-15', amount: 3500000, method: 'transfer',
    trainerIds: ['kim'], isNew: true, consultTrainerId: 'kim',
    sessionAdds: [{ trainerId: 'kim', count: 1 }],
  };
  const payments = { m1: [p1], m2: [p2] };
  const recordsJune = [
    { trainerId: 'kim', channel: 'blog', date: '2026-06-05' },
    { trainerId: 'kim', channel: 'blog', date: '2026-06-06' },
    { trainerId: 'kim', channel: 'study', date: '2026-06-07' },
  ];
  const schedules = [
    ...['15','18','22','24','27'].map((d,i)=>({ id:`s6-${i}`, memberId:'m1', trainerId:'kim', status:'attended', date:`2026-06-${d}` })),
    ...['06','09','13','16','20'].map((d,i)=>({ id:`s7-${i}`, memberId:'m1', trainerId:'kim', status:'attended', date:`2026-07-${d}` })),
  ];

  it('6월: 그 달 조건 충족(블로그·스터디+매출)으로 60%까지 상향된다', () => {
    const b = computeSessionSettlement({ trainers, members, schedules, payments, records: recordsJune, settings, ym: '2026-06' })[0];
    const row = b.rows.find(r => r.memberId === 'm1');
    expect(row.rate).toBe(60);
    expect(row.rateFrozen).toBe(true);
    expect(row.cnt).toBe(5);
    expect(row.unit).toBe(55000); // 1,100,000 ÷ 20회
    expect(row.payAmount).toBe(165000); // 55,000×5회×60%
  });

  it('7월: 그 달 실적이 없어 수동floor(50%)로 돌아가더라도, 등록월에 고정된 60%가 그대로 유지된다', () => {
    const b = computeSessionSettlement({ trainers, members, schedules, payments, records: [], settings, ym: '2026-07' })[0];
    const row = b.rows.find(r => r.memberId === 'm1');
    expect(row.rate).toBe(60); // 50%로 깎이면 안 됨 — 이번에 고친 부분
    expect(row.rateFrozen).toBe(true);
    expect(row.cnt).toBe(5);
    expect(row.payAmount).toBe(165000); // 55,000×5회×60% — 7월에도 동일해야 함
  });

  it('반대 방향(등록월에 낮게 박제됐는데 이후 트레이너 floor가 오른 경우)은 더 높은 현재값으로 상향된다', () => {
    // store.test.js의 '수동 지정이 있으면 박제보다 우선'과 동일한 취지 — 여기서는
    // computeSessionSettlement를 통해 실제 정산 파이프라인 레벨에서 재확인한다.
    const lowFrozenPayments = {
      m1: [{ id:'p3', memberId:'m1', paidAt:'2026-04-01', amount:1000000, method:'cash',
             trainerIds:['kim'], sessionAdds:[{trainerId:'kim', count:20}], splitRateAtPay:{ kim:40 } }],
    };
    const raisedSettings = { ...settings, trainerSplitRates: { kim: 55 } }; // 이후 floor가 55%로 인상됨
    const sch = Array.from({length:5},(_,i)=>({ id:`x${i}`, memberId:'m1', trainerId:'kim', status:'attended', date:'2026-07-10' }));
    const b = computeSessionSettlement({ trainers, members: [members[0]], schedules: sch, payments: lowFrozenPayments, records: [], settings: raisedSettings, ym: '2026-07' })[0];
    const row = b.rows.find(r => r.memberId === 'm1');
    expect(row.rate).toBe(55); // 등록월의 40%가 아니라, 인상된 현재 floor(55%)로 상향
  });
});

describe('전체 파이프라인 통합 — 수납(등록) → 세션(총/잔여) → 스케줄(출석횟수) → 정산%', () => {
  // 최흥식 사례를 처음부터 끝까지 하나로 이어서, 각 단계가 서로 어긋나지 않는지 확인.
  const settings = {
    vatRate: 3.3, cardFeeRate: 2.0,
    trainerSplitRates: { kim: 50 },
    rate60MinSales: 3000000, rate50MinBlog: 2, rate50MinStudy: 1, lowSplitRate: 40,
  };
  const trainers = [{ id: 'kim', name: '김나영' }];

  it('20회 등록 → 10회 출석 소진 → 잔여 10 → 정산 단가/횟수/비율이 서로 일치한다', () => {
    // 1) 수납: 1,100,000원 결제로 20회 등록 (계좌: 공제 없음 → net=1,100,000)
    const member = { id: 'm1', name: '최흥식', trainerSessions: { kim: { total: 20, remaining: 10 } } };
    const payment = {
      id: 'p1', memberId: 'm1', paidAt: '2026-06-08', amount: 1100000, method: 'transfer',
      trainerIds: ['kim'], isNew: true, consultTrainerId: 'kim',
      sessionAdds: [{ trainerId: 'kim', count: 20 }], splitRateAtPay: { kim: 60 },
    };
    // 2) 세션: 총 20 / 잔여 10 (스크린샷과 동일)
    expect(member.trainerSessions.kim.total).toBe(20);
    expect(member.trainerSessions.kim.remaining).toBe(10);

    // 3) 스케줄: 6월 5회 + 7월 5회 = 10회 출석 (= 총-잔여 = 소진량과 일치해야 함)
    const schedules = [
      ...Array.from({length:5},(_,i)=>({ id:`j${i}`, memberId:'m1', trainerId:'kim', status:'attended', date:`2026-06-1${i}` })),
      ...Array.from({length:5},(_,i)=>({ id:`u${i}`, memberId:'m1', trainerId:'kim', status:'attended', date:`2026-07-1${i}` })),
    ];
    const consumedCount = schedules.filter(s => s.status==='attended').length;
    expect(consumedCount).toBe(member.trainerSessions.kim.total - member.trainerSessions.kim.remaining);

    // 4) 정산%: 6월 5회/60%, 7월 5회/60%(고정 이월) — 단가는 두 달 모두 동일해야 함
    const juneResult = computeSessionSettlement({
      trainers, members: [member], schedules, payments: { m1: [payment] }, records: [], settings, ym: '2026-06',
    })[0];
    const julyResult = computeSessionSettlement({
      trainers, members: [member], schedules, payments: { m1: [payment] }, records: [], settings, ym: '2026-07',
    })[0];
    const juneRow = juneResult.rows.find(r => r.memberId === 'm1');
    const julyRow = julyResult.rows.find(r => r.memberId === 'm1');

    expect(juneRow.unit).toBe(julyRow.unit);       // 단가는 등록 총회차 기준이라 달마다 같아야 함
    expect(juneRow.unit).toBe(55000);               // 1,100,000 ÷ 20
    expect(juneRow.cnt).toBe(5);
    expect(julyRow.cnt).toBe(5);
    expect(juneRow.rate).toBe(60);
    expect(julyRow.rate).toBe(60);                  // 이번에 고친 부분 — 이월 확인
    expect(juneRow.payAmount + julyRow.payAmount).toBe(330000); // 55,000×10회×60%
  });
});
