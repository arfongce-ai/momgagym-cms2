// kiosk_mismatch_silent.test.js
// ════════════════════════════════════════════════════════════════════════
//  "키오스크 모드에서 '모미야'를 부르기 전에도 계속 소리에 반응합니다"
//  문의에 대한 회귀 테스트.
//
//  실제로 명령이 웨이크워드 없이 실행되고 있던 건 아니었다 — useMomiVoice.js의
//  requireWakeWord 기본값은 true이고, KioskVoiceCommand.jsx는 그 기본값을
//  그대로 쓴다(파라미터로 덮어쓰지 않음). 원인은 handleMismatch(웨이크워드가
//  안 잡힌 모든 발화, 즉 주변의 일반 대화)가 화면 우상단에 "[진단] 들림: ..."
//  문구를 5초씩 띄우던 것 — 상시 감지라 트레이너·회원의 잡담이 전부 여기로
//  들어와서 "계속 반응하는 것처럼" 보였고, 회원 대화 내용이 화면에 노출되는
//  부작용도 있었다. 이 문구는 2026-08-08에 "모미야가 반응 없다"는 문의를
//  원격 진단하려고 넣은 것인데, 실사용 단계에 들어오며 부작용이 더 커졌다.
//
//  수정: KioskVoiceCommand.jsx의 handleMismatch만 화면 노출을 끈다(콘솔 로그는
//  useMomiVoice.js에 이미 있어 진단 능력은 유지됨). GlobalVoiceCommand.jsx
//  (버튼을 눌러 직접 켜는 방식)는 손대지 않는다 — 그쪽은 사용자 본인이 지금
//  막 말한 내용을 확인하는 자연스러운 피드백이라 문맥이 다르다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');
const kioskSrc = read('src', 'components', 'common', 'KioskVoiceCommand.jsx');
const globalSrc = read('src', 'components', 'common', 'GlobalVoiceCommand.jsx');
const voiceHookSrc = read('src', 'hooks', 'useMomiVoice.js');

function bodyOf(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  expect(s).toBeGreaterThan(-1);
  const e = src.indexOf(endMarker, s);
  return src.slice(s, e === -1 ? src.length : e);
}

describe('KioskVoiceCommand.jsx — 웨이크워드 불일치 시 화면에 아무것도 띄우지 않는다', () => {
  it('handleMismatch 본체가 setFeedback을 호출하지 않는다(화면 노출 제거)', () => {
    const body = bodyOf(kioskSrc, 'const handleMismatch = useCallback((heard) => {', '}, []);');
    expect(body).not.toContain('setFeedback');
    expect(body).not.toContain('speak(');
  });

  it('onMismatch 배선 자체는 그대로 유지한다(콜백 존재 자체는 회귀 없음)', () => {
    expect(kioskSrc).toContain('onMismatch: handleMismatch,');
  });

  it('다른 콜백(handleWakeOnly·handleCommand의 실패 진단)은 여전히 화면 표시를 쓴다(과도하게 다 지운 게 아님)', () => {
    const wakeOnlyBody = bodyOf(kioskSrc, 'const handleWakeOnly = useCallback(() => {', '}, [speak]);');
    expect(wakeOnlyBody).toContain('setFeedback(message);');
    const handleBody = bodyOf(kioskSrc, 'const handleCommand = useCallback(', 'const handleWakeOnly = useCallback(');
    expect(handleBody).toContain('setFeedback(');
  });
});

describe('[확인] 진단 능력 자체는 콘솔 로그로 유지된다(useMomiVoice.js)', () => {
  it('모든 인식 결과를 웨이크워드 일치 여부와 무관하게 console.log로 남긴다', () => {
    const body = bodyOf(voiceHookSrc, 'recognition.onresult = (event) => {', 'if (pendingReplyRef.current)');
    expect(body).toMatch(/console\.log\(['"]\[모미\] 들린 말:['"],\s*heard\)/);
  });

  it('requireWakeWord 기본값은 true다(키오스크가 별도로 넘기지 않아도 웨이크워드가 필요함)', () => {
    expect(voiceHookSrc).toMatch(/requireWakeWord\s*=\s*true/);
  });

  it('KioskVoiceCommand.jsx는 useMomiVoice에 requireWakeWord를 넘기지 않는다(기본값 true 그대로 사용)', () => {
    const idx = kioskSrc.indexOf('useMomiVoice({');
    const body = kioskSrc.slice(idx, kioskSrc.indexOf('});', idx));
    expect(body).not.toContain('requireWakeWord');
  });
});

describe('[회귀 없음] GlobalVoiceCommand.jsx(버튼식)는 그대로 화면 진단 표시를 유지한다', () => {
  it('handleMismatch가 여전히 setFeedback으로 들린 말을 화면에 보여준다', () => {
    const body = bodyOf(globalSrc, 'const handleMismatch = useCallback((heard) => {', '}, []);');
    expect(body).toContain('setFeedback(`[진단] 들림: ${shown}`)');
  });
});
