// ai-measure/core/barbellBiomechanics.js
// ════════════════════════════════════════════════════════════════════════
//  바벨 리프팅(역도·VBT·1RM) 실시간 생체역학 엔진 — 측정/계산부 재설계.
//  jumpBiomechanics / gaitBiomechanics 와 동일한 설계 철학:
//   · 현장 튜닝 상수를 BARBELL_TUNING 한 곳에 모음
//   · 1-Euro 평활 재사용 (검출 떨림 제거 — 고정 EMA+데드존 대체)
//   · Accumulator 클래스: 매 프레임 push → 실시간 렙 분절/속도/궤적 산출
//   · valid 플래그 + reason 코드로 무효 측정 원천 차단 (측정 정직성)
//
//  실시간 측정 원리:
//   (1) 렙 분절: 평활된 수직 위치(y)의 방향 반전을 히스테리시스(minTravel)로
//       검출해 상승(컨센트릭) 구간을 완성 즉시 1렙으로 확정한다. 프레임 개수가
//       아니라 실측 ms 타임스탬프로 계산 → VFR/드롭/실제 fps 오차 자동 흡수
//       (점프의 비행시간 방식과 동형).
//   (2) 평균속도: 컨센트릭 수직 변위 ÷ 실측 시간. fps 의존성이 낮아 실시간에서
//       신뢰 가능(기존 입장과 동일).
//   (3) 최고속도(실시간): 순간 미분 대신 ±2 샘플 창의 중심차분(≈130ms@30fps
//       평활 미분, Savitzky-Golay 1차와 동등)으로 산출한다. 노이즈 증폭이 없는
//       대신 진짜 순간 피크보다 보수적(약간 낮게)이다 — 그럴듯한 과대값을
//       내놓지 않는 방향의 정직한 추정. 컨센트릭 구간의 샘플 밀도가 기준
//       (peakMinSamples) 미만이면 산출을 거부한다(reason 코드).
//       ※ 기존 canComputePeakVelocity(고속영상 게이트)는 '순간 피크 실측'용으로
//         유지된다. 이 엔진의 peakReason 'sg_ok'는 '실시간 평활 추정'임을
//         구분해 표기한다 — 서로 다른 정밀도의 방법을 똑같이 보이지 않게.
//   (4) 바 궤적(역도): 렙 시작점 대비 수평 이탈(드리프트)과 경로 효율
//       (수직변위 ÷ 총 경로길이)을 렙마다 산출 — 궤적 평가의 근거 수치.
//   (5) 속도저하(VBT): 렙 평균속도의 최고 대비 마지막 렙 저하율(%) —
//       Pareja-Blanco 등의 velocity-loss 자동조절 지표.
//
//  좌표계: x/y 는 0~1 화면 정규화(y 아래로 증가). 엔진은 비율(ratio) 도메인에
//  값을 보관하고, cm/속도 변환은 읽는 시점(live/summary)에 cmPerRatio 로 한다
//  → 측정 도중 키 입력/기준물 보정이 바뀌어도 궤적을 다시 잴 필요가 없다.
// ════════════════════════════════════════════════════════════════════════

import { OneEuroFilter } from './gaitBiomechanics';

