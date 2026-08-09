// [버그 수정 — 음성으로 회원 스케줄 조회 2026-08-09] 실사용 확인: "누구 스케줄
// 확인해줘"라고 하면 스케줄 화면으로는 이동하는데(voiceCommandService.js가
// '스케줄' 키워드로 destination은 정확히 잡음) 그 회원으로 좁혀지지 않고
// 전체가 그대로 보였다. Report.jsx/AiMeasureHub.jsx는 이미 consumePendingVoiceTarget()
// 으로 회원을 자동 선택하는데, Schedule.jsx만 그 소비 로직이 아예 없었다.
// 이미 있는 검색창(query)에 채워 넣는 것으로 고쳤다 — 새 필터 로직을 만들지
// 않는다(기존 matchQ가 이미 회원 이름을 포함해 검색함).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(process.cwd(), 'src/pages/Schedule.jsx'), 'utf8');

describe('Schedule.jsx — 음성으로 넘어올 때 회원 이름을 검색창에 채운다(회귀 방지)', () => {
  it('consumePendingVoiceTarget을 가져와 쓴다', () => {
    expect(src).toContain("import { consumePendingVoiceTarget } from '../voice/pendingVoiceTarget';");
  });

  it('마운트 시 pending.memberName이 있으면 setQuery로 검색창을 채운다', () => {
    const start = src.indexOf('const pending = consumePendingVoiceTarget();');
    const end = src.indexOf('}, []);', start);
    const body = src.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('if (pending?.memberName) setQuery(pending.memberName);');
  });

  it('새 필터 로직을 만들지 않고 기존 검색(query/matchQ)을 그대로 재사용한다', () => {
    // query state는 이미 있던 것 — 이 훅이 새 state를 따로 만들지 않았는지 확인.
    const stateDeclCount = (src.match(/const \[query,\s*setQuery\]\s*=\s*useState/g) || []).length;
    expect(stateDeclCount).toBe(1);
  });

  it('matchQ는 회원 이름을 포함해 검색한다(query가 채워지면 실제로 필터링됨을 보장)', () => {
    const start = src.indexOf('const matchQ = s => {');
    const end = src.indexOf('};', start);
    const body = src.slice(start, end);
    expect(body).toContain('nameWithRemain(s, members)');
    expect(body).toContain('s.memberName');
  });
});
