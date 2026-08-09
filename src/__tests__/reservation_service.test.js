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
    id: 's1', memberId: 'm1', memberName: '홍길동', trainerId: 't1', trainerName: '김민준',
    date: '2026-08-10', startTime: '10:00', endTime: '11:00', status: 'scheduled',
  },
  {
    id: 's2', memberId: 'm2', memberName: '김영희', trainerId: 't2', trainerName: '이서연',
    date: '2026-08-10', startTime: '14:00', endTime: '15:00', status: 'canceled', // 취소건 — 충돌/취소 대상 아님
  },
  {
    id: 's3', memberId: 'm1', memberName: '홍길동', trainerId: 't1', trainerName: '김민준',
    date: '2026-08-12', startTime: '09:00', endTime: '10:00', status: 'scheduled',
  },
  // [취소 프로젝트 2026-08-09] 같은 시간대에 회원 없는 예약이 두 트레이너에게
  // 각각 잡혀있는 경우 — 회원/트레이너를 안 밝히고 취소하면 특정 못 하는
  // 애매함(ambiguous) 케이스를 테스트하기 위한 픽스처.
  {
    id: 's4', memberId: null, memberName: null, trainerId: 't1', trainerName: '김민준',
    date: '2026-08-13', startTime: '09:00', endTime: '10:00', status: 'scheduled',
  },
  {
    id: 's5', memberId: null, memberName: null, trainerId: 't2', trainerName: '이서연',
    date: '2026-08-13', startTime: '09:00', endTime: '10:00', status: 'scheduled',
  },
];

const createScheduleWithDeduction = vi.fn(async (draft) => ({ ...draft, id: 'new-s' }));
const deleteScheduleWithRestore = vi.fn(async (id) => ({ id }));
const updateSchedule = vi.fn(async (id, patch) => ({ id, ...patch }));

vi.mock('../demoData.js', () => ({
  store: {
    getMembers: () => MEMBERS,
    getTrainers: () => TRAINERS,
    getSchedules: () => SCHEDULES,
    createScheduleWithDeduction: (draft) => createScheduleWithDeduction(draft),
    deleteScheduleWithRestore: (id) => deleteScheduleWithRestore(id),
    updateSchedule: (id, patch) => updateSchedule(id, patch),
  },
}));

import {
  proposeReservation,
  confirmReservation,
  buildReservationSummary,
  interpretConfirmationReply,
  proposeCancelReservation,
  cancelReservation,
  buildCancelSummary,
  proposeRescheduleReservation,
  rescheduleReservation,
  buildRescheduleSummary,
} from '../services/reservationService.js';

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

// [예약 생성 프로젝트 2단계 2026-08-08] 확인 흐름용 순수 함수 — 음성 컴포넌트가
// speak()/awaitReply()로 감싸서 쓰기 전에 로직만 따로 검증한다.
describe('buildReservationSummary() — 확인 질문 문구 생성', () => {
  it('회원·트레이너·일시가 모두 있으면 자연스러운 확인 질문을 만든다', () => {
    const p = proposeReservation({ memberQuery: '홍길동', trainerId: 't1', date: '2026-08-20', startTime: '09:00' });
    const summary = buildReservationSummary(p);
    expect(summary).toContain('홍길동님');
    expect(summary).toContain('2026-08-20 09:00');
    expect(summary).toContain('김민준 트레이너');
    expect(summary).toMatch(/맞으실까요\?$/);
  });

  it('회원 지정 없이도(상담 등) 문구를 만든다', () => {
    const p = proposeReservation({ trainerId: 't1', date: '2026-08-20', startTime: '09:00' });
    const summary = buildReservationSummary(p);
    expect(summary).toContain('회원 미지정');
  });

  it('경고가 있으면 확인 질문 뒤에 이어 붙인다(진행 여부는 막지 않음)', () => {
    const p = proposeReservation({ memberQuery: '김영희', trainerId: 't1', date: '2026-08-20', startTime: '09:00' });
    const summary = buildReservationSummary(p);
    expect(summary).toMatch(/맞으실까요\? 다만/);
    expect(summary).toContain('잔여');
  });

  it('draft가 없으면 안내 문구를 반환한다', () => {
    expect(buildReservationSummary({})).toBe('예약 정보를 만들지 못했어요.');
  });
});

