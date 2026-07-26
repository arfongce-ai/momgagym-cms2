// memberList 헬퍼 회귀 테스트: 세션마감/비활성 판정 + 정렬
import { describe, it, expect } from 'vitest';
import {
  isSessionExhausted, isMemberInactive, sortByName, sortExpiredLast, scopeMembersToTrainer, getUserTrainerId,
} from '../utils/memberList.js';

describe('isSessionExhausted (세션 마감 판정)', () => {
  it('세션제 슬롯 잔여가 모두 0이면 마감', () => {
    expect(isSessionExhausted({ trainerSessions: { t1: { total: 10, remaining: 0 } } })).toBe(true);
  });
  it('잔여가 하나라도 남으면 마감 아님', () => {
    expect(isSessionExhausted({ trainerSessions: { t1: { total: 10, remaining: 0 }, t2: { total: 5, remaining: 2 } } })).toBe(false);
  });
  it('세션 슬롯이 없으면 마감 아님', () => {
    expect(isSessionExhausted({ trainerSessions: {} })).toBe(false);
    expect(isSessionExhausted({})).toBe(false);
  });
  it('월정액 슬롯은 횟수 판정에서 제외 — 월정액만 있으면 마감 아님', () => {
    expect(isSessionExhausted({ trainerSessions: { t1: { monthly: { fee: 100000 }, total: 0, remaining: 0 } } })).toBe(false);
  });
  it('월정액 활성 회원은 세션 잔여 0이어도 마감 아님', () => {
    expect(isSessionExhausted({ monthly: { active: true }, trainerSessions: { t1: { total: 10, remaining: 0 } } })).toBe(false);
  });
  it('세션 슬롯 잔여 0 + 월정액 슬롯 혼재: 세션 슬롯만 보고 마감 처리', () => {
    expect(isSessionExhausted({ trainerSessions: { t1: { total: 10, remaining: 0 }, t2: { monthly: {}, remaining: 0 } } })).toBe(true);
  });
});

describe('isMemberInactive (결제만료 OR 세션마감)', () => {
  it('세션 마감 회원은 비활성', () => {
    expect(isMemberInactive({ trainerSessions: { t1: { total: 10, remaining: 0 } } })).toBe(true);
  });
  it('잔여 있는 일반 회원은 활성', () => {
    expect(isMemberInactive({ trainerSessions: { t1: { total: 10, remaining: 3 } } })).toBe(false);
  });
});

describe('sortExpiredLast (가나다 + 비활성 하단)', () => {
  it('활성 회원 가나다 후 비활성 회원 가나다', () => {
    const ms = [
      { name: '하영', trainerSessions: { t1: { total: 10, remaining: 5 } } }, // 활성
      { name: '강희', trainerSessions: { t1: { total: 10, remaining: 0 } } }, // 마감
      { name: '나래', trainerSessions: { t1: { total: 10, remaining: 2 } } }, // 활성
      { name: '바다', trainerSessions: { t1: { total: 10, remaining: 0 } } }, // 마감
    ];
    const out = sortExpiredLast(ms).map(m => m.name);
    expect(out).toEqual(['나래', '하영', '강희', '바다']); // 활성(나래·하영) → 마감(강희·바다)
  });
});

describe('getUserTrainerId / scopeMembersToTrainer', () => {
  it('트레이너는 본인 담당만, 관리자는 전체', () => {
    const ms = [
      { id: 'a', trainerSessions: { t1: {} } },
      { id: 'b', trainerSessions: { t2: {} } },
    ];
    expect(getUserTrainerId({ role: 'trainer', trainerId: 't1' })).toBe('t1');
    expect(getUserTrainerId({ role: 'admin' })).toBe(null);
    expect(scopeMembersToTrainer(ms, { role: 'trainer', trainerId: 't1' }).map(m => m.id)).toEqual(['a']);
    expect(scopeMembersToTrainer(ms, { role: 'admin' }).length).toBe(2);
  });
});
