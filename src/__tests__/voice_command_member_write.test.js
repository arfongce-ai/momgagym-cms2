// voiceCommandService.js — processVoiceCommand()의 momi 쓰기 권한 확장 3종
// (memo_add_propose / session_adjust_propose / member_info_update_propose)
// 분기. voice_command_reservation.test.js와 완전히 같은 이유·같은 패턴 —
// 백엔드(functions/api/voice-command.js)가 이 type들로 응답했을 때, 프론트가
// memberWriteService.proposeX()에 올바른 인자로 넘기는지(특히 mode별 트레이너
// 우선순위 분기)만 검증한다. proposeX() 자체의 로직은 member_write_service.test.js
// 에서 이미 충분히 검증됨(중복 안 함).
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../firebase.js', () => ({
  auth: { currentUser: null },
}));

const MEMBERS = [
  { id: 'm1', name: '홍길동', phone: '010-1111-2222', memo: '기존메모', trainerSessions: { t1: { total: 20, remaining: 8 } } },
  { id: 'm2', name: '김영희', phone: '010-3333-4444', memo: '', trainerSessions: { t1: { total: 10, remaining: 2 }, t2: { total: 5, remaining: 3 } } },
];
const TRAINERS = [
  { id: 't1', name: '박선생' },
  { id: 't2', name: '이서연' },
];
const updateMember = vi.fn(async (id, patch) => ({ id, ...patch }));

vi.mock('../demoData.js', () => ({
  store: {
    getMembers: () => MEMBERS,
    getTrainers: () => TRAINERS,
    getSchedules: () => [],
    updateMember: (id, patch) => updateMember(id, patch),
  },
}));

import { processVoiceCommand } from '../services/voiceCommandService.js';

function mockFetchType(type, overrides = {}) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ type, ...overrides }),
  }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  updateMember.mockClear();
});

describe('processVoiceCommand() — memo_add_propose 분기', () => {
  it('memberName·memoText를 그대로 proposeAddMemberMemo에 넘긴다', async () => {
    mockFetchType('memo_add_propose', { memberName: '홍길동', memoText: '무릎 조심' });
    const result = await processVoiceCommand({
      transcript: '홍길동님 메모에 무릎 조심이라고 추가해줘',
      role: 'trainer',
      currentUser: { trainerId: 't1' },
      allMembers: MEMBERS,
    });
    expect(result.type).toBe('memo_add_propose');
    expect(result.propose.ready).toBe(true);
    expect(result.propose.member.id).toBe('m1');
    expect(result.propose.memoText).toBe('무릎 조심');
  });

  it('아직 아무것도 저장하지 않는다(propose만 만듦)', async () => {
    mockFetchType('memo_add_propose', { memberName: '홍길동', memoText: '내용' });
    await processVoiceCommand({ transcript: 't', role: 'trainer', currentUser: {}, allMembers: MEMBERS });
    expect(updateMember).not.toHaveBeenCalled();
  });
});