describe('interpretConfirmationReply() — 네/아니요 해석', () => {
  it('"네", "예", "좋아요" 등은 confirm으로 해석한다', () => {
    expect(interpretConfirmationReply('네')).toBe('confirm');
    expect(interpretConfirmationReply('예 맞아요')).toBe('confirm');
    expect(interpretConfirmationReply('좋아요 진행해주세요')).toBe('confirm');
  });

  it('"아니요", "취소" 등은 cancel로 해석한다', () => {
    expect(interpretConfirmationReply('아니요')).toBe('cancel');
    expect(interpretConfirmationReply('취소해주세요')).toBe('cancel');
  });

  // [버그 수정 회귀 방지 2026-08-08] "취소해줘"는 "취소"(NO)가 "해줘"(YES)보다
  // 먼저 검사돼야 cancel로 정확히 해석된다. NO 패턴을 먼저 검사하도록 고친
  // 순서가 유지되는지 확인한다.
  it('"취소해줘"는 "해줘"(YES 패턴)에 앞서 "취소"(NO 패턴)로 먼저 해석되어 cancel이다', () => {
    expect(interpretConfirmationReply('취소해줘')).toBe('cancel');
  });

  it('알아들을 수 없는 말은 unclear로 해석한다', () => {
    expect(interpretConfirmationReply('잠깐만요 생각해볼게요')).toBe('unclear');
  });

  it('null(시간초과) 또는 빈 문자열(무음)은 timeout으로 해석한다', () => {
    expect(interpretConfirmationReply(null)).toBe('timeout');
    expect(interpretConfirmationReply('')).toBe('timeout');
    expect(interpretConfirmationReply('   ')).toBe('timeout');
  });
});

// [예약 생성 프로젝트 3단계 2026-08-09] 취소 — 만들기(propose/confirm)와
// 대칭되는 구조. deleteScheduleWithRestore는 실제 저장을 검증하지 않고(이미
// Schedule.jsx에서 쓰는, 검증된 함수) 호출 여부/인자만 확인한다.
describe('proposeCancelReservation() — 취소할 예약 찾기(부작용 없음)', () => {
  it('회원+날짜+시간이 정확히 일치하면 그 예약을 찾는다', () => {
    const p = proposeCancelReservation({ memberQuery: '홍길동', date: '2026-08-10', startTime: '10:00' });
    expect(p.ready).toBe(true);
    expect(p.schedule.id).toBe('s1');
  });

  it('트레이너 이름으로도 좁힐 수 있다(키오스크 경로)', () => {
    const p = proposeCancelReservation({ trainerName: '이서연', date: '2026-08-13', startTime: '09:00' });
    expect(p.ready).toBe(true);
    expect(p.schedule.id).toBe('s5');
  });

  it('trainerId로도 좁힐 수 있다(폰 경로)', () => {
    const p = proposeCancelReservation({ trainerId: 't1', date: '2026-08-13', startTime: '09:00' });
    expect(p.ready).toBe(true);
    expect(p.schedule.id).toBe('s4');
  });

  it('이미 취소된(status: canceled) 예약은 다시 못 찾는다', () => {
    const p = proposeCancelReservation({ memberQuery: '김영희', date: '2026-08-10', startTime: '14:00' });
    expect(p.ready).toBe(false);
    expect(p.schedule).toBeNull();
    expect(p.warnings.some((w) => w.includes('찾지 못했습니다'))).toBe(true);
  });

  it('해당 시간에 예약 자체가 없으면 못 찾는다', () => {
    const p = proposeCancelReservation({ date: '2026-08-19', startTime: '09:00' });
    expect(p.ready).toBe(false);
    expect(p.schedule).toBeNull();
  });

  // [핵심 — 파괴적 작업의 안전장치] 여러 건이 걸리면 절대 임의로 하나를 고르지
  // 않는다. 되돌릴 수 없는 삭제라 애매하면 사람에게 다시 물어야 한다.
  it('회원·트레이너를 안 밝혀서 여러 건이 걸리면 특정하지 않고 경고한다', () => {
    const p = proposeCancelReservation({ date: '2026-08-13', startTime: '09:00' });
    expect(p.ready).toBe(false);
    expect(p.schedule).toBeNull();
    expect(p.warnings.some((w) => w.includes('여러 건'))).toBe(true);
  });

  it('date나 startTime이 없으면 경고하고 조회 자체를 시도하지 않는다', () => {
    const p = proposeCancelReservation({ memberQuery: '홍길동' });
    expect(p.ready).toBe(false);
    expect(p.warnings.some((w) => w.includes('날짜'))).toBe(true);
  });
});

