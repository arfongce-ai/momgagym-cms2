// reservationService.js — [예약 생성 프로젝트 1단계 2026-08-08]
// proposeReservation은 순수 조회(부작용 없음)라 momi_voice.test.js의
// matchWakeWord와 같은 방식으로 실제 함수를 직접 불러와 검증한다.
import { describe, expect, it, vi, beforeEach } from 'vitest';

const MEMBERS = [
  { id: 'm1', name: '홍길동', trainerSessions: { t1: { total: 20, remaining: 8 } } },
  { id: 'm2', name: '김영희', trainerSessions: { t1: { total: 10, remaining: 0 } } },
  { id: 'm3', name: '김영희민', trainerSessions: {} }, // 부분 문자열 겹침 케이스
];
const TRAINERS = [
  { id: 't1', name: '김민준', color: '#f59e0b' },
  { id: 't2', name: '이서연', color: '#10b981' },
];
const SCHEDULES = [
  {
    id: 's1', memberId: 'm1', memberName: '홍길동', trainerId: 't1',
    date: '2026-08-10', startTime: '10:00', endTime: '11:00', status: 'scheduled',
  },
  {
    id: 's2', memberId: 'm2', memberName: '김영희', trainerId: 't2',
    date: '2026-08-10', startTime: '14:00', endTime: '15:00', status: 'canceled', // 취소건 — 충돌 대상 아님
  },
];

const createScheduleWithDeduction = vi.fn(async (draft) => ({ ...draft, id: 'new-s' }));

vi.mock('../demoData.js', () => ({
  store: {
    getMembers: () => MEMBERS,
    getTrainers: () => TRAINERS,
    getSchedules: () => SCHEDULES,
    createScheduleWithDeduction: (draft) => createScheduleWithDeduction(draft),
  },
}));

import { proposeReservation, confirmReservation } from '../services/reservationService.js';

describe('proposeReservation() — 회원 매칭', () => {
  it('이름이 정확히 일치하는 회원을 찾는다', () => {
    const p = proposeReservation({ memberQuery: '홍길동', trainerId: 't2', date: '2026-08-11', startTime: '09:00' });
    expect(p.draft.memberId).toBe('m1');
  });

  it('일치하는 회원이 없으면 경고를 담고 memberName은 입력값 그대로 남긴다', () => {
    const p = proposeReservation({ memberQuery: '없는이름', trainerId: 't2', date: '2026-08-11', startTime: '09:00' });
    expect(p.draft.memberId).toBeNull();
    expect(p.draft.memberName).toBe('없는이름');
    expect(p.ready).toBe(false);
    expect(p.warnings.some((w) => w.includes('없는이름'))).toBe(true);
  });

  it('회원 지정 없이(상담 등) 예약을 제안할 수 있다', () => {
    const p = proposeReservation({ trainerId: 't2', date: '2026-08-11', startTime: '09:00' });
    expect(p.draft.memberId).toBeNull();
    expect(p.warnings.some((w) => w.includes('회원'))).toBe(false);
  });
});

describe('proposeReservation() — 시간 충돌 검사(scheduleAudit.js same_slot과 동일 기준)', () => {
  it('트레이너가 같은 날짜·시작시간에 이미 예약이 있으면 경고하고 ready=false', () => {
    const p = proposeReservation({ memberQuery: '김영희', trainerId: 't1', date: '2026-08-10', startTime: '10:00' });
    expect(p.ready).toBe(false);
    expect(p.warnings.some((w) => w.includes('김민준') && w.includes('이미 다른 예약'))).toBe(true);
  });

  it('취소된(status: canceled) 예약은 충돌로 안 본다', () => {
    const p = proposeReservation({ memberQuery: '홍길동', trainerId: 't2', date: '2026-08-10', startTime: '14:00' });
    expect(p.ready).toBe(true);
  });

  it('같은 시간이어도 트레이너가 다르면 충돌이 아니다', () => {
    const p = proposeReservation({ memberQuery: '김영희', trainerId: 't2', date: '2026-08-10', startTime: '10:00' });
    expect(p.warnings.some((w) => w.includes('김민준'))).toBe(false);
  });

  it('회원이 그 시간에 이미 다른 예약이 있으면(다른 트레이너와) 경고한다', () => {
    const p = proposeReservation({ memberQuery: '홍길동', trainerId: 't2', date: '2026-08-10', startTime: '10:00' });
    expect(p.warnings.some((w) => w.includes('홍길동') && w.includes('이미 다른 예약'))).toBe(true);
  });

  it('충돌이 전혀 없으면 ready=true', () => {
    const p = proposeReservation({ memberQuery: '홍길동', trainerId: 't1', date: '2026-08-15', startTime: '09:00' });
    expect(p.ready).toBe(true);
    expect(p.warnings).toEqual([]);
  });
});

