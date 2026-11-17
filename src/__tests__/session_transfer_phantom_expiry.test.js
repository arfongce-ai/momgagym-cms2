// [2026-11-17] 양도 후 유령 잔여(만료 카드) — 퇴사 트레이너 이름으로 "만료됨·잔여 5회"가 뜨던 문제.
import { describe, it, expect } from 'vitest';
import { buildMemberSessionExpiry, moveSessionAdds } from '../services/sessionExpiry';

const settings = { vatRate: 3.3, cardFeeRate: 2.0, expiryDaysPer10Sessions: 90, expiryWarnDays: 30, lowSplitRate: 40 };
const sumRemaining = (lots) => lots.reduce((s, l) => s + l.remaining, 0);

describe('buildMemberSessionExpiry — 이미 양도된 옛 데이터', () => {
  // 출발: 10회 등록·5회 소진·5회 양도 → 슬롯 total 5·remaining 0, 결제 sessionAdds 는 그대로 10
  const member = { id: 'm1', joinDate: '2026-01-01', trainerSessions: { t1: { total: 5, remaining: 0 }, t2: { total: 5, remaining: 3 } } };
  const payments = [{ id: 'p1', paidAt: '2026-01-05', amount: 600000, method: 'cash', sessionAdds: [{ trainerId: 't1', count: 10 }] }];

  it('등록분 횟수 합이 total 보다 크면 초과분은 소진 처리 → 유령 잔여가 없다', () => {
    const r = buildMemberSessionExpiry({ member, payments, settings, today: '2026-11-17' });
    expect(sumRemaining(r.t1 || [])).toBe(0);
    expect((r.t1 || []).every(l => l.status !== 'expired')).toBe(true);
  });
  it('정상 데이터(합계 = total)는 그대로다', () => {
    const m = { id: 'm1', joinDate: '2026-01-01', trainerSessions: { t1: { total: 10, remaining: 4 } } };
    const r = buildMemberSessionExpiry({ member: m, payments, settings, today: '2026-02-01' });
    expect(sumRemaining(r.t1)).toBe(4);
  });
  it('등록분 잔여 합은 항상 슬롯 잔여와 같다', () => {
    const m = { id: 'm1', joinDate: '2026-01-01', trainerSessions: { t1: { total: 5, remaining: 2 } } };
    const r = buildMemberSessionExpiry({ member: m, payments, settings, today: '2026-02-01' });
    expect(sumRemaining(r.t1)).toBe(2);
  });
});

describe('moveSessionAdds — 양도 시 등록횟수 이동', () => {
  const pays = [
    { id: 'old', paidAt: '2026-01-05', sessionAdds: [{ trainerId: 't1', count: 10 }] },
    { id: 'new', paidAt: '2026-03-05', sessionAdds: [{ trainerId: 't1', count: 4 }, { trainerId: 't2', count: 2 }] },
  ];
  it('최근 결제부터 차감하고 대상 줄이 있으면 합산한다', () => {
    const out = moveSessionAdds(pays, 't1', 't2', 3);
    expect(out).toHaveLength(1);
    expect(out[0].pid).toBe('new');
    expect(out[0].sessionAdds).toEqual([{ trainerId: 't1', count: 1 }, { trainerId: 't2', count: 5 }]);
  });
  it('여러 결제에 걸치면 순서대로 넘어가며, 대상 줄이 없으면 뒤에 추가한다(배열 순번 유지)', () => {
    const out = moveSessionAdds(pays, 't1', 't3', 6);
    const byId = Object.fromEntries(out.map(o => [o.pid, o.sessionAdds]));
    expect(byId.new).toEqual([{ trainerId: 't1', count: 0 }, { trainerId: 't2', count: 2 }, { trainerId: 't3', count: 4 }]);
    expect(byId.old).toEqual([{ trainerId: 't1', count: 8 }, { trainerId: 't3', count: 2 }]);
  });
  it('입력은 바꾸지 않고, 같은 트레이너·0회·환불 결제는 무시한다', () => {
    const snap = JSON.stringify(pays);
    moveSessionAdds(pays, 't1', 't2', 3);
    expect(JSON.stringify(pays)).toBe(snap);
    expect(moveSessionAdds(pays, 't1', 't1', 3)).toEqual([]);
    expect(moveSessionAdds(pays, 't1', 't2', 0)).toEqual([]);
    expect(moveSessionAdds([{ ...pays[0], isRefunded: true }], 't1', 't2', 3)).toEqual([]);
  });
  it('양도 후 같은 데이터로 만료 계산하면 출발 트레이너 유령 잔여가 없다', () => {
    const moved = moveSessionAdds(pays, 't1', 't2', 5);
    const next = pays.map(p => { const h = moved.find(x => x.pid === p.id); return h ? { ...p, sessionAdds: h.sessionAdds } : p; });
    // t1: 14 등록 - 5 양도 = 9, 5 소진 → total 9, remaining 4 가정이 아니라 슬롯 total=9·remaining=4
    const member = { id: 'm1', joinDate: '2026-01-01', trainerSessions: { t1: { total: 9, remaining: 4 }, t2: { total: 7, remaining: 7 } } };
    const r = buildMemberSessionExpiry({ member, payments: next, settings, today: '2026-04-01' });
    expect(sumRemaining(r.t1)).toBe(4);
    expect(sumRemaining(r.t2)).toBe(7);
  });
});

