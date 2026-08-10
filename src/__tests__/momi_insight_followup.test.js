// MomiInsightPanel.jsx — [Axis4 시작 2026-08-08] 트레이너-모미 양방향 소통 첫 실물.
// 다른 momi_*.test.js와 동일하게 정적 소스 패턴 테스트를 따른다(vitest 'node' 환경).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

describe('MomiInsightPanel.jsx — 후속 질문(양방향 소통) 배선', () => {
  const src = readSrc('src', 'components', 'report', 'MomiInsightPanel.jsx');

  it('history state를 들고 있다가 askMomi 호출 때 넘긴다', () => {
    expect(src).toContain('const [history, setHistory] = useState([]);');
    expect(src).toContain('askMomi({ kind, report, member, question: q, history });');
  });

  it('최초 질문 성공 시 history를 [INITIAL_USER_TURN, assistant답변]으로 초기화한다', () => {
    const handleAskStart = src.indexOf('const handleAsk = async () => {');
    const handleAskEnd = src.indexOf('};', handleAskStart);
    const body = src.slice(handleAskStart, handleAskEnd);
    expect(body).toContain('setHistory([INITIAL_USER_TURN, { role: \'assistant\', content: text }]);');
  });

  it('후속 질문 성공 시 history에 user+assistant 턴을 이어붙인다(기존 내용 유지)', () => {
    const handleFollowUpStart = src.indexOf('const handleFollowUp = async () => {');
    const handleFollowUpEnd = src.indexOf('};', handleFollowUpStart);
    const body = src.slice(handleFollowUpStart, handleFollowUpEnd);
    expect(body).toContain("setHistory((h) => [...h, { role: 'user', content: q }, { role: 'assistant', content: text }]);");
  });

  it('빈 입력이거나 로딩 중이면 후속 질문을 보내지 않는다', () => {
    const handleFollowUpStart = src.indexOf('const handleFollowUp = async () => {');
    const guardEnd = src.indexOf('\n', handleFollowUpStart + 200);
    const body = src.slice(handleFollowUpStart, guardEnd);
    expect(body).toContain('if (!q || loading) return;');
  });

  it('askMomi의 기존 반환 타입(string)을 바꾸지 않는다(다른 호출부 안 깨짐)', () => {
    // await askMomi(...) 결과를 바로 text로 쓰고 있어야 한다(구조분해 없이) —
    // { text, ... } 같은 객체로 바뀌었다면 이 패턴이 깨진다.
    expect(src).toContain('const text = await askMomi({ kind, report, member });');
    expect(src).toContain('const text = await askMomi({ kind, report, member, question: q, history });');
  });

  it('후속 질문 입력창은 최초 답변(answer)이 있어야만 나타난다(빈 상태에서 안 보임)', () => {
    const inputSectionStart = src.lastIndexOf('{answer && (');
    expect(inputSectionStart).toBeGreaterThan(-1);
    const inputSectionBody = src.slice(inputSectionStart);
    expect(inputSectionBody).toContain('이어서 물어보기');
  });
});

describe('momiService.js — askMomi는 기존과 동일하게 string을 반환한다(회귀 방지)', () => {
  const src = readSrc('src', 'services', 'momiService.js');

  it('반환값은 여전히 data.text 하나뿐이다(객체로 안 바뀜)', () => {
    const returnLine = src.match(/return data\.text;/);
    expect(returnLine).not.toBeNull();
  });

  it('MomiAutoNote.jsx 등 기존 호출부가 기대하는 시그니처(kind,report,member)는 그대로 지원한다', () => {
    expect(src).toContain('export async function askMomi({ kind, report, member, question, history } = {}) {');
  });
});
