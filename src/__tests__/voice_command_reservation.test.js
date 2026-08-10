// voiceCommandService.js — processVoiceCommand()의 reservation_propose 분기.
// [예약 생성 프로젝트 2026-08-08] "모미야, OO님 O일 O시에 예약 걸어줘" 같은
// 요청이 백엔드(functions/api/voice-command.js)에서 type:'reservation_propose'로
// 오면, 프론트는 그걸 그대로 proposeReservation()에 넘겨 회원/트레이너 매칭·
// 충돌 검사까지 마친 draft를 만든다(아직 저장은 안 함). 여기서는 그 연결과
// "폰: trainerId(로그인 정보) / 키오스크: trainerName(말로 지정)" mode 분기가
// 올바른지만 검증한다 — proposeReservation() 자체의 로직은
// reservation_service.test.js에서 이미 충분히 검증됨(중복 안 함).
//
// [환경 참고] fetch·firebase·demoData를 전부 모킹해서 processVoiceCommand()를
// 실제로 실행한다 — 다만 sessionStorage를 쓰는 setPendingVoiceTarget()이
// 호출되는 navigate 분기는 이 파일에서 안 건드린다(reservation_propose는
// navigate 이전에 return하므로 문제 없음).
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../firebase.js', () => ({
  auth: { currentUser: null },
}));

const MEMBERS = [{ id: 'm1', name: '홍길동', trainerSessions: {} }];
const TRAINERS = [
  { id: 't1', name: '박선생', color: '#f59e0b' },
  { id: 't2', name: '이서연', color: '#10b981' },
];
const SCHEDULES = [
  {
    id: 's1', memberId: 'm1', memberName: '홍길동', trainerId: 't1', trainerName: '박선생',
    date: '2026-08-21', startTime: '10:00', endTime: '11:00', status: 'scheduled',
  },
];
const deleteScheduleWithRestore = vi.fn(async (id) => ({ id }));
const updateSchedule = vi.fn(async (id, patch) => ({ id, ...patch }));

vi.mock('../demoData.js', () => ({
  store: {
    getMembers: () => MEMBERS,
    getTrainers: () => TRAINERS,
    getSchedules: () => SCHEDULES,
    createScheduleWithDeduction: vi.fn(),
    deleteScheduleWithRestore: (id) => deleteScheduleWithRestore(id),
    updateSchedule: (id, patch) => updateSchedule(id, patch),
  },
}));

import { processVoiceCommand } from '../services/voiceCommandService.js';

function mockFetchReservationPropose(overrides = {}) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      type: 'reservation_propose',
      memberName: '홍길동',
      trainerName: null,
      date: '2026-08-20',
      startTime: '10:00',
      classType: null,
      ...overrides,
    }),
  }));
}

function mockFetchReservationCancelPropose(overrides = {}) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      type: 'reservation_cancel_propose',
      memberName: '홍길동',
      trainerName: null,
      date: '2026-08-21',
      startTime: '10:00',
      ...overrides,
    }),
  }));
}

function mockFetchReservationReschedulePropose(overrides = {}) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      type: 'reservation_reschedule_propose',
      memberName: '홍길동',
      trainerName: null,
      oldDate: '2026-08-21',
      oldStartTime: '10:00',
      newDate: '2026-08-25',
      newStartTime: '09:00',
      ...overrides,
    }),
  }));
}

