// src/__tests__/lifting_ui_redesign.test.js
// ════════════════════════════════════════════════════════════════════════
//  바벨 리프팅 UI/UX 재설계 배선 검증(정적 와이어링 어설션 패턴).
//   ① 허브: 랜딩(view='landing')이 초기 화면 + 모드 카드/시작 버튼 존재
//   ② 측정 화면: 결과가 LiftingResultSheet 로 렌더 + 실시간 렙 스트립 존재
//   ③ 엔진 live(): repList(실시간 스트립 데이터) 제공
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BarbellAccumulator } from '../ai-measure/core/barbellBiomechanics';

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf-8');

describe('허브 — VBT/1RM 2모드(역도 제거)', () => {
  const hub = read('ai-measure/menus/BarbellLiftingHub.jsx');

  it('기본 모드는 VBT, 초기 화면은 측정', () => {
    expect(hub).toContain("useState('vbt')");
    expect(hub).toContain("useState('measure')");
  });

  it("모드 목록에 'lifting'(역도)이 없다", () => {
    expect(hub).not.toContain("['lifting'");
    expect(hub).not.toContain('MODE_META');
    expect(hub).not.toContain("if (view === 'landing')");
  });

  it('LiftingMeasure(역도 실시간 추적)를 렌더하지 않는다', () => {
    expect(hub).not.toContain('<LiftingMeasure');
  });
});

describe('측정 화면 — 결과 시트/렙 스트립 배선', () => {
  for (const file of ['ai-measure/menus/VbtMeasure.jsx', 'ai-measure/menus/LiftingMeasure.jsx']) {
    const src = read(file);
    it(`${file} → LiftingResultSheet 사용`, () => {
      expect(src).toContain('<LiftingResultSheet');
    });
    it(`${file} → 실시간 렙 스트립(liveHud.repList) 렌더`, () => {
      expect(src).toContain('liveHud?.repList?.length');
    });
    it(`${file} → 게이지 HUD 유지`, () => {
      expect(src).toContain('<VelocityGaugeHud');
    });
  }
  it('1RM 화면도 렙 스트립을 렌더한다', () => {
    expect(read('ai-measure/menus/OneRMEstimate.jsx')).toContain('liveHud?.repList?.length');
  });
});

describe('엔진 live() — 실시간 렙 스트립 데이터', () => {
  it('확정 렙마다 repList 에 번호·속도가 쌓인다', () => {
    const acc = new BarbellAccumulator();
    let t = 0; const dt = 1000 / 30;
    const push = (y) => { acc.push({ x: 0.5, y }, t); t += dt; };
    for (let i = 0; i < 9; i++) push(0.4);
    for (let r = 0; r < 2; r++) {
      for (let i = 1; i <= 30; i++) push(0.4 + 0.25 * (i / 30));
      for (let i = 1; i <= 24; i++) push(0.65 - 0.25 * (i / 24));
      for (let i = 0; i < 6; i++) push(0.4);
    }
    const lv = acc.live(170);
    // 마지막 렙은 되돌림(retrace) 확인 전 — 카운트에는 +1(pending), 스트립엔 확정분만.
    expect(lv.reps).toBe(2);
    expect(lv.repList.length).toBe(1);
    expect(lv.repList[0].repNo).toBe(1);
    expect(lv.repList[0].meanVelocity).toBeGreaterThan(0);
    // 측정 종료 시 진행 중이던 렙이 확정된다.
    const s = acc.summary({ cmPerRatio: 170 });
    expect(s.repCount).toBe(2);
  });
});

describe('VBT/1RM — 진입 시 카메라 즉시 오픈(준비 화면 스킵)', () => {
  const read2 = (p) => require('node:fs').readFileSync(require('node:path').resolve(__dirname, '..', p), 'utf-8');
  const hub = read2('ai-measure/menus/BarbellLiftingHub.jsx');
  const vbt = read2('ai-measure/menus/VbtMeasure.jsx');
  const onerm = read2('ai-measure/menus/OneRMEstimate.jsx');

  it('허브는 마운트 즉시 VBT 카메라 시작 신호를 발화(초기값 1)', () => {
    expect(hub).toContain('setVbtCameraStartSignal] = useState(1)');
  });

  it('embedded 최초 진입 시 준비 화면 대신 카메라 로더를 렌더', () => {
    expect(vbt).toContain('embedded && !camOpenedOnceRef.current');
    expect(vbt).toContain('카메라를 켜는 중');
    expect(onerm).toContain('embedded && !camOpenedOnceRef.current');
    expect(onerm).toContain('카메라를 켜는 중');
  });

  it('첫 카메라 오픈 시 camOpenedOnceRef 를 세워 로더 트랩을 방지', () => {
    expect(vbt).toContain('camOpenedOnceRef.current = true');
    expect(onerm).toContain('camOpenedOnceRef.current = true');
  });

  it('VBT는 embedded에서 카메라를 닫으면 상위 메뉴로 복귀', () => {
    expect(vbt).toContain('if (embedded) onBack?.()');
  });
});
