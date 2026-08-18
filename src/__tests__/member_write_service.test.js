// memberWriteService.js — [momi 쓰기 권한 확장 2026-08-10]
// reservationService.js/reservation_service.test.js와 완전히 같은 방식 —
// proposeX는 순수 조회(부작용 없음)라 실제 함수를 직접 불러와 검증한다.
import { describe, expect, it, vi, beforeEach } from 'vitest';

const MEMBERS = [
  { id: 'm1', name: '홍길동', phone: '010-1111-2222', phone2: '', memo: '무릎 부상 이력', trainerSessions: { t1: { total: 20, remaining: 8 } } },
  // 담당 트레이너가 2명 — trainerName 없이는 자동으로 못 정하는(애매한) 케이스.
  { id: 'm2', name: '김영희', phone: '010-3333-4444', phone2: '010-9999-0000', memo: '', trainerSessions: { t1: { total: 10, remaining: 2 }, t2: { total: 5, remaining: 0 } } },
  // 세션이 아예 없는 회원.
  { id: 'm3', name: '이철수', phone: '010-5555-6666', phone2: '', memo: '', trainerSessions: {} },
  { id: 'm4', name: '김영희민', phone: '', phone2: '', memo: '', trainerSessions: {} }, // 부분 문자열 겹침 케이스
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
    updateMember: (id, patch) => updateMember(id, patch),
  },
}));

import {
  proposeAddMemberMemo,
  confirmAddMemberMemo,
  buildAddMemoSummary,
  proposeAdjustSessionCount,
  confirmAdjustSessionCount,
  buildAdjustSessionSummary,
  proposeUpdateMemberInfo,
  confirmUpdateMemberInfo,
  buildUpdateInfoSummary,
} from '../services/memberWriteService.js';

beforeEach(() => {
  updateMember.mockClear();
});

// ════════════════════════════════════════════════════════════════════════
// 1) 메모 추가
// ════════════════════════════════════════════════════════════════════════
describe('proposeAddMemberMemo — 순수 조회, 아직 저장 안 함', () => {
  it('회원·메모내용이 다 있으면 ready:true', () => {
    const r = proposeAddMemberMemo({ memberQuery: '홍길동', memoText: '무릎 조심' });
    expect(r.ready).toBe(true);
    expect(r.member.id).toBe('m1');
    expect(r.memoText).toBe('무릎 조심');
    expect(updateMember).not.toHaveBeenCalled();
  });

  it('회원을 못 찾으면 ready:false', () => {
    const r = proposeAddMemberMemo({ memberQuery: '없는사람', memoText: '내용' });
    expect(r.ready).toBe(false);
    expect(r.warnings[0]).toContain('일치하는 회원을 찾지 못했습니다');
  });

  // [음성인식률 개선 2026-08-18] 정확·부분 일치가 실패해도 자모 유사도로
  // 구제되는지 확인 — 유료(Claude) 경로가 넘긴 memberQuery가 STT 오인식을
  // 그대로 담고 있어도(예: "홍길동"이 "홍기동"으로 들림) 회원을 찾는다.
  it('발음이 비슷하게 오인식된 이름도 자모 유사도로 찾는다', () => {
    const r = proposeAddMemberMemo({ memberQuery: '홍기동', memoText: '무릎 조심' });
    expect(r.ready).toBe(true);
    expect(r.member.id).toBe('m1');
  });

  it('메모 내용이 비어있으면 ready:false', () => {
    const r = proposeAddMemberMemo({ memberQuery: '홍길동', memoText: '  ' });
    expect(r.ready).toBe(false);
    expect(r.warnings[0]).toContain('메모 내용을 알아듣지 못했어요');
  });

  it('회원 이름 자체가 없으면 ready:false', () => {
    const r = proposeAddMemberMemo({ memoText: '내용' });
    expect(r.ready).toBe(false);
  });

  it('앞뒤 공백은 다듬는다', () => {
    const r = proposeAddMemberMemo({ memberQuery: '홍길동', memoText: '  무릎 조심  ' });
    expect(r.memoText).toBe('무릎 조심');
  });
});

