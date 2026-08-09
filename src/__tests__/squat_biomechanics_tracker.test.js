import { describe, it, expect } from 'vitest';
import { SquatBiomechanicsTracker } from '../ai-measure/core/squatBiomechanicsTracker.js';
import { evaluateSquatBiomechanics } from '../ai-measure/core/squatBiomechanics.js';

// 캘리브레이션 결과를 직접 구성(StandingCalibrator.push 없이 트래커 로직만 검증).
const calib = { baselinePelvisY: 0.50, baselineKneeY: 0.70, baselineHeelY: 0.95, baselineFeetY: 0.95 };

function frame({ hipY, kneeY = 0.70, shoY = 0.30, ankY = 0.90, heelY = 0.95, valgus = 0, armDrop = 0 }) {
  // 25 landmark 배열: 필요한 인덱스만 채움(0=nose 자리는 안 씀, torsoLean에 shoulder 필요).
  const lm = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, visibility: 1 }));
  lm[7] = { x: 0.47, y: shoY - 0.12, visibility: 1 }; lm[8] = { x: 0.53, y: shoY - 0.12, visibility: 1 }; // ears
  // [2026-08-06] 귀: 기본값은 어깨 중점 바로 위·수평(고개 안 기운 상태) — 안 채우면
  // 기본값(0.5,0.5)에 남아 새로 연결된 headTiltDeg가 다른 지표 테스트에서 엉뚱하게
  // 위험으로 걸린다(팔꿈치 때와 동일한 이유).
  lm[11] = { x: 0.45, y: shoY, visibility: 1 }; lm[12] = { x: 0.55, y: shoY, visibility: 1 }; // shoulders
  lm[23] = { x: 0.45, y: hipY, visibility: 1 }; lm[24] = { x: 0.55, y: hipY, visibility: 1 }; // hips
  lm[25] = { x: 0.45 - valgus, y: kneeY, visibility: 1 }; lm[26] = { x: 0.55 + valgus, y: kneeY, visibility: 1 }; // knees
  lm[27] = { x: 0.45, y: ankY, visibility: 1 }; lm[28] = { x: 0.55, y: ankY, visibility: 1 }; // ankles
  lm[29] = { x: 0.45, y: heelY, visibility: 1 }; lm[30] = { x: 0.55, y: heelY, visibility: 1 }; // heels
  // [2026-08-03] 손목: 기본값은 어깨 바로 위(armDrop=0, 팔을 곧게 든 상태) — 오버헤드
  // 딥 스쿼트는 원래 이런 자세라, armDropDeg를 신경 안 쓰는 기존 테스트들도 이 기본값
  // 덕분에 "팔은 정상"인 채로 다른 지표만 검증할 수 있다(값을 안 주면 항상 회색/미판정
  // 이던 이전과 달리, 이제 armDropDeg가 실제로 판정에 들어가므로 기본값이 필요해졌다).
  const armLen = 0.35;
  const rad = (armDrop * Math.PI) / 180;
  const dx = armLen * Math.sin(rad), dy = armLen * Math.cos(rad);
  lm[15] = { x: 0.45 + dx, y: shoY - dy, visibility: 1 };
  lm[16] = { x: 0.55 + dx, y: shoY - dy, visibility: 1 };
  // [2026-08-06] 팔꿈치(13/14): 어깨-손목 사이 중점에 둬 "편 팔"을 근사한다
  // (손목과 동일한 armDrop=0 기본 가정과 일관 — 안 채우면 기본값(0.5,0.5)에
  // 남아 elbowExtensionDeg가 다른 지표 테스트에서 엉뚱하게 위험으로 걸린다).
  lm[13] = { x: (0.45 + lm[15].x) / 2, y: (shoY + lm[15].y) / 2, visibility: 1 };
  lm[14] = { x: (0.55 + lm[16].x) / 2, y: (shoY + lm[16].y) / 2, visibility: 1 };
  return lm;
}

// 서기(baselinePelvisY) → 목표 깊이(targetHipY)까지 부드럽게 선형 보간해 내려갔다가
// 같은 속도로 다시 서기까지 올라오는 한 번의 반복을 흘려보낸다. 30fps 상당의 촘촘한
// 스텝을 써야 프레임당 이동량이 작아져 balanceLoss 속도 휴리스틱을 오검출하지 않는다.
function runOneRep(tracker, { startMs = 0, targetHipY = 0.69, steps = 30, stepMs = 33, ...frameOpts } = {}) {
  let t = startMs;
  const push = (hipY) => { tracker.push(frame({ hipY, ...frameOpts }), t); t += stepMs; };
  const standY = 0.50;
  push(standY); push(standY); // 서 있는 프레임(대기)
  for (let i = 1; i <= steps; i++) push(standY + (targetHipY - standY) * (i / steps)); // 하강
  for (let i = steps - 1; i >= 0; i--) push(standY + (targetHipY - standY) * (i / steps)); // 상승
  push(standY);
  return t;
}

