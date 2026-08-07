// useMomiVoice.js(귀) 수정사항 배선 확인:
//  1) iOS는 continuous:false로 두어 알려진 "세션 멈춤" 버그를 우회한다.
//  2) 인식 결과·에러가 더 이상 조용히 무시되지 않고 콘솔에 남는다(진단용).
// 다른 voice 관련 테스트와 마찬가지로 vitest 환경이 'node'라 정적 소스 패턴을 따른다
// (momi_auto_note.test.js, momi_speech.test.js 참고).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

describe('useMomiVoice.js — iOS 대응 + 진단 로그', () => {
  const src = readSrc('src', 'hooks', 'useMomiVoice.js');

  it('iPhone/iPad를 유저에이전트로 감지한다', () => {
    expect(src).toContain('/iPad|iPhone|iPod/.test(ua)');
  });

  it('iPadOS 13+(유저에이전트가 MacIntel로 나오는 경우)도 터치 포인트로 감지한다', () => {
    expect(src).toContain("navigator.platform === 'MacIntel'");
    expect(src).toContain('navigator.maxTouchPoints > 1');
  });

  it('iOS에서만 continuous를 false로 둔다(그 외 브라우저는 기존 true 유지)', () => {
    expect(src).toContain('recognition.continuous = !isIOS();');
    // 예전처럼 무조건 true로 고정하는 코드가 되살아나지 않았는지도 함께 확인.
    expect(src).not.toMatch(/recognition\.continuous = true;/);
  });

  it('인식된 텍스트를 콘솔에 남긴다(원인 진단용)', () => {
    const resultStart = src.indexOf('recognition.onresult = (event) => {');
    const resultEnd = src.indexOf('};', resultStart);
    const resultBody = src.slice(resultStart, resultEnd);
    expect(resultBody).toContain("console.log('[모미] 들린 말:', heard);");
  });

  it('인식 오류를 더 이상 무조건 무시하지 않고 원인을 콘솔에 남긴다', () => {
    const errorStart = src.indexOf('recognition.onerror = (event) => {');
    const errorEnd = src.indexOf('};', errorStart);
    const errorBody = src.slice(errorStart, errorEnd);
    expect(errorBody).toContain("console.warn('[모미] 인식 오류:', event.error);");
  });
});
