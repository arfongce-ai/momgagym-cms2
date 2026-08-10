// [음성 명령 확장 2026-08-09] Members.jsx — "모미야, OO님 세션/수납/신체정보/
// 측정이력/메모 보여줘" 같은 명령으로 도착했을 때 회원을 자동 선택하고 해당
// 탭을 여는지 확인. 이전엔 이 화면만 consumePendingVoiceTarget을 아예 호출하지
// 않아서 회원 이름을 말해도 무시됐다(AiMeasureHub.jsx/Report.jsx/Schedule.jsx는
// 이미 이 패턴을 쓰고 있었음). schedule_voice_target.test.js와 같은 정적 소스
// 패턴 테스트를 따른다(DOM 렌더링 없이 소스 문자열로 배선을 검증).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(process.cwd(), 'src/pages/Members.jsx'), 'utf8');

describe('Members.jsx — 음성으로 넘어올 때 회원을 자동 선택하고 탭을 연다(회귀 방지)', () => {
  it('consumePendingVoiceTarget을 가져와 쓴다', () => {
    expect(src).toContain("import { consumePendingVoiceTarget } from '../voice/pendingVoiceTarget';");
  });

  it('members가 로드된 뒤 pending.memberName으로 매칭해 setSelected한다', () => {
    const start = src.indexOf('const pending = consumePendingVoiceTarget();');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('}, [members]);', start);
    const body = src.slice(start, end);
    expect(body).toContain('members.find(x => x.name === pending.memberName)');
    expect(body).toContain('setSelected(m);');
  });

  it('pending.memberTab을 selectedInitialTab으로 넘긴다(기존 openMember URL 파라미터 흐름과 동일한 state 재사용)', () => {
    const start = src.indexOf('const pending = consumePendingVoiceTarget();');
    const end = src.indexOf('}, [members]);', start);
    const body = src.slice(start, end);
    expect(body).toContain('setSelectedInitialTab(pending.memberTab || null);');
  });

  it('members가 아직 비어있으면 아무것도 하지 않는다(빈 이름 매칭 오작동 방지)', () => {
    const start = src.indexOf('const pending = consumePendingVoiceTarget();');
    const before = src.slice(0, start);
    const guardIdx = before.lastIndexOf('if (!members.length) return;');
    expect(guardIdx).toBeGreaterThan(-1);
  });

  it('새 state를 따로 만들지 않고 기존 selected/selectedInitialTab을 재사용한다(회귀 방지)', () => {
    const selectedDeclCount = (src.match(/const \[selected,\s*setSelected\]\s*=\s*useState/g) || []).length;
    const tabDeclCount = (src.match(/const \[selectedInitialTab,\s*setSelectedInitialTab\]\s*=\s*useState/g) || []).length;
    expect(selectedDeclCount).toBe(1);
    expect(tabDeclCount).toBe(1);
  });
});