// ───────── 현장 튜닝 설정 (한 곳에 모음) ─────────
// "렙을 못 셈/작은 동작 놓침" → minTravelRatio·minRepRomRatio 낮추기
// "미세 떨림이 렙으로 잡힘"   → minTravelRatio 높이기, filterMinCutoff 낮추기
// "피크가 너무 자주 거부됨"   → peakMinSamples 낮추기(정확도와 트레이드오프)
export const BARBELL_TUNING = {
  // 위치 평활(1-Euro) — 반전점을 뭉개지 않는 선에서 떨림 제거.
  //  스켈레톤(손목 중점) 입력은 엔드캡 추적보다 지터가 크므로 조금 더 평활.
  filterMinCutoff: 1.8,
  filterBeta: 0.04,
  extremeEps: 0.004,       // 극점 갱신 최소 개선폭 — 필터 점근 수렴이 정지
                           // 구간을 렙 시간에 포함시키는 것을 차단(속도 정확도)

  // ── 렙 분절(히스테리시스) ──
  minTravelRatio: 0.05,    // 방향 반전으로 인정할 최소 되돌림(화면비)
  minRepRomRatio: 0.06,    // 렙으로 인정할 최소 수직 변위(화면비) — 손목 지터 컷
  minRepDurationSec: 0.2,  // 이보다 짧은 상승은 노이즈로 간주(무효)
  maxRepDurationSec: 15,   // 이보다 길면 렙이 아니라 정지/드리프트로 간주

  // ── 실시간 피크속도(평활 미분) ──
  peakWindow: 2,           // 중심차분 반창(±N 샘플). 2 ≈ 130ms@30fps
  peakMinSamples: 10,      // 컨센트릭 샘플 수 ≥ 이 값이면 산출('sg_ok')
  peakLowSamples: 6,       // 이 값 미만이면 산출 거부('insufficient_samples')

  // ── 유효 측정 게이트(정직성) ──
  minValidSamples: 8,      // 세트 전체 최소 샘플
  minValidRomRatio: 0.03,  // 세트 전체 최소 수직 변위

  // ── 속도저하(velocity loss) 해석 임계(%) — Pareja-Blanco 근거 ──
  velocityLossBands: { fresh: 10, strength: 20, hypertrophy: 30 },
};

const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

/** 비율/초 → m/s (cmPerRatio 스케일). 스케일 없으면 null. */
function ratioPerSecToMs(ratioPerSec, cmPerRatio) {
  if (!Number.isFinite(ratioPerSec) || !Number.isFinite(cmPerRatio) || cmPerRatio <= 0) return null;
  return ratioPerSec * cmPerRatio / 100;
}

/**
 * 컨센트릭(상승) 구간의 평활 피크속도(비율/초) — ±window 중심차분의 최댓값.
 * 실측 ms 타임스탬프 기준이라 VFR 에도 안전.
 * @returns {{ peakRatioPerSec:number|null, quality:'sg_ok'|'insufficient_samples', samples:number }}
 */
export function smoothedPeakRatioPerSec(points, {
  window = BARBELL_TUNING.peakWindow,
  minSamples = BARBELL_TUNING.peakMinSamples,
} = {}) {
  const pts = Array.isArray(points) ? points : [];
  const n = pts.length;
  if (n < minSamples || n < window * 2 + 1) {
    return { peakRatioPerSec: null, quality: 'insufficient_samples', samples: n };
  }
  let peak = 0;
  for (let i = window; i < n - window; i++) {
    const dy = Math.abs(pts[i + window].y - pts[i - window].y);
    const dt = (pts[i + window].ts - pts[i - window].ts) / 1000;
    if (dt <= 0) continue;
    const v = dy / dt;
    if (v > peak) peak = v;
  }
  return peak > 0
    ? { peakRatioPerSec: peak, quality: 'sg_ok', samples: n }
    : { peakRatioPerSec: null, quality: 'insufficient_samples', samples: n };
}

/**
 * 바벨 세트 실시간 누적기.
 *  사용: const acc = new BarbellAccumulator();
 *        매 프레임 acc.push({x,y}, tsMs);
 *        HUD:     acc.live(cmPerRatio)
 *        종료:    acc.finish(); acc.summary({ cmPerRatio, source })
 */
export class BarbellAccumulator {
  constructor(tuning = {}) {
    this.T = { ...BARBELL_TUNING, ...tuning };
    this.reset();
  }

