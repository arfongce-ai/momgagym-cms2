// RSI(반응 탄성 점프) 측정 후 "리포트 생성 안됨" 버그 회귀 방지.
//
// 근본 원인 (JumpPrecisionAnalysis.jsx, 실시간 측정 경로):
//  1) 측면뷰 판정용 OrientationVoter가 매 프레임(공중 포함)에 투표했다.
//     JumpBiomechAccumulator.push는 "공중은 자세 왜곡"이라는 이유로 공중(air)
//     프레임을 방향 투표에서 이미 제외하고 있었는데(gaitBiomechanics.js 354행
//     부근), 같은 목적의 OrientationVoter(RSI 측면뷰 게이트 전용)만 이 필터가
//     빠져 있었다. RSI는 파워 점프보다 체공 비중이 훨씬 커서(연속 반응 점프)
//     이 누락이 훨씬 크게 작용해, 정상적으로 측면에서 촬영해도 공중 프레임의
//     자세 왜곡 노이즈가 누적되면 'side' 판정이 오염되어 computeRSIFromFlights
//     가 not_side_view 로 측정을 무효 처리했다(=리포트 대신 "측정 무효" 표시).
//  2) 측정 직후 미리보기(JumpReport 컴포넌트)의 등급 배지가 RSI 리포트에도
//     파워 점프용 점프높이 임계값(50/40/30cm)을 그대로 적용했다. RSI는 접지
//     시간을 최소화하는 게 목적이라 점프 높이 자체가 낮게 나오는 게 정상인데,
//     그 값을 파워 점프 기준으로 채점하면 정상적인 RSI 측정 대부분이 "개선
//     필요"로 표시되어 리포트가 쓸모없어 보이는 문제가 있었다.
//
// 아래는 실제 컴포넌트(JumpPrecisionAnalysis.jsx)에서 쓰는 것과 동일한 순수
// 유틸(OrientationVoter/detectOrientation, RSI_TUNING/computeRSIFromFlights)을
// 그대로 가져와, 컴포넌트의 판단 로직을 그대로 미러링해 검증한다.
import { describe, it, expect } from 'vitest';
import { OrientationVoter, detectOrientation } from '../ai-measure/core/gaitBiomechanics';
import { computeRSIFromFlights, RSI_TUNING } from '../ai-measure/core/reactiveJump';

// 측면 촬영 랜드마크. air=true 이면 공중 구간의 자세 왜곡(팔·몸통 흔들림,
// 모션블러로 인한 포즈 추정 노이즈)을 어깨/골반 좌우 벌어짐으로 모사한다.
function sideFrame(air, distortion = 0) {
  const lm = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, visibility: 1 }));
  const shoulderSpread = air ? distortion : 0;
  const hipSpread = air ? distortion * 0.8 : 0;
  lm[11] = { x: 0.500 - shoulderSpread / 2, y: 0.30, visibility: 1 };
  lm[12] = { x: 0.508 + shoulderSpread / 2, y: 0.30, visibility: 1 };
  lm[23] = { x: 0.500 - hipSpread / 2, y: 0.55, visibility: 1 };
  lm[24] = { x: 0.508 + hipSpread / 2, y: 0.55, visibility: 1 };
  return lm;
}

// JumpPrecisionAnalysis.jsx 프레임 루프의 실제 조건을 그대로 미러링:
//   if (orientRef.current && jp !== 'air') orientRef.current.push(landmarks);
function pushWithComponentFilter(voter, landmarks, phase) {
  if (phase !== 'air') voter.push(landmarks);
}

