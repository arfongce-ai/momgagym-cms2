// ai-measure/core/sprintAgility.js
// 스프린트(5m/10m) · 아질리티(5-0-5) 측정 핵심 로직.
//
// 원리: 카메라 화면 위 골반(Hip, 23·24) 중심 좌표를 프레임 단위로 추적하고,
// 바닥에 표시해둔 두 기준점(예: 0m·5m 지점)을 화면에서 터치로 지정해
// "화면 위 거리 : 실제 거리(m)" 스케일을 구한 뒤, 그 축 위로 골반 좌표를
// 사영(projection)해 실제 이동거리(m)로 환산한다.
//
// 재사용:
//  - calibration.js의 buildReferenceScale() — 역도 측정에서 "기준 물체
//    길이로 화면 스케일 구하기"와 완전히 같은 원리라 그대로 가져다 쓴다.
//  - gaitBiomechanics.js의 OneEuroFilter — 보행측정과 동일한 평활 필터.
//  - geometry.js의 LM 랜드마크 인덱스 상수.
//
// 실시간 모드(SprintLiveAnalysis.jsx)·업로드 모드(SprintUploadAnalysis.jsx)가
// 이 모듈 하나를 공유한다 — GaitRunningAnalysis.jsx / GaitUploadAnalysis.jsx가
// gaitBiomechanics.js를 공유하는 것과 동일한 구조.

import { LM } from './geometry';
import { OneEuroFilter } from './gaitBiomechanics';
import { buildReferenceScale } from './calibration';

// ───────── 현장 튜닝 설정 (한 곳에 모음) ─────────
export const SPRINT_TUNING = {
  minVisibility: 0.2,      // 골반 랜드마크 가시성 하한
  filterMinCutoff: 1.2,    // 1-Euro 평활 강도
  filterBeta: 0.03,        // 1-Euro 반응성(빠른 가속 구간 추종)
  stopVelocityMs: 0.3,     // 이하이면 '정지'로 판정(감속·제동력 계산용)
  turnVelocityThresholdMs: 0.25, // 아질리티 방향전환(턴) 판정 임계 속도
  moveDetectMinDeltaM: 0.03,     // 스타트 반응속도: '움직였다'로 볼 최소 이동량(m)
};

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;

/**
 * 화면 두 기준점(0m·5m 등) 사이의 정규화 좌표 거리(스칼라, 부호 없음).
 * calibration.js의 pointDistanceRatio()와 동일한 계산이라 여기선 축 위
 * 사영(projection)까지 함께 만드는 buildAxisProjector에서 자체 계산한다.
 */
function buildAxisProjector(pointA, pointB) {
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len; // 축 방향 단위벡터
  return (p) => {
    if (!p) return null;
    const vx = p.x - pointA.x, vy = p.y - pointA.y;
    return vx * ux + vy * uy; // A점=0, B점=len(=축 위 스칼라, 부호 있음)
  };
}

/**
 * 트랙 캘리브레이션: 화면 터치 2점 + 실제 거리(m) → 실시간 거리 환산기.
 * @param {{x:number,y:number}} pointA 화면 터치 1점 (0m 지점, 보통 출발선)
 * @param {{x:number,y:number}} pointB 화면 터치 2점 (예: 5m 지점)
 * @param {number} knownDistanceM 두 점 사이 실제 거리(m)
 * @returns {{isCalibrated:boolean, knownDistanceM:number, project:(p)=>number|null}|null}
 *   project(p)는 골반 좌표를 넣으면 A점 기준 부호 있는 실제거리(m)를 반환한다.
 *   (전진 방향이 +, 아질리티에서 되돌아오면 자연히 값이 다시 줄어든다)
 */
