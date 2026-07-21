// integrity_audit.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { auditMemberIntegrity, summarizeFindings } from '../services/integrityAudit';

describe('auditMemberIntegrity — 세션 소진 정합성', () => {
  const trainers = [{ id: 't1', name: '김나영' }];

  it('출석+노쇼+차감된예정 수업 수가 (등록−잔여)와 일치하면 findings가 없다', () => {
    const members = [{ id: 'm1', name: '최흥식', trainerSessions: { t1: { total: 20, remaining: 10 } } }];
    const schedules = [
      ...Array.from({length:9}, (_,i)=>({ id:`a${i}`, memberId:'m1', trainerId:'t1', status:'attended' })),
      { id: 'ns1', memberId:'m1', trainerId:'t1', status:'noshow' },
    ];
    const findings = auditMemberIntegrity({ members, trainers, schedules, payments: {} });
    expect(findings.filter(f=>f.type==='session_mismatch')).toHaveLength(0);
  });

  it('예정(scheduled)이지만 세션이 이미 차감된(sessionDeducted) 수업도 소진량에 포함해 정합성을 맞춘다', () => {
    const members = [{ id: 'm1', name: '최흥식', trainerSessions: { t1: { total: 10, remaining: 8 } } }];
    const schedules = [
      { id:'a1', memberId:'m1', trainerId:'t1', status:'attended' },
      { id:'s1', memberId:'m1', trainerId:'t1', status:'scheduled', sessionDeducted:true }, // 아직 안 함, 차감만 됨
    ];
    const findings = auditMemberIntegrity({ members, trainers, schedules, payments: {} });
    expect(findings.filter(f=>f.type==='session_mismatch')).toHaveLength(0);
  });

  it('불일치가 있으면 session_mismatch(warn)로 표시한다', () => {
    const members = [{ id: 'm1', name: '최흥식', trainerSessions: { t1: { total: 20, remaining: 10 } } }];
    const schedules = Array.from({length:7}, (_,i)=>({ id:`a${i}`, memberId:'m1', trainerId:'t1', status:'attended' })); // 7 ≠ 10
    const findings = auditMemberIntegrity({ members, trainers, schedules, payments: {} });
    const f = findings.find(x=>x.type==='session_mismatch');
    expect(f).toBeTruthy();
    expect(f.severity).toBe('warn');
    expect(f.memberName).toBe('최흥식');
  });

  it('외부일정(isExternal)은 소진량 계산에서 제외한다', () => {
    const members = [{ id: 'm1', name: '최흥식', trainerSessions: { t1: { total: 5, remaining: 4 } } }];
    const schedules = [
      { id:'a1', memberId:'m1', trainerId:'t1', status:'attended' },
      { id:'ext1', memberId:'m1', trainerId:'t1', status:'attended', isExternal:true },
    ];
    const findings = auditMemberIntegrity({ members, trainers, schedules, payments: {} });
    expect(findings.filter(f=>f.type==='session_mismatch')).toHaveLength(0); // 실제 소진 1 = 등록5-잔여4
  });

  it('다른 회원의 스케줄은 섞이지 않는다', () => {
    const members = [
      { id: 'm1', name: '최흥식', trainerSessions: { t1: { total: 5, remaining: 5 } } },
      { id: 'm2', name: '다른회원', trainerSessions: { t1: { total: 5, remaining: 0 } } },
    ];
    const schedules = Array.from({length:5}, (_,i)=>({ id:`b${i}`, memberId:'m2', trainerId:'t1', status:'attended' }));
    const findings = auditMemberIntegrity({ members, trainers, schedules, payments: {} });
    expect(findings.filter(f=>f.type==='session_mismatch')).toHaveLength(0);
  });
});

describe('auditMemberIntegrity — 환불 데이터 완전성', () => {
  const trainers = [];
  const members = [{ id: 'm1', name: '최흥식', trainerSessions: {} }];

  it('환불 필드가 모두 채워져 있으면 findings가 없다', () => {
    const payments = { m1: [{ id:'p1', isRefunded:true, refundAmount:100000, refundedAt:'2026-07-21' }] };
    const findings = auditMemberIntegrity({ members, trainers, schedules: [], payments });
    expect(findings.filter(f=>f.type==='refund_incomplete')).toHaveLength(0);
  });

  it('refundAmount가 없으면 error로 표시한다', () => {
    const payments = { m1: [{ id:'p1', isRefunded:true, refundedAt:'2026-07-21' }] };
    const findings = auditMemberIntegrity({ members, trainers, schedules: [], payments });
    const f = findings.find(x=>x.type==='refund_incomplete');
    expect(f.severity).toBe('error');
    expect(f.message).toContain('환불액');
  });

  it('refundedAt이 없으면 error로 표시한다', () => {
    const payments = { m1: [{ id:'p1', isRefunded:true, refundAmount:50000 }] };
    const findings = auditMemberIntegrity({ members, trainers, schedules: [], payments });
    const f = findings.find(x=>x.type==='refund_incomplete');
    expect(f.message).toContain('환불일');
  });

  it('환불되지 않은(isRefunded false) 결제는 검사하지 않는다', () => {
    const payments = { m1: [{ id:'p1', isRefunded:false, amount:100000 }] };
    const findings = auditMemberIntegrity({ members, trainers, schedules: [], payments });
    expect(findings.filter(f=>f.type==='refund_incomplete')).toHaveLength(0);
  });

  it('refundAmount가 0이어도(전액 진행분 소진 등) 정상으로 처리한다', () => {
    const payments = { m1: [{ id:'p1', isRefunded:true, refundAmount:0, refundedAt:'2026-07-21' }] };
    const findings = auditMemberIntegrity({ members, trainers, schedules: [], payments });
    expect(findings.filter(f=>f.type==='refund_incomplete')).toHaveLength(0);
  });
});

