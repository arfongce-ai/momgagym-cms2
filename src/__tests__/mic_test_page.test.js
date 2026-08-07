// /mic-test 독립 진단 페이지가 인증 없이 접근 가능하게 배선됐는지 확인.
// 다른 voice 관련 테스트와 마찬가지로 정적 소스 패턴을 따른다(momi_voice.test.js 참고).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

describe('App.jsx — /mic-test 라우트', () => {
  const src = readSrc('src', 'App.jsx');

  it('MicTest를 불러온다', () => {
    expect(src).toContain("import MicTest from './pages/MicTest';");
  });

  it('/mic-test는 /login과 같은 레벨(인증 게이트 밖)에 있다', () => {
    const loginIdx = src.indexOf('<Route path="/login"');
    const micTestIdx = src.indexOf('<Route path="/mic-test"');
    const authGateIdx = src.indexOf('<Route path="/*"');
    expect(loginIdx).toBeGreaterThan(-1);
    expect(micTestIdx).toBeGreaterThan(-1);
    // /mic-test가 /login과 /* 게이트 사이, 즉 RequireAuth 바깥에 있어야 한다.
    expect(micTestIdx).toBeGreaterThan(loginIdx);
    expect(micTestIdx).toBeLessThan(authGateIdx);
  });
});

describe('MicTest.jsx — 독립성 확인', () => {
  const src = readSrc('src', 'pages', 'MicTest.jsx');

  it('AuthContext·demoData 등 앱 상태에 의존하지 않는다', () => {
    expect(src).not.toContain('useAuth');
    expect(src).not.toContain('demoData');
    expect(src).not.toContain('momiService');
  });

  it('SpeechRecognition의 주요 생명주기 이벤트를 전부 화면에 로그로 남긴다', () => {
    for (const handler of [
      'onstart',
      'onaudiostart',
      'onspeechstart',
      'onspeechend',
      'onaudioend',
      'onresult',
      'onerror',
      'onend',
    ]) {
      expect(src).toContain(`recognition.${handler}`);
    }
  });

  it('중간결과(interim)도 보여준다(진단 목적이라 최종결과만 보는 본 기능과 다름)', () => {
    expect(src).toContain('recognition.interimResults = true;');
  });
});