describe('cancelReservation() — 실제 취소(기존 deleteScheduleWithRestore에 위임)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scheduleId를 그대로 deleteScheduleWithRestore에 넘긴다(세션 복원 로직 재구현 안 함)', async () => {
    const p = proposeCancelReservation({ memberQuery: '홍길동', date: '2026-08-10', startTime: '10:00' });
    await cancelReservation(p.schedule.id);
    expect(deleteScheduleWithRestore).toHaveBeenCalledWith('s1');
  });

  it('scheduleId 없이는 호출을 시도하지 않고 에러를 던진다(방어)', async () => {
    await expect(cancelReservation(null)).rejects.toThrow();
    expect(deleteScheduleWithRestore).not.toHaveBeenCalled();
  });
});

describe('buildCancelSummary() — 취소 확인 질문 문구 생성', () => {
  it('회원·일시·트레이너를 담은 확인 질문을 만든다', () => {
    const p = proposeCancelReservation({ memberQuery: '홍길동', date: '2026-08-10', startTime: '10:00' });
    const summary = buildCancelSummary(p);
    expect(summary).toContain('홍길동님');
    expect(summary).toContain('2026-08-10 10:00');
    expect(summary).toContain('김민준 트레이너');
    expect(summary).toMatch(/취소할까요\?$/);
  });

  it('찾은 예약이 없으면 안내 문구를 반환한다', () => {
    expect(buildCancelSummary({ schedule: null })).toBe('취소할 예약 정보를 찾지 못했어요.');
  });
});

// [예약 생성 프로젝트 4단계 2026-08-09] 시간 변경 — 취소와 같은 방식으로 대상을
// 특정한 뒤, 만들기와 같은 기준으로 새 시간대 충돌을 검사한다.
describe('proposeRescheduleReservation() — 옮길 대상 특정 + 새 시간대 충돌 검사(부작용 없음)', () => {
  it('빈 시간대로 옮기면 ready=true, newDraft에 새 일시가 담긴다', () => {
    const p = proposeRescheduleReservation({
      memberQuery: '홍길동', oldDate: '2026-08-10', oldStartTime: '10:00',
      newDate: '2026-08-14', newStartTime: '09:00',
    });
    expect(p.ready).toBe(true);
    expect(p.schedule.id).toBe('s1');
    expect(p.newDraft).toEqual({ date: '2026-08-14', startTime: '09:00', endTime: '10:00' });
  });

  it('새 시간대에 같은 트레이너의 다른 예약이 있으면 경고하되(ready=false) 그래도 대상/새 일시는 찾아둔다', () => {
    // s3: 2026-08-12 09:00, t1(김민준) 이미 예약 있음 — s1(t1)을 그 시간으로 옮기려 하면 충돌.
    const p = proposeRescheduleReservation({
      memberQuery: '홍길동', oldDate: '2026-08-10', oldStartTime: '10:00',
      newDate: '2026-08-12', newStartTime: '09:00',
    });
    expect(p.ready).toBe(false);
    expect(p.schedule.id).toBe('s1');
    expect(p.newDraft.date).toBe('2026-08-12');
    expect(p.warnings.some((w) => w.includes('김민준') && w.includes('이미 다른 예약'))).toBe(true);
  });

  it('제자리(기존과 같은 날짜·시간)로 "이동"해도 스스로와 충돌 처리되지 않는다', () => {
    const p = proposeRescheduleReservation({
      memberQuery: '홍길동', oldDate: '2026-08-10', oldStartTime: '10:00',
      newDate: '2026-08-10', newStartTime: '10:00',
    });
    expect(p.ready).toBe(true);
  });

  it('트레이너 이름으로 대상을 좁힐 수 있다(키오스크 경로)', () => {
    const p = proposeRescheduleReservation({
      trainerName: '김민준', oldDate: '2026-08-10', oldStartTime: '10:00',
      newDate: '2026-08-14', newStartTime: '09:00',
    });
    expect(p.schedule.id).toBe('s1');
  });

  it('기존 예약을 못 찾으면 ready=false, schedule/newDraft=null', () => {
    const p = proposeRescheduleReservation({
      oldDate: '2026-09-01', oldStartTime: '09:00', newDate: '2026-09-05', newStartTime: '09:00',
    });
    expect(p.ready).toBe(false);
    expect(p.schedule).toBeNull();
    expect(p.newDraft).toBeNull();
  });

  it('회원·트레이너를 안 밝혀서 옮길 대상이 여러 건이면 특정하지 않는다', () => {
    const p = proposeRescheduleReservation({
      oldDate: '2026-08-13', oldStartTime: '09:00', newDate: '2026-08-20', newStartTime: '09:00',
    });
    expect(p.ready).toBe(false);
    expect(p.schedule).toBeNull();
    expect(p.warnings.some((w) => w.includes('여러 건'))).toBe(true);
  });

  it('새 날짜/시간이 없으면 대상 조회 자체를 시도하지 않는다', () => {
    const p = proposeRescheduleReservation({ oldDate: '2026-08-10', oldStartTime: '10:00' });
    expect(p.ready).toBe(false);
    expect(p.warnings.some((w) => w.includes('옮길 새'))).toBe(true);
  });

  it('기존 예약의 날짜/시간이 없으면 경고한다', () => {
    const p = proposeRescheduleReservation({ newDate: '2026-08-14', newStartTime: '09:00' });
    expect(p.ready).toBe(false);
    expect(p.warnings.some((w) => w.includes('기존 예약'))).toBe(true);
  });
});