describe('RSI 측면뷰 판정 — 공중 프레임 제외 회귀 방지', () => {
  it('공중 프레임의 자세 왜곡이 커도(측면 촬영은 유지) 지상 프레임만 투표하면 side로 안정적으로 판정된다', () => {
    const voter = new OrientationVoter();
    // 지상(stand/land) 프레임 다수: 깨끗한 측면 자세
    for (let i = 0; i < 20; i++) pushWithComponentFilter(voter, sideFrame(false), 'stand');
    // 공중 프레임 다수: 왜곡이 커서 단일 프레임 기준으로는 'back'으로도 잘못 잡힐 수준
    for (let i = 0; i < 40; i++) pushWithComponentFilter(voter, sideFrame(true, 0.16), 'air');
    for (let i = 0; i < 10; i++) pushWithComponentFilter(voter, sideFrame(false), 'land');

    // 공중 프레임은 애초에 투표되지 않았어야 한다.
    expect(voter.votes.back).toBe(0);
    expect(voter.votes.side).toBeGreaterThan(0);
    expect(voter.decide()).toBe('side');
  });

  it('회귀 재현: 공중 프레임까지 투표하면(예전 버그) 같은 세션이 오염되어 side 확신도가 크게 떨어진다', () => {
    // 예전 버그를 그대로 재현한 버전(필터 없이 모든 프레임 투표)과 비교.
    const buggyVoter = new OrientationVoter();
    const fixedVoter = new OrientationVoter();
    const frames = [];
    for (let i = 0; i < 20; i++) frames.push({ lm: sideFrame(false), phase: 'stand' });
    for (let i = 0; i < 40; i++) frames.push({ lm: sideFrame(true, 0.16), phase: 'air' });
    for (let i = 0; i < 10; i++) frames.push({ lm: sideFrame(false), phase: 'land' });

    for (const f of frames) {
      buggyVoter.push(f.lm); // 예전 버그: 공중 포함 전부 투표
      pushWithComponentFilter(fixedVoter, f.lm, f.phase); // 수정본: 공중 제외
    }

    // 수정본은 오염 투표가 전혀 없어야 한다.
    expect(fixedVoter.votes.back).toBe(0);
    // 예전 버그 버전은 공중 프레임 왜곡이 그대로 back 표로 잡힌다(오염 발생).
    expect(buggyVoter.votes.back).toBeGreaterThan(0);
    // 오염된 버전이 side 쪽 다수결 마진이 훨씬 좁다(반응 탄성처럼 공중 비중이
    // 더 크거나 왜곡이 더 크면 이 마진 차이가 실제로 뒤집힐 수 있다는 것을 보여준다).
    const buggyMargin = buggyVoter.votes.side - buggyVoter.votes.back;
    const fixedMargin = fixedVoter.votes.side - fixedVoter.votes.back;
    expect(fixedMargin).toBeGreaterThan(buggyMargin);
  });

  it('단일 프레임 기준으로도 공중의 왜곡 정도에 따라 side↔back 판정이 실제로 뒤집힐 수 있다(전제 확인)', () => {
    const stand = detectOrientation(sideFrame(false));
    const air = detectOrientation(sideFrame(true, 0.16));
    expect(stand.view).toBe('side');
    expect(air.view).not.toBe('side'); // 왜곡이 판정을 뒤집을 만큼 크다는 전제 확인
  });
});

// ── 등급 배지: RSI는 파워 점프 키 임계값이 아니라 RSI 비율 등급을 써야 한다 ──
// JumpPrecisionAnalysis.jsx의 JumpReport 컴포넌트가 실제로 쓰는 로직을 그대로
// 미러링(수정 후 버전). 색상 매핑(tone → text-{tone}-400)까지 동일하게 검증한다.
function computeGradeBadge(report, isRsi) {
  if (!report.valid) return null;
  if (isRsi) {
    return report.rsi?.grade
      ? { label: report.rsi.grade.label, color: `text-${report.rsi.grade.tone}-400` }
      : { label: '평가 불가', color: 'text-slate-400' };
  }
  if (report.heightCm >= 50) return { label: '매우 우수', color: 'text-blue-400' };
  if (report.heightCm >= 40) return { label: '우수', color: 'text-emerald-400' };
  if (report.heightCm >= 30) return { label: '보통', color: 'text-amber-400' };
  return { label: '개선 필요', color: 'text-red-400' };
}

// 예전 버그 버전(비교용): RSI 여부와 무관하게 항상 점프 높이 임계값을 쓴다.
function computeGradeBadgeOldBuggy(report) {
  if (!report.valid) return null;
  if (report.heightCm >= 50) return { label: '매우 우수', color: 'text-blue-400' };
  if (report.heightCm >= 40) return { label: '우수', color: 'text-emerald-400' };
  if (report.heightCm >= 30) return { label: '보통', color: 'text-amber-400' };
  return { label: '개선 필요', color: 'text-red-400' };
}