describe('auditMemberIntegrity — 정산비율 박제 여부', () => {
  const trainers = [{ id: 't1', name: '김나영' }];
  const members = [{ id: 'm1', name: '최흥식', trainerSessions: {} }];

  it('sessionAdds가 있는데 splitRateAtPay가 없으면 info로 표시한다', () => {
    const payments = { m1: [{ id:'p1', paidAt:'2026-06-08', sessionAdds:[{trainerId:'t1', count:20}] }] };
    const findings = auditMemberIntegrity({ members, trainers, schedules: [], payments });
    const f = findings.find(x=>x.type==='rate_not_frozen');
    expect(f.severity).toBe('info');
    expect(f.message).toContain('김나영');
  });

  it('splitRateAtPay가 있으면 표시하지 않는다', () => {
    const payments = { m1: [{ id:'p1', paidAt:'2026-06-08', sessionAdds:[{trainerId:'t1', count:20}], splitRateAtPay:{t1:60} }] };
    const findings = auditMemberIntegrity({ members, trainers, schedules: [], payments });
    expect(findings.filter(f=>f.type==='rate_not_frozen')).toHaveLength(0);
  });

  it('sessionAdds count가 0인 트레이너는 검사 대상에서 제외한다', () => {
    const payments = { m1: [{ id:'p1', paidAt:'2026-06-08', sessionAdds:[{trainerId:'t1', count:0}] }] };
    const findings = auditMemberIntegrity({ members, trainers, schedules: [], payments });
    expect(findings.filter(f=>f.type==='rate_not_frozen')).toHaveLength(0);
  });

  it('미수금(isUnpaid) 결제는 검사하지 않는다', () => {
    const payments = { m1: [{ id:'p1', paidAt:'2026-06-08', isUnpaid:true, sessionAdds:[{trainerId:'t1', count:20}] }] };
    const findings = auditMemberIntegrity({ members, trainers, schedules: [], payments });
    expect(findings.filter(f=>f.type==='rate_not_frozen')).toHaveLength(0);
  });
});

describe('summarizeFindings', () => {
  it('심각도별 개수를 센다', () => {
    const findings = [
      { severity: 'error' }, { severity: 'error' }, { severity: 'warn' }, { severity: 'info' }, { severity: 'info' }, { severity: 'info' },
    ];
    expect(summarizeFindings(findings)).toEqual({ error: 2, warn: 1, info: 3 });
  });

  it('빈 배열이면 전부 0', () => {
    expect(summarizeFindings([])).toEqual({ error: 0, warn: 0, info: 0 });
  });
});

describe('Settings.jsx — 무결성 검사 도구 배선 확인(관리자 전용, 읽기 전용)', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'pages', 'Settings.jsx'), 'utf8');

  it('auditMemberIntegrity를 가져와 전 회원 데이터로 호출한다', () => {
    expect(src).toContain("from '../services/integrityAudit'");
    expect(src).toContain('store.getMembers()');
    expect(src).toContain('auditMemberIntegrity({ members, trainers, schedules, payments })');
  });

  it('스캔 결과를 자동으로 쓰지 않는다(읽기 전용 — store.update/delete 호출 없음)', () => {
    const start = src.indexOf('const scanIntegrity = async () => {');
    const end = src.indexOf('return (', start);
    const fn = src.slice(start, end);
    expect(fn).not.toMatch(/store\.(update|delete|add|process|cancel)/);
  });

  it('관리자(admin) 권한 블록 안에 렌더링된다', () => {
    const idx = src.indexOf('데이터 무결성 검사 (관리자)');
    expect(idx).toBeGreaterThan(-1);
    const before = src.slice(0, idx);
    expect(before.lastIndexOf("user?.role === 'admin'")).toBeGreaterThan(-1);
  });
});
