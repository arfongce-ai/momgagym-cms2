// 회원·결제 엑셀 가져오기: 파서 + addMembersBatch 검증
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parsePaymentSheet, buildMemberImport, normalizeMethod, parseSession, excelDate } from '../utils/memberImport';

let FAIL = false;
const mem = {};
vi.mock('../firebase', () => ({ db: { __mock: true }, auth: {} }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  doc: (_db, name, id) => ({ name, id }),
  getDocs: async () => ({ empty: true, docs: [] }),
  setDoc: async (ref, data) => { if (FAIL) throw new Error('denied'); (mem[ref.name] ||= {})[ref.id] = data; },
  deleteDoc: async (ref) => { if (FAIL) throw new Error('denied'); if (mem[ref.name]) delete mem[ref.name][ref.id]; },
  writeBatch: () => {
    const ops = [];
    return {
      set: (ref, data) => ops.push(['set', ref, data]),
      delete: (ref) => ops.push(['del', ref]),
      commit: async () => { if (FAIL) throw new Error('batch denied'); for (const [t, ref, data] of ops) { if (t === 'set') (mem[ref.name] ||= {})[ref.id] = data; else if (mem[ref.name]) delete mem[ref.name][ref.id]; } },
    };
  },
}));
import { store } from '../demoData';

beforeEach(() => { FAIL = false; });

describe('정규화 헬퍼', () => {
  it('결제수단 정규화', () => {
    expect(normalizeMethod('울산페이')).toBe('pay');
    expect(normalizeMethod('울신페이')).toBe('pay');
    expect(normalizeMethod('현금영수증1')).toBe('cash_receipt');
    expect(normalizeMethod('계좌')).toBe('transfer');
    expect(normalizeMethod('카드2')).toBe('card2');
    expect(normalizeMethod('현금')).toBe('cash');
  });
  it('세션 표기 파싱', () => {
    expect(parseSession('10s')).toEqual({ kind: 'session', count: 10 });
    expect(parseSession('30S')).toEqual({ kind: 'session', count: 30 });
    expect(parseSession('1m')).toEqual({ kind: 'monthly', count: 1 });
    expect(parseSession('입금')).toEqual({ kind: 'etc', count: 0 });
  });
  it('엑셀 시리얼 날짜 변환', () => {
    expect(excelDate(46026)).toBe('2026-01-04');
    expect(excelDate('2026-02-15')).toBe('2026-02-15');
  });
});

// 매출관리 시트를 모사한 rows
const sheet = [
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  [null, null, '날짜', '이름 ', '세션', '금액', '부가세(10%)', '결제', '내용', '수단', '상담', '담당', '입금 ', null, '0.4'],
  [null, '1월', null, null, null, null, null, null, null, null, null, null, null],
  [null, 1, 46026, '안재훈', '10s', 600000, null, 1, null, '계좌', '재만T', '재만T', 600000],
  [null, 2, 46027, '박건희', '10s', 600000, 60000, 1, '허리통증', '카드2', '동규T', '호진T', 537600],
  [null, 3, 46028, '안재훈', '10s', 600000, null, 2, '재등록', '계좌', '재만T', '재만T', 600000], // 재등록
  [null, 4, 46029, '서현숙', '1m', 150000, null, 1, '월회원', '계좌', '나영T', '나영T', 150000], // 월회원
  [null, 5, 46030, '김도훈', null, -360000, null, null, '환불', null, null, '해정T', -360000], // 환불
  [null, null, null, '총매출', null, 99999999, null, null, null, null, null, null], // 집계행(제외)
];

const abbrToName = { '재만T':'박재만', '동규T':'김동규', '호진T':'주호진', '나영T':'김나영', '해정T':'정해정' };
const trainerNameToId = { '박재만':'t10', '김동규':'t11', '주호진':'t12', '김나영':'t13', '정해정':'t14' };

describe('parsePaymentSheet + buildMemberImport', () => {
  const { records, skipped } = parsePaymentSheet(sheet, { abbrToName, trainerNameToId });

  it('집계행(총매출)은 제외된다', () => {
    expect(skipped).toBe(1);
    expect(records.some(r => r.name === '총매출')).toBe(false);
  });
  it('결제 5건 파싱(안재훈2·박건희·서현숙·김도훈)', () => {
    expect(records.length).toBe(5);
  });
  it('유형 분류: session/monthly/refund', () => {
    const kinds = records.map(r => r.kind).sort();
    expect(kinds).toEqual(['monthly', 'refund', 'session', 'session', 'session']);
  });

  const members = buildMemberImport(records);

  it('회원 4명(안재훈·박건희·서현숙·김도훈), 안재훈은 재등록으로 묶임', () => {
    expect(members.length).toBe(4);
    const aj = members.find(m => m.name === '안재훈');
    expect(aj.payments.length).toBe(2);                          // 2건 결제
    expect(aj.trainerSessions['t10'].total).toBe(20);           // 10+10 누적
    expect(aj.trainerSessions['t10'].remaining).toBe(20);
  });
  it('서현숙은 월회원으로 표시', () => {
    const s = members.find(m => m.name === '서현숙');
    expect(s.monthly).toBeTruthy();
    expect(s.monthly.fee).toBe(150000);
  });
  it('박건희: 담당=호진T(주호진), 결제수단 카드2', () => {
    const b = members.find(m => m.name === '박건희');
    expect(b.trainerSessions['t12'].total).toBe(10);
    expect(b.payments[0].method).toBe('card2');
  });
  it('김도훈 환불은 isRefunded 플래그', () => {
    const k = members.find(m => m.name === '김도훈');
    expect(k.payments[0].isRefunded).toBe(true);
    expect(k.warnings.some(w => w.includes('환불'))).toBe(true);
  });
});

describe('store.addMembersBatch', () => {
  it('회원+결제를 원자적으로 등록하고 중복은 스킵', async () => {
    const { records } = parsePaymentSheet(sheet, { abbrToName, trainerNameToId });
    const members = buildMemberImport(records);
    const before = store.getMembers().length;
    const res = await store.addMembersBatch(members);
    expect(res.added).toBe(4);
    expect(store.getMembers().length).toBe(before + 4);
    // 결제도 회원에 연결됨
    const aj = store.getMembers().find(m => m.name === '안재훈');
    expect(store.getPayments(aj.id).length).toBe(2);

    // 같은 데이터 재가져오기 → 전부 중복 스킵
    const res2 = await store.addMembersBatch(members);
    expect(res2.added).toBe(0);
    expect(res2.skipped).toBe(4);
  });

  it('배치 실패 시 회원·결제 모두 롤백', async () => {
    const before = store.getMembers().length;
    FAIL = true;
    await expect(store.addMembersBatch([{ name: '롤백회원', payments: [{ amount: 1000 }], trainerSessions: {} }])).rejects.toThrow();
    FAIL = false;
    expect(store.getMembers().length).toBe(before);
  });
});