import { findSessionAddsMismatches } from '../services/sessionExpiry';
describe('findSessionAddsMismatches — 전체 회원 양도 불일치 점검 [2026-11-17]', () => {
  const pay = (id, adds) => ({ id, paidAt: '2026-01-05', sessionAdds: adds });
  it('초과분과 받은 쪽(부족한 트레이너)을 찾고, 한 명이면 정리 가능으로 본다', () => {
    const members = [{ id: 'm1', name: '가', trainerSessions: { t1: { total: 5, remaining: 0 }, t2: { total: 5, remaining: 3 } } }];
    const rows = findSessionAddsMismatches({ members, getPayments: () => [pay('p1', [{ trainerId: 't1', count: 10 }])] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ trainerId: 't1', addsSum: 10, total: 5, excess: 5, repairable: true });
    expect(rows[0].receivers).toEqual([{ trainerId: 't2', deficit: 5 }]);
  });
  it('받은 쪽이 없거나 여럿이면 정리 불가(직접 확인)', () => {
    const none = [{ id: 'm1', name: '가', trainerSessions: { t1: { total: 5, remaining: 0 } } }];
    expect(findSessionAddsMismatches({ members: none, getPayments: () => [pay('p1', [{ trainerId: 't1', count: 10 }])] })[0].repairable).toBe(false);
    const many = [{ id: 'm1', name: '가', trainerSessions: { t1: { total: 5, remaining: 0 }, t2: { total: 3, remaining: 3 }, t3: { total: 3, remaining: 3 } } }];
    expect(findSessionAddsMismatches({ members: many, getPayments: () => [pay('p1', [{ trainerId: 't1', count: 10 }])] })[0].repairable).toBe(false);
  });
  it('정상 회원(합계 = total)과 월정액은 나오지 않는다', () => {
    const members = [{ id: 'm1', name: '가', trainerSessions: { t1: { total: 10, remaining: 4 } } }];
    expect(findSessionAddsMismatches({ members, getPayments: () => [pay('p1', [{ trainerId: 't1', count: 10 }])] })).toEqual([]);
  });
  it('양도로 슬롯이 통째로 사라진 경우(total 없음)도 잡는다', () => {
    const members = [{ id: 'm1', name: '가', trainerSessions: { t2: { total: 5, remaining: 5 } } }];
    const rows = findSessionAddsMismatches({ members, getPayments: () => [pay('p1', [{ trainerId: 't1', count: 5 }])] });
    expect(rows[0]).toMatchObject({ trainerId: 't1', total: 0, excess: 5, repairable: true });
  });
});
