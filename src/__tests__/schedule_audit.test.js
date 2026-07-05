// 스케줄 중복 점검 로직 검증
import { describe, it, expect } from 'vitest';
import { findDuplicateSchedules, summarizeDuplicates } from '../services/scheduleAudit';

const base = {
  memberId: 'm1', memberName: '홍성예', trainerId: 't1', trainerName: '박병준',
  isExternal: false, isConsult: false, sessionDeducted: true,
  status: 'scheduled', classType: '트레이닝',
};

describe('findDuplicateSchedules — 회차 중복(same_lot, 재등록 안전)', () => {
  it('같은 회원·트레이너·누적소진인덱스가 2건 차감됐으면 회차 중복으로 잡는다', () => {
    const schedules = [
      { ...base, id:'a', date:'2026-07-04', startTime:'10:00', sessionAtBooking:10, sessionTotalAtBooking:10, consumedIndexAtBooking:0 },
      { ...base, id:'b', date:'2026-07-06', startTime:'11:00', sessionAtBooking:10, sessionTotalAtBooking:10, consumedIndexAtBooking:0 },
    ];
    const groups = findDuplicateSchedules(schedules);
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe('same_lot');
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].label).toMatch(/10\(s\)/);
    expect(groups[0].items[0].date).toBe('2026-07-04');
  });

  it('★재등록으로 회차번호(sessionAtBooking)만 같고 누적인덱스가 다르면 중복 아님', () => {
    // 첫 등록분 6회차(잔여6, 누적인덱스4)와 재등록분 6회차(잔여6, 누적인덱스14)는
    // sessionAtBooking 은 둘 다 6 이지만 서로 다른 수업 → 중복으로 잡으면 안 된다.
    const schedules = [
      { ...base, id:'a', date:'2026-05-01', startTime:'10:00', sessionAtBooking:6, sessionTotalAtBooking:10, consumedIndexAtBooking:4 },
      { ...base, id:'b', date:'2026-07-01', startTime:'10:00', sessionAtBooking:6, sessionTotalAtBooking:20, consumedIndexAtBooking:14 },
    ];
    expect(findDuplicateSchedules(schedules).filter(g=>g.type==='same_lot')).toHaveLength(0);
  });

  it('누적인덱스가 다르면 중복이 아니다', () => {
    const schedules = [
      { ...base, id:'a', date:'2026-07-04', startTime:'10:00', consumedIndexAtBooking:0 },
      { ...base, id:'b', date:'2026-07-06', startTime:'11:00', consumedIndexAtBooking:1 },
    ];
    expect(findDuplicateSchedules(schedules)).toHaveLength(0);
  });

  it('consumedIndexAtBooking 이 없는 구버전 예약은 회차중복 판정에서 제외(추측 안 함)', () => {
    const schedules = [
      { ...base, id:'a', date:'2026-07-04', startTime:'10:00', sessionAtBooking:10, sessionTotalAtBooking:10 },
      { ...base, id:'b', date:'2026-07-06', startTime:'11:00', sessionAtBooking:10, sessionTotalAtBooking:10 },
    ];
    expect(findDuplicateSchedules(schedules).filter(g=>g.type==='same_lot')).toHaveLength(0);
  });

  it('미차감(sessionDeducted=false)은 회차 중복 판정에서 제외', () => {
    const schedules = [
      { ...base, id:'a', date:'2026-07-04', startTime:'10:00', consumedIndexAtBooking:0, sessionDeducted:true },
      { ...base, id:'b', date:'2026-07-06', startTime:'11:00', consumedIndexAtBooking:0, sessionDeducted:false },
    ];
    expect(findDuplicateSchedules(schedules).filter(g=>g.type==='same_lot')).toHaveLength(0);
  });
});

