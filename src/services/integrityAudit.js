// integrityAudit.js — 전 회원 대상 데이터 무결성 검사 (관리자용, 읽기 전용 스캔)
// ════════════════════════════════════════════════════════════════════════
//  목적: "등록된 모든 회원"을 대상으로 수납→세션→스케줄→환불 사이에 어긋난
//  데이터가 있는지 찾아낸다. 판단 재료만 제공하고 자동으로 고치지 않는다
//  (scheduleAudit.js와 동일한 원칙 — 되돌릴 수 없는 처리는 관리자가 직접).
//
//  검사 항목:
//   1) session_mismatch — 트레이너별 (등록−잔여) 소진량과, 실제 스케줄상
//      "차감 처리된" 수업 수(출석·노쇼·차감된예정)가 다른 경우.
//      · 세션 재등록/직접수정 등 정상적인 수동 조정으로도 생길 수 있어
//        severity는 'warn'(확인 필요) — 반드시 오류는 아님.
//   2) refund_incomplete — isRefunded=true인데 refundAmount/refundedAt이
//      비어있는 경우. processRefund는 이 필드들을 항상 함께 기록하므로,
//      정상 흐름으로는 생길 수 없다 — severity 'error'.
//   3) rate_not_frozen — 세션이 추가된(sessionAdds) 결제인데 그 트레이너의
//      정산비율(splitRateAtPay)이 박제되지 않은 경우. 구버전 결제는 흔히
//      있을 수 있어 severity 'info'(그 결제월 자동판정으로 폴백되어 동작은
//      하지만, 이후 트레이너 조건이 바뀌면 등록월 실적과 다르게 계산될 수 있음).
// ════════════════════════════════════════════════════════════════════════

const isDeductingSchedule = (s) =>
  !s.isExternal &&
  (s.status === 'attended' || s.status === 'noshow' || (s.status === 'scheduled' && s.sessionDeducted));

// members: [...], trainers: [...], schedules: [...], payments: { [memberId]: [...] }
export function auditMemberIntegrity({ members = [], trainers = [], schedules = [], payments = {} }) {
  const findings = [];
  const trainerMap = Object.fromEntries(trainers.map(t => [t.id, t]));
  const trainerName = (tid) => trainerMap[tid]?.name || tid;

  members.forEach(m => {
    const ts = m.trainerSessions || {};
    const mPayments = payments[m.id] || [];

    // 1) 세션 소진 정합성
    Object.entries(ts).forEach(([tid, s]) => {
      const total = Number(s.total) || 0;
      const remaining = s.remaining != null ? Number(s.remaining) : total;
      const expectedDeducted = total - remaining;
      const actualDeducted = schedules.filter(sc =>
        sc.memberId === m.id && sc.trainerId === tid && isDeductingSchedule(sc)
      ).length;
      if (actualDeducted !== expectedDeducted) {
        findings.push({
          type: 'session_mismatch', severity: 'warn',
          memberId: m.id, memberName: m.name || '?',
          trainerId: tid, trainerName: trainerName(tid),
          message: `등록 ${total}회 · 잔여 ${remaining}회(소진 ${expectedDeducted}회 예상) vs 실제 스케줄 차감 기록 ${actualDeducted}회`,
        });
      }
    });

    mPayments.forEach(p => {
      // 2) 환불 데이터 완전성
      if (p.isRefunded) {
        const missing = [];
        if (p.refundAmount === undefined || p.refundAmount === null) missing.push('환불액');
        if (!p.refundedAt) missing.push('환불일');
        if (missing.length) {
          findings.push({
            type: 'refund_incomplete', severity: 'error',
            memberId: m.id, memberName: m.name || '?', paymentId: p.id, paidAt: p.paidAt || '',
            message: `환불 처리됐지만 누락된 값: ${missing.join(', ')}`,
          });
        }
      }
      // 3) 정산비율 박제 여부
      if (!p.isUnpaid && Array.isArray(p.sessionAdds) && p.sessionAdds.length) {
        const addedTids = [...new Set(p.sessionAdds.filter(sa => (Number(sa.count) || 0) > 0).map(sa => sa.trainerId))];
        const missingFreeze = addedTids.filter(tid => !(p.splitRateAtPay && p.splitRateAtPay[tid] != null));
        if (missingFreeze.length) {
          findings.push({
            type: 'rate_not_frozen', severity: 'info',
            memberId: m.id, memberName: m.name || '?', paymentId: p.id, paidAt: p.paidAt || '',
            message: `정산비율이 박제되지 않음(트레이너: ${missingFreeze.map(trainerName).join(', ')}) — 결제월 자동판정으로 폴백`,
          });
        }
      }
    });
  });

  return findings;
}

export const SEVERITY_LABEL = { error: '오류', warn: '확인 필요', info: '참고' };
export const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

export function summarizeFindings(findings = []) {
  const bySeverity = { error: 0, warn: 0, info: 0 };
  findings.forEach(f => { bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1; });
  return bySeverity;
}
