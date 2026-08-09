// measure_reports_richness.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-05] "오버헤드 딥 스쿼트/SLST 결과리포트가 부실합니다(자세·점프·
//  러닝 등 참고하여 보완)" 요청에 대한 회귀 테스트.
//
//  이전 상태: 두 리포트 모두 종합 판정 한 줄 + 시행별 상태 단어(정상/주의/위험)
//  뿐이었다. 실측 각도·유지시간 숫자는 어디에도 안 보였고(트래커·판정 모듈은
//  이미 계산해서 갖고 있었는데도), Jump/Gait/ROM/Posture가 쓰는 공용 리포트
//  체계(UnifiedReportPrimitives·ProblemFocusPanel·ReportActions)도 안 쓰고
//  있었다.
//
//  수정: 두 파일 다 같은 공용 체계로 다시 짜고, 판정 모듈이 이미 계산해 둔
//  숫자(각도·유지시간)와 confirmedFlags/unconfirmedFlags(재현성 2단계 판정)를
//  그대로 화면에 노출하는 파생 함수들을 추가했다. 이 함수들은 evaluateSquat
//  Biomechanics()/evaluateSingleLegStanceWithEyes()가 이미 낸 결론을 다시
//  계산하지 않고 그대로 읽기만 한다 — 재현성 규칙을 화면에서 다르게 재구현하면
//  판정 모듈과 리포트가 다른 말을 하게 될 위험이 있어서다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractSquatMetrics, squatMetricStatus, computeSquatScore } from '../ai-measure/core/squatBiomechanics.js';
import { legMetrics, stanceMetricStatus, computeStanceScore } from '../ai-measure/core/singleLegStance.js';

// [리포트 통합 2026-08-09] 둘 다 결과 리포트 표시는 측정 화면(*AnalysisHub.jsx)에서
// 재사용 가능한 *ReportDashboard.jsx로 옮겨졌다 — 아래 "[배선]" describe 블록은
// 리포트 표시 자체를 검증하므로 새 위치를 읽는다.
const squatSrc = readFileSync(join(process.cwd(), 'src/ai-measure/menus/SquatReportDashboard.jsx'), 'utf8');
const stanceSrc = readFileSync(join(process.cwd(), 'src/ai-measure/menus/StanceReportDashboard.jsx'), 'utf8');

describe('extractSquatMetrics — 지표별 권위 소스에서 더 나쁜 값을 대표값으로', () => {
  const trial = (over) => ({ valid: true, status: 'normal', thighInclineDeg: 5, torsoLeanDeg: 5, kneeValgusDeg: 2, pelvicTiltDeg: 2, armDropDeg: 3, ...over });

  it('무릎외반·골반기울기는 정면(앞 절반) 시행에서만 가져온다', () => {
    const report = { trials: [trial({ kneeValgusDeg: 8 }), trial({ kneeValgusDeg: 4 }), trial({ kneeValgusDeg: 99 }), trial({ kneeValgusDeg: 99 })] };
    const m = extractSquatMetrics(report);
    expect(m.kneeValgusDeg).toBe(8); // 정면 두 시행 중 더 나쁜(큰) 값, 측면의 99는 무시
  });

  it('팔 처짐은 측면(뒤 절반) 시행에서만 가져온다', () => {
    const report = { trials: [trial({ armDropDeg: 99 }), trial({ armDropDeg: 99 }), trial({ armDropDeg: 12 }), trial({ armDropDeg: 30 })] };
    const m = extractSquatMetrics(report);
    expect(m.armDropDeg).toBe(30); // 측면 두 시행 중 더 나쁜 값
  });

  it('상체 기울기는 torsoLeanSource에 따라 정면/측면 중 선택된 쪽에서만 가져온다', () => {
    const report = { torsoLeanSource: 'side', trials: [trial({ torsoLeanDeg: 5 }), trial({ torsoLeanDeg: 5 }), trial({ torsoLeanDeg: 20 }), trial({ torsoLeanDeg: 15 })] };
    expect(extractSquatMetrics(report).torsoLeanDeg).toBe(20);
    const fallback = { torsoLeanSource: 'front_fallback', trials: report.trials };
    expect(extractSquatMetrics(fallback).torsoLeanDeg).toBe(5);
  });

  it('깊이는 4개 시행 전체에서 더 나쁜(얕은) 값을 가져온다', () => {
    const report = { trials: [trial({ thighInclineDeg: 3 }), trial({ thighInclineDeg: 25 }), trial({ thighInclineDeg: 8 }), trial({ thighInclineDeg: 6 })] };
    expect(extractSquatMetrics(report).depthDeg).toBe(25);
  });

  it('trials가 없으면 전부 null(값 없음을 있는 척하지 않음)', () => {
    const m = extractSquatMetrics({});
    expect(m.depthDeg).toBeNull();
    expect(m.armDropDeg).toBeNull();
  });
});

