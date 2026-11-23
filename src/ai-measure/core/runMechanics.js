// ai-measure/core/runMechanics.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-11-23] 4번(보행·러닝) 달리기 분석 보강 — 접지·체공 시간, 오버스트라이드, 팔 스윙 각도,
//  쉬운 말 피드백 문장. 기존 GaitCycleTracker/BiomechAccumulator는 손대지 않고 같은 프레임을
//  한 번 더 받아 쓰는 별도 추적기다("있던 것에 추가").
//
//  정직성 원칙 (프로젝트 설계 원칙: AI가 확정 판정하지 않는다)
//   · 전부 단일 카메라 2D 좌표에서 나온 '참고 추정값'이다. 접지 시간은 프레임 간격(30fps면 약 33ms)만큼 오차가 있다.
//   · 기준값(주의·위험 문턱)은 실측 데이터 쌓이기 전 센터 현장 보정용 '시작값'이며 논문 컷오프가 아니다.
//   · 측면 촬영에서만 의미 있는 지표(오버스트라이드·팔 스윙)는 측면일 때만 값을 낸다. 아니면 null(측정 안 됨).
//   · 접지 시간·체공 시간은 프레임 속도가 낮으면(15fps 미만) 계산하지 않는다.
// ════════════════════════════════════════════════════════════════════════
import { OneEuroFilter, angleAt } from './gaitBiomechanics';
import { getFrameAspect } from './geometry.js';

export const RUN_MECH_TUNING = {
  minFps: 15,                // 이보다 느린 녹화에서는 접지·체공 시간을 계산하지 않음
  minVisibility: 0.3,
  contactEnterFrac: 0.12,    // 발 높이가 (바닥~최고점) 폭의 아래 12% 이내면 접지 시작
  contactExitFrac: 0.2,      // 20% 밖으로 올라가면 접지 끝(히스테리시스)
  minFootRange: 0.03,        // 발 상하 움직임이 이보다 작으면(서 있음) 접지 판정 안 함(정규화 y)
  minContactMs: 60,
  maxContactMs: 700,
  minFlightMs: 20,
  maxFlightMs: 400,
  minEvents: 4,              // 한 발당 접지 4회 이상일 때만 값을 낸다
  contactAsymWarnPct: 8,
  contactAsymFlagPct: 15,
  overstrideWarnPct: 18,     // 착지 때 발목이 골반보다 앞에 있는 거리(다리 길이 대비 %)
  overstrideFlagPct: 28,
  armRangeLowDeg: 25,        // 위팔 앞뒤 스윙 폭이 이보다 작으면 '작음'
  armRangeHighDeg: 90,       // 이보다 크면 '큼'
  armAsymWarnPct: 20,
  elbowLowDeg: 60,
  elbowHighDeg: 130,
};

const T = RUN_MECH_TUNING;
const LMI = { SH_L: 11, SH_R: 12, EL_L: 13, EL_R: 14, WR_L: 15, WR_R: 16, HIP_L: 23, HIP_R: 24, ANK_L: 27, ANK_R: 28, HEEL_L: 29, HEEL_R: 30, TOE_L: 31, TOE_R: 32 };
const vis = (p) => !!p && (p.visibility == null || p.visibility >= T.minVisibility);
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const percentile = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
};
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const levelOf = (v, warn, flag) => (v == null ? 'normal' : v >= flag ? 'risk' : v >= warn ? 'caution' : 'normal');

// 발의 가장 낮은 지점(뒤꿈치·발끝·발목 중 화면 아래쪽) — 바닥에 닿는 부분.
function footLowY(lm, side) {
  const k = side === 'left' ? [LMI.HEEL_L, LMI.TOE_L, LMI.ANK_L] : [LMI.HEEL_R, LMI.TOE_R, LMI.ANK_R];
  const ys = k.map((i) => lm[i]).filter(vis).map((p) => p.y);
  return ys.length ? Math.max(...ys) : null;
}

function makeFoot() {
  return {
    // 컷오프를 높게(6Hz) — 낮으면 필터 지연 때문에 접지 시작이 늦게 잡혀 착지 위치가 틀어진다
    filt: new OneEuroFilter({ minCutoff: 6.0, beta: 0.05, dCutoff: 1.0 }),
    lo: Infinity, hi: -Infinity, inContact: false, startTs: null, contacts: [], touchdowns: [],
  };
}