  reset() {
    this.samples = [];        // { x, y, ts } — 평활 좌표(그리기 겸용)
    this.fx = new OneEuroFilter({ minCutoff: this.T.filterMinCutoff, beta: this.T.filterBeta });
    this.fy = new OneEuroFilter({ minCutoff: this.T.filterMinCutoff, beta: this.T.filterBeta });
    this.minY = Infinity; this.maxY = -Infinity;
    // 렙 상태기계.
    this.dir = 0;             // +1 하강(y 증가) | -1 상승 | 0 미정
    this.anchorIdx = 0;       // 직전 극점 인덱스
    this.extremeIdx = 0;      // 현재 진행 방향의 최대 도달 인덱스
    this.repsRaw = [];        // 확정 렙(비율 도메인)
    this._finished = false;
  }

  /** 화면에 그릴 평활 궤적. */
  path() { return this.samples; }
  sampleCount() { return this.samples.length; }

  push(point, tsMs) {
    if (!point || this._finished) return;
    const t = Number(tsMs);
    const px = Number(point.x), py = Number(point.y);
    if (!Number.isFinite(t) || !Number.isFinite(px) || !Number.isFinite(py)) return;
    const last = this.samples[this.samples.length - 1];
    if (last && t <= last.ts) return; // 시간 역행/중복 프레임 무시

    const sec = t / 1000;
    const x = this.fx.filter(px, sec);
    const y = this.fy.filter(py, sec);
    this.samples.push({ x, y, ts: t });
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
    this._step();
  }

  /** 렙 상태기계 1스텝 — 마지막 샘플 기준. */
  _step() {
    const S = this.samples;
    const i = S.length - 1;
    if (i < 1) { this.anchorIdx = 0; this.extremeIdx = 0; return; }
    const y = S[i].y;
    const { minTravelRatio } = this.T;

    if (this.dir === 0) {
      if (Math.abs(y - S[this.anchorIdx].y) >= minTravelRatio * 0.5) {
        this.dir = y > S[this.anchorIdx].y ? 1 : -1;
        this.extremeIdx = i;
      }
      return;
    }
    // 진행 방향으로 더 가면 극점 갱신 — eps 이상 실제로 전진했을 때만
    // (필터 잔여 수렴으로 정지 구간이 렙 시간에 섞이는 것을 방지).
    const eps = this.T.extremeEps;
    if (this.dir === 1 && y >= S[this.extremeIdx].y + eps) this.extremeIdx = i;
    if (this.dir === -1 && y <= S[this.extremeIdx].y - eps) this.extremeIdx = i;

    // 극점에서 반대로 minTravel 이상 되돌아오면 직전 진행 구간이 확정.
    const retrace = this.dir === 1 ? S[this.extremeIdx].y - y : y - S[this.extremeIdx].y;
    if (retrace >= minTravelRatio) {
      this._closeSegment();
      this.anchorIdx = this.extremeIdx;
      this.dir = -this.dir;
      this.extremeIdx = i;
    }
  }

  /** anchor→extreme 구간을 마감. 상승(y 감소) 구간이면 렙으로 확정. */
  _closeSegment() {
    const S = this.samples;
    const a = this.anchorIdx, b = this.extremeIdx;
    if (b <= a) return;
    const travel = Math.abs(S[b].y - S[a].y);
    if (travel < this.T.minRepRomRatio) return;
    const goingUp = S[b].y < S[a].y;
    if (!goingUp) return; // 하강(에센트릭) 구간은 렙으로 세지 않음
    const durationSec = (S[b].ts - S[a].ts) / 1000;
    if (durationSec < this.T.minRepDurationSec || durationSec > this.T.maxRepDurationSec) return;

    const pts = S.slice(a, b + 1);
    const peak = smoothedPeakRatioPerSec(pts, this.T);
    // 바 궤적 — 렙 시작 x 대비 수평 이탈, 경로 효율.
    const baseX = pts[0].x;
    let maxDrift = 0, pathLen = 0;
    for (let k = 0; k < pts.length; k++) {
      const d = Math.abs(pts[k].x - baseX);
      if (d > maxDrift) maxDrift = d;
      if (k > 0) pathLen += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
    }
    const efficiency = pathLen > 0 ? Math.min(1, travel / pathLen) : null;

    this.repsRaw.push({
      repNo: this.repsRaw.length + 1,
      startMs: Math.round(S[a].ts),
      endMs: Math.round(S[b].ts),
      durationSec: r2(durationSec),
      romRatio: r3(travel),
      meanRatioPerSec: travel / durationSec,
      peakRatioPerSec: peak.peakRatioPerSec,
      peakQuality: peak.quality,
      peakSamples: peak.samples,
      maxDriftRatio: r3(maxDrift),
      efficiency: r2(efficiency),
    });
  }