describe('confirmAddMemberMemo — 확인 후에만 실제 저장, 기존 메모를 지우지 않고 이어붙인다', () => {
  it('기존 메모 뒤에 새 줄로 이어붙인다(덮어쓰기 아님)', async () => {
    const member = MEMBERS.find((m) => m.id === 'm1'); // memo: '무릎 부상 이력'
    const newMemo = await confirmAddMemberMemo({ member, memoText: '오늘 컨디션 좋음' });
    expect(newMemo).toBe('무릎 부상 이력\n[모미] 오늘 컨디션 좋음');
    expect(updateMember).toHaveBeenCalledWith('m1', { memo: newMemo });
  });

  it('기존 메모가 비어있으면 그냥 새 줄 하나만 된다', async () => {
    const member = MEMBERS.find((m) => m.id === 'm2'); // memo: ''
    const newMemo = await confirmAddMemberMemo({ member, memoText: '첫 메모' });
    expect(newMemo).toBe('[모미] 첫 메모');
  });

  it('[모미] 표시를 붙여서 수동 작성 메모와 구분되게 한다', async () => {
    const member = MEMBERS.find((m) => m.id === 'm3');
    const newMemo = await confirmAddMemberMemo({ member, memoText: '내용' });
    expect(newMemo).toContain('[모미]');
  });

  it('member/memoText 없이는 저장하지 않고 에러를 던진다(Never silently no-op 원칙)', async () => {
    await expect(confirmAddMemberMemo({ member: null, memoText: '내용' })).rejects.toThrow();
    await expect(confirmAddMemberMemo({ member: MEMBERS[0], memoText: '' })).rejects.toThrow();
    expect(updateMember).not.toHaveBeenCalled();
  });
});