describe('squatMetricStatus — evaluateSquatBiomechanics의 재현성 판정을 그대로 반영', () => {
  it('confirmedFlags에 _high가 있으면 risk', () => {
    const report = { confirmedFlags: ['arm_drop_high'], unconfirmedFlags: [] };
    expect(squatMetricStatus(report, 'arm_drop_')).toBe('risk');
  });
  it('confirmedFlags에 _borderline이 있으면 caution', () => {
    const report = { confirmedFlags: ['torso_lean_borderline'], unconfirmedFlags: [] };
    expect(squatMetricStatus(report, 'torso_lean_')).toBe('caution');
  });
  it('unconfirmedFlags에만 있으면(1회만 관찰) observed — caution도 risk도 아님', () => {
    const report = { confirmedFlags: [], unconfirmedFlags: ['knee_valgus_borderline'] };
    expect(squatMetricStatus(report, 'knee_valgus_')).toBe('observed');
  });
  it('아무 플래그도 없으면 normal', () => {
    const report = { confirmedFlags: ['arm_drop_high'], unconfirmedFlags: [] };
    expect(squatMetricStatus(report, 'pelvic_tilt_')).toBe('normal');
  });
});

describe('computeSquatScore — 지표별 status를 100/65/35점으로 평균', () => {
  it('전부 정상이면 100점', () => {
    const report = { confirmedFlags: [], unconfirmedFlags: [] };
    const m = { depthDeg: 2, torsoLeanDeg: 2, kneeValgusDeg: 2, pelvicTiltDeg: 2, armDropDeg: 2 };
    expect(computeSquatScore(report, m)).toBe(100);
  });
  it('measure invalid면 0점', () => {
    expect(computeSquatScore({ valid: false }, {})).toBe(0);
  });
  it('값이 없는 지표는 평균에서 제외한다(측정 안 된 걸 정상으로 치지 않음)', () => {
    const report = { confirmedFlags: [], unconfirmedFlags: [] };
    const m = { depthDeg: 2, torsoLeanDeg: null, kneeValgusDeg: null, pelvicTiltDeg: null, armDropDeg: null };
    expect(computeSquatScore(report, m)).toBe(100); // depthDeg 하나만으로 평균
  });
  it('risk 하나 + normal 하나면 두 값의 평균(35+100)/2', () => {
    const report = { confirmedFlags: ['arm_drop_high'], unconfirmedFlags: [] };
    const m = { depthDeg: 2, torsoLeanDeg: null, kneeValgusDeg: null, pelvicTiltDeg: null, armDropDeg: 40 };
    expect(computeSquatScore(report, m)).toBe(Math.round((100 + 35) / 2));
  });
});

describe('legMetrics — 같은 다리·조건의 2회 시행 중 더 나쁜 값(유지시간=짧을수록, 각도=클수록)', () => {
  it('유지시간은 더 짧은 쪽을 대표값으로', () => {
    const leg = { trials: [{ valid: true, holdTimeMs: 28000 }, { valid: true, holdTimeMs: 15000 }] };
    expect(legMetrics(leg).holdMs).toBe(15000);
  });
  it('각도는 더 큰 쪽을 대표값으로', () => {
    const leg = { trials: [{ valid: true, pelvicTiltDeg: 3 }, { valid: true, pelvicTiltDeg: 8 }] };
    expect(legMetrics(leg).pelvicTiltDeg).toBe(8);
  });
  it('무효 시행은 제외한다', () => {
    const leg = { trials: [{ valid: false, holdTimeMs: 1000 }, { valid: true, holdTimeMs: 25000 }] };
    expect(legMetrics(leg).holdMs).toBe(25000);
  });
  it('leg가 없으면 전부 null', () => {
    const m = legMetrics(null);
    expect(m.holdMs).toBeNull();
    expect(m.pelvicTiltDeg).toBeNull();
  });
});

describe('stanceMetricStatus — 즉시확정/재현성확정 두 경로 모두 반영', () => {
  it('즉시확정(basis=immediate)이고 해당 immediateKey가 원인이면 risk', () => {
    const leg = { basis: 'immediate', immediateReasons: ['hold_time_insufficient'] };
    expect(stanceMetricStatus(leg, 'hold_time_', 'hold_time_insufficient')).toBe('risk');
  });
  it('즉시확정인데 다른 항목이 원인이면(예: 균형상실) 이 지표는 unknown(안 잰 척 안 함)', () => {
    const leg = { basis: 'immediate', immediateReasons: ['balance_loss'] };
    expect(stanceMetricStatus(leg, 'pelvic_tilt_', 'pelvic_tilt_insufficient')).toBe('unknown');
  });
  it('재현성확정 경로에서 confirmedFlags(repeatedFlags)에 있으면 caution/risk', () => {
    const leg = { basis: 'reproducibility', repeatedFlags: ['pelvic_tilt_high'], unconfirmedFlags: [] };
    expect(stanceMetricStatus(leg, 'pelvic_tilt_')).toBe('risk');
  });
  it('unconfirmedFlags에만 있으면 observed', () => {
    const leg = { basis: 'reproducibility', repeatedFlags: [], unconfirmedFlags: ['knee_valgus_borderline'] };
    expect(stanceMetricStatus(leg, 'knee_valgus_')).toBe('observed');
  });
  it('leg가 없으면 unknown', () => {
    expect(stanceMetricStatus(null, 'pelvic_tilt_')).toBe('unknown');
  });
});

