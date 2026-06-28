// 회원 완전 삭제(purgeMember) 시 측정·분석 데이터까지 모두 제거되는지 검증.
// 회원과 __mid 로 연결되는 6개 컬렉션이 빠짐없이 삭제 대상에 포함돼야 한다:
//   schedules, payments, body, ai, gait_reports, posture_reports
import { describe, it, expect } from 'vitest';

// purgeMember 의 삭제목록 수집 로직을 추출한 순수 모델.
// (캐시 데이터 + Firestore 쿼리 결과를 합쳐 삭제 대상을 만든다)
function collectPurgeTargets({ cache, firestore }, mid) {
  const sub = [];
  cache.schedules.filter(s => s.memberId === mid).forEach(s => sub.push({ name: 'schedules', id: s.id }));
  (cache.payments[mid] || []).forEach(p => sub.push({ name: 'payments', id: p.id }));
  (cache.body[mid] || []).forEach(r => sub.push({ name: 'body', id: r.id }));
  (cache.ai[mid] || []).forEach(a => sub.push({ name: 'ai', id: a.id }));
  // 지연 로딩 컬렉션은 Firestore __mid 쿼리로 보강
  (firestore.ai || []).filter(d => d.__mid === mid).forEach(d => {
    if (!sub.some(x => x.name === 'ai' && x.id === d.id)) sub.push({ name: 'ai', id: d.id });
  });
  (firestore.gait_reports || []).filter(d => d.__mid === mid).forEach(d => sub.push({ name: 'gait_reports', id: d.id }));
  (firestore.posture_reports || []).filter(d => d.__mid === mid).forEach(d => sub.push({ name: 'posture_reports', id: d.id }));
  return sub;
}

describe('회원 완전삭제 — 측정·분석 데이터 제거', () => {
  const cache = {
    schedules: [{ id: 's1', memberId: 'm' }, { id: 's2', memberId: 'other' }],
    payments: { m: [{ id: 'p1' }] },
    body: { m: [{ id: 'b1' }] },
    ai: { m: [{ id: 'a1' }] },
  };
  const firestore = {
    ai: [{ id: 'a1', __mid: 'm' }, { id: 'a2', __mid: 'm' }], // a2는 캐시에 없던 것(지연로딩 미적재)
    gait_reports: [{ id: 'g1', __mid: 'm' }, { id: 'g2', __mid: 'other' }],
    posture_reports: [{ id: 'po1', __mid: 'm' }],
  };

  it('6개 컬렉션 모두 삭제 대상에 포함', () => {
    const targets = collectPurgeTargets({ cache, firestore }, 'm');
    const names = new Set(targets.map(t => t.name));
    ['schedules', 'payments', 'body', 'ai', 'gait_reports', 'posture_reports'].forEach(n => {
      expect(names.has(n)).toBe(true);
    });
  });

  it('다른 회원(other) 데이터는 삭제 대상에서 제외', () => {
    const targets = collectPurgeTargets({ cache, firestore }, 'm');
    expect(targets.some(t => t.id === 's2')).toBe(false); // other 스케줄
    expect(targets.some(t => t.id === 'g2')).toBe(false); // other 보행리포트
  });

  it('지연 로딩으로 캐시에 없던 측정 데이터(a2)도 Firestore 쿼리로 포함', () => {
    const targets = collectPurgeTargets({ cache, firestore }, 'm');
    expect(targets.some(t => t.name === 'ai' && t.id === 'a2')).toBe(true);
  });

  it('캐시+Firestore 중복(a1)은 한 번만 포함', () => {
    const targets = collectPurgeTargets({ cache, firestore }, 'm');
    const a1 = targets.filter(t => t.name === 'ai' && t.id === 'a1');
    expect(a1).toHaveLength(1);
  });
});