export function calibrateTrack(pointA, pointB, knownDistanceM) {
  // buildReferenceScale은 calibration.js의 기존 함수를 그대로 재사용 —
  // "화면 위 두 점 거리 : 실제 길이(cm)" 스케일(cmPerRatio)을 구해준다.
  const scale = buildReferenceScale([pointA, pointB], Number(knownDistanceM) * 100);
  if (!scale) return null;

  const project = buildAxisProjector(pointA, pointB);
  const mPerRatio = scale.cmPerRatio / 100; // cm → m

  return {
    isCalibrated: true,
    knownDistanceM: Number(knownDistanceM),
    project: (p) => {
      const ratio = project(p);
      return ratio == null ? null : ratio * mPerRatio;
    },
  };
}

/** 골반(Hip) 중심 좌표 — 보행측정의 pelvisRelativeFeet와 동일하게 23·24 평균. */
export function hipCenter(lm) {
  const v = SPRINT_TUNING.minVisibility;
  if (!lm || !lm[LM.LEFT_HIP] || !lm[LM.RIGHT_HIP]) return null;
  const l = lm[LM.LEFT_HIP], r = lm[LM.RIGHT_HIP];
  if ((l.visibility ?? 1) < v || (r.visibility ?? 1) < v) return null;
  return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
}

/**
 * 스프린트/아질리티 실시간 트래커.
 * 매 프레임 push(lm, tsMs) 호출 → 위치·속도·구간기록(split)·턴·반응속도를 누적.
 * finalize()로 최종 리포트를 산출한다 (실시간·업로드 모드 공용).
 */
export class SprintTracker {
  /**
   * @param {object} opt
   * @param {{project:Function}} opt.calibration  calibrateTrack()의 반환값
   * @param {number[]} opt.splitDistancesM  구간기록을 찍을 거리(m) 목록. 기본 [5, 10]
   * @param {'sprint'|'agility'} opt.mode
   */
  constructor({ calibration, splitDistancesM = [5, 10], mode = 'sprint', tuning = {} } = {}) {
    this.tuning = { ...SPRINT_TUNING, ...tuning };
    this.calibration = calibration;
    this.splitDistancesM = splitDistancesM;
    this.mode = mode;

    this.filter = new OneEuroFilter({ minCutoff: this.tuning.filterMinCutoff, beta: this.tuning.filterBeta });

    this.startTimeMs = null;
    this.lastTimeMs = null;
    this.lastDistanceM = null;

    this.samples = [];        // { tMs, distanceM, velocityMs } — 가속 구간 그래프용 원자료
    this.splits = {};         // { 5: elapsedMs, 10: elapsedMs, ... }
    this.peakVelocityMs = 0;
    this.peakVelocityAtM = null;

    this.turns = [];          // 아질리티 방향전환 지점들 [{ atDistanceM, tMs }]
    this._movingSign = 0;     // 1 전진 / -1 후진 / 0 정지

    // 스타트 반응속도(오디오 신호 이후 첫 움직임까지)
    this.cueAtMs = null;
    this.reactionTimeMs = null;
    this._reactionLatched = false;
  }

  /** 출발 신호(audioCue.js의 beepGo() 재생) 시각 기록 — 반응속도 측정용. */
  markCue(tsMs) {
    this.cueAtMs = tsMs;
    this.reactionTimeMs = null;
    this._reactionLatched = false;
  }

