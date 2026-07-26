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

describe('스케줄 점검 — 그룹별 확인(이상 있어도 검토 후 확인 가능)', () => {
  const src = read('pages/Schedule.jsx');

  it('그룹 시그니처는 유형+해당 예약 id 조합이다(수정되면 자동으로 새 상태로 다시 잡힘)', () => {
    expect(src).toContain('function groupSignature(group) {');
    expect(src).toMatch(/const ids = \(group\.items \|\| \[\]\)\.map\(i => i\.id\)\.sort\(\)\.join\(','\)/);
    expect(src).toMatch(/return `\$\{group\.type\}\|\$\{ids\}`/);
  });

  it('확인 버튼은 이상이 있는 그룹에도(문제없음 상태가 아니어도) 그룹별로 노출된다', () => {
    expect(src).toContain('onClick={() => confirmGroup(g)}');
    // 예전처럼 "문제없음일 때만" 보이는 게 아니라, 그룹 목록 자체가 groups.length===0이 아닐 때 항상 렌더된다.
    expect(src).not.toContain('onClick={confirmNoIssue}');
  });

  it('이미 확인된 그룹은 버튼 대신 "확인됨" 표시로 바뀐다', () => {
    expect(src).toContain('✓ 확인됨');
  });

  it('배지(점검 버튼)는 미확인 그룹만 반영한다 — 확인된 그룹은 배지에서 빠진다', () => {
    expect(src).toContain('const unconfirmedGroups = duplicateGroups.filter(g => !confirmedGroupSigs[groupSignature(g)]);');
    expect(src).toContain('const auditSummary = summarizeDuplicates(unconfirmedGroups);');
  });

  it('모달에는 확인된 그룹도 계속 보인다(숨기지 않고 다만 배지에서만 제외 — 데이터 정직성)', () => {
    // 모달의 목록 렌더는 groups(원본 전체)를 그대로 순회하고, unconfirmedGroups가 아니다.
    const modalIdx = src.indexOf('function ScheduleAuditModal');
    const modalSrc = src.slice(modalIdx);
    expect(modalSrc).toContain('[...groups].sort((a, b) => {');
  });

  it('점검 모달에 user가 전달되어 확인자 이름을 기록할 수 있다', () => {
    const callIdx = src.indexOf('<ScheduleAuditModal');
    const call = src.slice(callIdx, callIdx + 200);
    expect(call).toMatch(/user=\{user\}/);
  });
});

describe('groupSignature 로직 재현 — 실제 동작 검증', () => {
  function groupSignature(group) {
    const ids = (group.items || []).map((i) => i.id).sort().join(',');
    return `${group.type}|${ids}`;
  }

  it('같은 예약 id 조합은 항상 같은 시그니처를 낸다(순서 무관)', () => {
    const g1 = { type: 'same_lot', items: [{ id: 'b' }, { id: 'a' }] };
    const g2 = { type: 'same_lot', items: [{ id: 'a' }, { id: 'b' }] };
    expect(groupSignature(g1)).toBe(groupSignature(g2));
  });

  it('예약 하나가 삭제되어 구성이 바뀌면 시그니처가 달라진다(확인 기록이 자동으로 무효화됨)', () => {
    const before = groupSignature({ type: 'same_lot', items: [{ id: 'a' }, { id: 'b' }] });
    const after = groupSignature({ type: 'same_lot', items: [{ id: 'a' }] });
    expect(before).not.toBe(after);
  });

  it('확인된 시그니처 집합으로 필터링하면 해당 그룹만 미확인 목록에서 빠진다', () => {
    const groups = [
      { type: 'same_lot', items: [{ id: '1' }, { id: '2' }] },
      { type: 'same_slot', items: [{ id: '3' }, { id: '4' }] },
    ];
    const confirmed = { [groupSignature(groups[0])]: { at: Date.now() } };
    const unconfirmed = groups.filter((g) => !confirmed[groupSignature(g)]);
    expect(unconfirmed).toHaveLength(1);
    expect(unconfirmed[0].type).toBe('same_slot');
  });
});