export class RunMechanicsTracker {
  constructor() {
    this.foot = { left: makeFoot(), right: makeFoot() };
    this.firstTs = null;
    this.lastTs = null;
    this.frames = 0;
    this._air = null;          // 두 발 모두 공중인 구간 시작 ts
    this.flights = [];
    this._dirSum = 0;          // (발끝.x − 뒤꿈치.x) 합 → 달리는 방향 부호
    this._legMax = 0;          // 골반~발목 세로 길이 최댓값(다리 길이 근사)
    this.arm = { left: { ang: [], elbow: [], vis: 0 }, right: { ang: [], elbow: [], vis: 0 } };
  }

  push(lm, ts) {
    if (!lm || !Number.isFinite(ts)) return;
    if (this.firstTs == null) this.firstTs = ts;
    this.lastTs = ts;
    this.frames += 1;

    const hipL = lm[LMI.HIP_L]; const hipR = lm[LMI.HIP_R];
    const hipMid = vis(hipL) && vis(hipR) ? { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 } : null;

    // 달리는 방향(발끝이 향하는 쪽)
    [['left', LMI.HEEL_L, LMI.TOE_L], ['right', LMI.HEEL_R, LMI.TOE_R]].forEach(([, h, t]) => {
      if (vis(lm[h]) && vis(lm[t])) this._dirSum += lm[t].x - lm[h].x;
    });
    if (hipMid) {
      [LMI.ANK_L, LMI.ANK_R].forEach((i) => { if (vis(lm[i])) this._legMax = Math.max(this._legMax, lm[i].y - hipMid.y); });
    }

    // 접지 판정(발별)
    const states = {};
    ['left', 'right'].forEach((side) => {
      const f = this.foot[side];
      const raw = footLowY(lm, side);
      if (raw == null) { states[side] = null; return; }
      const y = f.filt.filter(raw, ts / 1000);
      f.lo = Math.min(f.lo === Infinity ? y : f.lo + (y - f.lo) * 0.002, y);
      f.hi = Math.max(f.hi === -Infinity ? y : f.hi - (f.hi - y) * 0.002, y);
      const range = f.hi - f.lo;
      if (range < T.minFootRange) { states[side] = false; return; }
      const fromFloor = (f.hi - y) / range; // 0 = 바닥, 1 = 최고점
      if (!f.inContact && fromFloor <= T.contactEnterFrac) {
        f.inContact = true; f.startTs = ts;
        const ank = lm[side === 'left' ? LMI.ANK_L : LMI.ANK_R];
        if (hipMid && vis(ank)) f.touchdowns.push((ank.x - hipMid.x) * getFrameAspect()); // 세로(높이) 기준 길이로 맞춤
      } else if (f.inContact && fromFloor > T.contactExitFrac) {
        f.inContact = false;
        const dur = ts - f.startTs;
        if (dur >= T.minContactMs && dur <= T.maxContactMs) f.contacts.push(dur);
        else f.touchdowns.pop(); // 비정상 길이 접지는 오버스트라이드 표본에서도 뺀다
        f.startTs = null;
      }
      states[side] = f.inContact;
    });

    // 체공(두 발 모두 접지 아님) 구간
    if (states.left === false && states.right === false) {
      if (this._air == null) this._air = ts;
    } else if (this._air != null) {
      if (states.left != null && states.right != null) {
        const d = ts - this._air;
        if (d >= T.minFlightMs && d <= T.maxFlightMs) this.flights.push(d);
      }
      this._air = null;
    }

    // 팔 스윙(위팔 각도 = 어깨→팔꿈치 벡터와 수직선 사이각, 달리는 방향 앞이 +)
    [['left', LMI.SH_L, LMI.EL_L, LMI.WR_L], ['right', LMI.SH_R, LMI.EL_R, LMI.WR_R]].forEach(([side, s, e, w]) => {
      const sh = lm[s]; const el = lm[e]; const wr = lm[w];
      if (!vis(sh) || !vis(el)) return;
      const a = this.arm[side];
      a.ang.push((Math.atan2((el.x - sh.x) * getFrameAspect(), el.y - sh.y) * 180) / Math.PI); // 부호는 summary에서 방향 곱함
      a.vis += (sh.visibility ?? 1) + (el.visibility ?? 1);
      if (vis(wr)) {
        const ea = angleAt(sh, el, wr);
        if (Number.isFinite(ea)) a.elbow.push(ea);
      }
    });
  }

