// ai-measure/core/intervalTimer.js
// 인터벌 타이머(HIIT/타바타)의 "다음 구간 결정" 순수 로직.
// UI(타이머 표시/비프음)와 분리해 단위 테스트와 재사용이 가능하게 한다.
//
// 구간(phase): 'idle' | 'prepare' | 'work' | 'rest' | 'done'
//  · prepare : 시작 전 카운트다운(prepSec). 0이면 건너뜀.
//  · work    : 운동 구간(workSec).
//  · rest    : 휴식 구간(restSec). 0이면 건너뛰고 바로 다음 라운드.
//  · done    : 모든 라운드 종료.

/**
 * 현재 구간이 끝났을 때 다음 구간을 계산한다.
 * @param {object} cfg  { workSec, restSec, rounds, prepSec }
 * @param {object} cur  { phase, round }
 * @returns {{ phase: string, round: number }} 다음 구간
 */
export function nextPhase(cfg, cur) {
  const { restSec = 0, rounds = 1 } = cfg || {};
  const phase = cur?.phase ?? 'idle';
  const round = cur?.round ?? 1;

  if (phase === 'prepare') return { phase: 'work', round: 1 };

  if (phase === 'work') {
    if (restSec > 0) return { phase: 'rest', round };
    // 휴식이 없으면 바로 다음 라운드(또는 종료)
    if (round >= rounds) return { phase: 'done', round };
    return { phase: 'work', round: round + 1 };
  }

  if (phase === 'rest') {
    if (round >= rounds) return { phase: 'done', round };
    return { phase: 'work', round: round + 1 };
  }

  return { phase: 'done', round };
}

/** 시작 시 첫 구간 (준비 구간이 있으면 prepare, 없으면 work). */
export function firstPhase(cfg) {
  const prepSec = cfg?.prepSec ?? 0;
  return prepSec > 0 ? { phase: 'prepare', round: 1 } : { phase: 'work', round: 1 };
}

/** 구간 길이(초). idle/done 은 0. */
export function phaseDurationSec(cfg, phase) {
  if (phase === 'prepare') return cfg?.prepSec ?? 0;
  if (phase === 'work') return cfg?.workSec ?? 0;
  if (phase === 'rest') return cfg?.restSec ?? 0;
  return 0;
}

/** 전체 소요 시간(초): 준비 + (운동+휴식)×라운드. */
export function totalDurationSec(cfg) {
  const { workSec = 0, restSec = 0, rounds = 1, prepSec = 0 } = cfg || {};
  return prepSec + (workSec + restSec) * rounds;
}