describe('processVoiceCommand() — reservation_propose 분기', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('phone 모드(mode 생략=기본값)는 currentUser.trainerId를 우선 사용한다', async () => {
    mockFetchReservationPropose();
    const result = await processVoiceCommand({
      transcript: '홍길동님 8월 20일 10시에 예약 걸어줘',
      role: 'trainer',
      currentUser: { trainerId: 't1' },
      allMembers: MEMBERS,
    });
    expect(result.type).toBe('reservation_propose');
    expect(result.propose.draft.trainerId).toBe('t1');
    expect(result.propose.draft.trainerName).toBe('박선생');
  });

  it('kiosk 모드는 currentUser.trainerId가 있어도 무시하고 trainerName(말로 지정)만 쓴다', async () => {
    // [핵심 회귀 방지] 키오스크는 여러 트레이너가 같이 쓰는 공용 기기라, 마침
    // 로그인돼 있는 트레이너의 trainerId를 그대로 신뢰하면 안 된다.
    mockFetchReservationPropose({ trainerName: '이서연' });
    const result = await processVoiceCommand({
      transcript: '홍길동님 8월 20일 10시에 이서연 트레이너로 예약 걸어줘',
      role: 'trainer',
      currentUser: { trainerId: 't1' }, // 공용 키오스크에 우연히 로그인된 다른 트레이너
      allMembers: MEMBERS,
      mode: 'kiosk',
    });
    expect(result.propose.draft.trainerId).toBe('t2');
    expect(result.propose.draft.trainerName).toBe('이서연');
  });

  it('kiosk 모드에서 트레이너 이름을 말하지 않으면 트레이너 미지정 경고가 남는다', async () => {
    mockFetchReservationPropose({ trainerName: null });
    const result = await processVoiceCommand({
      transcript: '홍길동님 8월 20일 10시에 예약 걸어줘',
      role: 'trainer',
      currentUser: { trainerId: 't1' },
      allMembers: MEMBERS,
      mode: 'kiosk',
    });
    expect(result.propose.draft.trainerId).toBeNull();
    expect(result.propose.warnings.some((w) => w.includes('트레이너를 지정'))).toBe(true);
  });

  it('phone 모드에서 trainerId 없는 계정(예: 관리자)이 이름을 말하면 trainerName으로 폴백된다', async () => {
    mockFetchReservationPropose({ trainerName: '이서연' });
    const result = await processVoiceCommand({
      transcript: '홍길동님 8월 20일 10시에 이서연 트레이너로 예약 걸어줘',
      role: 'admin',
      currentUser: { trainerId: null },
      allMembers: MEMBERS,
      mode: 'phone',
    });
    expect(result.propose.draft.trainerId).toBe('t2');
  });

  it('아직 아무것도 저장하지 않는다(propose만 만듦)', async () => {
    const { store } = await import('../demoData.js');
    mockFetchReservationPropose();
    await processVoiceCommand({
      transcript: '홍길동님 8월 20일 10시에 예약 걸어줘',
      role: 'trainer',
      currentUser: { trainerId: 't1' },
      allMembers: MEMBERS,
    });
    expect(store.createScheduleWithDeduction).not.toHaveBeenCalled();
  });
});

// [예약 생성 프로젝트 3단계 2026-08-09] 취소 — 위 propose_reservation 분기와
// 완전히 대칭인 mode 분기(폰=trainerId/키오스크=trainerName)를 검증한다.
describe('processVoiceCommand() — reservation_cancel_propose 분기', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('phone 모드는 currentUser.trainerId로 대상을 좁혀 정확히 한 건을 찾는다', async () => {
    mockFetchReservationCancelPropose();
    const result = await processVoiceCommand({
      transcript: '홍길동님 8월 21일 10시 예약 취소해줘',
      role: 'trainer',
      currentUser: { trainerId: 't1' },
      allMembers: MEMBERS,
    });
    expect(result.type).toBe('reservation_cancel_propose');
    expect(result.propose.ready).toBe(true);
    expect(result.propose.schedule.id).toBe('s1');
  });

  it('kiosk 모드는 currentUser.trainerId를 무시하고 trainerName(말로 지정)만 쓴다', async () => {
    mockFetchReservationCancelPropose({ trainerName: '박선생' });
    const result = await processVoiceCommand({
      transcript: '홍길동님 8월 21일 10시 박선생 트레이너 예약 취소해줘',
      role: 'trainer',
      currentUser: { trainerId: 't2' }, // 공용 키오스크에 우연히 로그인된 다른 트레이너
      allMembers: MEMBERS,
      mode: 'kiosk',
    });
    expect(result.propose.ready).toBe(true);
    expect(result.propose.schedule.id).toBe('s1');
  });

  it('일치하는 예약이 없으면 ready=false, schedule=null', async () => {
    mockFetchReservationCancelPropose({ date: '2026-09-01' });
    const result = await processVoiceCommand({
      transcript: '홍길동님 9월 1일 10시 예약 취소해줘',
      role: 'trainer',
      currentUser: { trainerId: 't1' },
      allMembers: MEMBERS,
    });
    expect(result.propose.ready).toBe(false);
    expect(result.propose.schedule).toBeNull();
  });

  it('아직 아무것도 지우지 않는다(propose만 만듦)', async () => {
    mockFetchReservationCancelPropose();
    await processVoiceCommand({
      transcript: '홍길동님 8월 21일 10시 예약 취소해줘',
      role: 'trainer',
      currentUser: { trainerId: 't1' },
      allMembers: MEMBERS,
    });
    expect(deleteScheduleWithRestore).not.toHaveBeenCalled();
  });
});

