// member_transfer_cross_member_ui.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-10 신규] 세션 양도 UI 확장 — 회원 고정을 풀고 "다른 회원에게 양도"
//  (신규/기존 회원), "트레이너 고정 회원→회원"까지 지원한다.
//  Vitest+Node라 실제 DOM 렌더링 대신 소스 패턴 매칭으로 배선을 검증한다
//  (프로젝트 기존 테스트 관례 — member_detail_double_submit_guard.test.js 등과 동일).
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(process.cwd(), 'src');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('MemberDetail.jsx — 양도 대상 종류(destType) 상태·전환', () => {
  const src = read('components/members/MemberDetail.jsx');

  it('transferForm에 destType/toMemberId가 추가됐고 기본값은 trainer(기존 동작 보존)', () => {
    expect(src).toContain("const [transferForm,  setTransferForm]  = useState({ toTid:'', count:1, destType:'trainer', toMemberId:'' });");
  });

  it('startTransfer는 폼을 열 때마다 destType을 trainer로, toMemberId를 빈 값으로 초기화한다(잔상 방지)', () => {
    const start = src.indexOf('const startTransfer = (tid, s) => {');
    const end = src.indexOf('const setTransferDestType');
    const fn = src.slice(start, end);
    expect(fn).toContain("destType:'trainer'");
    expect(fn).toContain("toMemberId:''");
  });

  it('setTransferDestType — member로 전환 시 출발 트레이너(transferTid)를 기본 선택해 "트레이너 고정"을 기본값으로 만든다', () => {
    const start = src.indexOf('const setTransferDestType = (destType) => {');
    const end = src.indexOf('const saveTransfer = async (fromTid) => {');
    const fn = src.slice(start, end);
    expect(fn).toContain("toTid: destType === 'member' ? transferTid : ''");
  });
});

describe('MemberDetail.jsx — saveTransfer: 회원↔회원 양도 배선', () => {
  const src = read('components/members/MemberDetail.jsx');
  // 더블 서브밋 가드 테스트(member_detail_double_submit_guard.test.js)와 동일한
  // 경계로 잘라, saveTransfer(fromTid) 시그니처와 busy 가드가 그대로임을 전제로 검증.
  const start = src.indexOf('const saveTransfer = async (fromTid) => {');
  const end = src.indexOf('// ── 다중 트레이너 금액 분배');
  const fn = src.slice(start, end);

  it('saveTransfer(fromTid) 시그니처를 그대로 유지한다(더블서브밋 가드 테스트 전제 — 회귀 방지)', () => {
    expect(start).toBeGreaterThan(-1);
    expect(fn).toContain('if (busy) return;');
    expect(fn).toContain('setBusy(true);');
    expect(fn).toContain('} finally { setBusy(false); }');
  });

  it('destType이 member인데 toMemberId가 없으면 트레이너 선택과 별개로 막는다', () => {
    expect(fn).toContain("if (destType === 'member' && !toMemberId) { alert('양도받을 회원을 선택하세요.'); return; }");
  });

  it('destType===member일 때만 store.transferSessions에 toMemberId를 실어 보낸다(trainer 모드는 기존 호출과 동일 — 하위호환)', () => {
    expect(fn).toContain("await store.transferSessions(member.id, {");
    expect(fn).toContain("...(destType === 'member' ? { toMemberId } : {}),");
  });

  it('회원↔회원 확인 문구에는 "결제 기록은 원래 회원 유지 + 단가/비율은 이어받음" 안내가, 같은 회원 문구에는 기존 결제금 이전 안내가 각각 들어간다(사용자가 돈이 어떻게 되는지 헷갈리지 않게)', () => {
    expect(fn).toContain('결제 기록(영수증)은 원래 회원에게 그대로 남습니다');
    expect(fn).toContain('넘어가는 세션의 단가·정산비율은 그대로 이어받아');
    expect(fn).toContain('양도한 횟수만큼 결제금·정산비율도 함께 이전됩니다');
  });
});