describe('rescheduleReservation() — 실제 변경(기존 updateSchedule에 위임)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scheduleId와 새 일시를 그대로 updateSchedule에 넘긴다(로직 재구현 안 함)', async () => {
    const p = proposeRescheduleReservation({
      memberQuery: '홍길동', oldDate: '2026-08-10', oldStartTime: '10:00',
      newDate: '2026-08-14', newStartTime: '09:00',
    });
    await rescheduleReservation(p.schedule.id, p.newDraft);
    expect(updateSchedule).toHaveBeenCalledWith('s1', p.newDraft);
  });

  it('필수 인자가 부족하면 호출을 시도하지 않고 에러를 던진다(방어)', async () => {
    await expect(rescheduleReservation('s1', { date: '2026-08-14' })).rejects.toThrow();
    await expect(rescheduleReservation(null, { date: '2026-08-14', startTime: '09:00' })).rejects.toThrow();
    expect(updateSchedule).not.toHaveBeenCalled();
  });
});

describe('buildRescheduleSummary() — 변경 확인 질문 문구 생성', () => {
  it('기존 일시 → 새 일시를 담은 확인 질문을 만든다', () => {
    const p = proposeRescheduleReservation({
      memberQuery: '홍길동', oldDate: '2026-08-10', oldStartTime: '10:00',
      newDate: '2026-08-14', newStartTime: '09:00',
    });
    const summary = buildRescheduleSummary(p);
    expect(summary).toContain('홍길동님');
    expect(summary).toContain('2026-08-10 10:00');
    expect(summary).toContain('2026-08-14 09:00');
    expect(summary).toMatch(/옮길까요\?$/);
  });

  it('경고가 있으면 확인 질문 뒤에 이어 붙인다', () => {
    const p = proposeRescheduleReservation({
      memberQuery: '홍길동', oldDate: '2026-08-10', oldStartTime: '10:00',
      newDate: '2026-08-12', newStartTime: '09:00',
    });
    const summary = buildRescheduleSummary(p);
    expect(summary).toMatch(/옮길까요\? 다만/);
  });

  it('대상을 못 찾았으면 안내 문구를 반환한다', () => {
    expect(buildRescheduleSummary({ schedule: null, newDraft: null })).toBe('옮길 예약 정보를 찾지 못했어요.');
  });
});