describe('computeStanceScore — 눈뜨고/눈감고 × 좌/우 4개 leg.status를 평균', () => {
  it('4개 다 normal이면 100점', () => {
    const leg = { valid: true, status: 'normal' };
    const report = { eyesOpen: { valid: true, left: leg, right: leg }, eyesClosed: { valid: true, left: leg, right: leg } };
    expect(computeStanceScore(report)).toBe(100);
  });
  it('measure invalid면 0점', () => {
    expect(computeStanceScore({ valid: false })).toBe(0);
  });
  it('status가 unknown인 leg는 평균에서 제외한다', () => {
    const normal = { valid: true, status: 'normal' };
    const unknown = { valid: true, status: 'unknown' };
    const report = { eyesOpen: { valid: true, left: normal, right: unknown }, eyesClosed: { valid: false } };
    expect(computeStanceScore(report)).toBe(100); // normal 하나만 평균에 들어감
  });
  it('risk가 섞이면 점수가 내려간다', () => {
    const normal = { valid: true, status: 'normal' };
    const risk = { valid: true, status: 'risk' };
    const report = { eyesOpen: { valid: true, left: normal, right: risk }, eyesClosed: { valid: false } };
    expect(computeStanceScore(report)).toBe(Math.round((100 + 35) / 2));
  });
});

describe('[배선] SquatReportDashboard.jsx가 Jump/Gait와 같은 공용 리포트 체계를 쓴다', () => {
  it('UnifiedReportPrimitives·ProblemFocusPanel·ReportActions를 가져와 쓴다', () => {
    expect(squatSrc).toMatch(/from '\.\.\/\.\.\/components\/report\/UnifiedReportPrimitives'/);
    expect(squatSrc).toMatch(/from '\.\/ProblemFocusPanel\.jsx'/);
    expect(squatSrc).toMatch(/from '\.\.\/\.\.\/components\/report\/ReportActions'/);
    expect(squatSrc).toMatch(/<ProblemFocusPanel/);
    expect(squatSrc).toMatch(/<ReportActions/);
  });

  it('부위별 5개 지표(깊이·상체·무릎·골반·팔)를 전부 화면에 그린다', () => {
    expect(squatSrc).toMatch(/metricKey="depth"/);
    expect(squatSrc).toMatch(/metricKey="torso"/);
    expect(squatSrc).toMatch(/metricKey="knee"/);
    expect(squatSrc).toMatch(/metricKey="pelvis"/);
    expect(squatSrc).toMatch(/metricKey="arm"/);
  });

  it('FMS 감점 사유(fmsReasons)를 한글로 설명하는 섹션이 있다', () => {
    expect(squatSrc).toMatch(/FMS_REASON_KO/);
    expect(squatSrc).toMatch(/report\.fmsReasons\.map/);
  });

  it('종합 점수(0~100)를 계산해 헤더에 넘긴다', () => {
    expect(squatSrc).toMatch(/score=\{report\.valid === false \? null : reportScore\}/);
  });
});

describe('[배선] StanceReportDashboard.jsx가 Jump/Gait와 같은 공용 리포트 체계를 쓴다', () => {
  it('UnifiedReportPrimitives·ProblemFocusPanel·ReportActions를 가져와 쓴다', () => {
    expect(stanceSrc).toMatch(/from '\.\.\/\.\.\/components\/report\/UnifiedReportPrimitives'/);
    expect(stanceSrc).toMatch(/from '\.\/ProblemFocusPanel\.jsx'/);
    expect(stanceSrc).toMatch(/from '\.\.\/\.\.\/components\/report\/ReportActions'/);
    expect(stanceSrc).toMatch(/<ProblemFocusPanel/);
  });

  it('눈뜨고·눈감고 각각 좌/우 유지시간·골반기울기 바를 그린다', () => {
    expect(stanceSrc).toMatch(/<HoldTimeBar leg=\{eyesOpen\.left\}/);
    expect(stanceSrc).toMatch(/<HoldTimeBar leg=\{eyesOpen\.right\}/);
    expect(stanceSrc).toMatch(/<HoldTimeBar leg=\{eyesClosed\.left\}/);
    expect(stanceSrc).toMatch(/<HoldTimeBar leg=\{eyesClosed\.right\}/);
  });

  it('좌우 비대칭(asymmetryFlag) 콜아웃이 있다', () => {
    expect(stanceSrc).toMatch(/asymmetryAny/);
    expect(stanceSrc).toMatch(/좌우 균형 확인 필요/);
  });

  it('목표/최소 유지시간을 SLST_TUNING에서 그대로 가져와 표시한다(하드코딩 안 함)', () => {
    expect(stanceSrc).toMatch(/SLST_TUNING\.targetHoldMs/);
    expect(stanceSrc).toMatch(/SLST_TUNING\.minAcceptableHoldMs/);
  });

  it('종합 점수(0~100)를 계산해 헤더에 넘긴다', () => {
    expect(stanceSrc).toMatch(/score=\{report\.valid === false \? null : reportScore\}/);
  });
});