  /** 진행 중인 상승 구간이 렙 조건을 이미 충족했는지(실시간 표시용 +1). */
  _hasPendingUpRep() {
    const S = this.samples;
    if (this.dir !== -1 || !S.length) return false;
    const travel = Math.abs(S[this.extremeIdx].y - S[this.anchorIdx].y);
    return travel >= this.T.minRepRomRatio;
  }

  /**
   * 측정 종료 — 데이터가 반전 없이 끝났을 때 마지막 상승 구간을 렙으로 반영
   * (업로드/즉시 종료 대응, repCounter.countWithPending 과 동일 취지).
   */
  finish() {
    if (this._finished) return;
    if (this._hasPendingUpRep()) this._closeSegment();
    this._finished = true;
  }

  /**
   * 실시간 HUD 상태 — 매 프레임 호출해도 가벼움(확정 렙은 이미 계산돼 있음).
   * @param {number|null} cmPerRatio
   */
  live(cmPerRatio = null) {
    const reps = this.repsRaw.length + (this._hasPendingUpRep() ? 1 : 0);
    const last = this.repsRaw[this.repsRaw.length - 1] || null;
    const means = this.repsRaw.map(r => r.meanRatioPerSec);
    const best = means.length ? Math.max(...means) : null;
    const lastMean = last ? last.meanRatioPerSec : null;
    const romRatio = this.samples.length >= 2 ? this.maxY - this.minY : null;
    // 실시간 렙 스트립(HUD 카드)용 — 최근 10렙의 번호·평균속도·ROM·저하율.
    //  RSI 점프별 카드처럼 렙마다 기록이 남도록 카드에 필요한 값을 함께 제공.
    const repList = this.repsRaw.slice(-10).map(r => ({
      repNo: r.repNo,
      meanVelocity: r2(ratioPerSecToMs(r.meanRatioPerSec, cmPerRatio)),
      peakVelocity: r2(ratioPerSecToMs(r.peakRatioPerSec, cmPerRatio)),
      romCm: cmPerRatio && r.romRatio != null ? r1(r.romRatio * cmPerRatio) : null,
      // 그 렙의 최고속도 대비 저하율(%) — best 는 전체 최고 평균속도.
      lossPct: best && best > 0 && r.meanRatioPerSec != null
        ? r1(((best - r.meanRatioPerSec) / best) * 100)
        : null,
    }));
    return {
      reps,
      repList,
      phase: this.dir === 1 ? 'down' : this.dir === -1 ? 'up' : 'rest',
      romCm: cmPerRatio && romRatio != null ? r1(romRatio * cmPerRatio) : null,
      lastRepVelocity: r2(ratioPerSecToMs(lastMean, cmPerRatio)),
      bestRepVelocity: r2(ratioPerSecToMs(best, cmPerRatio)),
      velocityLossPct: best && lastMean != null && best > 0
        ? r1(((best - lastMean) / best) * 100)
        : null,
    };
  }