  /**
   * @param {{orientation?:'side'|'back'|'front'|null, fps?:number|null}} opt
   * fps 를 안 넘기면 프레임 수/녹화 시간으로 추정한다.
   */
  summary({ orientation = null, fps = null } = {}) {
    const spanMs = this.lastTs != null && this.firstTs != null ? this.lastTs - this.firstTs : 0;
    const estFps = fps ?? (spanMs > 0 ? ((this.frames - 1) * 1000) / spanMs : null);
    const fpsOk = estFps != null && estFps >= T.minFps;
    const isSide = orientation === 'side';

    // ── 접지·체공 ──
    const L = this.foot.left.contacts; const R = this.foot.right.contacts;
    const enough = L.length >= T.minEvents && R.length >= T.minEvents;
    const leftMs = enough && fpsOk ? Math.round(median(L)) : null;
    const rightMs = enough && fpsOk ? Math.round(median(R)) : null;
    const avgMs = leftMs != null && rightMs != null ? Math.round((leftMs + rightMs) / 2) : null;
    const asym = leftMs != null && rightMs != null ? r1((Math.abs(leftMs - rightMs) / ((leftMs + rightMs) / 2)) * 100) : null;
    const flightMs = fpsOk && this.flights.length >= T.minEvents ? Math.round(median(this.flights)) : null;
    const contact = {
      leftMs, rightMs, avgMs, flightMs,
      asymmetryPct: asym,
      asymmetryLevel: levelOf(asym, T.contactAsymWarnPct, T.contactAsymFlagPct),
      events: { left: L.length, right: R.length, flights: this.flights.length },
      fps: estFps != null ? Math.round(estFps) : null,
      resolutionMs: estFps ? Math.round(1000 / estFps) : null,
      reason: !fpsOk ? '녹화 프레임 속도가 낮아 계산하지 않음' : !enough ? '발이 땅에 닿는 장면을 충분히 잡지 못함' : null,
    };

    // ── 오버스트라이드(측면 전용) ──
    const dir = this._dirSum >= 0 ? 1 : -1;
    let overstride = { avgPct: null, maxPct: null, level: 'normal', n: 0, reason: null };
    if (!isSide) {
      overstride.reason = '측면 촬영에서만 계산';
    } else if (!this._legMax) {
      overstride.reason = '다리 길이를 잡지 못함';
    } else {
      const all = [...this.foot.left.touchdowns, ...this.foot.right.touchdowns]
        .map((dx) => ((dx * dir) / this._legMax) * 100);
      if (all.length < T.minEvents) {
        overstride.reason = '착지 장면을 충분히 잡지 못함';
      } else {
        const avg = all.reduce((a, b) => a + b, 0) / all.length;
        const shown = Math.max(0, avg); // 착지 때 발이 몸 뒤에 있으면(음수) '앞으로 뻗음 0'으로 본다
        overstride = {
          avgPct: r1(shown), maxPct: r1(Math.max(0, percentile(all, 0.9))),
          level: levelOf(shown, T.overstrideWarnPct, T.overstrideFlagPct),
          n: all.length, reason: null,
          warnPct: T.overstrideWarnPct, flagPct: T.overstrideFlagPct,
        };
      }
    }

    // ── 팔 스윙(측면 전용) ──
    const rangeOf = (a) => {
      if (a.ang.length < 20) return null;
      const signed = a.ang.map((v) => v * dir);
      return percentile(signed, 0.95) - percentile(signed, 0.05);
    };
    let armSwing = { leftRangeDeg: null, rightRangeDeg: null, mainSide: null, mainRangeDeg: null, elbowAvgDeg: null, asymmetryPct: null, level: 'normal', reason: null };
    if (!isSide) {
      armSwing.reason = '측면 촬영에서만 계산';
    } else {
      const lr = rangeOf(this.arm.left); const rr = rangeOf(this.arm.right);
      if (lr == null && rr == null) {
        armSwing.reason = '팔이 충분히 보이지 않음';
      } else {
        // 측면에서는 카메라 쪽 팔이 더 또렷하다 — 인식 점수가 높은 쪽을 대표로 쓴다.
        const mainSide = (this.arm.left.vis >= this.arm.right.vis ? 'left' : 'right');
        const mainRange = mainSide === 'left' ? lr : rr;
        const useSide = mainRange != null ? mainSide : (lr != null ? 'left' : 'right');
        const useRange = useSide === 'left' ? lr : rr;
        const elbowArr = this.arm[useSide].elbow;
        const bothOk = lr != null && rr != null;
        const asymP = bothOk ? r1((Math.abs(lr - rr) / ((lr + rr) / 2)) * 100) : null;
        armSwing = {
          leftRangeDeg: r1(lr), rightRangeDeg: r1(rr),
          mainSide: useSide, mainRangeDeg: r1(useRange),
          elbowAvgDeg: elbowArr.length >= 20 ? Math.round(elbowArr.reduce((a, b) => a + b, 0) / elbowArr.length) : null,
          asymmetryPct: asymP,
          level: 'normal', reason: null,
          lowDeg: T.armRangeLowDeg, highDeg: T.armRangeHighDeg,
        };
      }
    }

    const valid = contact.avgMs != null || overstride.avgPct != null || armSwing.mainRangeDeg != null;
    return { valid, orientation, contact, overstride, armSwing };
  }
}

