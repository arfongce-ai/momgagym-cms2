// memberBusinessContext.js — [매출 데이터 연결 배선 준비 2026-08-08]
// 순수 함수라 momi_voice.test.js의 matchWakeWord와 같은 방식으로 실제 함수를
// 직접 불러와 검증한다(정적 소스 패턴이 아니라 진짜 동작 확인).
import { describe, expect, it } from 'vitest';
import { buildMemberBusinessContext } from '../ai-measure/core/memberBusinessContext.js';

const FIXED_NOW = new Date('2026-08-08');

describe('buildMemberBusinessContext() — 회원 데이터에서 비즈니스 신호만 안전하게 요약', () => {
  it('member가 없으면 null', () => {
    expect(buildMemberBusinessContext(null)).toBeNull();
  });

  it('참고할 신호가 하나도 없으면 null(빈 객체를 프롬프트에 안 태움)', () => {
    expect(buildMemberBusinessContext({ name: '홍길동' })).toBeNull();
  });

  it('전화번호·생년월일·메모 같은 개인정보 필드를 절대 포함하지 않는다', () => {
    const ctx = buildMemberBusinessContext(
      {
        name: '홍길동',
        phone: '010-1111-2222',
        birthDate: '1985-06-20',
        memo: '무릎 부상 이력',
        lastAttendedDate: '2026-07-25',
        trainerSessions: { t1: { total: 20, remaining: 8 } },
      },
      FIXED_NOW
    );
    const serialized = JSON.stringify(ctx);
    expect(serialized).not.toContain('010-1111-2222');
    expect(serialized).not.toContain('1985-06-20');
    expect(serialized).not.toContain('무릎 부상 이력');
  });

  it('출석·결제·가입 경과일을 오늘 기준으로 계산한다', () => {
    const ctx = buildMemberBusinessContext(
      {
        lastAttendedDate: '2026-07-25', // 14일 전
        lastPaymentDate: '2026-07-01', // 38일 전
        joinDate: '2026-01-01',
        trainerSessions: {},
      },
      FIXED_NOW
    );
    expect(ctx.daysSinceLastAttended).toBe(14);
    expect(ctx.daysSinceLastPayment).toBe(38);
  });

  it('트레이너별 이용권 잔여 횟수를 요약한다', () => {
    const ctx = buildMemberBusinessContext(
      { trainerSessions: { t1: { total: 20, remaining: 8 }, t2: { total: 10, remaining: 2 } } },
      FIXED_NOW
    );
    expect(ctx.packages).toEqual([
      { trainerId: 't1', total: 20, remaining: 8, lowBalance: false },
      { trainerId: 't2', total: 10, remaining: 2, lowBalance: true },
    ]);
  });

  it('잔여 2회 이하면 lowSessionBalance 신호가 true(재등록 타이밍)', () => {
    const ctx = buildMemberBusinessContext(
      { trainerSessions: { t1: { total: 10, remaining: 2 } } },
      FIXED_NOW
    );
    expect(ctx.signals.lowSessionBalance).toBe(true);
  });

  it('잔여 3회 이상이면 lowSessionBalance 신호가 false', () => {
    const ctx = buildMemberBusinessContext(
      { trainerSessions: { t1: { total: 10, remaining: 3 } } },
      FIXED_NOW
    );
    expect(ctx.signals.lowSessionBalance).toBe(false);
  });

  it('14일 이상 미출석이면 longAbsence 신호가 true(이탈 위험)', () => {
    const ctx = buildMemberBusinessContext({ lastAttendedDate: '2026-07-20' }, FIXED_NOW);
    expect(ctx.signals.longAbsence).toBe(true);
  });

  it('13일 이내 출석이면 longAbsence 신호가 false', () => {
    const ctx = buildMemberBusinessContext({ lastAttendedDate: '2026-07-27' }, FIXED_NOW);
    expect(ctx.signals.longAbsence).toBe(false);
  });

  it('날짜 필드가 없거나 잘못돼도 죽지 않고 null로 채운다(추측 안 함)', () => {
    const ctx = buildMemberBusinessContext(
      { lastAttendedDate: '유효하지않은날짜', trainerSessions: { t1: { total: 5, remaining: 1 } } },
      FIXED_NOW
    );
    expect(ctx.daysSinceLastAttended).toBeNull();
    expect(ctx.signals.longAbsence).toBe(false); // null이면 추측해서 true로 안 만듦
  });
});
