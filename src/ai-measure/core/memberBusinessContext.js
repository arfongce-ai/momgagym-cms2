// src/ai-measure/core/memberBusinessContext.js
// [매출 데이터 연결 배선 준비 2026-08-08] 관리자용 비즈니스 인사이트
// (functions/api/momi.js의 ADMIN_ROLE_SUFFIX)가 실제로 참고할 데이터가 아직
// 없었다 — "그런 관점으로 말해도 된다"만 열어놨지 볼 데이터는 연결 안 된
// 상태였다. 이 파일은 회원 객체에서 결제·출석·이용권 관련 "신호"만 안전하게
// 요약해서 뽑아낸다. 전화번호·생년월일·메모 같은 개인정보나 원본 결제 금액은
// 절대 포함하지 않는다 — 재등록·이탈 판단에 필요한 신호만.
//
// [배선 준비 단계임] 이 함수는 순수 함수라 지금 바로 테스트 가능하지만, 실제로
// 리포트 화면에서 이 값을 만들어 askMomi에 넘기는 배선은 각 리포트 컴포넌트마다
// 따로 붙여야 한다(다음 단계, 아직 안 함). 지금은 "데이터를 안전하게 요약할 수
// 있다"는 것과 momiService.js/momi.js가 이걸 받을 준비까지만 되어 있다.
// functions/api/momi.js가 role을 다시 검증해서 admin이 아니면 이 데이터 자체를
// 프롬프트에서 뺀다(클라이언트가 실수로 같이 보내도 서버가 걸러냄).

function daysBetween(fromISO, toDate = new Date()) {
  if (!fromISO) return null;
  const from = new Date(fromISO);
  if (Number.isNaN(from.getTime())) return null;
  const ms = toDate.getTime() - from.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * 회원 객체에서 비즈니스 신호만 안전하게 요약한다.
 * @param {object} member  { isActive?, lastAttendedDate?, lastPaymentDate?, joinDate?, trainerSessions? }
 * @param {Date} [now]     테스트용 — 기준 시각을 고정하고 싶을 때만 전달.
 * @returns {object|null}  요약(참고할 신호가 하나도 없으면 null — 빈 객체를 프롬프트에 안 태움)
 */
export function buildMemberBusinessContext(member, now = new Date()) {
  if (!member) return null;

  const daysSinceLastAttended = daysBetween(member.lastAttendedDate, now);
  const daysSinceLastPayment = daysBetween(member.lastPaymentDate, now);
  const daysSinceJoin = daysBetween(member.joinDate, now);

  const packages = Object.entries(member.trainerSessions || {}).map(([trainerId, s]) => ({
    trainerId,
    total: typeof s?.total === 'number' ? s.total : null,
    remaining: typeof s?.remaining === 'number' ? s.remaining : null,
    lowBalance: typeof s?.remaining === 'number' && s.remaining <= 2,
  }));

  const summary = {
    isActive: typeof member.isActive === 'boolean' ? member.isActive : null,
    daysSinceLastAttended,
    daysSinceLastPayment,
    daysSinceJoin,
    packages,
    signals: {
      // 재등록 타이밍 신호 — 어느 트레이너 패키지든 잔여 2회 이하면 true.
      lowSessionBalance: packages.some((p) => p.lowBalance),
      // 이탈 위험 신호 — 2주 이상 미출석. (임계값은 추정치 — 실사용하며 조정 필요)
      longAbsence: typeof daysSinceLastAttended === 'number' && daysSinceLastAttended >= 14,
    },
  };

  const hasAnySignal =
    summary.daysSinceLastAttended != null ||
    summary.daysSinceLastPayment != null ||
    packages.length > 0;

  return hasAnySignal ? summary : null;
}
