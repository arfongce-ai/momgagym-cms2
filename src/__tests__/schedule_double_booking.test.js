// 스케줄 중복 예약/이중 회차표기 방지 검증
//  증상: 세션은 1회 사용인데 스케줄에 "홍성예 10(s)"가 두 번 표시.
//  원인: 동시(더블탭·연속) 예약이 캐시의 같은 잔여값을 읽어 둘 다 첫 수업으로
//        찍히고 차감은 한 번만 반영됨.
//  수정: (1) 제출 버튼 중복 방지, (2) 차감 로직 직렬화.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('스케줄 중복 예약 방지 — 제출 가드', () => {
  const sched = read('../pages/Schedule.jsx');

  it('예약 제출이 submitting 상태로 중복 실행을 막는다', () => {
    expect(sched).toMatch(/const \[submitting, setSubmitting\]/);
    expect(sched).toMatch(/if \(submitting\) return/);
    expect(sched).toMatch(/disabled=\{submitting/);
  });

  it('제출은 await 로 완료를 기다린 뒤 상태를 해제한다', () => {
    expect(sched).toMatch(/const handleAdd = async/);
    expect(sched).toMatch(/await runAdd\(\)/);
    expect(sched).toMatch(/finally \{\s*setSubmitting\(false\)/);
  });

  it('기간 외부일정도 순차(await) 생성으로 동시 생성을 피한다', () => {
    expect(sched).toMatch(/for \(const d of dates\)/);
    expect(sched).toMatch(/await onAdd\(/);
    expect(sched).not.toMatch(/dates\.forEach\(d => \{\s*onAdd/);
  });
});

describe('세션 차감 직렬화 — 동시 예약 경쟁 방지', () => {
  const store = read('../demoData.js');

  it('차감 로직이 체인으로 직렬화되어 캐시 경쟁을 막는다', () => {
    expect(store).toMatch(/_deductionChain/);
    expect(store).toMatch(/_doCreateScheduleWithDeduction/);
    // 공개 진입점은 이전 차감이 끝난 뒤 실행되도록 체인에 연결
    expect(store).toMatch(/const prev = store\._deductionChain \|\| Promise\.resolve\(\)/);
    expect(store).toMatch(/store\._deductionChain = next/);
  });

  it('회차표기는 sessionAtBooking==total 일 때만 (s)', () => {
    const sched = read('../pages/Schedule.jsx');
    expect(sched).toMatch(/if \(total != null && n === total\) tag = '\(s\)'/);
    expect(sched).toMatch(/else if \(n === 1\) tag = '\(e\)'/);
  });
});

describe('스케줄 확정/삭제 직렬화 — 동시 취소·삭제 경쟁 방지', () => {
  const store = read('../demoData.js');
  const sched = read('../pages/Schedule.jsx');

  it('finalizeSchedule과 deleteScheduleWithRestore도 같은 체인으로 직렬화된다', () => {
    expect(store).toMatch(/finalizeSchedule: async \(scheduleId, status\) => \{\s*\n\s*const run = \(\) => store\._doFinalizeSchedule/);
    expect(store).toMatch(/deleteScheduleWithRestore: async \(scheduleId\) => \{\s*\n\s*const run = \(\) => store\._doDeleteScheduleWithRestore/);
  });

  it('직렬화 후 재확인으로 이미 확정된 스케줄의 이중 처리를 막는다', () => {
    expect(store).toMatch(/_doFinalizeSchedule:.*[\s\S]{0,300}if \(sched\.statusFinalized\) throw new Error\('이미 처리된 스케줄입니다\.'\)/);
  });

  it('상태/삭제 버튼에 processing 가드가 있어 더블탭으로 두 요청이 동시에 나가지 않는다', () => {
    expect(sched).toMatch(/const \[processing, setProcessing\] = useState\(false\)/);
    expect(sched).toMatch(/if \(processing\) return/);
    expect(sched).toMatch(/disabled=\{processing\}/);
  });
});
