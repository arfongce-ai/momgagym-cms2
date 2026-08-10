// [음성 명령 확장 2026-08-09] pendingVoiceTarget.js에 memberTab(Members.jsx)·
// revenueTab(Revenue.jsx) 필드를 추가했다. 기존 memberName/testId/openReportKind
// 동작이 그대로 유지되는지도 함께 확인한다(회귀 방지) — pending_voice_target_report_kind.test.js
// 와 같은 sessionStorage 메모리 스텁 패턴을 그대로 쓴다.
import { describe, expect, it, beforeEach } from 'vitest';
import { setPendingVoiceTarget, consumePendingVoiceTarget } from '../voice/pendingVoiceTarget.js';

beforeEach(() => {
  const backing = {};
  global.sessionStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); },
    removeItem: (k) => { delete backing[k]; },
    clear: () => { Object.keys(backing).forEach((k) => delete backing[k]); },
  };
});

describe('pendingVoiceTarget — memberTab (Members.jsx 세션·수납·신체정보·측정이력·메모)', () => {
  it('memberName과 memberTab을 함께 저장·복원한다(실제 사용 시나리오)', () => {
    setPendingVoiceTarget({ memberName: '홍길동', memberTab: 'sessions' });
    const got = consumePendingVoiceTarget();
    expect(got.memberName).toBe('홍길동');
    expect(got.memberTab).toBe('sessions');
  });

  it('memberTab만 있어도 저장한다', () => {
    setPendingVoiceTarget({ memberTab: 'payments' });
    expect(consumePendingVoiceTarget().memberTab).toBe('payments');
  });

  it('한 번 소비하면 지워진다(1회성)', () => {
    setPendingVoiceTarget({ memberName: '홍길동', memberTab: 'memo' });
    consumePendingVoiceTarget();
    expect(consumePendingVoiceTarget()).toBeNull();
  });
});

describe('pendingVoiceTarget — revenueTab (Revenue.jsx 정산 등)', () => {
  it('revenueTab만 있어도 저장한다(회원 무관 화면이므로 memberName 없이도)', () => {
    setPendingVoiceTarget({ revenueTab: 'settle' });
    const got = consumePendingVoiceTarget();
    expect(got.revenueTab).toBe('settle');
    expect(got.memberName).toBeNull();
  });
});

describe('pendingVoiceTarget — 기존 필드와의 회귀 방지', () => {
  it('memberName/testId/openReportKind만 쓰는 기존 호출은 그대로 동작하고 새 필드는 null로 채워진다', () => {
    setPendingVoiceTarget({ memberName: '홍길동', testId: 'jump' });
    const got = consumePendingVoiceTarget();
    expect(got.memberName).toBe('홍길동');
    expect(got.testId).toBe('jump');
    expect(got.memberTab).toBeNull();
    expect(got.revenueTab).toBeNull();
  });

  it('아무 필드도 없으면 여전히 아무것도 저장하지 않는다', () => {
    setPendingVoiceTarget({});
    expect(consumePendingVoiceTarget()).toBeNull();
  });

  it('5분 넘게 묵은 값은 memberTab/revenueTab이 있어도 무시한다', () => {
    const STORAGE_KEY = 'momi_pending_voice_target';
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      memberName: '홍길동', memberTab: 'sessions', ts: Date.now() - 6 * 60 * 1000,
    }));
    expect(consumePendingVoiceTarget()).toBeNull();
  });
});