// ════════════════════════════════════════════════════════════════════════
//  쉬운 말 피드백 — 이미 저장된 지표(기존 + 새 지표)를 해석해 "무엇을 어떻게 고치면 좋은지"를 짧게.
//  숫자를 새로 만들지 않고 값과 기준만 말로 바꾼다. 값이 없으면(측정 안 됨) 말하지 않는다.
//  반환: [{ key, level:'good'|'info'|'caution'|'risk', title, text }] — 중요한 것부터 최대 maxItems개.
// ════════════════════════════════════════════════════════════════════════
const LEVEL_ORDER = { risk: 0, caution: 1, info: 2, good: 3 };

export function buildRunningFeedback(metrics = {}, { orientation = null, mode = null, maxItems = 5 } = {}) {
  const m = metrics || {};
  const rm = m.runMechanics || null;
  const items = [];
  const add = (key, level, title, text) => items.push({ key, level, title, text });
  const isRun = mode === 'run';

  // 1) 오버스트라이드 — 발이 몸보다 너무 앞에 닿으면 브레이크가 걸린다
  const os = rm?.overstride;
  if (os?.avgPct != null) {
    if (os.level === 'risk') add('overstride', 'risk', '발이 너무 앞에 닿아요', '발이 몸보다 많이 앞쪽에 닿고 있어요. 보폭을 줄이고 발걸음 수를 조금 늘려서, 발이 몸 바로 아래쪽에 닿게 해보세요.');
    else if (os.level === 'caution') add('overstride', 'caution', '발이 조금 앞에 닿아요', '발이 몸보다 살짝 앞쪽에 닿는 편이에요. 걸음을 조금 더 짧고 가볍게 가져가면 무릎 부담이 줄어요.');
    else add('overstride', 'good', '발 닿는 위치 좋아요', '발이 몸 가까운 곳에 닿고 있어요. 지금처럼 유지하세요.');
  }

  // 2) 몸통 기울기(측면)
  const tl = m.trunkLean?.avg;
  if (tl != null && orientation === 'side') {
    if (m.trunkLeanAssessment?.level === 'risk' || tl >= 15) add('trunk', 'risk', '몸통이 많이 기울었어요', '몸통이 곧게 서지 않고 많이 기울어 있어요. 시선은 멀리 두고, 가슴을 펴고 골반 위에 몸을 올린다는 느낌으로 달려보세요.');
    else if (m.trunkLeanAssessment?.level === 'caution' || tl >= 8) add('trunk', 'caution', '몸통 기울기를 확인해요', '몸통이 조금 기울어 있어요. 앞으로 숙이더라도 허리가 아니라 발목부터 살짝 기울인다고 생각하면 좋아요.');
  }

  // 3) 좌우 접지 시간 차이
  const ct = rm?.contact;
  if (ct?.asymmetryPct != null) {
    if (ct.asymmetryLevel === 'risk') add('contact_asym', 'risk', '좌우 발 닿는 시간이 달라요', '한쪽 발이 땅에 더 오래 머물러요. 약한 쪽 다리 힘을 따로 키우는 운동(한 발 스쿼트·한 발 균형)을 같이 해보세요.');
    else if (ct.asymmetryLevel === 'caution') add('contact_asym', 'caution', '좌우 발 닿는 시간 차이가 조금 있어요', '양쪽이 거의 비슷하지만 조금 차이가 나요. 다음 측정에서 같은 차이가 반복되는지 확인해요.');
  }

  // 4) 접지 시간 해석(달리기일 때만, 속도에 따라 달라 점수화하지 않음)
  if (isRun && ct?.avgMs != null) {
    if (ct.avgMs > 300) add('contact', 'info', '발이 땅에 오래 머물러요', `발이 땅에 닿아 있는 시간이 평균 ${ct.avgMs}ms예요. 천천히 달릴 땐 자연스럽지만, 같은 속도에서 이 시간이 줄어들면 더 가볍게 달린다는 뜻이에요. 다음 측정과 비교해 보세요.`);
    else add('contact', 'info', '발이 땅에 닿는 시간', `평균 ${ct.avgMs}ms예요. 속도가 빨라질수록 짧아지는 값이라, 같은 속도로 다시 재서 변화를 비교하세요.`);
  }

  // 5) 팔 스윙
  const arm = rm?.armSwing;
  if (arm?.mainRangeDeg != null) {
    if (arm.mainRangeDeg < RUN_MECH_TUNING.armRangeLowDeg) add('arm', 'caution', '팔을 더 흔들어 보세요', '팔 움직임이 작은 편이에요. 팔꿈치를 90° 정도로 접고 뒤로 당긴다는 느낌으로 리듬을 만들면 다리가 따라와요.');
    else if (arm.mainRangeDeg > RUN_MECH_TUNING.armRangeHighDeg) add('arm', 'caution', '팔을 너무 크게 흔들어요', '팔이 너무 크게 움직여요. 어깨 힘을 빼고 팔 흔들기를 조금 줄이면 몸이 덜 흔들려요.');
    else add('arm', 'good', '팔 스윙 좋아요', '팔을 앞뒤로 적당히 흔들고 있어요.');
    if (arm.elbowAvgDeg != null && (arm.elbowAvgDeg < RUN_MECH_TUNING.elbowLowDeg || arm.elbowAvgDeg > RUN_MECH_TUNING.elbowHighDeg)) {
      add('elbow', 'info', '팔꿈치 각도', arm.elbowAvgDeg < RUN_MECH_TUNING.elbowLowDeg ? '팔꿈치를 너무 많이 접고 있어요. 90° 정도로 조금 펴보세요.' : '팔꿈치가 너무 펴져 있어요. 90° 정도로 접어서 흔들어 보세요.');
    }
  }

  // 6) 수직 진폭(위아래 출렁임)
  const vo = m.verticalOscillation;
  if (isRun && vo != null) {
    if (vo > 10) add('vertical', 'caution', '위아래로 많이 뛰어요', '몸이 위아래로 많이 출렁여요. 높이 뛰기보다 앞으로 나간다는 생각으로 가볍게 걸음을 이어가 보세요.');
  }

  // 7) 좌우 무릎 대칭, 보폭 비대칭(측면)
  if (m.kneeSymmetry != null && m.kneeSymmetry < 90) add('knee_sym', 'caution', '좌우 무릎 움직임이 달라요', '왼쪽과 오른쪽 무릎이 굽혀지는 정도가 달라요. 한쪽 다리가 덜 쓰이고 있을 수 있어요.');
  const sl = m.strideLengthAssessment;
  if (orientation === 'side' && sl?.level && sl.level !== 'normal') add('stride_sym', sl.level === 'risk' ? 'risk' : 'caution', '좌우 보폭이 달라요', `${sl.shorterSide === 'left' ? '왼쪽' : sl.shorterSide === 'right' ? '오른쪽' : '한쪽'} 걸음이 더 짧아요. 짧은 쪽 엉덩이와 다리 힘을 확인해 보세요.`);

  // 8) 골반(후면)
  if (orientation === 'back' && m.pelvicDropAssessment?.level && m.pelvicDropAssessment.level !== 'normal') {
    add('pelvis', m.pelvicDropAssessment.level === 'risk' ? 'risk' : 'caution', '골반이 한쪽으로 처져요', '달릴 때 골반이 한쪽으로 처져요. 엉덩이 옆 근육(중둔근) 운동으로 골반을 잡아주세요.');
  }

  items.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return items.slice(0, maxItems);
}
