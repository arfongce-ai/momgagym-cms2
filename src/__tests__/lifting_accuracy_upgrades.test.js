import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { plateCmPerRatio, PLATE_CALIBRATION_TAGS, PLATE_CALIBRATION_DIAMETER_CM } from '../ai-measure/core/plates.js';
import { romToCmScaled, trimPathToRange } from '../ai-measure/core/barbell.js';
import { predictNextPos } from '../ai-measure/core/endcapTracker.js';
import { median, detectMeasurementOutlier } from '../ai-measure/core/lifting.js';

// ── 개선 1: 원판 지름 기준 스케일 보정 ──
describe('plateCmPerRatio — 원판 지름(45cm) 기준 cm 스케일', () => {
  it('세로 지름 비율로부터 cm/비율 스케일을 구한다', () => {
    // 원판이 화면 세로의 10%를 차지했다면: 45cm / 0.1 = 450cm/비율(1.0)
    expect(plateCmPerRatio(0.1)).toBeCloseTo(450, 5);
  });

  it('지름 정보가 없으면 null(정직성 — 추측하지 않음)', () => {
    expect(plateCmPerRatio(null)).toBeNull();
    expect(plateCmPerRatio(0)).toBeNull();
  });

  it('대형 범퍼 플레이트(10/15/20/25kg)만 보정 기준 태그로 인정', () => {
    expect(PLATE_CALIBRATION_TAGS.has('red')).toBe(true);   // 25kg
    expect(PLATE_CALIBRATION_TAGS.has('blue')).toBe(true);  // 20kg
    expect(PLATE_CALIBRATION_TAGS.has('yellow')).toBe(true);// 15kg
    expect(PLATE_CALIBRATION_TAGS.has('green')).toBe(true); // 10kg
    // 5kg/2.5kg/1.25kg 는 브랜드마다 지름이 달라 제외
    expect(PLATE_CALIBRATION_TAGS.has('white')).toBe(false);
    expect(PLATE_CALIBRATION_TAGS.has('chrome')).toBe(false);
  });

  it('IWF 표준 지름 상수는 45cm(450mm)', () => {
    expect(PLATE_CALIBRATION_DIAMETER_CM).toBe(45);
  });
});

describe('romToCmScaled — 직접 스케일(cm/비율)로 변위 환산', () => {
  it('romRatio × cmPerRatio', () => {
    expect(romToCmScaled(0.2, 450)).toBe(90);
  });
  it('스케일·변위 중 하나라도 없으면 null', () => {
    expect(romToCmScaled(0, 450)).toBeNull();
    expect(romToCmScaled(0.2, null)).toBeNull();
  });
});

// ── 개선 4: 사람이 확인하는 구간 보정 ──
describe('trimPathToRange — 결과 확인 후 구간 트리밍', () => {
  const samples = [
    { x: 0.5, y: 0.9, ts: 0 },
    { x: 0.5, y: 0.7, ts: 100 },
    { x: 0.5, y: 0.3, ts: 200 },   // 여기가 진짜 최고점
    { x: 0.1, y: 0.05, ts: 300 },  // 드리프트로 튄 프레임(이상치)
    { x: 0.5, y: 0.35, ts: 400 },
  ];

  it('전체 구간이면 최저~최고 y로 romRatio 계산(이상치 포함)', () => {
    const r = trimPathToRange(samples, 0, 400);
    expect(r.romRatio).toBeCloseTo(0.85, 5); // 0.9 - 0.05(이상치 포함)
    expect(r.samples).toBe(5);
  });

  it('드리프트 구간을 잘라내면(0~200ms) 이상치가 romRatio에서 빠진다', () => {
    const full = trimPathToRange(samples, 0, 400);
    const trimmed = trimPathToRange(samples, 0, 200);
    expect(trimmed.romRatio).toBeCloseTo(0.6, 5); // 0.9-0.3
    expect(trimmed.romRatio).toBeLessThan(full.romRatio + 1e-9);
    expect(trimmed.samples).toBe(3);
    expect(trimmed.durationMs).toBe(200);
  });

  it('구간에 샘플이 2개 미만이면 null(정직성 — 억지로 계산하지 않음)', () => {
    expect(trimPathToRange(samples, 350, 360)).toBeNull();
    expect(trimPathToRange([], 0, 100)).toBeNull();
  });
});

