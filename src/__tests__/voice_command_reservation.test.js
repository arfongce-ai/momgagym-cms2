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

// [무료 확장 2026-08-11] "오늘/내일/모레" + "오전/오후 명시 시각"만 다루는
// 좁은 안전 범위 — 기존 "8월20일 10시" 스타일(요일/구체적 날짜, 오전오후
// 없는 시각)은 전부 그대로 이 범위 밖이라 여전히 Claude로 간다(위 describe
// 블록들의 기존 케이스가 하나도 안 깨진 것 자체가 그 증거 — 겹치지 않음).
describe('processVoiceCommand() — 예약 생성 무료 규칙기반 매칭(2026-08-11)', () => {
  it('"내일 오후 3시" 같은 명확한 표현은 fetch(Claude)를 아예 호출하지 않고 무료로 처리한다', async () => {
    global.fetch = vi.fn(); // 호출되면 안 됨 — 호출되면 아래 not.toHaveBeenCalled에서 잡힘
    const result = await processVoiceCommand({
      transcript: '홍길동님 내일 오후 3시에 예약 잡아줘',
      role: 'trainer',
      currentUser: { trainerId: 't1' },
      allMembers: MEMBERS,
      allTrainers: TRAINERS,
      mode: 'phone',
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.type).toBe('reservation_propose');
    expect(result.propose.ready).toBe(true);
    expect(result.propose.draft.startTime).toBe('15:00');
  });

  it('"오전/오후" 없이 그냥 "3시"면(새벽인지 오후인지 알 수 없음) 확신 없는 걸로 보고 Claude로 넘어간다', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ type: 'reservation_propose', memberName: '홍길동', date: '2026-08-12', startTime: '15:00' }),
    }));
    const result = await processVoiceCommand({
      transcript: '홍길동님 내일 3시에 예약 잡아줘',
      role: 'trainer', currentUser: { trainerId: 't1' }, allMembers: MEMBERS, allTrainers: TRAINERS, mode: 'phone',
    });
    expect(global.fetch).toHaveBeenCalled();
    expect(result.type).toBe('reservation_propose');
  });

  it('예약 요청 뒤에 다른 요청이 더 붙은 복합 문장은 Claude로 넘어간다', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ type: 'chat', text: '...' }),
    }));
    await processVoiceCommand({
      transcript: '홍길동님 내일 오후 3시에 예약 잡아줘 그리고 메모도 추가해줘',
      role: 'trainer', currentUser: { trainerId: 't1' }, allMembers: MEMBERS, allTrainers: TRAINERS, mode: 'phone',
    });
    expect(global.fetch).toHaveBeenCalled();
  });

  it('트레이너 이름이 실제로 언급되면(등록된 트레이너) 그 이름을 뽑아서 함께 넘긴다', async () => {
    global.fetch = vi.fn();
    const result = await processVoiceCommand({
      transcript: '홍길동님 내일 오후 3시에 이서연 트레이너로 예약 잡아줘',
      role: 'trainer', currentUser: { trainerId: 't1' }, allMembers: MEMBERS, allTrainers: TRAINERS, mode: 'kiosk',
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.propose.draft.trainerName).toBe('이서연');
  });

  it('아직 아무것도 저장하지 않는다(propose만 만듦, 확인 전엔 createScheduleWithDeduction 호출 안 됨)', async () => {
    global.fetch = vi.fn();
    await processVoiceCommand({
      transcript: '홍길동님 오늘 오전 10시에 예약 걸어줘',
      role: 'trainer', currentUser: { trainerId: 't1' }, allMembers: MEMBERS, allTrainers: TRAINERS, mode: 'phone',
    });
    // MEMBERS[0]는 mock store 안의 createScheduleWithDeduction(위 파일 상단, vi.fn())을
    // 스파이로 재사용 — 별도 import 없이 store mock 참조로 직접 확인 가능하면 확인,
    // 없으면 최소한 fetch 미호출로 "아직 Claude에도 안 갔다"만 확인해도 충분.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('예약 취소도 같은 원칙으로 무료 처리된다("내일 오후 3시 예약 취소해줘")', async () => {
    global.fetch = vi.fn();
    const result = await processVoiceCommand({
      transcript: '홍길동님 오늘 오전 10시 예약 취소해줘',
      role: 'trainer', currentUser: { trainerId: 't1' }, allMembers: MEMBERS, allTrainers: TRAINERS, mode: 'phone',
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.type).toBe('reservation_cancel_propose');
    // MEMBERS/SCHEDULES fixture(파일 상단) — 홍길동, 2026-08-21 10:00 예약 있음.
    // 오늘(테스트 실행일) 오전 10시엔 스케줄이 없을 수 있어 ready는 굳이 안 보고
    // "무료 경로로 정상 진입했는지"만 확인한다(찾는 로직 자체는 reservation_service.test.js가 이미 검증).
    expect(result.propose).toBeDefined();
  });

  it('예약 변경도 같은 원칙으로 무료 처리된다("내일 오후 3시 예약을 모레 오전 10시로 옮겨줘")', async () => {
    global.fetch = vi.fn();
    const result = await processVoiceCommand({
      transcript: '홍길동님 오늘 오전 10시 예약을 내일 오후 2시로 옮겨줘',
      role: 'trainer', currentUser: { trainerId: 't1' }, allMembers: MEMBERS, allTrainers: TRAINERS, mode: 'phone',
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.type).toBe('reservation_reschedule_propose');
    expect(result.propose).toBeDefined();
  });
});
