// gauge_center_overlap_fix.test.js
// ════════════════════════════════════════════════════════════════════════
//  "RSI가 이상하게 뜬다"는 리포트를 조사하며 확인한 별개의 문제: 사용자가
//  보낸 영상은 실시간 화면이 아니라 "🎥 동영상 저장"으로 만들어지는 실제
//  mp4/webm 파일이었고, 그 파일에 번인되는 원형 게이지(drawGaugeHud의
//  gauge)가 화면 정중앙(cy=height*0.5)에 반경 min(w,h)*0.20 크기로 그려져
//  촬영 대상(사람)과 그대로 겹쳐 있었다.
//
//  drawGaugeHud는 recordingOverlay.js의 공용 함수로, 점프/RSI뿐 아니라
//  보행·스쿼트·SLST·1RM·ROM·바벨(VBT, drawLiftingDataHud 경유)까지 최소
//  7개 측정 화면의 "저장/공유되는" 녹화 영상이 전부 공유한다 — 즉 이 함수
//  하나의 수정이 모든 측정 종류에 일괄 적용된다.
//
//  실시간 화면(GaugeHud.jsx, React)은 이미 [2026-08-05]에 "상단에 좌카드-
//  게이지-우카드"로 배치해 이 문제가 없었다(overlay_overlap_fix.test.js
//  참고). 이번 수정은 녹화 번인(drawGaugeHud)도 같은 배치로 통일해,
//  화면 중앙을 완전히 비우고 피사체를 가리지 않게 한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { drawGaugeHud } from '../ai-measure/core/recordingOverlay.js';

// 실제 좌표를 기록하는 mock 2D context(overlay.test.js의 mockCtx를 좌표 캡처용으로 확장).
function recordingCtx() {
  const arcs = [];
  const texts = [];
  const rectStarts = []; // roundRectPath의 첫 moveTo(x,y) — 카드/칩의 좌상단 근사치
  let font = '';
  return {
    save: vi.fn(), restore: vi.fn(),
    beginPath: vi.fn(), closePath: vi.fn(),
    moveTo: vi.fn((x, y) => { rectStarts.push({ x, y }); }),
    lineTo: vi.fn(), arcTo: vi.fn(),
    arc: vi.fn((cx, cy, r, s, e) => { arcs.push({ cx, cy, r, s, e }); }),
    fill: vi.fn(), stroke: vi.fn(),
    fillRect: vi.fn(), strokeRect: vi.fn(), clearRect: vi.fn(),
    measureText: vi.fn((t) => ({ width: String(t).length * 8 })),
    fillText: vi.fn((t, x, y) => { texts.push({ t: String(t), x, y, font }); }),
    set fillStyle(v) {}, get fillStyle() { return ''; },
    set strokeStyle(v) {}, get strokeStyle() { return ''; },
    set font(v) { font = v; }, get font() { return font; },
    set lineWidth(v) {}, set textBaseline(v) {}, set textAlign(v) {},
    _arcs: arcs, _texts: texts, _rectStarts: rectStarts,
  };
}

// 게이지 아크(REC 점보다 반경이 훨씬 큰 원)를 찾는다 — REC 점은 반경 4~8px 정도.
function findGaugeArc(arcs) {
  return arcs.filter((a) => a.r > 15).sort((a, b) => b.r - a.r)[0] || null;
}

