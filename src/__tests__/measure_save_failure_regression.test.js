// src/__tests__/measure_save_failure_regression.test.js
// ════════════════════════════════════════════════════════════════════════
//  회귀 보호 대상(2026-08-19 버그 리포트 — 바벨 리프팅):
//   1) "실시간 촬영 시 전면카메라가 한번씩 켜짐"
//      → 원인: openMainCameraStream()이 카메라를 켤 때마다(측정 진입·모드
//        전환마다) facingMode:{ideal:'environment'}(소프트 제약)로 별도 probe
//        스트림을 새로 열어, 일부 기종에서 초기화 중 전면 카메라가 잠깐
//        선택됐다. exact 제약 + 세션 단위 캐시로 probe 자체를 최소화한다.
//   2) "측정 후 기록이 안 됨(결과리포트에도 없음)"
//      → 원인: persist()가 Firestore 저장(save()) 실패를 catch 하고도 그대로
//        setReport+setView('report')로 넘어가, 사용자에게는 성공한 것처럼
//        보이지만 실제로는 저장되지 않아 이력·리포트에 영원히 나타나지 않는
//        레코드가 만들어졌다. 이 패턴은 바벨 리프팅뿐 아니라 점프·보행·
//        스쿼트·한다리서기(SLST) 허브에도 동일하게 복사돼 있었다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../ai-measure/${p}`, import.meta.url), 'utf8');

describe('cameraSelect — 전면 카메라 순간 노출 방지', () => {
  const src = read('core/cameraSelect.js');

  it('후면 카메라 probe는 소프트(ideal)가 아니라 exact 제약을 먼저 시도한다', () => {
    expect(src).toContain("facingMode: { exact: 'environment' }");
  });

  it('probe 결과(deviceId)를 세션 단위로 캐시해 카메라를 켤 때마다 재probe하지 않는다', () => {
    expect(src).toContain('cachedBackCameraId');
    expect(src).toContain('labelsUnlocked');
    // 캐시가 있으면 probe 블록 자체를 건너뛴다.
    expect(src).toMatch(/if \(preferExactDevice && !labelsUnlocked\)/);
  });

  it('기본 제약 목록도 environment를 exact로 우선 시도한다(폴백은 유지)', () => {
    expect(src).toContain("{ facingMode: { exact: 'environment' }");
    // 하드웨어가 exact를 지원하지 않는 기기를 위한 ideal 폴백은 여전히 남아있어야 한다.
    expect(src).toContain("{ facingMode: { ideal: 'environment' }");
  });
});

describe('측정 허브 — 저장 실패 시 성공한 것처럼 report로 넘어가지 않는다', () => {
  const hubs = [
    'menus/BarbellLiftingHub.jsx',
    'menus/GaitAnalysisHub.jsx',
    'menus/SquatAnalysisHub.jsx',
    'menus/StanceAnalysisHub.jsx',
  ];

  it.each(hubs)('%s: catch(e) 안에서 setSaveState(\'error\') 뒤 즉시 return 해 report 전환을 막는다', (path) => {
    const src = read(path);
    // 예전 버그 패턴: catch (e) { setSaveState('error'); } 한 줄짜리 —
    // 에러 여부와 무관하게 바로 아래 setReport/setView('report')로 이어졌다.
    expect(src).not.toMatch(/catch \(e\) \{ setSaveState\('error'\); \}/);
    // 새 패턴: catch 블록이 setSaveState('error') 다음 return으로 끝난다.
    const catchMatch = src.match(/catch \(e\) \{[\s\S]{0,400}?\}/);
    expect(catchMatch).toBeTruthy();
    expect(catchMatch[0]).toContain("setSaveState('error')");
    expect(catchMatch[0]).toMatch(/return;?\s*\}$/);
  });

  it('JumpAnalysisHub.jsx: persist()의 catch는 null을 반환해 실패를 호출부에 알린다', () => {
    const src = read('menus/JumpAnalysisHub.jsx');
    expect(src).not.toMatch(/catch \(e\) \{ setSaveState\('error'\); \}/);
    const catchMatch = src.match(/catch \(e\) \{[\s\S]{0,400}?\}/);
    expect(catchMatch).toBeTruthy();
    expect(catchMatch[0]).toContain("setSaveState('error')");
    expect(catchMatch[0]).toMatch(/return null;?\s*\}$/);
  });

  it('JumpAnalysisHub.jsx: confirmRecord는 persist 성공(truthy 반환) 시에만 report로 전환한다', () => {
    const src = read('menus/JumpAnalysisHub.jsx');
    expect(src).toMatch(/const saved = await persist\(withNote, record\);[\s\S]{0,300}if \(saved\) setView\('report'\);/);
  });

  it('JumpAnalysisHub.jsx: finishTrials는 persist 실패 시 trials를 비우거나 report로 넘어가지 않는다', () => {
    const src = read('menus/JumpAnalysisHub.jsx');
    expect(src).toMatch(/const saved = await persist\(combined, \{\}\);[\s\S]{0,80}if \(!saved\) return;/);
  });
});