describe('findDuplicateSchedules — 같은 시간 이중 예약(same_slot, 트레이너 구분)', () => {
  it('같은 회원·같은 트레이너·날짜·시작시간이 2건이면 잡는다(회차 무관)', () => {
    const schedules = [
      { ...base, id:'a', trainerId:'t1', date:'2026-07-04', startTime:'10:00', sessionAtBooking:10, sessionTotalAtBooking:10 },
      { ...base, id:'b', trainerId:'t1', date:'2026-07-04', startTime:'10:00', sessionAtBooking:9,  sessionTotalAtBooking:10 },
    ];
    const groups = findDuplicateSchedules(schedules);
    const slot = groups.find(g=>g.type==='same_slot');
    expect(slot).toBeTruthy();
    expect(slot.items).toHaveLength(2);
  });

  it('★같은 시간이라도 트레이너가 다르면 정상(1회원 2트레이너) — 이중예약 아님', () => {
    const schedules = [
      { ...base, id:'a', trainerId:'t1', trainerName:'박병준', date:'2026-07-04', startTime:'10:00', consumedIndexAtBooking:0 },
      { ...base, id:'b', trainerId:'t2', trainerName:'황지영', date:'2026-07-04', startTime:'10:00', consumedIndexAtBooking:0 },
    ];
    expect(findDuplicateSchedules(schedules).filter(g=>g.type==='same_slot')).toHaveLength(0);
  });

  it('★1회원 2트레이너: 각 트레이너별 회차 중복은 트레이너별로 따로 잡는다', () => {
    const schedules = [
      // t1 의 누적0 이 2건(중복) — t1 그룹
      { ...base, id:'a', trainerId:'t1', trainerName:'박병준', date:'2026-07-01', startTime:'10:00', consumedIndexAtBooking:0 },
      { ...base, id:'b', trainerId:'t1', trainerName:'박병준', date:'2026-07-03', startTime:'11:00', consumedIndexAtBooking:0 },
      // t2 의 누적0 은 1건(정상) — 위 t1 중복과 섞이지 않아야 함
      { ...base, id:'c', trainerId:'t2', trainerName:'황지영', date:'2026-07-02', startTime:'10:00', consumedIndexAtBooking:0 },
    ];
    const lots = findDuplicateSchedules(schedules).filter(g=>g.type==='same_lot');
    expect(lots).toHaveLength(1);
    expect(lots[0].items.every(s=>s.trainerId==='t1')).toBe(true);
    expect(lots[0].items).toHaveLength(2);
  });
});

describe('findDuplicateSchedules — 제외 대상', () => {
  it('외부 일정·상담·회원없음은 점검 대상이 아니다', () => {
    const schedules = [
      { ...base, id:'x', isExternal:true, memberId:null, date:'2026-07-04', startTime:'10:00' },
      { ...base, id:'y', isExternal:true, memberId:null, date:'2026-07-04', startTime:'10:00' },
      { ...base, id:'z', isConsult:true,  date:'2026-07-04', startTime:'10:00' },
    ];
    expect(findDuplicateSchedules(schedules)).toHaveLength(0);
  });

  it('정상 데이터(중복 없음)면 빈 배열', () => {
    const schedules = [
      { ...base, id:'a', date:'2026-07-04', startTime:'10:00', sessionAtBooking:10, sessionTotalAtBooking:10 },
    ];
    expect(findDuplicateSchedules(schedules)).toHaveLength(0);
  });
});

describe('summarizeDuplicates', () => {
  it('그룹/항목 수와 이슈 여부를 요약한다', () => {
    const schedules = [
      { ...base, id:'a', date:'2026-07-04', startTime:'10:00', sessionAtBooking:10, sessionTotalAtBooking:10, consumedIndexAtBooking:0 },
      { ...base, id:'b', date:'2026-07-06', startTime:'11:00', sessionAtBooking:10, sessionTotalAtBooking:10, consumedIndexAtBooking:0 },
    ];
    const s = summarizeDuplicates(findDuplicateSchedules(schedules));
    expect(s.hasIssues).toBe(true);
    expect(s.groupCount).toBeGreaterThanOrEqual(1);
    expect(s.itemCount).toBeGreaterThanOrEqual(2);
  });

  it('이슈 없으면 hasIssues=false', () => {
    expect(summarizeDuplicates([])).toEqual({ groupCount:0, itemCount:0, hasIssues:false });
  });
});

describe('Schedule 점검 UI 배선', () => {
  it('점검 버튼·배지·모달이 배선되어 있다', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../pages/Schedule.jsx', import.meta.url), 'utf8');
    expect(src).toMatch(/findDuplicateSchedules/);
    expect(src).toMatch(/setShowAudit/);
    expect(src).toMatch(/ScheduleAuditModal/);
    expect(src).toMatch(/auditSummary\.groupCount/);
  });
});