  /**
   * 세트 요약 — 저장/리포트용. finish() 후 호출 권장(자동 호출됨).
   * @param {{ cmPerRatio?:number|null, source?:string }} opts
   */
  summary({ cmPerRatio = null, source = 'live' } = {}) {
    this.finish();
    const S = this.samples;
    const T = this.T;
    const romRatio = S.length >= 2 ? this.maxY - this.minY : 0;
    const durationSec = S.length >= 2 ? (S[S.length - 1].ts - S[0].ts) / 1000 : 0;

    // ── 정직성 게이트 ──
    if (S.length < T.minValidSamples) {
      return { valid: false, reason: 'insufficient_samples', samples: S.length };
    }
    if (romRatio < T.minValidRomRatio) {
      return { valid: false, reason: 'rom_too_small', samples: S.length, romRatio: r3(romRatio) };
    }

    const canScale = Number.isFinite(cmPerRatio) && cmPerRatio > 0;
    const scaleCm = (ratio) => (canScale && ratio != null ? r1(ratio * cmPerRatio) : null);

    const reps = this.repsRaw.map((r) => {
      const peakOk = r.peakQuality === 'sg_ok' && r.peakRatioPerSec != null;
      return {
        repNo: r.repNo,
        startMs: r.startMs,
        endMs: r.endMs,
        durationSec: r.durationSec,
        romCm: scaleCm(r.romRatio),
        meanVelocity: r2(ratioPerSecToMs(r.meanRatioPerSec, canScale ? cmPerRatio : null)),
        peakVelocity: peakOk ? r2(ratioPerSecToMs(r.peakRatioPerSec, canScale ? cmPerRatio : null)) : null,
        peakReason: !canScale ? 'no_calibration' : peakOk ? 'sg_ok' : 'insufficient_samples',
        driftCm: scaleCm(r.maxDriftRatio),
        driftRatio: r.maxDriftRatio,
        efficiency: r.efficiency,
      };
    });

    const meanVels = reps.map(r => r.meanVelocity).filter(v => Number.isFinite(v) && v > 0);
    const best = meanVels.length ? Math.max(...meanVels) : null;
    const lastV = meanVels.length ? meanVels[meanVels.length - 1] : null;
    const avg = meanVels.length ? r2(meanVels.reduce((s, v) => s + v, 0) / meanVels.length) : null;
    const lossPct = best && lastV != null && best > 0 ? r1(((best - lastV) / best) * 100) : null;

    // 렙 일관성(CV%) — 평가 근거 수치.
    let cvPct = null;
    if (meanVels.length >= 2 && avg > 0) {
      const sd = Math.sqrt(meanVels.reduce((s, v) => s + (v - avg) ** 2, 0) / meanVels.length);
      cvPct = r1((sd / avg) * 100);
    }

    // 세트 대표 피크 — 렙 피크 중 최대. 렙이 없으면 전체 구간 평활 피크.
    let peakVelocity = null;
    let peakReason = !canScale ? 'no_calibration' : 'insufficient_samples';
    const repPeaks = reps.map(r => r.peakVelocity).filter(v => Number.isFinite(v) && v > 0);
    if (repPeaks.length) {
      peakVelocity = r2(Math.max(...repPeaks));
      peakReason = 'sg_ok';
    } else if (canScale) {
      const whole = smoothedPeakRatioPerSec(S, T);
      if (whole.quality === 'sg_ok') {
        peakVelocity = r2(ratioPerSecToMs(whole.peakRatioPerSec, cmPerRatio));
        peakReason = 'sg_ok';
      }
    }

    // 바 궤적 요약.
    const driftsCm = reps.map(r => r.driftCm).filter(v => Number.isFinite(v));
    const effs = reps.map(r => r.efficiency).filter(v => Number.isFinite(v));
    const barPath = {
      maxDriftCm: driftsCm.length ? r1(Math.max(...driftsCm)) : null,
      avgEfficiency: effs.length ? r2(effs.reduce((s, v) => s + v, 0) / effs.length) : null,
    };

    // 세트 평균속도 — 렙 평균들의 평균. 렙이 없으면 전체 변위÷시간(구버전 호환).
    const overallMean = canScale && durationSec > 0
      ? r2((romRatio * cmPerRatio) / 100 / durationSec)
      : null;

    return {
      valid: true,
      source,
      samples: S.length,
      durationSec: r2(durationSec),
      durationMs: Math.round(durationSec * 1000),
      romRatio: r3(romRatio),
      romCm: scaleCm(romRatio),
      isCalibrated: canScale,
      meanVelocity: avg ?? overallMean,
      peakVelocity,
      peakReason,
      repCount: reps.length,
      reps,
      consistencyCvPct: cvPct,
      barPath,
      // 기존 repVelocity 계약(허브/프로필/공유) 호환 형태.
      repVelocityCompat: {
        reps,
        summary: {
          repCount: reps.length,
          bestMeanVelocity: best != null ? r2(best) : null,
          lastMeanVelocity: lastV != null ? r2(lastV) : null,
          averageMeanVelocity: avg,
          velocityLossPct: lossPct,
        },
      },
      velocityLossPct: lossPct,
    };
  }
}

