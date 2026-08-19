// src/__tests__/measure_sensitivity_and_ui_regression.test.js
// ════════════════════════════════════════════════════════════════════════
//  회귀 보호 대상(2026-08-19 오후 — 1RM 스쿼트·벤치프레스 후속 신고):
//   1) "1RM 측정 시 momi(마이크) 버튼이 kg 버튼을 가려 무게 증가가 어려움"
//      → 원인: GlobalVoiceCommand.jsx/KioskVoiceCommand.jsx가 카메라 스테이지
//        활성 중 opacity만 낮췄고, pointer(클릭/탭) 이벤트는 여전히 이 버튼이
//        가로채 뒤에 있는 무게 다이얼 +/+5 버튼이 눌리지 않았다. 카메라
//        스테이지 활성 중 pointerEvents:'none'을 추가해 탭이 아래 컨트롤로
//        통과하도록 한다.
//   2) "벤치프레스 측정 시 너무 민감하게 반응"
//      → 원인: OneRMEstimate.jsx(1RM)와 VbtMeasure.jsx(VBT) 둘 다
//        handleResult()에서 프레이밍 판정(assessFraming) 결과를 UI 배지
//        표시에만 쓰고, 실제 렙 판정용 좌표 축적(accRef.current.push /
//        fusedRef.current.push)은 게이팅하지 않았다 — 세트가 끝나고 사람이
//        프레임을 완전히 벗어나도(전신 미검출) 손목 위치 변화가 그대로
//        "가짜 렙"으로 잡혔다. fr.fullBody(머리+발목이 화면 안에 보임)가
//        아니면 축적을 건너뛰도록 한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('음성 명령 버튼 — 카메라 스테이지 활성 중 클릭이 아래 컨트롤로 통과한다', () => {
  const files = [
    'components/common/GlobalVoiceCommand.jsx',
    'components/common/KioskVoiceCommand.jsx',
  ];

  it.each(files)('%s: cameraActive일 때 pointerEvents를 none으로 끈다', (path) => {
    const src = read(path);
    expect(src).toMatch(/pointerEvents:\s*cameraActive\s*\?\s*'none'\s*:\s*'auto'/);
  });

  it.each(files)('%s: !supported 분기와 정상 렌더 분기 둘 다에 pointerEvents 게이팅이 있다', (path) => {
    const src = read(path);
    const matches = src.match(/pointerEvents:\s*cameraActive\s*\?\s*'none'\s*:\s*'auto'/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe('1RM/VBT 렙 카운트 — 전신이 화면에 없으면 좌표를 축적하지 않는다', () => {
  it('OneRMEstimate.jsx: fr.fullBody가 아니면 accRef.push 이전에 return 한다', () => {
    const src = read('ai-measure/menus/OneRMEstimate.jsx');
    expect(src).toMatch(/if \(!fr\.fullBody\) return;[\s\S]{0,120}accRef\.current\.push/);
  });

  it('VbtMeasure.jsx: fr.fullBody가 아니면 fusedRef.push를 건너뛰고 lost로 집계한다', () => {
    const src = read('ai-measure/menus/VbtMeasure.jsx');
    expect(src).toMatch(/if \(!bar \|\| !fr\.fullBody\) \{[\s\S]{0,200}frameStatsRef\.current\.lost \+= 1;[\s\S]{0,80}return;\s*\}/);
    // fullBody 게이트를 통과한 프레임만 fusedRef에 쌓인다(위 게이트 블록 다음).
    expect(src).toMatch(/if \(!bar \|\| !fr\.fullBody\) \{[\s\S]*?\n\s*\}\n\n\s*if \(recordingRef\.current\) \{\s*\n\s*fusedRef\.current\.push/);
  });

  it('두 파일 모두 handleResult 안에서 assessFraming(fr) 계산 이후에 게이팅한다(순서 보장)', () => {
    const onerm = read('ai-measure/menus/OneRMEstimate.jsx');
    const vbt = read('ai-measure/menus/VbtMeasure.jsx');
    const framinBeforeGateOnerm = onerm.indexOf('const fr = assessFraming') < onerm.indexOf('if (!fr.fullBody) return;');
    const framinBeforeGateVbt = vbt.indexOf('const fr = assessFraming') < vbt.indexOf('if (!bar || !fr.fullBody)');
    expect(framinBeforeGateOnerm).toBe(true);
    expect(framinBeforeGateVbt).toBe(true);
  });
});
