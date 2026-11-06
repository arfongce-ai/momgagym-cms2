import { describe, it, expect } from 'vitest';
import { summarizeMembers, isMemberExpired as scriptExpired, isSessionExhausted as scriptExhausted } from '../../scripts/dashboard-snapshot/memberStatus.mjs';
import { isMemberExpired, isSessionExhausted, isMemberInactive } from '../utils/memberList.js';
import { isMemberExpired as appExpired } from '../utils/dates.js';
import { summarizeRange } from '../utils/dashboardRollup.js';

const todayLocal = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ahead = (n) => ago(-n);

const members = [
  { id: 'a', isActive: true, trainerSessions: { t1: { total: 10, remaining: 4 } }, lastPaymentDate: ago(10) },          // 활성
  { id: 'b', isActive: true, trainerSessions: { t1: { total: 10, remaining: 0 } }, lastPaymentDate: ago(10) },          // 횟수마감
  { id: 'c', isActive: true, trainerSessions: { t2: { total: 10, remaining: 3 } }, lastPaymentDate: ago(400) },         // 1년 경과 만료
  { id: 'd', isActive: true, trainerSessions: {}, monthly: { active: true, dueDate: ahead(3) } },                      // 월정액 임박 → 만료
  { id: 'e', isActive: true, trainerSessions: {}, monthly: { active: true, dueDate: ahead(20) } },                     // 월정액 정상
];

describe('대시보드 활성 회원 — CMS 회원 목록과 같은 기준', () => {
  it('스크립트 판정이 앱 판정과 회원마다 일치한다', () => {
    members.forEach((m) => {
      expect(scriptExpired(m, todayLocal)).toBe(appExpired(m));
      expect(scriptExhausted(m)).toBe(isSessionExhausted(m));
    });
  });
  it('isActive 플래그가 전부 true 여도 만료·마감 회원은 활성에서 빠진다', () => {
    const s = summarizeMembers(members, todayLocal);
    expect(s.total).toBe(5);
    expect(s.active).toBe(members.filter((m) => !isMemberInactive(m)).length);
    expect(s.active).toBe(2); // a, e
    expect(s.activeByTrainer).toEqual({ t1: 1 });
  });
});

describe('1주·1달 집계', () => {
  const dailyDocs = [
    { date: ago(0), revenue: 300000, newMembers: 1, reports: 5, activeMembers: 80, byTrainer: { t1: { name: 'A', revenue: 200000 }, t2: { name: 'B', revenue: 100000 } } },
    { date: ago(1), revenue: 100000, newMembers: 0, reports: 2, activeMembers: null, byTrainer: { t1: { name: 'A', revenue: 100000 } } },
    { date: ago(9), revenue: 999999, newMembers: 9, reports: 9, byTrainer: {} }, // 7일 밖
  ];
  it('7일 합계는 기간 안 문서만 더하고 빠진 날은 0이 아니라 제외로 센다', () => {
    const r = summarizeRange(dailyDocs, 7, todayLocal);
    expect(r.days).toHaveLength(7);
    expect(r.totals).toEqual({ revenue: 400000, newMembers: 1, reports: 7 });
    expect(r.missing).toBe(5);
    expect(r.avgRevenue).toBe(200000);
    expect(r.byTrainer.map((t) => [t.id, t.revenue])).toEqual([['t1', 300000], ['t2', 100000]]);
  });
  it('30일이면 9일 전 문서도 포함된다', () => {
    const r = summarizeRange(dailyDocs, 30, todayLocal);
    expect(r.totals.revenue).toBe(1399999);
  });
});
