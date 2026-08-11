// [momi 쓰기 권한 확장 2026-08-10] GlobalVoiceCommand.jsx/KioskVoiceCommand.jsx —
// memo_add_propose / session_adjust_propose / member_info_update_propose 결과를
// 예약류와 동일하게 "요약 말하기 → 확인 대기 → 확인 후에만 저장" 흐름으로
// 처리하는지 확인. voice_control_timer_ui_wiring.test.js와 같은 정적 소스
// 패턴·같은 describe.each 컨벤션을 따른다(두 컴포넌트가 로직상 완전히 같은
// 미러라 한 파일에서 같이 검증).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

describe.each([
  ['GlobalVoiceCommand.jsx', 'src/components/common/GlobalVoiceCommand.jsx'],
  ['KioskVoiceCommand.jsx', 'src/components/common/KioskVoiceCommand.jsx'],
])('%s — momi 쓰기 권한 확장 3종 배선', (label, path) => {
  const src = readSrc(path);

  it('memberWriteService에서 confirm/summary 함수 6개를 전부 가져온다(재구현 안 함)', () => {
    expect(src).toMatch(/from ['"]\.\.\/\.\.\/services\/memberWriteService['"]/);
    for (const fn of [
      'buildAddMemoSummary', 'confirmAddMemberMemo',
      'buildAdjustSessionSummary', 'confirmAdjustSessionCount',
      'buildUpdateInfoSummary', 'confirmUpdateMemberInfo',
    ]) {
      expect(src).toContain(fn);
    }
  });

  it('3개의 run*ConfirmFlow 함수가 전부 runVoiceConfirmFlow를 재사용한다(예약류와 같은 확인 뼈대, 새로 안 만듦)', () => {
    for (const fnName of ['runMemoAddConfirmFlow', 'runSessionAdjustConfirmFlow', 'runMemberInfoUpdateConfirmFlow']) {
      const start = src.indexOf(`const ${fnName} = useCallback(`);
      expect(start, `${fnName} 정의를 못 찾음`).toBeGreaterThan(-1);
      const end = src.indexOf('[runVoiceConfirmFlow, announceAndFinish]', start);
      const body = src.slice(start, end);
      expect(body).toContain('runVoiceConfirmFlow({');
    }
  });

  it('메모 추가 — 회원이나 메모 내용을 못 찾으면 확인 없이 바로 안내하고 끝낸다(예약류 hasBlockingIssue와 동일 원칙)', () => {
    const start = src.indexOf('const runMemoAddConfirmFlow = useCallback(');
    const end = src.indexOf('const runSessionAdjustConfirmFlow', start);
    const body = src.slice(start, end);
    expect(body).toContain('if (!member || !memoText) {');
    expect(body).toContain('return announceAndFinish(');
  });

  it('세션 조정 — ready:false거나 트레이너/횟수가 없으면 확인 없이 바로 안내한다(음수 방지 하드 검증 결과를 그대로 존중)', () => {
    const start = src.indexOf('const runSessionAdjustConfirmFlow = useCallback(');
    const end = src.indexOf('const runMemberInfoUpdateConfirmFlow', start);
    const body = src.slice(start, end);
    expect(body).toContain('if (!propose.ready || !member || !trainerId || !delta) {');
  });

  it('기본정보 수정 — 회원·필드·새 값 중 하나라도 없으면 확인 없이 바로 안내한다', () => {
    const start = src.indexOf('const runMemberInfoUpdateConfirmFlow = useCallback(');
    const end = src.indexOf('const handleCommand = useCallback(', start);
    const body = src.slice(start, end);
    expect(body).toContain('if (!member || !field || !newValue) {');
  });

  it('handleCommand 결과 분기 3개가 전부 handledSeparately=true + clearHistory로 실제 액션 처리한다(예약류와 동일 패턴)', () => {
    for (const [resultType, flowFn] of [
      ['memo_add_propose', 'runMemoAddConfirmFlow'],
      ['session_adjust_propose', 'runSessionAdjustConfirmFlow'],
      ['member_info_update_propose', 'runMemberInfoUpdateConfirmFlow'],
    ]) {
      const idx = src.indexOf(`result.type === '${resultType}'`);
      expect(idx, `${resultType} 분기를 못 찾음`).toBeGreaterThan(-1);
      const nextBranch = src.indexOf('} else if', idx);
      const branchBody = src.slice(idx, nextBranch);
      expect(branchBody).toContain('handledSeparately = true;');
      expect(branchBody).toContain('clearHistory(chatHistoryRef, lastChatAtRef);');
      expect(branchBody).toContain(`await ${flowFn}(result.propose);`);
    }
  });

  it('3개 분기 모두 예약 3종 분기 다음, timer_control 분기보다 먼저 온다(삽입 위치 확인)', () => {
    const rescheduleIdx = src.indexOf("result.type === 'reservation_reschedule_propose'");
    const memoIdx = src.indexOf("result.type === 'memo_add_propose'");
    const sessionIdx = src.indexOf("result.type === 'session_adjust_propose'");
    const infoIdx = src.indexOf("result.type === 'member_info_update_propose'");
    const timerIdx = src.indexOf("result.type === 'timer_control'");
    expect(memoIdx).toBeGreaterThan(rescheduleIdx);
    expect(sessionIdx).toBeGreaterThan(memoIdx);
    expect(infoIdx).toBeGreaterThan(sessionIdx);
    expect(timerIdx).toBeGreaterThan(infoIdx);
  });

  it('handleCommand의 useCallback deps 배열에 새 확인흐름 함수 3개가 전부 들어있다(stale closure 방지)', () => {
    const depsIdx = src.lastIndexOf('runMemberInfoUpdateConfirmFlow,') > -1
      ? src.lastIndexOf('runMemberInfoUpdateConfirmFlow,')
      : src.lastIndexOf('runMemberInfoUpdateConfirmFlow');
    expect(depsIdx).toBeGreaterThan(-1);
    // deps 배열 전체(핸들러 정의부 이후 등장하는 마지막 참조)가 실제로 배열
    // 리터럴 안에 있는지, 대괄호로 감싸인 구간에서 세 함수 모두 확인한다.
    const arrStart = src.lastIndexOf('[\n      role, user, allMembers, navigate, speak,');
    const arrEnd = src.indexOf(']', arrStart);
    const depsBody = src.slice(arrStart, arrEnd);
    expect(depsBody).toContain('runMemoAddConfirmFlow');
    expect(depsBody).toContain('runSessionAdjustConfirmFlow');
    expect(depsBody).toContain('runMemberInfoUpdateConfirmFlow');
  });
});