// ───────── 속도 기반 1RM 실시간 추정 (근거기반) ─────────
//  평균 컨센트릭 속도 ↔ %1RM 관계는 종목별로 안정적(개인차 작음)이라는
//  연구에 기반한 앵커 테이블. 선형 보간으로 %1RM → e1RM = 무게 ÷ %.
//   · bench: González-Badillo & Sánchez-Medina (2010)
//   · squat: Sánchez-Medina et al. (2017) 풀스쿼트
//   · deadlift: 연구 간 편차가 커 근사치(신뢰도 low 로 표기 — 정직성)
export const VELOCITY_PCT_TABLES = Object.freeze({
  squat: [
    [0.32, 100], [0.39, 95], [0.45, 90], [0.52, 85], [0.60, 80],
    [0.68, 75], [0.76, 70], [0.85, 65], [0.94, 60], [1.04, 55], [1.13, 50],
  ],
  bench_press: [
    [0.17, 100], [0.23, 95], [0.30, 90], [0.36, 85], [0.42, 80],
    [0.49, 75], [0.55, 70], [0.61, 65], [0.68, 60], [0.74, 55], [0.80, 50],
  ],
  deadlift: [
    [0.15, 100], [0.24, 95], [0.32, 90], [0.40, 85], [0.48, 80],
    [0.56, 75], [0.64, 70], [0.72, 65], [0.80, 60],
  ],
});

const VELOCITY_TABLE_CONFIDENCE = { squat: 'medium', bench_press: 'medium', deadlift: 'low' };

/** 평균속도 → %1RM (선형 보간). 테이블 범위 밖이면 null. */
export function velocityToPct1Rm(exerciseType, meanVelocity) {
  const table = VELOCITY_PCT_TABLES[exerciseType];
  const v = Number(meanVelocity);
  if (!table || !Number.isFinite(v) || v <= 0) return null;
  const vMin = table[0][0], vMax = table[table.length - 1][0];
  if (v < vMin || v > vMax) return null; // 범위 밖 외삽 금지(정직성)
  for (let i = 1; i < table.length; i++) {
    const [v0, p0] = table[i - 1];
    const [v1, p1] = table[i];
    if (v <= v1) {
      const t = (v - v0) / (v1 - v0);
      return r1(p0 + (p1 - p0) * t);
    }
  }
  return null;
}

/**
 * 속도 기반 1RM 실시간 추정.
 * @returns {{ oneRm:number|null, pctOfMax:number|null, confidence:'medium'|'low'|null, reason:string }}
 */
export function estimateOneRmFromMeanVelocity({ exerciseType, loadKg, meanVelocity } = {}) {
  const load = Number(loadKg);
  if (!VELOCITY_PCT_TABLES[exerciseType]) {
    return { oneRm: null, pctOfMax: null, confidence: null, reason: 'unsupported_exercise' };
  }
  if (!Number.isFinite(load) || load <= 0) {
    return { oneRm: null, pctOfMax: null, confidence: null, reason: 'no_load' };
  }
  const pct = velocityToPct1Rm(exerciseType, meanVelocity);
  if (pct == null) {
    return { oneRm: null, pctOfMax: null, confidence: null, reason: 'velocity_out_of_range' };
  }
  return {
    oneRm: r1(load / (pct / 100)),
    pctOfMax: pct,
    confidence: VELOCITY_TABLE_CONFIDENCE[exerciseType] || 'low',
    reason: 'ok',
  };
}
