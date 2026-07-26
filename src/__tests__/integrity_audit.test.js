// integrity_audit.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { auditMemberIntegrity, summarizeFindings, filterDismissed, TAB_FOR_FINDING_TYPE } from '../services/integrityAudit';

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

describe('finding.key — 안정적인 식별자(무시 처리용)', () => {
  const trainers = [{ id: 't1', name: '김나영' }];

  it('같은 문제는 재스캔해도 항상 같은 key를 갖는다', () => {
    const members = [{ id: 'm1', name: '최흥식', trainerSessions: { t1: { total: 20, remaining: 10 } } }];
    const schedules = Array.from({length:7}, (_,i)=>({ id:`a${i}`, memberId:'m1', trainerId:'t1', status:'attended' }));
    const run1 = auditMemberIntegrity({ members, trainers, schedules, payments: {} });
    const run2 = auditMemberIntegrity({ members, trainers, schedules, payments: {} });
    expect(run1[0].key).toBe(run2[0].key);
  });

  it('서로 다른 회원·트레이너 조합은 서로 다른 key를 갖는다(충돌 없음)', () => {
    const members = [
      { id: 'm1', name: 'A', trainerSessions: { t1: { total: 5, remaining: 5 } } },
      { id: 'm2', name: 'B', trainerSessions: { t1: { total: 5, remaining: 5 } } },
    ];
    const findings = auditMemberIntegrity({
      members, trainers,
      schedules: [{ id:'x', memberId:'m1', trainerId:'t1', status:'attended' }, { id:'y', memberId:'m2', trainerId:'t1', status:'attended' }],
      payments: {},
    });
    const keys = findings.map(f=>f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('세 가지 타입 모두 key를 갖는다', () => {
    const members = [{ id: 'm1', name: '최흥식', trainerSessions: {} }];
    const payments = { m1: [
      { id:'p1', isRefunded:true },
      { id:'p2', paidAt:'2026-06-01', sessionAdds:[{trainerId:'t1', count:5}] },
    ] };
    const findings = auditMemberIntegrity({ members, trainers, schedules: [], payments });
    expect(findings.every(f => typeof f.key === 'string' && f.key.length > 0)).toBe(true);
  });
});

describe('filterDismissed — 무시 처리된 항목은 다시 뜨지 않는다', () => {
  const findings = [
    { key: 'a', message: '1' }, { key: 'b', message: '2' }, { key: 'c', message: '3' },
  ];

  it('무시 목록에 있는 key는 제외된다', () => {
    const result = filterDismissed(findings, ['b']);
    expect(result.map(f=>f.key)).toEqual(['a', 'c']);
  });

  it('무시 목록이 비어있으면 전부 그대로 남는다', () => {
    expect(filterDismissed(findings, [])).toHaveLength(3);
  });

  it('빈 findings에도 안전하게 동작한다', () => {
    expect(filterDismissed([], ['a'])).toEqual([]);
  });
});

describe('TAB_FOR_FINDING_TYPE — 회원상세 이동 시 열어줄 탭', () => {
  it('세 가지 타입 모두 유효한 탭을 매핑한다', () => {
    expect(TAB_FOR_FINDING_TYPE.session_mismatch).toBe('sessions');
    expect(TAB_FOR_FINDING_TYPE.refund_incomplete).toBe('payments');
    expect(TAB_FOR_FINDING_TYPE.rate_not_frozen).toBe('payments');
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

describe('firestore.rules — integrityDismissals 컬렉션이 규칙에 등록돼 있는지', () => {
  const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');

  it('규칙 파일은 목록에 없는 컬렉션을 기본 차단한다(회귀 방지용 전제 확인)', () => {
    expect(rules).toMatch(/match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
  });

  it('integrityDismissals가 관리자 전용으로 명시돼 있다(그렇지 않으면 무시 버튼이 배포 후 권한 오류로 실패한다)', () => {
    expect(rules).toMatch(/match \/integrityDismissals\/\{id\}\s*\{\s*allow read, write: if isAdmin\(\);\s*\}/);
  });
});

describe('Settings.jsx — 무결성 검사 도구 배선 확인(관리자 전용)', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'pages', 'Settings.jsx'), 'utf8');

  it('auditMemberIntegrity를 가져와 전 회원 데이터로 호출한다', () => {
    expect(src).toContain("from '../services/integrityAudit'");
    expect(src).toContain('store.getMembers()');
    expect(src).toContain('auditMemberIntegrity({ members, trainers, schedules, payments })');
  });

  it('스캔 자체는 자동으로 쓰지 않는다(읽기 전용 — store.update/delete/dismiss 호출 없음)', () => {
    const start = src.indexOf('const scanIntegrity = async () => {');
    const end = src.indexOf('const dismissFinding', start);
    const fn = src.slice(start, end);
    expect(fn).not.toMatch(/store\.(update|delete|add|process|cancel|dismiss)/);
  });

  it('무시(정상) 버튼은 store.dismissIntegrityFinding을 호출한다', () => {
    expect(src).toContain('store.dismissIntegrityFinding(');
  });

  it('스캔 결과에서 무시된 항목을 filterDismissed로 걸러낸다', () => {
    expect(src).toContain('filterDismissed(');
    expect(src).toContain('store.getIntegrityDismissals()');
  });

  it('회원상세로 이동 버튼은 TAB_FOR_FINDING_TYPE으로 탭을 지정해 /members로 이동한다', () => {
    expect(src).toContain('TAB_FOR_FINDING_TYPE');
    expect(src).toMatch(/navigate\(`\/members\?/);
  });

  it('관리자(admin) 권한 블록 안에 렌더링된다', () => {
    const idx = src.indexOf('데이터 무결성 검사 (관리자)');
    expect(idx).toBeGreaterThan(-1);
    const before = src.slice(0, idx);
    expect(before.lastIndexOf("user?.role === 'admin'")).toBeGreaterThan(-1);
  });
});

describe('Members.jsx — 무결성 검사에서 넘어온 회원 자동 오픈 배선 확인', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'pages', 'Members.jsx'), 'utf8');

  it('URL 쿼리(openMember/tab)를 읽어 해당 회원의 MemberDetail을 자동으로 연다', () => {
    expect(src).toMatch(/useSearchParams|location\.search/);
    expect(src).toContain('openMember');
  });

  it('MemberDetail에 initialTab을 전달한다', () => {
    expect(src).toContain('initialTab');
  });
});

// ── store.dismissIntegrityFinding / getIntegrityDismissals — 원자적 저장 기능 테스트 ──
vi.mock('../firebase', () => ({ db: { __mock: true }, auth: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ __coll: name }),
  doc: (_db, name, id) => ({ name, id }),
  query: (coll, ...clauses) => ({ ...coll, __clauses: clauses }),
  where: (field, op, value) => ({ field, op, value }),
  getDocs: async () => ({ empty: true, docs: [] }),
  setDoc: async () => { if (globalThis.__dismissShouldFail) throw new Error('네트워크 오류(테스트)'); },
  deleteDoc: async () => {},
  writeBatch: () => ({ set(){}, delete(){}, commit: async () => {} }),
}));

const { store: dismissStore, initStore: initDismissStore } = await import('../demoData.js');

beforeEach(async () => {
  globalThis.__dismissShouldFail = false;
  await initDismissStore({ force: true });
});

describe('store.dismissIntegrityFinding — 무시 처리 저장·조회', () => {
  it('무시하면 getIntegrityDismissals에 나타나고, key로 filterDismissed에서 걸러진다', async () => {
    const finding = { key: 'session_mismatch:m1:t1', type: 'session_mismatch', memberId: 'm1', memberName: '최흥식', trainerId: 't1', message: '테스트' };
    await dismissStore.dismissIntegrityFinding(finding, { dismissedBy: '관리자' });

    const list = dismissStore.getIntegrityDismissals();
    expect(list.some(d => d.id === 'session_mismatch:m1:t1')).toBe(true);
    expect(list.find(d => d.id === finding.key).dismissedBy).toBe('관리자');

    const nextScan = [finding, { key: 'other', message: '다른 문제' }];
    const remaining = filterDismissed(nextScan, list.map(d => d.id));
    expect(remaining.map(f => f.key)).toEqual(['other']);
  });

  it('key가 없는 finding은 에러를 던진다(잘못된 호출 방지)', async () => {
    await expect(dismissStore.dismissIntegrityFinding({ type: 'x' })).rejects.toThrow();
  });

  it('저장 실패 시 캐시가 롤백된다', async () => {
    globalThis.__dismissShouldFail = true;
    await expect(dismissStore.dismissIntegrityFinding({ key: 'k1', type: 'x' })).rejects.toThrow();
    expect(dismissStore.getIntegrityDismissals().some(d => d.id === 'k1')).toBe(false);
  });
});
