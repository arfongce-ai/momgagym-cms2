// slst_leg_switch_remount.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] "왼발 지지는 되는데 오른발 지지에서 화면이 검게 되고 녹화가
//  안 된다" 현장 버그 회귀 테스트.
//
//  원인: StanceAnalysisHub가 <StanceLiveAnalysis>를 key 없이 렌더링했다.
//  legStep이 'left'→'right'로 바뀌어도 React는 같은 컴포넌트 인스턴스를
//  재사용하므로:
//   · recordingStartedRef.current가 왼발 때 true로 남아 beginRecording()이
//     첫 줄에서 return → 오른발 구간은 아예 녹화되지 않음.
//   · 왼발 마무리(finishAndSubmit)에서 stop()으로 끈 카메라가 다시 켜지지
//     않아 <video>가 검은 화면으로 남음(스켈레톤만 보임).
//   · 결과 화면의 "측정 영상"에 왼쪽 영상만 나타남.
//
//  수정: 다리/눈 조건이 바뀌면 완전히 새 측정이므로 key로 remount 시킨다.
//  실제 카메라·MediaRecorder가 필요한 동작이라 소스 배선을 고정하는 방식으로
//  검증한다(이 저장소의 화면 테스트 관행과 동일).
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const hub = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/StanceAnalysisHub.jsx'),
  'utf8',
);
const live = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/StanceLiveAnalysis.jsx'),
  'utf8',
);

describe('StanceAnalysisHub — 다리/눈 조건이 바뀌면 측정 화면을 remount 한다', () => {
  it('StanceLiveAnalysis에 eyesState와 legStep을 모두 담은 key가 있다', () => {
    expect(hub).toMatch(/key=\{`live-\$\{eyesState\}-\$\{legStep\}`\}/);
  });

  it('StanceUploadAnalysis에도 같은 규칙의 key가 있다', () => {
    expect(hub).toMatch(/key=\{`upload-\$\{eyesState\}-\$\{legStep\}`\}/);
  });

  it('key가 legStep만이 아니라 eyesState까지 포함한다(눈뜨고→눈감고 전환도 새 측정)', () => {
    const keys = hub.match(/key=\{`(live|upload)-[^`]*`\}/g) || [];
    expect(keys.length).toBe(2);
    keys.forEach((k) => {
      expect(k).toContain('${eyesState}');
      expect(k).toContain('${legStep}');
    });
  });

  it('key 없이 렌더링되던 예전 형태가 남아있지 않다', () => {
    // key가 member 등 다른 prop보다 먼저 오는지 확인. 위에 긴 설명 주석이
    // 있어 창을 넉넉히 잡는다.
    const idx = hub.indexOf('<StanceLiveAnalysis');
    const block = hub.slice(idx, idx + 1200);
    const keyIdx = block.indexOf('key=');
    const memberIdx = block.indexOf('member=');
    expect(keyIdx).toBeGreaterThan(-1);
    expect(memberIdx).toBeGreaterThan(-1);
    expect(keyIdx).toBeLessThan(memberIdx);
  });
});

describe('StanceLiveAnalysis — remount가 필요한 이유(가드가 실제로 존재함)', () => {
  it('beginRecording은 recordingStartedRef가 true면 즉시 return 한다', () => {
    // 이 가드 자체는 한 측정 안에서 중복 녹화를 막는 올바른 코드다. 문제는
    // 인스턴스가 재사용될 때 이 ref가 초기화되지 않는다는 점이었다.
    expect(live).toMatch(/const beginRecording = \(\) => \{\s*if \(recordingStartedRef\.current\) return;/);
  });

  it('측정 완료 시 stop()으로 카메라를 끈다(그래서 재사용하면 검은 화면이 된다)', () => {
    const idx = live.indexOf('const finishAndSubmit');
    const body = live.slice(idx, idx + 800);
    expect(body).toMatch(/\bstop\(\);/);
  });

  it('stanceLeg 변경만으로 ref들을 초기화하는 별도 effect는 없다(=key remount에 의존)', () => {
    // 만약 나중에 리셋 effect를 추가한다면 이 테스트가 실패하면서
    // "이제 key 없이도 되는지" 다시 판단하게 만든다.
    expect(live).not.toMatch(/recordingStartedRef\.current = false;[\s\S]{0,200}\}, \[stanceLeg\]\)/);
  });
});