describe('proposeReservation() — 세션 잔액 확인', () => {
  it('잔여 세션이 0이면 경고하되 ready를 막진 않아도 warnings엔 반영한다', () => {
    const p = proposeReservation({ memberQuery: '김영희', trainerId: 't1', date: '2026-08-20', startTime: '09:00' });
    expect(p.warnings.some((w) => w.includes('잔여') && w.includes('0회'))).toBe(true);
    expect(p.ready).toBe(false);
  });

  it('잔여 세션이 있으면 remainingAfter를 -1로 계산한다', () => {
    const p = proposeReservation({ memberQuery: '홍길동', trainerId: 't1', date: '2026-08-20', startTime: '09:00' });
    expect(p.remainingAfter).toBe(7);
  });

  it('해당 트레이너의 이용권이 아예 없으면(월정액 등) remainingAfter는 null(추측 안 함)', () => {
    const p = proposeReservation({ memberQuery: '홍길동', trainerId: 't2', date: '2026-08-20', startTime: '09:00' });
    expect(p.remainingAfter).toBeNull();
  });
});

describe('proposeReservation() — 필수값 방어', () => {
  it('date나 startTime이 없으면 경고하고 ready=false', () => {
    const p = proposeReservation({ memberQuery: '홍길동', trainerId: 't1' });
    expect(p.ready).toBe(false);
    expect(p.warnings.some((w) => w.includes('날짜'))).toBe(true);
  });

  it('endTime을 안 주면 시작시간 +1시간으로 자동 계산한다', () => {
    const p = proposeReservation({ trainerId: 't1', date: '2026-08-20', startTime: '09:30' });
    expect(p.draft.endTime).toBe('10:30');
  });

  it('23시대 시작이면 자정을 넘겨 00시대로 계산한다(단순 +1시간, 날짜 안 넘김에 유의)', () => {
    const p = proposeReservation({ trainerId: 't1', date: '2026-08-20', startTime: '23:30' });
    expect(p.draft.endTime).toBe('00:30');
  });
});

// [예약 생성 프로젝트 2026-08-08] 폰=trainerId(로그인 정보, 정확) vs
// 키오스크=trainerName(말로 지정, 퍼지 매칭) — 사용자가 명시적으로 선택한 구분.
describe('proposeReservation() — 트레이너 지정 방식(폰: trainerId / 키오스크: trainerName)', () => {
  it('trainerId가 있으면(폰) 그대로 정확히 매칭한다', () => {
    const p = proposeReservation({ trainerId: 't1', date: '2026-08-20', startTime: '09:00' });
    expect(p.draft.trainerId).toBe('t1');
    expect(p.draft.trainerName).toBe('김민준');
  });

  it('trainerName만 있으면(키오스크) 이름으로 찾아서 trainerId를 채운다', () => {
    const p = proposeReservation({ trainerName: '이서연', date: '2026-08-20', startTime: '09:00' });
    expect(p.draft.trainerId).toBe('t2');
    expect(p.draft.trainerName).toBe('이서연');
  });

  it('trainerId와 trainerName이 둘 다 있으면 trainerId(정확한 쪽)를 우선한다', () => {
    const p = proposeReservation({ trainerId: 't1', trainerName: '이서연', date: '2026-08-20', startTime: '09:00' });
    expect(p.draft.trainerId).toBe('t1'); // trainerName('이서연'=t2)이 아니라 trainerId 그대로.
  });

  it('trainerName과 일치하는 트레이너가 없으면 경고하고 ready=false', () => {
    const p = proposeReservation({ trainerName: '없는트레이너', date: '2026-08-20', startTime: '09:00' });
    expect(p.ready).toBe(false);
    expect(p.warnings.some((w) => w.includes('없는트레이너'))).toBe(true);
  });

  it('trainerId도 trainerName도 없으면 경고한다(둘 중 하나는 필수)', () => {
    const p = proposeReservation({ date: '2026-08-20', startTime: '09:00' });
    expect(p.ready).toBe(false);
    expect(p.warnings.some((w) => w.includes('트레이너를 지정'))).toBe(true);
  });
});

describe('proposeReservation() — 부작용 없음(호출만으로 아무것도 저장 안 됨)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('여러 번 호출해도 createScheduleWithDeduction은 절대 호출되지 않는다', () => {
    proposeReservation({ memberQuery: '홍길동', trainerId: 't1', date: '2026-08-20', startTime: '09:00' });
    proposeReservation({ memberQuery: '김영희', trainerId: 't1', date: '2026-08-20', startTime: '09:00' });
    expect(createScheduleWithDeduction).not.toHaveBeenCalled();
  });
});

describe('confirmReservation() — 실제 저장(기존 createScheduleWithDeduction에 위임)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('draft를 그대로 createScheduleWithDeduction에 넘긴다(세션 차감 로직 재구현 안 함)', async () => {
    const p = proposeReservation({ memberQuery: '홍길동', trainerId: 't1', date: '2026-08-20', startTime: '09:00' });
    await confirmReservation(p.draft);
    expect(createScheduleWithDeduction).toHaveBeenCalledWith(p.draft);
  });

  it('date/startTime이 없는 draft는 저장을 시도하지 않고 에러를 던진다(방어)', async () => {
    await expect(confirmReservation({ memberName: '홍길동' })).rejects.toThrow();
    expect(createScheduleWithDeduction).not.toHaveBeenCalled();
  });
});