describe('buildAddMemoSummary — 확인받을 문장', () => {
  it('회원명·메모내용을 담아 "추가할까요?"로 끝난다', () => {
    const s = buildAddMemoSummary({ member: { name: '홍길동' }, memoText: '무릎 조심', warnings: [] });
    expect(s).toBe('홍길동님 메모에 "무릎 조심" 추가할까요?');
  });

  it('회원을 못 찾은 경우 전용 문구', () => {
    expect(buildAddMemoSummary({ member: null })).toContain('찾지 못했어요');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 2) 세션 횟수 조정
// ════════════════════════════════════════════════════════════════════════
describe('proposeAdjustSessionCount — 순수 조회 + 음수 방지 하드 검증', () => {
  it('회원·트레이너·횟수가 다 명확하면 ready:true, 잔여/총 횟수를 미리 계산해준다', () => {
    const r = proposeAdjustSessionCount({ memberQuery: '홍길동', trainerId: 't1', delta: 2 });
    expect(r.ready).toBe(true);
    expect(r.currentRemaining).toBe(8);
    expect(r.afterRemaining).toBe(10);
    expect(r.currentTotal).toBe(20);
    expect(r.afterTotal).toBe(22);
  });

  it('트레이너를 안 밝혀도 그 회원 세션 트레이너가 1명뿐이면 자동으로 정한다', () => {
    const r = proposeAdjustSessionCount({ memberQuery: '홍길동', delta: 1 }); // m1은 t1 하나뿐
    expect(r.ready).toBe(true);
    expect(r.trainerId).toBe('t1');
  });

  it('트레이너가 2명이라 애매하면(자동 해석 불가) ready:false, 트레이너를 물어본다', () => {
    const r = proposeAdjustSessionCount({ memberQuery: '김영희', delta: 1 }); // m2는 t1/t2 둘 다
    expect(r.ready).toBe(false);
    expect(r.warnings[0]).toContain('여러 명');
  });

  it('trainerName으로 명시하면 애매함이 풀린다', () => {
    const r = proposeAdjustSessionCount({ memberQuery: '김영희', trainerName: '이서연', delta: 1 });
    expect(r.ready).toBe(true);
    expect(r.trainerId).toBe('t2');
  });

  it('차감 후 잔여가 음수가 되면 확인조차 받지 않고 ready:false(하드 차단)', () => {
    // m2/t2: remaining 0 — 1회만 차감해도 음수.
    const r = proposeAdjustSessionCount({ memberQuery: '김영희', trainerName: '이서연', delta: -1 });
    expect(r.ready).toBe(false);
    expect(r.warnings.join(' ')).toContain('음수가 되어 진행할 수 없어요');
  });

  it('차감 후 총 횟수가 음수가 되는 경우도 동일하게 하드 차단', () => {
    // m1/t1: total 20, remaining 8 — 21회 차감하면 remaining -13, total -1 둘 다 음수.
    const r = proposeAdjustSessionCount({ memberQuery: '홍길동', trainerId: 't1', delta: -21 });
    expect(r.ready).toBe(false);
  });

  it('정확히 0이 되는 차감은 허용한다(음수가 아니라 0이므로)', () => {
    const r = proposeAdjustSessionCount({ memberQuery: '홍길동', trainerId: 't1', delta: -8 }); // remaining 8 -> 0
    expect(r.ready).toBe(true);
    expect(r.afterRemaining).toBe(0);
  });

  it('delta가 0이거나 숫자가 아니면 ready:false', () => {
    expect(proposeAdjustSessionCount({ memberQuery: '홍길동', trainerId: 't1', delta: 0 }).ready).toBe(false);
    expect(proposeAdjustSessionCount({ memberQuery: '홍길동', trainerId: 't1', delta: undefined }).ready).toBe(false);
  });

  it('세션이 아예 없는 회원+트레이너 미지정이면(자동 해석 후보가 0명) 트레이너를 물어본다', () => {
    const r = proposeAdjustSessionCount({ memberQuery: '이철수', delta: 1 });
    expect(r.ready).toBe(false);
    expect(r.warnings[0]).toContain('담당 트레이너를 지정해주세요');
  });

  it('회원을 못 찾으면 ready:false', () => {
    const r = proposeAdjustSessionCount({ memberQuery: '없는사람', trainerId: 't1', delta: 1 });
    expect(r.ready).toBe(false);
  });
});

describe('confirmAdjustSessionCount — 확인 후에만 실제 반영, total/remaining을 함께 조정', () => {
  it('추가는 total·remaining을 동일하게 늘린다', async () => {
    const member = MEMBERS.find((m) => m.id === 'm1');
    const pkg = await confirmAdjustSessionCount({ member, trainerId: 't1', delta: 3 });
    expect(pkg).toEqual({ total: 23, remaining: 11 });
    expect(updateMember).toHaveBeenCalledWith('m1', {
      trainerSessions: { t1: { total: 23, remaining: 11 } },
    });
  });

  it('차감은 total·remaining을 동일하게 줄인다', async () => {
    const member = MEMBERS.find((m) => m.id === 'm1');
    const pkg = await confirmAdjustSessionCount({ member, trainerId: 't1', delta: -3 });
    expect(pkg).toEqual({ total: 17, remaining: 5 });
  });

  it('[방어적 하한] 혹시 음수로 계산돼도 0 밑으로는 절대 안 내려간다', async () => {
    const member = MEMBERS.find((m) => m.id === 'm1');
    const pkg = await confirmAdjustSessionCount({ member, trainerId: 't1', delta: -999 });
    expect(pkg.total).toBe(0);
    expect(pkg.remaining).toBe(0);
  });

  it('member/trainerId/delta 없이는 저장하지 않고 에러를 던진다', async () => {
    await expect(confirmAdjustSessionCount({ member: null, trainerId: 't1', delta: 1 })).rejects.toThrow();
    await expect(confirmAdjustSessionCount({ member: MEMBERS[0], trainerId: null, delta: 1 })).rejects.toThrow();
    await expect(confirmAdjustSessionCount({ member: MEMBERS[0], trainerId: 't1', delta: 0 })).rejects.toThrow();
  });
});

describe('buildAdjustSessionSummary — 확인받을 문장', () => {
  it('추가는 "추가할까요?", 잔여 변화(전→후)를 함께 보여준다', () => {
    const s = buildAdjustSessionSummary({
      member: { name: '홍길동' }, trainer: { name: '박선생' }, delta: 2, currentRemaining: 8, afterRemaining: 10, warnings: [],
    });
    expect(s).toContain('추가할까요');
    expect(s).toContain('8회');
    expect(s).toContain('10회');
  });

  it('차감은 "차감할까요?"이고 횟수는 절댓값으로 말한다(음수 그대로 안 읽음)', () => {
    const s = buildAdjustSessionSummary({
      member: { name: '홍길동' }, trainer: { name: '박선생' }, delta: -2, currentRemaining: 8, afterRemaining: 6, warnings: [],
    });
    expect(s).toContain('2회 차감할까요');
    expect(s).not.toContain('-2');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 3) 회원 기본정보(전화번호 등) 수정
// ════════════════════════════════════════════════════════════════════════
describe('proposeUpdateMemberInfo — 순수 조회, phone/phone2만 지원', () => {
  it('전화번호 변경이 다 명확하면 ready:true, 기존 값을 oldValue로 담아준다', () => {
    const r = proposeUpdateMemberInfo({ memberQuery: '홍길동', field: 'phone', newValue: '010-9999-8888' });
    expect(r.ready).toBe(true);
    expect(r.oldValue).toBe('010-1111-2222');
    expect(r.newValue).toBe('010-9999-8888');
    expect(r.fieldLabel).toBe('전화번호');
  });

  it('phone2(비상연락처)도 지원한다', () => {
    const r = proposeUpdateMemberInfo({ memberQuery: '김영희', field: 'phone2', newValue: '010-1111-0000' });
    expect(r.ready).toBe(true);
    expect(r.fieldLabel).toBe('비상연락처');
  });

  it('지원하지 않는 필드(예: name)는 ready:false — 이름 등은 아직 의도적으로 미지원', () => {
    const r = proposeUpdateMemberInfo({ memberQuery: '홍길동', field: 'name', newValue: '변경이름' });
    expect(r.ready).toBe(false);
    expect(r.warnings[0]).toContain('알아듣지 못했어요');
  });

  it('새 값이 비어있으면 ready:false', () => {
    const r = proposeUpdateMemberInfo({ memberQuery: '홍길동', field: 'phone', newValue: '' });
    expect(r.ready).toBe(false);
  });

  it('전화번호 자릿수가 어색하면(8~11자리 밖) 소프트 경고를 달아준다 — 하드 차단은 아님', () => {
    const r = proposeUpdateMemberInfo({ memberQuery: '홍길동', field: 'phone', newValue: '123' });
    expect(r.ready).toBe(false); // 경고가 있으므로 ready는 false지만
    expect(r.warnings[0]).toContain('자릿수가 어색해요');
    expect(r.newValue).toBe('123'); // 값 자체는 그대로 담겨있다(트레이너가 그래도 확인하면 진행 가능해야 하므로 propose가 값을 지우진 않음)
  });

  it('정상 자릿수의 번호는 경고 없이 통과한다', () => {
    const r = proposeUpdateMemberInfo({ memberQuery: '홍길동', field: 'phone', newValue: '010-1234-5678' });
    expect(r.ready).toBe(true);
  });

  it('회원을 못 찾으면 ready:false', () => {
    const r = proposeUpdateMemberInfo({ memberQuery: '없는사람', field: 'phone', newValue: '010-1234-5678' });
    expect(r.ready).toBe(false);
  });
});

describe('confirmUpdateMemberInfo — 확인 후에만 실제 저장', () => {
  it('지정한 필드만 정확히 바꾼다', async () => {
    const member = MEMBERS.find((m) => m.id === 'm1');
    const result = await confirmUpdateMemberInfo({ member, field: 'phone', newValue: '010-9999-8888' });
    expect(result).toBe('010-9999-8888');
    expect(updateMember).toHaveBeenCalledWith('m1', { phone: '010-9999-8888' });
  });

  it('member/field/newValue 없이는 저장하지 않고 에러를 던진다', async () => {
    await expect(confirmUpdateMemberInfo({ member: null, field: 'phone', newValue: '010' })).rejects.toThrow();
    await expect(confirmUpdateMemberInfo({ member: MEMBERS[0], field: null, newValue: '010' })).rejects.toThrow();
    await expect(confirmUpdateMemberInfo({ member: MEMBERS[0], field: 'phone', newValue: '' })).rejects.toThrow();
    expect(updateMember).not.toHaveBeenCalled();
  });
});

describe('buildUpdateInfoSummary — 확인받을 문장', () => {
  it('기존 값 → 새 값 형태로 보여준다', () => {
    const s = buildUpdateInfoSummary({ member: { name: '홍길동' }, fieldLabel: '전화번호', oldValue: '010-1111-2222', newValue: '010-9999-8888', warnings: [] });
    expect(s).toBe('홍길동님 전화번호를 010-1111-2222에서 010-9999-8888로 바꿀까요?');
  });

  it('기존 값이 없었으면(신규 등록) "에서" 부분 없이 자연스럽게', () => {
    const s = buildUpdateInfoSummary({ member: { name: '이철수' }, fieldLabel: '비상연락처', oldValue: '', newValue: '010-1234-5678', warnings: [] });
    expect(s).toBe('이철수님 비상연락처를 010-1234-5678로 바꿀까요?');
  });
});
