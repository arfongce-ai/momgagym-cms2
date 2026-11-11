// [트레이너 본인 기록 2026-11-11] 트레이너도 본인 신체정보·체력측정을 기록·비교할 수
// 있게 하는 "본인 기록 대상". 순수 함수는 실제 실행으로, 화면 연결은 소스 패턴으로 확인한다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  TRAINER_SELF_PREFIX,
  trainerSelfId,
  isTrainerSelfId,
  buildTrainerSelfSubject,
  trainerSelfSubjectsFor,
  withTrainerSelfSubjects,
} from '../utils/trainerSelf.js';
import { scopeMembersToTrainer, isMemberInactive } from '../utils/memberList.js';

const trainers = [
  { id: 't1', name: '가명T1', phone: '010-0000-0001', birthDate: '1990-05-05', gender: 'male', loginEmail: 'a@example.com' },
  { id: 't2', name: '가명T2', phone: '010-0000-0002' },
];
const members = [{ id: 'm1', name: '가명회원', trainerSessions: { t1: { remaining: 3 } } }];
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('본인 기록 대상 ID', () => {
  it('트레이너 ID에 접두사를 붙이고, 접두사로 구분한다', () => {
    expect(trainerSelfId('t1')).toBe(`${TRAINER_SELF_PREFIX}t1`);
    expect(trainerSelfId('')).toBe('');
    expect(isTrainerSelfId('trself_t1')).toBe(true);
    expect(isTrainerSelfId('m1')).toBe(false);
    expect(isTrainerSelfId('trself_')).toBe(false);
    expect(isTrainerSelfId(null)).toBe(false);
  });
});

describe('buildTrainerSelfSubject — 회원 모양의 대상', () => {
  const s = buildTrainerSelfSubject(trainers[0]);
  it('이름·생년월일·성별만 가져오고 연락처·이메일은 넣지 않는다', () => {
    expect(s).toEqual({
      id: 'trself_t1', name: '가명T1 (트레이너)', isTrainerSelf: true, selfTrainerId: 't1',
      gender: 'male', birthDate: '1990-05-05', phone: '', trainerSessions: {},
    });
    expect(JSON.stringify(s)).not.toContain('010-0000');
    expect(JSON.stringify(s)).not.toContain('example.com');
  });
  it('생년월일·성별이 없어도 만들어진다', () => {
    expect(buildTrainerSelfSubject(trainers[1])).toMatchObject({ id: 'trself_t2', gender: '', birthDate: '' });
    expect(buildTrainerSelfSubject(null)).toBeNull();
  });
  it('만료·세션마감 회원으로 취급되지 않는다(선택기 하단으로 밀리지 않음)', () => {
    expect(isMemberInactive(s)).toBe(false);
  });
});

describe('열람 범위 — 본인 + 대표', () => {
  it('트레이너는 본인만', () => {
    expect(trainerSelfSubjectsFor({ role: 'trainer', trainerId: 't1' }, trainers).map((s) => s.id)).toEqual(['trself_t1']);
    expect(trainerSelfSubjectsFor({ role: 'trainer', id: 't2' }, trainers).map((s) => s.id)).toEqual(['trself_t2']);
  });
  it('관리자(대표)는 전체 트레이너', () => {
    expect(trainerSelfSubjectsFor({ role: 'admin' }, trainers).map((s) => s.id)).toEqual(['trself_t1', 'trself_t2']);
  });
  it('직원·비로그인·연결 안 된 트레이너는 없음', () => {
    expect(trainerSelfSubjectsFor({ role: 'staff' }, trainers)).toEqual([]);
    expect(trainerSelfSubjectsFor(null, trainers)).toEqual([]);
    expect(trainerSelfSubjectsFor({ role: 'trainer', trainerId: 'tX' }, trainers)).toEqual([]);
    expect(trainerSelfSubjectsFor({ role: 'admin' }, undefined)).toEqual([]);
  });
});

describe('회원 목록과의 관계', () => {
  it('선택기 목록 앞에 붙고, 원래 회원 목록은 그대로다', () => {
    const user = { role: 'trainer', trainerId: 't1' };
    const list = withTrainerSelfSubjects(scopeMembersToTrainer(members, user), user, trainers);
    expect(list.map((m) => m.id)).toEqual(['trself_t1', 'm1']);
    expect(members).toHaveLength(1);
  });
  it('members 컬렉션에 쓰는 코드가 없다(회원 수·매출 통계에 섞이지 않음)', () => {
    const util = read('../utils/trainerSelf.js');
    const page = read('../pages/MyRecords.jsx');
    for (const src of [util, page]) {
      expect(src).not.toMatch(/addMember|updateMember|addMembersBatch|fbSet\(/);
    }
  });
});

describe('화면 연결', () => {
  it('측정 허브와 리포트의 대상 선택에 본인 기록 대상이 들어간다', () => {
    expect(read('../ai-measure/AiMeasureHub.jsx')).toContain('withTrainerSelfSubjects(sortByName(scopeMembersToTrainer(store.getMembers(), user)), user, store.getTrainers())');
    expect(read('../pages/Report.jsx')).toContain('withTrainerSelfSubjects(sortByName(scopeMembersToTrainer(store.getMembers(), user)), user, store.getTrainers())');
  });
  it('회원 상세는 본인 기록 대상이면 신체정보·측정이력 탭만 보인다', () => {
    const src = read('../components/members/MemberDetail.jsx');
    expect(src).toContain("const isTrainerSelf = initMember?.isTrainerSelf === true;");
    expect(src).toContain("const TABS = isTrainerSelf ? ALL_TABS.filter(([t]) => t === 'body' || t === 'ai') : ALL_TABS;");
    expect(src).toContain("useState(initialTab || (isTrainerSelf ? 'body' : 'info'))");
  });
  it('내 기록 메뉴·라우트가 있고 직원 계정에는 숨긴다', () => {
    expect(read('../App.jsx')).toContain('<Route path="/my-records" element={<MyRecords />} />');
    const layout = read('../components/layout/AppLayout.jsx');
    expect(layout).toContain("{ path:'/my-records', label:'내 기록', icon:'🧍', selfRecords:true }");
    expect(layout.match(/item\.selfRecords|it\.selfRecords/g)).toHaveLength(2);
  });
  it('트레이너 관리에서 성별을 입력할 수 있다', () => {
    const src = read('../pages/Trainers.jsx');
    expect(src).toContain("gender:t.gender||''");
    expect(src).toContain("onChange={pf('gender')}");
  });
});