describe('median — 공유 통계 유틸', () => {
  it('홀수 개는 가운데 값', () => { expect(median([3, 1, 2])).toBe(2); });
  it('짝수 개는 가운데 두 값의 평균', () => { expect(median([1, 2, 3, 4])).toBe(2.5); });
  it('빈 배열/전부 NaN이면 null', () => { expect(median([])).toBeNull(); expect(median([NaN])).toBeNull(); });
});

// ── 개선 6: 같은 세션 내 이상치 감지 ──
describe('detectMeasurementOutlier — 직전 측정 대비 이상치 경고', () => {
  it('직전 기록이 없으면 경고 없음', () => {
    const out = detectMeasurementOutlier({ mode: 'vbt', exerciseType: 'squat', meanVelocity: 0.8 }, null);
    expect(out.isOutlier).toBe(false);
  });

  it('모드/종목이 다르면 비교하지 않는다', () => {
    const out = detectMeasurementOutlier(
      { mode: 'vbt', exerciseType: 'squat', meanVelocity: 3.0 },
      { mode: 'vbt', exerciseType: 'bench', meanVelocity: 1.0 },
    );
    expect(out.isOutlier).toBe(false);
  });

  it('평균속도가 직전 대비 2배 이상이면 이상치로 경고(VBT/역도)', () => {
    const out = detectMeasurementOutlier(
      { mode: 'vbt', exerciseType: 'squat', meanVelocity: 2.2 },
      { mode: 'vbt', exerciseType: 'squat', meanVelocity: 1.0 },
    );
    expect(out.isOutlier).toBe(true);
    expect(out.field).toBe('meanVelocity');
    expect(out.message).toContain('평균속도');
  });

  it('추정 1RM이 직전 대비 절반 이하면 이상치로 경고(1RM 모드)', () => {
    const out = detectMeasurementOutlier(
      { mode: 'onerm', exerciseType: 'bench', oneRM: 40 },
      { mode: 'onerm', exerciseType: 'bench', oneRM: 100 },
    );
    expect(out.isOutlier).toBe(true);
    expect(out.field).toBe('oneRM');
  });

  it('정상 범위(1.3배 등) 내 변화는 경고하지 않는다', () => {
    const out = detectMeasurementOutlier(
      { mode: 'vbt', exerciseType: 'squat', meanVelocity: 1.2 },
      { mode: 'vbt', exerciseType: 'squat', meanVelocity: 1.0 },
    );
    expect(out.isOutlier).toBe(false);
  });
});

// ── 배선(개선 6) 정적 확인 ──
describe('BarbellLiftingHub/LiftingReportDashboard 배선 — 세션 이상치 경고', () => {
  const hub = readFileSync(new URL('../ai-measure/menus/BarbellLiftingHub.jsx', import.meta.url), 'utf8');
  const dash = readFileSync(new URL('../ai-measure/menus/LiftingReportDashboard.jsx', import.meta.url), 'utf8');
  it('Hub가 세션 이력을 추적하고 detectMeasurementOutlier를 호출한다', () => {
    expect(hub).toContain('sessionHistoryRef');
    expect(hub).toContain('detectMeasurementOutlier');
  });
  it('리포트가 outlierWarning을 표시한다', () => {
    expect(dash).toContain('report.outlierWarning');
  });
});

