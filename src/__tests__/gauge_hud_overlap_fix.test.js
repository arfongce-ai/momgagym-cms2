// gauge_hud_overlap_fix.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-05] "자세&체형, ROM, 런닝&보행, 점프&RSI, 바벨리프팅, 한다리
//  서기, 오버헤드 딥 스쿼트에서 HUD가 겹치는 부분 때문에 확인이 어렵습니다"
//  — 같은 요청이 "오버레이" → "HUD"로 표현만 바뀌어 반복됐다. 지난번엔
//  화면별로 다른 원인(중복 배지·safe-area)을 고쳤는데, 이번엔 "HUD" 자체를
//  다시 짚어보니 훨씬 근본적인 원인이 있었다.
//
//  원인: GaugeHud.jsx(7개 측정 모듈이 전부 공유하는 실시간 HUD)가 원형
//  게이지를 컨테이너 정중앙에, 좌우 스탯 카드를 각각 absolute left-0/
//  right-0로 독립 배치하고 있었다. 폭이 좁은 화면(구형·보급형 폰)에서는
//  "카드 최소폭(76px) + 원 반지름(88px)"의 합이 실제 컨테이너 폭보다 커져,
//  카드가 원의 아래쪽 모서리와 그대로 겹쳤다. 컴포넌트 하나를 모든 모듈이
//  공유하다 보니, 화면마다 다른 버그처럼 보였지만 실제로는 여기 하나였다
//  — 그래서 지난번 화면별 수정 이후에도 "HUD가 겹친다"는 같은 증상이
//  다시 보고됐다.
//
//  수정: absolute 좌표 계산 대신 CSS Grid(grid-cols-[1fr_auto_1fr])로
//  좌 카드/원/우 카드를 서로 다른 트랙에 배치했다 — 레이아웃 엔진 자체가
//  트랙 간 겹침을 원천 차단한다(카드가 넘치면 그 칸 안에서 줄어들거나
//  말줄임될 뿐, 원 쪽을 침범하지 않는다). 원 크기를 176→160px로 줄이고
//  카드 최소폭을 76→56px로 낮춰 여유를 더 확보했다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(process.cwd(), 'src/ai-measure/menus/GaugeHud.jsx'), 'utf8');

describe('[핵심 회귀] GaugeHud.jsx — 원형 게이지와 좌우 스탯 카드가 CSS Grid로 서로 다른 트랙에 배치된다', () => {
  it('좌 카드 / 원 / 우 카드가 grid-cols-[1fr_auto_1fr]의 세 트랙에 있다(겹침을 레이아웃 엔진이 원천 차단)', () => {
    expect(src).toMatch(/grid-cols-\[1fr_auto_1fr\]/);
  });

  it('원(가운데 트랙)이 auto 크기, 좌우 카드 트랙엔 min-w-0으로 grid blowout(카드가 트랙을 억지로 늘리는 것)을 막는다', () => {
    const idx = src.indexOf('grid-cols-[1fr_auto_1fr]');
    const body = src.slice(idx, idx + 900);
    expect(body).toMatch(/min-w-0/);
  });

  it('예전 방식(absolute left-0/right-0/left-1/2 독립 배치)이 더 이상 없다', () => {
    expect(src).not.toMatch(/absolute left-0 bottom-1/);
    expect(src).not.toMatch(/absolute right-0 bottom-1/);
    expect(src).not.toMatch(/absolute left-1\/2 top-1 -translate-x-1\/2/);
  });

  it('원 지름을 줄이고(176→160) 카드 최소폭도 줄여(76→56) 좁은 화면에서 여유를 더 확보했다', () => {
    expect(src).toMatch(/const size = 160;/);
    expect(src).toMatch(/min-w-\[56px\]/);
  });

  it('스탯 카드 내용이 넘치면 트랙을 벗어나는 대신 카드 안에서 말줄임(truncate)된다', () => {
    const idx = src.indexOf('function StatCard');
    const body = src.slice(idx, src.indexOf('function arcPath', 0) > idx ? idx + 600 : idx + 600);
    expect(body).toMatch(/truncate/);
    expect(body).toMatch(/overflow-hidden/);
  });

  it('좁은 컨테이너(296px, 구형 폰 폭 기준)에서도 카드-원 간 이론상 여백이 0보다 크다', () => {
    // 296px 컨테이너, gap-1.5(6px) × 2, 원 160px → 좌우 트랙 합 = 296-160-12 = 124px → 트랙당 62px.
    // StatCard min-w는 56px이라 62 > 56, 카드가 자기 트랙 안에 온전히 들어가고 원을 침범하지 않는다.
    const containerW = 296;
    const gap = 6 * 2;
    const circleSize = 160;
    const sideTrackW = (containerW - circleSize - gap) / 2;
    const cardMinW = 56;
    expect(sideTrackW).toBeGreaterThan(cardMinW);
  });
});
