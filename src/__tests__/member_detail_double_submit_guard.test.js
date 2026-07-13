// member_detail_double_submit_guard.test.js
// ════════════════════════════════════════════════════════════════════════
//  버그: 회원 상세의 "세션 추가"·"수납 등록"·"세션 양도" 버튼에 중복 제출
//  방지가 없었다. addPaymentWithMemberUpdate는 호출마다 새 결제 id를
//  만들기 때문에(uid('p')), 더블탭/더블클릭하면 결제가 중복 기록되거나
//  transferSessions가 두 번 실행되어 세션이 이중으로 양도될 수 있었다.
//  (Schedule.jsx의 finalizeSchedule/deleteScheduleWithRestore 이중처리
//  방지와 같은 이유의 버그.)
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(process.cwd(), 'src');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('회원 상세 — 세션/결제/양도 중복 제출 방지', () => {
  const src = read('components/members/MemberDetail.jsx');

  it('공용 busy 가드 상태가 있다', () => {
    expect(src).toContain('const [busy, setBusy] = useState(false);');
  });

  it('handleAddSession은 busy면 즉시 반환하고, 처리 중 busy를 세웠다가 끝나면 해제한다', () => {
    const start = src.indexOf('const handleAddSession = async () => {');
    const end = src.indexOf('const startAdjust');
    const fn = src.slice(start, end);
    expect(fn).toContain('if (busy) return;');
    expect(fn).toContain('setBusy(true);');
    expect(fn).toContain('finally { setBusy(false); }');
  });

  it('handleAddPayment은 busy면 즉시 반환하고, 처리 중 busy를 세웠다가 끝나면 해제한다', () => {
    const start = src.indexOf('const handleAddPayment = async () => {');
    const end = src.indexOf('const handleDeletePayment');
    const fn = src.slice(start, end);
    expect(fn).toContain('if (busy) return;');
    expect(fn).toContain('setBusy(true);');
    expect(fn).toContain('finally { setBusy(false); }');
  });

  it('saveTransfer은 busy면 즉시 반환하고, 처리 중 busy를 세웠다가 끝나면 해제한다', () => {
    const start = src.indexOf('const saveTransfer = async (fromTid) => {');
    const end = src.indexOf('// ── 다중 트레이너 금액 분배');
    const fn = src.slice(start, end);
    expect(fn).toContain('if (busy) return;');
    expect(fn).toContain('setBusy(true);');
    expect(fn).toContain("} finally { setBusy(false); }");
  });

  it('세 버튼 모두 disabled={busy}로 화면에서도 재클릭을 막는다', () => {
    expect(src).toMatch(/onClick=\{handleAddSession\} disabled=\{busy\}/);
    expect(src).toMatch(/onClick=\{handleAddPayment\} disabled=\{busy\}/);
    expect(src).toMatch(/onClick=\{\(\)=>saveTransfer\(tid\)\} disabled=\{busy\}/);
  });
});

describe('트레이너 관리 — 등록 중복 제출 방지', () => {
  const src = read('pages/Trainers.jsx');

  it('saveTrainer는 saving이면 즉시 반환하고, 처리 중 saving을 세웠다가 끝나면 해제한다', () => {
    const start = src.indexOf('const saveTrainer = async () => {');
    const end = src.indexOf('const deleteTrainer');
    const fn = src.slice(start, end);
    expect(fn).toContain('if (saving) return;');
    expect(fn).toContain('setSaving(true);');
    expect(fn).toContain('finally { setSaving(false); }');
  });

  it('등록/수정 버튼이 disabled={saving}으로 재클릭을 막는다', () => {
    expect(src).toMatch(/onClick=\{saveTrainer\} disabled=\{saving\}/);
  });
});