describe('SquatBiomechanicsTracker — 반복(rep) 감지 및 trial 변환', () => {
  it('서기→하강→기립 복귀 한 사이클을 유효한 trial 1개로 잡는다', () => {
    const tracker = new SquatBiomechanicsTracker(calib);
    runOneRep(tracker);
    const s = tracker.summary();
    expect(s.trialsFound).toBe(1);
    expect(s.trial1.valid).toBe(true);
  });

  it('무릎 높이까지 깊게 앉으면 thighInclineDeg가 0에 가깝다(패러렐 도달)', () => {
    const tracker = new SquatBiomechanicsTracker(calib);
    runOneRep(tracker, { targetHipY: 0.70 }); // hipY === baselineKneeY → depthFrac=1
    const s = tracker.summary();
    expect(s.trial1.thighInclineDeg).toBeLessThan(5);
  });

  it('살짝만 앉으면(얕은 스쿼트) thighInclineDeg가 높게(얕음) 나온다', () => {
    const tracker = new SquatBiomechanicsTracker(calib);
    // minDepthForValidRep(0.20)는 넘기되 얕게만 — depthFrac≈0.3
    runOneRep(tracker, { targetHipY: 0.56 });
    const s = tracker.summary();
    expect(s.trial1.thighInclineDeg).toBeGreaterThan(50);
  });

  it('충분히 안 내려간 흔들림은 반복으로 세지 않는다(minDepthForValidRep 미만)', () => {
    const tracker = new SquatBiomechanicsTracker(calib);
    let t = 0;
    const push = (hipY) => { tracker.push(frame({ hipY }), t); t += 33; };
    [0.50, 0.50, 0.52, 0.53, 0.52, 0.50, 0.50].forEach(push); // 아주 살짝만 움직임
    expect(tracker.summary().trialsFound).toBe(0);
  });

  it('무릎이 안쪽으로 모이면(valgus) kneeValgusDeg가 커진다', () => {
    const straight = new SquatBiomechanicsTracker(calib);
    runOneRep(straight, { valgus: 0 });
    const valgusIn = new SquatBiomechanicsTracker(calib);
    runOneRep(valgusIn, { valgus: 0.08 });
    expect(valgusIn.summary().trial1.kneeValgusDeg).toBeGreaterThan(straight.summary().trial1.kneeValgusDeg);
  });

  it('뒤꿈치가 기준선보다 많이 뜨면 heelLift가 true다', () => {
    const tracker = new SquatBiomechanicsTracker(calib);
    runOneRep(tracker, { heelY: 0.90 }); // baselineHeelY(0.95)보다 위로(작은 y) 많이 뜸
    expect(tracker.summary().trial1.heelLift).toBe(true);
  });

  it('연속 2회 반복까지만 모으고 그 이후는 무시한다(maxTrials)', () => {
    const tracker = new SquatBiomechanicsTracker(calib);
    let t = runOneRep(tracker, { startMs: 0 });
    t = runOneRep(tracker, { startMs: t });
    runOneRep(tracker, { startMs: t });
    const s = tracker.summary();
    expect(s.trialsFound).toBe(2);
  });

  it('liveDepthState()로 하강 중 실시간 깊이를 조회할 수 있다(라이브 화면용)', () => {
    const tracker = new SquatBiomechanicsTracker(calib);
    expect(tracker.liveDepthState()).toBeNull(); // 아직 서 있는 상태(waiting)에선 null
    tracker.push(frame({ hipY: 0.50 }), 0);
    expect(tracker.liveDepthState()).toBeNull();
    tracker.push(frame({ hipY: 0.60 }), 33); // depthFrac=(0.60-0.50)/0.20=0.5, 하강 시작
    const live = tracker.liveDepthState();
    expect(live).not.toBeNull();
    expect(live.depthFrac).toBeCloseTo(0.5, 1);
    tracker.push(frame({ hipY: 0.70 }), 66); // 완전 패러렐(depthFrac=1) 도달
    expect(tracker.liveDepthState().thighInclineDeg).toBeLessThan(5);
  });
});

describe('evaluateSquatBiomechanics ↔ 트래커 출력 — 통합 확인', () => {
  it('트래커 summary()를 그대로 넣으면 정상 판정이 나온다(깊고 곧은 스쿼트)', () => {
    const tracker = new SquatBiomechanicsTracker(calib);
    runOneRep(tracker, { targetHipY: 0.70, valgus: 0, heelY: 0.95 });
    runOneRep(tracker, { startMs: 2000, targetHipY: 0.70, valgus: 0, heelY: 0.95 });
    const result = evaluateSquatBiomechanics(tracker.summary());
    expect(result.valid).toBe(true);
    expect(result.status).toBe('normal');
  });
});