  /**
   * 프레임 1개 처리.
   * @param {Array} lm  MediaPipe pose landmarks (한 프레임)
   * @param {number} tsMs  프레임 타임스탬프(ms) — 실시간모드는 performance.now(),
   *   업로드모드는 video.currentTime*1000
   * @returns {{elapsedMs:number, distanceM:number, velocityMs:number}|null}
   */
  push(lm, tsMs) {
    const hip = hipCenter(lm);
    if (!hip || !this.calibration) return null;

    const rawDistanceM = this.calibration.project(hip);
    if (rawDistanceM == null) return null;
    const distanceM = this.filter.filter(rawDistanceM, tsMs / 1000);

    if (this.startTimeMs == null) this.startTimeMs = tsMs;
    const elapsedMs = tsMs - this.startTimeMs;

    // ── 스타트 반응속도 ──
    if (this.cueAtMs != null && !this._reactionLatched && tsMs >= this.cueAtMs && this.lastDistanceM != null) {
      if (Math.abs(distanceM - this.lastDistanceM) > this.tuning.moveDetectMinDeltaM) {
        this.reactionTimeMs = Math.max(0, tsMs - this.cueAtMs);
        this._reactionLatched = true;
      }
    }

    // ── 순간 속도 ──
    let velocityMs = 0;
    if (this.lastTimeMs != null && this.lastDistanceM != null) {
      const dt = (tsMs - this.lastTimeMs) / 1000;
      if (dt > 0) velocityMs = (distanceM - this.lastDistanceM) / dt;
    }

    // ── 최고속도 ──
    if (Math.abs(velocityMs) > this.peakVelocityMs) {
      this.peakVelocityMs = Math.abs(velocityMs);
      this.peakVelocityAtM = r2(distanceM);
    }

    // ── 구간기록(split) ──
    for (const d of this.splitDistancesM) {
      if (this.splits[d] == null && distanceM >= d) {
        this.splits[d] = elapsedMs;
      }
    }

    // ── 아질리티 방향전환(턴) 감지 ──
    const sign = velocityMs > this.tuning.turnVelocityThresholdMs ? 1
               : velocityMs < -this.tuning.turnVelocityThresholdMs ? -1 : 0;
    if (sign !== 0 && this._movingSign !== 0 && sign !== this._movingSign) {
      this.turns.push({ atDistanceM: r2(distanceM), tMs: Math.round(elapsedMs) });
    }
    if (sign !== 0) this._movingSign = sign;

    this.samples.push({ tMs: Math.round(elapsedMs), distanceM: r3(distanceM), velocityMs: r2(velocityMs) });
    this.lastTimeMs = tsMs;
    this.lastDistanceM = distanceM;

    return { elapsedMs: Math.round(elapsedMs), distanceM: r3(distanceM), velocityMs: r2(velocityMs) };
  }

  /** 최고속도 도달 후 완전정지까지 감속 구간 — 무릎 제동력 평가용. */
  _decelerationSummary() {
    if (!this.samples.length || this.peakVelocityMs <= 0) return null;
    const peakIdx = this.samples.findIndex((s) => Math.abs(s.velocityMs) >= this.peakVelocityMs - 0.02);
    if (peakIdx < 0) return null;
    const stopIdx = this.samples.findIndex(
      (s, i) => i > peakIdx && Math.abs(s.velocityMs) < this.tuning.stopVelocityMs
    );
    if (stopIdx < 0) return null;
    const peak = this.samples[peakIdx], stop = this.samples[stopIdx];
    return {
      decelDistanceM: r2(Math.abs(stop.distanceM - peak.distanceM)),
      decelTimeMs: stop.tMs - peak.tMs,
    };
  }

  /** 측정 종료 후 최종 리포트. crossMeasureContext.js 연동은 다음 단계에서 확인 후 연결. */
  finalize() {
    const splitsOut = {};
    for (const [d, tMs] of Object.entries(this.splits)) splitsOut[`${d}m`] = Math.round(tMs);

    const last = this.samples[this.samples.length - 1];
    const totalTimeMs = last ? last.tMs : 0;
    const totalDistanceM = this.lastDistanceM != null ? r2(this.lastDistanceM) : 0;
    const avgVelocityMs = totalTimeMs > 0 ? r2(totalDistanceM / (totalTimeMs / 1000)) : 0;

    return {
      kind: this.mode === 'agility' ? 'agility' : 'sprint',
      totalTimeMs,
      totalDistanceM,
      avgVelocityMs,
      peakVelocityMs: r2(this.peakVelocityMs),
      peakVelocityAtM: this.peakVelocityAtM,
      splits: splitsOut,
      turnCount: this.turns.length,
      turns: this.turns,
      reactionTimeMs: this.reactionTimeMs != null ? Math.round(this.reactionTimeMs) : null,
      deceleration: this._decelerationSummary(),
      samples: this.samples, // 가속 구간 그래프(속도 vs 시간)에 그대로 사용
    };
  }
}