describe('RSI 등급 배지 — 파워 점프 키 임계값 오적용 회귀 방지', () => {
  it('RSI는 반응 탄성 능력이 좋아도(점프 높이가 낮은 게 정상) 파워 점프 기준으로 "개선 필요"가 되면 안 된다', () => {
    // RSI 반응 점프는 점프 높이가 낮은 게 정상(접지시간 최소화가 목표)이면서도
    // 반응성(RSI 비율=체공/접지)은 우수할 수 있다 — 접지 80ms(허용 최솟값) ·
    // 체공 220ms → RSI 2.75(우수, ≥2.5)인데 높이는 약 5.9cm로 파워 점프 기준
    // (30cm 미만=개선 필요)으로 보면 최하 등급이 되는 전형적인 사례.
    const rsiResult = computeRSIFromFlights(
      [
        { takeoffMs: 0,   landingMs: 220,  flightMs: 220 },
        { takeoffMs: 300, landingMs: 520,  flightMs: 220 },
        { takeoffMs: 600, landingMs: 820,  flightMs: 220 },
        { takeoffMs: 900, landingMs: 1120, flightMs: 220 },
      ],
      { view: 'side' },
    );
    expect(rsiResult.valid).toBe(true);
    expect(rsiResult.rsi).toBeGreaterThanOrEqual(2.5); // '우수' 등급대 확인(전제)
    expect(rsiResult.heightCm).toBeLessThan(30); // 파워 점프 기준으로는 '개선 필요' 구간(전제)

    const report = { valid: true, jumpType: 'reactive', heightCm: rsiResult.heightCm, rsi: rsiResult };

    const fixed = computeGradeBadge(report, true);
    const oldBuggy = computeGradeBadgeOldBuggy(report);

    // 회귀 확인: 예전 버그는 무조건 "개선 필요"(빨강)를 보여준다.
    expect(oldBuggy).toEqual({ label: '개선 필요', color: 'text-red-400' });
    // 수정본은 RSI 비율 기준 등급(RSI_TUNING.grades)을 그대로 반영한다 — 예전
    // 버그와 달라야 하고, RSI_TUNING의 등급표와 정확히 일치해야 한다.
    expect(fixed).not.toEqual(oldBuggy);
    expect(fixed.label).toBe(rsiGradeLabelFor(rsiResult.rsi));
    expect(fixed.color).toBe(`text-${rsiGradeToneFor(rsiResult.rsi)}-400`);
  });

  it('파워 점프(RSI 아님)는 기존과 동일하게 점프 높이 임계값을 그대로 쓴다(회귀 없음)', () => {
    const report = { valid: true, jumpType: 'power', heightCm: 45 };
    const fixed = computeGradeBadge(report, false);
    expect(fixed).toEqual({ label: '우수', color: 'text-emerald-400' });
  });

  it('RSI인데 rsi 데이터가 없는 예외적인 경우에도 크래시 없이 안전한 기본값을 보여준다', () => {
    const report = { valid: true, jumpType: 'reactive', heightCm: 8, rsi: null };
    expect(() => computeGradeBadge(report, true)).not.toThrow();
    expect(computeGradeBadge(report, true)).toEqual({ label: '평가 불가', color: 'text-slate-400' });
  });

  it('무효 측정은 RSI 여부와 무관하게 등급이 없다(null)', () => {
    expect(computeGradeBadge({ valid: false, jumpType: 'reactive' }, true)).toBeNull();
    expect(computeGradeBadge({ valid: false, jumpType: 'power' }, false)).toBeNull();
  });
});

function rsiGradeLabelFor(rsi) {
  const g = RSI_TUNING.grades.find((g) => rsi >= g.min);
  return g?.label;
}
function rsiGradeToneFor(rsi) {
  const g = RSI_TUNING.grades.find((g) => rsi >= g.min);
  return g?.tone;
}