// [예약 생성 프로젝트 4단계 2026-08-09] 변경 — 취소·만들기와 완전히 대칭인
// mode 분기(폰=trainerId/키오스크=trainerName)를 검증한다.
describe('processVoiceCommand() — reservation_reschedule_propose 분기', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('phone 모드는 currentUser.trainerId로 대상을 좁혀 정확히 한 건을 찾고 새 일시를 담는다', async () => {
    mockFetchReservationReschedulePropose();
    const result = await processVoiceCommand({
      transcript: '홍길동님 8월 21일 10시 예약을 8월 25일 9시로 옮겨줘',
      role: 'trainer',
      currentUser: { trainerId: 't1' },
      allMembers: MEMBERS,
    });
    expect(result.type).toBe('reservation_reschedule_propose');
    expect(result.propose.ready).toBe(true);
    expect(result.propose.schedule.id).toBe('s1');
    expect(result.propose.newDraft).toEqual({ date: '2026-08-25', startTime: '09:00', endTime: '10:00' });
  });

  it('kiosk 모드는 currentUser.trainerId를 무시하고 trainerName(말로 지정)만 쓴다', async () => {
    mockFetchReservationReschedulePropose({ trainerName: '박선생' });
    const result = await processVoiceCommand({
      transcript: '홍길동님 8월 21일 10시 박선생 트레이너 예약을 8월 25일 9시로 옮겨줘',
      role: 'trainer',
      currentUser: { trainerId: 't2' }, // 공용 키오스크에 우연히 로그인된 다른 트레이너
      allMembers: MEMBERS,
      mode: 'kiosk',
    });
    expect(result.propose.ready).toBe(true);
    expect(result.propose.schedule.id).toBe('s1');
  });

  it('옮길 대상을 못 찾으면 ready=false, schedule/newDraft=null', async () => {
    mockFetchReservationReschedulePropose({ oldDate: '2026-09-01' });
    const result = await processVoiceCommand({
      transcript: '홍길동님 9월 1일 10시 예약을 8월 25일 9시로 옮겨줘',
      role: 'trainer',
      currentUser: { trainerId: 't1' },
      allMembers: MEMBERS,
    });
    expect(result.propose.ready).toBe(false);
    expect(result.propose.schedule).toBeNull();
    expect(result.propose.newDraft).toBeNull();
  });

  it('아직 아무것도 바꾸지 않는다(propose만 만듦)', async () => {
    mockFetchReservationReschedulePropose();
    await processVoiceCommand({
      transcript: '홍길동님 8월 21일 10시 예약을 8월 25일 9시로 옮겨줘',
      role: 'trainer',
      currentUser: { trainerId: 't1' },
      allMembers: MEMBERS,
    });
    expect(updateSchedule).not.toHaveBeenCalled();
  });
});