describe('drawGaugeHud — 게이지가 화면 정중앙이 아니라 상단에 그려진다(피사체 미가림)', () => {
  it('RSI 게이지(720x960 캔버스)의 중심이 화면 세로 중앙이 아니라 상단 1/3 안쪽에 있다', () => {
    const ctx = recordingCtx();
    const W = 720, H = 960;
    drawGaugeHud(ctx, W, H, {
      title: 'RSI · SIDE', status: 'READY', recording: true, accent: '#22d3ee',
      gauge: { label: 'RSI', value: 16.7, unit: '', arc: true, min: 0, max: 3 },
      stats: [{ label: '접지시간', value: 369, unit: 'ms' }, { label: '진행', value: '1/2' }],
    });
    const gaugeArc = findGaugeArc(ctx._arcs);
    expect(gaugeArc).not.toBeNull();
    // 예전 버그: cy === height*0.5(정중앙, 480). 지금은 화면 상단 쪽에 있어야 한다.
    expect(gaugeArc.cy).toBeLessThan(H * 0.35);
    expect(gaugeArc.cy).not.toBeCloseTo(H * 0.5, 0);
  });

  it('게이지 반경이 예전(min(w,h)*0.20)보다 작다 — 상단 한 줄에 코너 카드와 나란히 들어가야 하므로', () => {
    const ctx = recordingCtx();
    const W = 720, H = 960;
    drawGaugeHud(ctx, W, H, {
      title: 'SQUAT', recording: true, accent: '#f59e0b',
      gauge: { label: '패러렐까지', value: 62, unit: '%', arc: true, min: 0, max: 100 },
      stats: [{ label: '측면', value: '2/2' }],
    });
    const gaugeArc = findGaugeArc(ctx._arcs);
    const oldRadius = Math.round(Math.min(W, H) * 0.20); // 144
    expect(gaugeArc.r).toBeLessThan(oldRadius);
  });

  it('게이지와 좌/우 코너 스탯 카드가 겹치지 않는다(카드 우측 끝 < 게이지 좌측 끝, 카드 좌측 끝 > 게이지 우측 끝)', () => {
    const ctx = recordingCtx();
    const W = 720, H = 960;
    drawGaugeHud(ctx, W, H, {
      title: 'RSI · SIDE', status: 'READY', recording: true, accent: '#22d3ee',
      gauge: { label: 'RSI', value: 1.8, unit: '', arc: true, min: 0, max: 3 },
      stats: [{ label: '접지시간', value: 210, unit: 'ms' }, { label: '진행', value: '2/3' }],
    });
    const gaugeArc = findGaugeArc(ctx._arcs);
    const gaugeLeft = gaugeArc.cx - gaugeArc.r;
    const gaugeRight = gaugeArc.cx + gaugeArc.r;
    // 좌측 스탯 라벨("접지시간")과 우측 스탯 라벨("진행")의 x좌표로 카드 위치 근사.
    const leftLabel = ctx._texts.find((t) => t.t === '접지시간');
    const rightLabel = ctx._texts.find((t) => t.t === '진행');
    expect(leftLabel).toBeTruthy();
    expect(rightLabel).toBeTruthy();
    expect(leftLabel.x).toBeLessThan(gaugeLeft);
    expect(rightLabel.x).toBeGreaterThan(gaugeRight);
  });

  it('게이지가 없어도(파워 점프 등) 코너 스탯은 정상적으로 그려진다(회귀 없음)', () => {
    const ctx = recordingCtx();
    drawGaugeHud(ctx, 720, 960, {
      title: 'JUMP · FRONT', recording: true,
      stats: [{ label: '체공시간', value: 420, unit: 'ms' }, { label: '점프', value: '1' }],
    });
    const txt = ctx._texts.map((t) => t.t).join('|');
    expect(txt).toContain('체공시간');
    expect(txt).toContain('420');
  });

  it('스탯이 3개 이상이어도(1RM: LOAD/REPS/V) 좌우로 나뉘어 상단에 쌓이고 크래시하지 않는다', () => {
    const ctx = recordingCtx();
    expect(() => drawGaugeHud(ctx, 720, 960, {
      title: '1RM', recording: true, accent: '#f59e0b',
      gauge: { label: '추정 1RM', value: 82, unit: 'kg' },
      stats: [
        { label: 'LOAD', value: 60, unit: 'kg' },
        { label: 'REPS', value: 5, unit: '회' },
        { label: 'V', value: 0.42, unit: 'm/s' },
      ],
    })).not.toThrow();
    const txt = ctx._texts.map((t) => t.t).join('|');
    expect(txt).toContain('LOAD');
    expect(txt).toContain('REPS');
    expect(txt).toContain('V');
  });

  it('텍스트 내용(라벨·값·단위)은 레이아웃 변경과 무관하게 그대로 유지된다(overlay.test.js와 동일 계약)', () => {
    const ctx = recordingCtx();
    drawGaugeHud(ctx, 1080, 1440, {
      title: 'VBT', recording: true, elapsedSec: 4.1, accent: '#22d3ee',
      gauge: { label: '평균속도', value: 0.82, unit: 'm/s', arc: true, min: 0, max: 1.5 },
      stats: [{ label: '수직이동', value: 56, unit: 'cm' }],
    });
    const txt = ctx._texts.map((t) => t.t).join('|');
    expect(txt).toContain('VBT');
    expect(txt).toContain('평균속도');
    expect(txt).toContain('0.82');
    expect(txt).toContain('수직이동');
    expect(txt).toContain('56');
  });
});

describe('[확인] 게이지 중앙 배치 문제가 있던 7개 측정 화면 — 전부 공용 drawGaugeHud/drawLiftingDataHud를 쓴다', () => {
  // 공용 함수 하나를 고치면 아래 전부에 일괄 적용된다는 전제 자체를 고정해 둔다 —
  // 누군가 특정 화면만 자체 그리기 로직으로 바꾸면(회귀) 이 테스트가 깨진다.
  const files = [
    'JumpPrecisionAnalysis.jsx', 'GaitRunningAnalysis.jsx', 'SquatLiveAnalysis.jsx',
    'StanceLiveAnalysis.jsx', 'OneRMEstimate.jsx', 'RomMeasure.jsx',
  ];
  for (const f of files) {
    it(`${f} → drawGaugeHud(gauge 포함)로 녹화 번인을 그린다`, () => {
      const src = readFileSync(join(process.cwd(), `src/ai-measure/menus/${f}`), 'utf8');
      expect(src).toMatch(/drawGaugeHud\(/);
      // JumpPrecisionAnalysis.jsx는 `gauge, stats, cards` 변수 shorthand로 넘기고,
      // 나머지는 `gauge: { ... }` 인라인으로 넘긴다 — 두 형태 다 허용.
      expect(src).toMatch(/\bgauge\b\s*[,:]/);
    });
  }

  it('VbtMeasure.jsx / LiftingMeasure.jsx → drawLiftingDataHud(내부적으로 drawGaugeHud 사용)', () => {
    const overlaySrc = readFileSync(join(process.cwd(), 'src/ai-measure/core/recordingOverlay.js'), 'utf8');
    const idx = overlaySrc.indexOf('export function drawLiftingDataHud');
    const body = overlaySrc.slice(idx, overlaySrc.indexOf('\n}', idx));
    expect(body).toMatch(/drawGaugeHud\(/);
    expect(body).toMatch(/gauge:\s*/);
  });
});