describe('MemberDetail.jsx — 양도 UI: 대상 선택(기존/신규 회원) 배선', () => {
  const src = read('components/members/MemberDetail.jsx');

  it('MemberPicker와 MemberRegister(기본 export)를 함께 임포트한다(재사용 — 새로 안 만듦)', () => {
    expect(src).toContain("import MemberRegister, { ClassTypeCheckbox } from './MemberRegister';");
    expect(src).toContain("import MemberPicker from '../common/MemberPicker';");
  });

  it('MemberDetail은 members 배열을 새 prop으로 받는다(기본값 빈 배열 — 안 넘겨도 안전)', () => {
    expect(src).toContain('export default function MemberDetail({ member:initMember, trainers, members=[], onClose, onUpdate, initialTab }) {');
  });

  it('기존 회원 선택기는 현재 회원 자신을 목록에서 제외한다(자기 자신에게 양도 방지)', () => {
    expect(src).toContain('members={members.filter(m=>m.id!==member.id)}');
  });

  it('기존 회원 선택기는 allowNone=false로 반드시 회원을 고르게 한다', () => {
    expect(src).toContain('allowNone={false}');
  });

  it('"+ 신규 회원 등록" 버튼이 있고, 클릭 시 showTransferNewMember를 연다', () => {
    expect(src).toContain('+ 신규 회원 등록');
    expect(src).toContain('onClick={()=>setShowTransferNewMember(true)}');
  });

  it('신규 회원 등록 완료 시 방금 만든 회원을 바로 toMemberId로 지정한다(수동 재검색 불필요)', () => {
    const start = src.indexOf('{showTransferNewMember && (');
    const block = src.slice(start); // 컴포넌트 끝까지 — 이 블록이 파일의 마지막 조건부 렌더이므로 안전
    expect(block).toContain('onSuccess={(newMember)=>{');
    expect(block).toContain("if (newMember?.id) setTransferForm(f=>({ ...f, toMemberId:newMember.id }));");
  });

  it('신규 회원 등록 모달에도 trainers를 그대로 전달한다(정식 가입 흐름과 동일 절차)', () => {
    const start = src.indexOf('{showTransferNewMember && (');
    const block = src.slice(start);
    expect(block).toContain('<MemberRegister');
    expect(block).toContain('trainers={trainers}');
  });
});

describe('MemberDetail.jsx — 양도 UI: 트레이너 선택 목록(회원 양도 시 트레이너 고정 허용)', () => {
  const src = read('components/members/MemberDetail.jsx');

  it('destType===member일 때는 트레이너 목록에서 출발 트레이너(tid)를 제외하지 않는다(트레이너 고정 허용)', () => {
    expect(src).toContain("(transferForm.destType==='member' ? trainers : trainers.filter(tt=>tt.id!==tid)).map(tt=>{");
  });

  it('destType===member일 때 트레이너 옵션의 잔여 표시는 대상 회원(toMemberId)의 세션 기준으로 바뀐다', () => {
    const start = src.indexOf("const destSessions = transferForm.destType==='member'");
    const end = src.indexOf('return (', start);
    const block = src.slice(start, end);
    expect(block).toContain("(members.find(m=>m.id===transferForm.toMemberId)?.trainerSessions || {})");
    expect(block).toContain(': member.trainerSessions;');
  });
});

describe('Members.jsx — MemberDetail에 members 전체 목록을 함께 전달', () => {
  it('선택된 회원 상세를 열 때 members 배열도 함께 넘긴다(양도 대상 선택기가 쓸 수 있게)', () => {
    const src = read('pages/Members.jsx');
    const start = src.indexOf('{selected && (');
    const end = src.indexOf(')}', start);
    const block = src.slice(start, end);
    expect(block).toContain('<MemberDetail');
    expect(block).toContain('members={members}');
  });
});