// ── 개선 5: 등속 → 등가속도 예측 ──
describe('predictNextPos — 등가속도(2차) 외삽 예측', () => {
  it('직전 점이 없으면(궤적 시작) 현재 위치를 그대로 반환', () => {
    const pos = { x: 0.5, y: 0.5 };
    expect(predictNextPos(pos, null, null)).toEqual(pos);
  });

  it('prev2가 없으면 등속(1차)만 반영', () => {
    const pos = { x: 0.5, y: 0.5 }, prev = { x: 0.48, y: 0.52 };
    const pred = predictNextPos(pos, prev, null);
    expect(pred.x).toBeCloseTo(0.52, 5); // + (0.5-0.48)
    expect(pred.y).toBeCloseTo(0.48, 5); // + (0.5-0.52)
  });

  it('가속 구간에서는 등속보다 더 앞선 지점을 예측한다(등가속도 반영)', () => {
    // v0=0.02, v1=0.04 (가속 중) → a=0.02 → pred = pos + v1 + 0.5a = pos + 0.05
    const pos = { x: 0.56, y: 0.5 }, prev = { x: 0.52, y: 0.5 }, prev2 = { x: 0.50, y: 0.5 };
    const constVelPred = pos.x + (pos.x - prev.x); // 등속이라면 0.60
    const pred = predictNextPos(pos, prev, prev2);
    expect(pred.x).toBeGreaterThan(constVelPred);
  });

  it('감속 구간에서는 등속보다 덜 나아간 지점을 예측한다', () => {
    // v0=0.06, v1=0.04 (감속 중) → a=-0.02
    const pos = { x: 0.60, y: 0.5 }, prev = { x: 0.56, y: 0.5 }, prev2 = { x: 0.50, y: 0.5 };
    const constVelPred = pos.x + (pos.x - prev.x); // 0.64
    const pred = predictNextPos(pos, prev, prev2);
    expect(pred.x).toBeLessThan(constVelPred);
  });

  it('폭주 방지 — 예측 변위가 SEARCH_RADIUS를 넘지 않게 클램프된다', () => {
    const pos = { x: 0.5, y: 0.5 }, prev = { x: 0.0, y: 0.5 }, prev2 = { x: -0.6, y: 0.5 };
    const pred = predictNextPos(pos, prev, prev2);
    const dist = Math.hypot(pred.x - pos.x, pred.y - pos.y);
    expect(dist).toBeLessThanOrEqual(0.18 * 0.85 + 1e-9);
  });
});

// ── 배선(개선 1을 세 모듈 모두에 적용했는지) 정적 확인 ──
describe('LiftingMeasure/VbtMeasure/LiftingUploadAnalysis 배선 — 원판 지름 보정', () => {
  const lifting = readFileSync(new URL('../ai-measure/menus/LiftingMeasure.jsx', import.meta.url), 'utf8');
  const vbt = readFileSync(new URL('../ai-measure/menus/VbtMeasure.jsx', import.meta.url), 'utf8');
  const upload = readFileSync(new URL('../ai-measure/menus/LiftingUploadAnalysis.jsx', import.meta.url), 'utf8');

  it('세 모듈 모두 plateCmPerRatio 기반 보정을 사용하고 calibrationSource를 결과에 남긴다', () => {
    for (const src of [lifting, vbt, upload]) {
      expect(src).toContain('plateCmPerRatio');
      expect(src).toContain('PLATE_CALIBRATION_TAGS');
      expect(src).toContain('calibrationSource');
    }
  });
});

// ── 배선(개선 3: 기록 중 노출·초점 고정) 정적 확인 ──
describe('LiftingMeasure/VbtMeasure 배선 — 노출·초점 고정', () => {
  const lifting = readFileSync(new URL('../ai-measure/menus/LiftingMeasure.jsx', import.meta.url), 'utf8');
  const vbt = readFileSync(new URL('../ai-measure/menus/VbtMeasure.jsx', import.meta.url), 'utf8');
  const camSelect = readFileSync(new URL('../ai-measure/core/cameraSelect.js', import.meta.url), 'utf8');
  const engine = readFileSync(new URL('../ai-measure/core/usePoseEngine.js', import.meta.url), 'utf8');

  it('cameraSelect가 촬영 중 manual 노출/초점/화밸 고정을 지원한다', () => {
    expect(camSelect).toContain('lockCameraCapture');
    expect(camSelect).toContain("exposureMode: 'manual'");
  });

  it('usePoseEngine이 lockCapture/unlockCapture를 노출한다', () => {
    expect(engine).toContain('lockCapture');
    expect(engine).toContain('unlockCapture');
  });

  it('역도·VBT 모두 기록 시작 시 lockCapture를, 종료 시 unlockCapture를 호출한다', () => {
    for (const src of [lifting, vbt]) {
      expect(src).toContain('lockCapture().then(setExposureLock)');
      expect(src).toContain('unlockCapture()');
    }
  });
});