describe('processVoiceCommand() — session_adjust_propose 분기 (mode별 트레이너 우선순위, 예약류와 동일 규칙)', () => {
  it('phone 모드는 currentUser.trainerId를 우선 사용한다', async () => {
    mockFetchType('session_adjust_propose', { memberName: '김영희', trainerName: null, delta: 2 });
    const result = await processVoiceCommand({
      transcript: '김영희님 세션 2회 추가해줘',
      role: 'trainer',
      currentUser: { trainerId: 't1' },
      allMembers: MEMBERS,
      mode: 'phone',
    });
    expect(result.propose.trainerId).toBe('t1');
    expect(result.propose.ready).toBe(true);
  });

  it('kiosk 모드는 currentUser.trainerId가 있어도 무시하고 trainerName만 쓴다(공용 기기 보안 원칙)', async () => {
    mockFetchType('session_adjust_propose', { memberName: '김영희', trainerName: '이서연', delta: 1 });
    const result = await processVoiceCommand({
      transcript: '김영희님 이서연 트레이너 세션 1회 추가해줘',
      role: 'trainer',
      currentUser: { trainerId: 't1' }, // 공용 키오스크에 우연히 로그인된 다른 트레이너
      allMembers: MEMBERS,
      mode: 'kiosk',
    });
    expect(result.propose.trainerId).toBe('t2');
  });

  it('kiosk 모드에서 트레이너를 말하지 않고, 회원 담당 트레이너도 여러 명이면 ready:false', async () => {
    mockFetchType('session_adjust_propose', { memberName: '김영희', trainerName: null, delta: 1 });
    const result = await processVoiceCommand({
      transcript: '김영희님 세션 1회 추가해줘',
      role: 'trainer',
      currentUser: { trainerId: 't1' },
      allMembers: MEMBERS,
      mode: 'kiosk',
    });
    expect(result.propose.ready).toBe(false);
  });

  it('delta가 그대로 전달된다(부호 포함)', async () => {
    mockFetchType('session_adjust_propose', { memberName: '홍길동', trainerName: null, delta: -3 });
    const result = await processVoiceCommand({
      transcript: '홍길동님 세션 3회 차감해줘',
      role: 'trainer',
      currentUser: { trainerId: 't1' },
      allMembers: MEMBERS,
      mode: 'phone',
    });
    expect(result.propose.delta).toBe(-3);
    expect(result.propose.afterRemaining).toBe(5);
  });

  it('아직 아무것도 저장하지 않는다(propose만 만듦)', async () => {
    mockFetchType('session_adjust_propose', { memberName: '홍길동', trainerName: null, delta: 1 });
    await processVoiceCommand({ transcript: 't', role: 'trainer', currentUser: { trainerId: 't1' }, allMembers: MEMBERS, mode: 'phone' });
    expect(updateMember).not.toHaveBeenCalled();
  });
});

describe('processVoiceCommand() — member_info_update_propose 분기', () => {
  it('memberName·field·newValue를 그대로 proposeUpdateMemberInfo에 넘긴다', async () => {
    mockFetchType('member_info_update_propose', { memberName: '홍길동', field: 'phone', newValue: '010-9999-8888' });
    const result = await processVoiceCommand({
      transcript: '홍길동님 전화번호 010-9999-8888로 바꿔줘',
      role: 'trainer',
      currentUser: {},
      allMembers: MEMBERS,
    });
    expect(result.type).toBe('member_info_update_propose');
    expect(result.propose.ready).toBe(true);
    expect(result.propose.oldValue).toBe('010-1111-2222');
    expect(result.propose.newValue).toBe('010-9999-8888');
  });

  it('지원하지 않는 필드면 ready:false로 넘어온다(백엔드 enum이 phone/phone2로 제한하지만 방어적으로 재검증)', async () => {
    mockFetchType('member_info_update_propose', { memberName: '홍길동', field: 'name', newValue: '다른이름' });
    const result = await processVoiceCommand({
      transcript: 't', role: 'trainer', currentUser: {}, allMembers: MEMBERS,
    });
    expect(result.propose.ready).toBe(false);
  });

  it('아직 아무것도 저장하지 않는다(propose만 만듦)', async () => {
    mockFetchType('member_info_update_propose', { memberName: '홍길동', field: 'phone', newValue: '010-0000-0000' });
    await processVoiceCommand({ transcript: 't', role: 'trainer', currentUser: {}, allMembers: MEMBERS });
    expect(updateMember).not.toHaveBeenCalled();
  });
});

describe('processVoiceCommand() — 기존 navigate/reservation/timer_control 분기는 그대로 유지된다(회귀 방지)', () => {
  it('memo_add_propose 등 새 타입이 아니면 기존 로직을 그대로 탄다', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ type: 'chat', text: '네, 말씀하세요!' }),
    }));
    const result = await processVoiceCommand({
      transcript: '오늘 날씨 어때', role: 'trainer', currentUser: {}, allMembers: MEMBERS,
    });
    expect(result.type).toBe('chat');
  });
});
