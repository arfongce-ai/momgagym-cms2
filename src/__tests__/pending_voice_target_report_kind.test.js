// [리포트 통합 2026-08-09] pendingVoiceTarget.js에 openReportKind 필드를
// 추가했다 — AI측정 저장 화면의 "결과리포트에서 보기" 버튼이 이걸로 Report.jsx에
// "도착하면 자동으로 이 종류의 최신 리포트를 열어라"를 1회성으로 전달한다.
// 기존 memberName/testId 동작은 그대로 유지되는지도 같이 확인한다(회귀 방지).
import { describe, expect, it, beforeEach } from 'vitest';
import { setPendingVoiceTarget, consumePendingVoiceTarget } from '../voice/pendingVoiceTarget.js';

// [환경 참고] 이 프로젝트 테스트는 기본적으로 node 환경이라(다른 voice 테스트들과
// 동일 컨벤션 — DOM/브라우저 API가 필요 없는 순수 로직 위주) sessionStorage가
// 전역에 없다. pendingVoiceTarget.js 자체는 이미 try/catch로 방어돼 있지만(접근
// 실패 시 조용히 무시), 실제 저장·복원 동작 자체를 검증하려면 가벼운 메모리
// 스텁을 이 파일에서만 임시로 꽂아준다(다른 테스트 파일에는 영향 없음).
beforeEach(() => {
  const backing = {};
  global.sessionStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); },
    removeItem: (k) => { delete backing[k]; },
    clear: () => { Object.keys(backing).forEach((k) => delete backing[k]); },
  };
});

describe('pendingVoiceTarget — openReportKind (리포트 통합 2026-08-09)', () => {
  it('openReportKind만 있어도 저장한다(memberName/testId 없이도)', () => {
    setPendingVoiceTarget({ openReportKind: 'posture' });
    const got = consumePendingVoiceTarget();
    expect(got.openReportKind).toBe('posture');
  });

  it('memberName과 openReportKind를 함께 저장·복원한다(실제 사용 시나리오)', () => {
    setPendingVoiceTarget({ memberName: '홍길동', openReportKind: 'posture' });
    const got = consumePendingVoiceTarget();
    expect(got.memberName).toBe('홍길동');
    expect(got.openReportKind).toBe('posture');
  });

  it('한 번 소비하면 지워진다(1회성 — 회귀 방지)', () => {
    setPendingVoiceTarget({ memberName: '홍길동', openReportKind: 'posture' });
    consumePendingVoiceTarget();
    const second = consumePendingVoiceTarget();
    expect(second).toBeNull();
  });

  it('기존 memberName/testId만 쓰는 호출(음성 명령)은 그대로 동작한다(회귀 방지)', () => {
    setPendingVoiceTarget({ memberName: '홍길동', testId: 'jump' });
    const got = consumePendingVoiceTarget();
    expect(got.memberName).toBe('홍길동');
    expect(got.testId).toBe('jump');
    expect(got.openReportKind).toBeNull();
  });

  it('셋 다 없으면 아무것도 저장하지 않는다', () => {
    setPendingVoiceTarget({});
    expect(consumePendingVoiceTarget()).toBeNull();
  });

  it('5분 넘게 묵은 값은 openReportKind가 있어도 무시한다(뒤로가기 오작동 방지, 회귀 방지)', () => {
    const STORAGE_KEY = 'momi_pending_voice_target';
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      memberName: '홍길동', openReportKind: 'posture', ts: Date.now() - 6 * 60 * 1000,
    }));
    expect(consumePendingVoiceTarget()).toBeNull();
  });
});
