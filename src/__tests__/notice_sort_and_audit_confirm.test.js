// notice_sort_and_audit_confirm.test.js
//  1) 공지사항: 고정 우선 + 최신순(createdAt 내림차순) 정렬.
//     기존엔 isPinned만 정렬해 새 공지가 배열 끝(오래된 순)에 쌓였다.
//  2) 스케줄 점검: 문제 없을 때 수동으로 "확인했다"고 기록하는 버튼.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(process.cwd(), 'src');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('공지사항 정렬 — 고정 우선 + 최신순', () => {
  const src = read('pages/Home.jsx');

  it('정렬 기준에 isPinned와 createdAt 내림차순이 함께 들어간다', () => {
    expect(src).toContain('(b.isPinned - a.isPinned) || String(b.createdAt || \'\').localeCompare(String(a.createdAt || \'\'))');
  });

  it('원본 배열을 직접 정렬(mutate)하지 않고 복사본을 정렬한다', () => {
    expect(src).toMatch(/setNotices\(\s*\n?\s*\[\.\.\.store\.getNotices\(\)\]\.sort/);
  });

  // 실제 비교 함수 동작을 동일 로직으로 재현해 알고리즘 자체를 검증
  // (고정 여부 우선, 그다음 최신순이 실제로 성립하는지).
  const compareNotices = (a, b) =>
    (b.isPinned - a.isPinned) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));

  it('핀 고정 공지가 항상 위로 온다', () => {
    const list = [
      { id: 1, isPinned: false, createdAt: '2026-07-10T00:00:00.000Z' },
      { id: 2, isPinned: true,  createdAt: '2026-07-01T00:00:00.000Z' },
      { id: 3, isPinned: false, createdAt: '2026-07-12T00:00:00.000Z' },
    ];
    const sorted = [...list].sort(compareNotices);
    expect(sorted[0].id).toBe(2); // 고정이 가장 오래됐어도 최우선
  });

  it('같은 고정 상태 안에서는 최신(createdAt 큰 값)이 먼저 온다', () => {
    const list = [
      { id: 'old', isPinned: false, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'new', isPinned: false, createdAt: '2026-07-13T09:00:00.000Z' },
      { id: 'mid', isPinned: false, createdAt: '2026-05-01T00:00:00.000Z' },
    ];
    const sorted = [...list].sort(compareNotices);
    expect(sorted.map(n => n.id)).toEqual(['new', 'mid', 'old']);
  });

  it('방금 등록한(가장 최신) 공지가 목록 맨 위에 온다 — 회귀 재현', () => {
    const existing = [
      { id: 'a', isPinned: false, createdAt: '2026-07-01T00:00:00.000Z' },
      { id: 'b', isPinned: false, createdAt: '2026-07-05T00:00:00.000Z' },
    ];
    const justAdded = { id: 'c', isPinned: false, createdAt: new Date().toISOString() };
    const sorted = [...existing, justAdded].sort(compareNotices);
    expect(sorted[0].id).toBe('c'); // 수정 전엔 배열 맨 끝(가장 아래)에 있었다
  });
});

describe('스케줄 점검 — 문제 없음 수동 확인', () => {
  const src = read('pages/Schedule.jsx');

  it('점검 결과가 깨끗할 때 "문제 없음 확인" 버튼이 있다', () => {
    expect(src).toContain('✓ 문제 없음 확인');
    expect(src).toContain('onClick={confirmNoIssue}');
  });

  it('확인 기록은 시각+확인자 이름을 localStorage에 저장한다', () => {
    expect(src).toContain("const AUDIT_CONFIRM_KEY = 'fitcms_schedule_audit_confirmed';");
    expect(src).toMatch(/const rec = \{ at: Date\.now\(\), byName: user\?\.name \|\| '' \}/);
    expect(src).toContain('localStorage.setItem(AUDIT_CONFIRM_KEY, JSON.stringify(rec))');
  });

  it('모달을 열 때 이전 확인 기록을 읽어와 "마지막 확인" 표시를 할 수 있다', () => {
    expect(src).toContain('function readAuditConfirmed()');
    expect(src).toContain('useState(readAuditConfirmed)');
    expect(src).toContain('마지막 확인:');
  });

  it('점검 모달에 user가 전달되어 확인자 이름을 기록할 수 있다', () => {
    const callIdx = src.indexOf('<ScheduleAuditModal');
    const call = src.slice(callIdx, callIdx + 200);
    expect(call).toMatch(/user=\{user\}/);
  });

  it('버튼은 문제가 없는(hasIssues=false) 분기 안에서만 노출된다', () => {
    const idx = src.indexOf('!summary.hasIssues');
    const branch = src.slice(idx, src.indexOf('✓ 문제 없음 확인', idx) + 20);
    expect(branch).not.toContain(') : (');
  });
});
