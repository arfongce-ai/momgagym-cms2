// ai-measure/core/seniorTests.js
// ════════════════════════════════════════════════════════════════════════
//  [시니어 기능 테스트 2026-11-24] 30초 의자 일어서기 · 5회 의자 일어서기 · TUG(일어나 걷기).
//  · 측정자가 횟수/초를 직접 입력하는 도구형(카메라 자동 카운트 아님). 값은 그대로 저장하고
//    이상·무효 값도 저장을 막지 않는다(무효는 status 'unknown' + 사유로 남긴다).
//  · 규준은 등록정보의 나이·성별로 고른다. 기준표에 없는 나이는 판정하지 않는다(unknown).
//  · 상태는 normal / caution / unknown 만 쓴다. 자동 'risk' 판정은 하지 않는다(트레이너 확인 필수).
//  출처
//   · 30초 의자 일어서기: CDC STEADI "30-Second Chair Stand" 평균 미만 기준(60~94세, 남/여).
//   · TUG: CDC STEADI — 12초 이상이면 낙상 위험 신호.
//   · 5회 의자 일어서기: Bohannon 2006 메타분석 평균 초과(느림) 기준 60~89세.
// ════════════════════════════════════════════════════════════════════════
import { normalizeSex } from './cardioTest';

export const SENIOR_KIND = 'senior_test';

export const SENIOR_TESTS = {
  chair30: {
    id: 'chair30',
    label: '30초 의자 일어서기',
    short: '30초 일어서기',
    unit: '회',
    higherBetter: true,
    durationSec: 30,
    what: '30초 동안 의자에서 몇 번 일어섰다 앉는지로 다리 힘과 일상 기능을 봅니다.',
    how: [
      '높이 약 43cm(17인치) 등받이 의자를 벽에 붙이고 팔은 가슴 앞에 X자로 모읍니다.',
      '"시작"에서 끝까지 일어섰다 앉기를 30초 동안 되도록 많이 반복합니다.',
      '측정자는 완전히 일어선 횟수마다 횟수 버튼을 누릅니다. 30초 때 반 이상 일어난 상태면 1회로 셉니다.',
      '첫 1회에 팔을 쓰면 0회로 기록하고 종료합니다(팔 사용 체크).',
    ],
    read: '같은 나이·성별 평균보다 적으면 다리 힘이 약하고 낙상 위험이 커질 수 있다는 참고 신호입니다.',
    care: '어지럼·가슴 통증·숨참이 있으면 즉시 중단합니다. 의자가 밀리지 않게 고정하고 곁에서 지켜봅니다.',
  },
  sts5: {
    id: 'sts5',
    label: '5회 의자 일어서기',
    short: '5회 일어서기',
    unit: '초',
    higherBetter: false,
    reps: 5,
    what: '의자에서 5번 일어났다 앉는 데 걸리는 시간으로 다리 힘을 봅니다(짧을수록 좋음).',
    how: [
      '등받이 의자에 앉아 팔을 가슴 앞에 모읍니다.',
      '"시작"에서 최대한 빠르게 5번 일어섰다 앉습니다.',
      '5번째로 완전히 일어선 순간 초시계를 멈춥니다.',
      '팔을 쓰거나 5회를 못 채우면 무효로 기록합니다.',
    ],
    read: '같은 나이대 평균보다 오래 걸리면 다리 힘이 약한 신호입니다.',
    care: '어지럼·통증이 있으면 즉시 중단합니다. 측정자가 곁에서 지켜봅니다.',
  },
  tug: {
    id: 'tug',
    label: 'TUG (일어나 걷기)',
    short: 'TUG',
    unit: '초',
    higherBetter: false,
    distanceM: 3,
    what: '의자에서 일어나 3m를 걸어갔다 돌아와 앉는 시간으로 균형·걷기 기능과 낙상 위험을 봅니다(짧을수록 좋음).',
    how: [
      '평소 신는 신발, 보조도구(지팡이 등)를 쓰면 쓰던 대로 준비합니다. 3m 지점에 선을 표시합니다.',
      '"시작"에서 일어나 평소 속도로 3m 선까지 걷고, 돌아서 와서 앉습니다.',
      '등이 의자에 닿는 순간 초시계를 멈춥니다.',
      '측정자는 넘어지지 않게 바로 옆에서 대기합니다(잡아주기 위한 대기).',
    ],
    read: '12초 이상 걸리면 낙상 위험이 높다는 신호로 봅니다.',
    care: '바닥이 미끄럽지 않은지 확인하고, 측정자가 곁에서 대기합니다.',
  },
};

export const SENIOR_TEST_ORDER = ['chair30', 'sts5', 'tug'];

// ── 규준 ─────────────────────────────────────────────────────────────
// CDC STEADI 30초 의자 일어서기: 이 값 "미만"이면 평균 미만(남, 여).
const CHAIR30_BELOW = [
  { from: 60, to: 64, male: 14, female: 12 },
  { from: 65, to: 69, male: 12, female: 11 },
  { from: 70, to: 74, male: 12, female: 10 },
  { from: 75, to: 79, male: 11, female: 10 },
  { from: 80, to: 84, male: 10, female: 9 },
  { from: 85, to: 89, male: 8, female: 8 },
  { from: 90, to: 94, male: 7, female: 4 },
];

// Bohannon 2006: 이 값 "초과"면 평균보다 느림(성별 구분 없음).
const STS5_SLOW = [
  { from: 60, to: 69, over: 11.4 },
  { from: 70, to: 79, over: 12.6 },
  { from: 80, to: 89, over: 14.8 },
];

export const TUG_RISK_SEC = 12;
export const STS5_COMMON_CUTOFF_SEC = 15; // Buatois 2008 — 나이 구분 없는 참고 기준

export function chair30Cutoff(age, sex) {
  const a = Number(age);
  const s = normalizeSex(sex);
  if (!Number.isFinite(a) || !s) return null;
  const row = CHAIR30_BELOW.find((r) => a >= r.from && a <= r.to);
  return row ? { below: row[s], band: `${row.from}~${row.to}세`, sex: s } : null;
}

export function sts5Cutoff(age) {
  const a = Number(age);
  if (!Number.isFinite(a)) return null;
  const row = STS5_SLOW.find((r) => a >= r.from && a <= r.to);
  return row ? { over: row.over, band: `${row.from}~${row.to}세` } : null;
}

// ── 측정 전 안전 확인 ────────────────────────────────────────────────
// 혈압 기준(출처 확인 2026-11-25)
//  · 보류: 안정시 수축기 > 200 또는 이완기 > 110 mmHg — ACSM 운동검사 안전 기준(상대적 금기, ACC/AHA 운동부하검사 지침과 동일).
//    "초과"다(200·110 정확히는 보류 아님). 상대적 금기라 의사 확인 후 이득이 크면 진행할 수 있다는 뜻이다.
//  · 알림: 수축기 ≥ 180 또는 이완기 ≥ 120 mmHg — Mayo Clinic·MSD 매뉴얼의 '고혈압 위기' 수치.
//    보류 기준 미만이어도 안내를 띄운다(진행은 트레이너 판단, 의사 상담 권고).
//  통증·어지럼은 센터 운영 안전 확인이며 공인 수치 기준이 아니다.
export const BP_HOLD = { systolicOver: 200, diastolicOver: 110 };
export const BP_NOTICE = { systolicAtLeast: 180, diastolicAtLeast: 120 };

export function seniorPrecheck({ systolic = null, diastolic = null, painNow = false, dizzy = false } = {}) {
  const sys = Number(systolic);
  const dia = Number(diastolic);
  const hasSys = systolic !== '' && systolic != null && Number.isFinite(sys);
  const hasDia = diastolic !== '' && diastolic != null && Number.isFinite(dia);
  const reasons = [];
  if (hasSys && sys > BP_HOLD.systolicOver) reasons.push(`안정시 수축기 혈압 ${sys}(200 초과)`);
  if (hasDia && dia > BP_HOLD.diastolicOver) reasons.push(`안정시 이완기 혈압 ${dia}(110 초과)`);
  if (painNow) reasons.push('지금 통증이 있음');
  if (dizzy) reasons.push('어지럼이 있음');
  if (reasons.length) {
    return { ok: false, level: 'hold', reasons, message: `측정 보류 권장: ${reasons.join(', ')}. 트레이너가 확인한 뒤 진행하세요(혈압은 ACSM 운동검사 기준 — 의사 확인 권장).` };
  }
  const high = (hasSys && sys >= BP_NOTICE.systolicAtLeast) || (hasDia && dia >= BP_NOTICE.diastolicAtLeast);
  if (high) {
    return { ok: true, level: 'notice', reasons: [], message: `혈압이 높은 편입니다(${hasSys ? sys : '-'}/${hasDia ? dia : '-'}). 180/120 이상은 고혈압 위기 수치라 의사 상담을 권하며, 진행은 트레이너가 판단하세요.` };
  }
  return { ok: true, level: 'ok', reasons: [], message: '' };
}

// ── 평가 ─────────────────────────────────────────────────────────────
const num = (v) => (v === '' || v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

/**
 * evaluateSeniorTest(testId, value, { age, sex, armsUsed, completed })
 * → { status, label, valid, reason, reference, easy }
 *  · 무효/기준표 밖이어도 값은 그대로 저장되고 status 'unknown' + reason 으로 남는다.
 */
export function evaluateSeniorTest(testId, value, { age = null, sex = null, armsUsed = false, completed = true } = {}) {
  const meta = SENIOR_TESTS[testId];
  if (!meta) return { status: 'unknown', label: '확인 필요', valid: false, reason: '알 수 없는 테스트', reference: null, easy: '' };
  const v = num(value);

  if (testId === 'chair30') {
    if (armsUsed) {
      return { status: 'unknown', label: '무효(팔 사용)', valid: false, reason: '첫 동작에 팔을 써서 0회로 기록', reference: null,
        easy: '팔을 짚고 일어나서 0회로 기록했어요. 팔 없이 다시 해볼 수 있는지 트레이너가 확인합니다.' };
    }
    if (v == null || v < 0) return { status: 'unknown', label: '값 없음', valid: false, reason: '횟수 없음', reference: null, easy: '' };
    const ref = chair30Cutoff(age, sex);
    if (!ref) return { status: 'unknown', label: '기준 없음', valid: true, reason: '나이(60~94세)·성별 기준표 밖이라 판정하지 않음', reference: null,
      easy: `30초 동안 ${v}번 일어났어요. 나이·성별 기준표가 없어 같은 분의 다음 기록과 비교해요.` };
    const ok = v >= ref.below;
    return {
      status: ok ? 'normal' : 'caution',
      label: ok ? '평균 이상' : '평균 미만',
      valid: true, reason: '',
      reference: { text: `${ref.band} ${ref.sex === 'male' ? '남' : '여'} ${ref.below}회 미만이면 평균 미만`, cutoff: ref.below, source: 'CDC STEADI' },
      easy: ok ? `30초 동안 ${v}번 일어났어요. 또래 평균(${ref.below}회) 이상이라 다리 힘이 괜찮은 편이에요.`
        : `30초 동안 ${v}번 일어났어요. 또래 평균(${ref.below}회)보다 적어서 다리 힘을 키우면 좋아요.`,
    };
  }

  if (testId === 'sts5') {
    if (armsUsed || completed === false) {
      return { status: 'unknown', label: '무효', valid: false, reason: armsUsed ? '팔을 써서 무효' : '5회를 채우지 못함', reference: null,
        easy: '5번을 끝까지 못 하셨거나 팔을 써서 기록으로 쓰지 않았어요.' };
    }
    if (v == null || v <= 0) return { status: 'unknown', label: '값 없음', valid: false, reason: '시간 없음', reference: null, easy: '' };
    const ref = sts5Cutoff(age);
    if (!ref) return { status: 'unknown', label: '기준 없음', valid: true, reason: '나이(60~89세) 기준표 밖이라 판정하지 않음', reference: null,
      easy: `5번 일어서는 데 ${v}초 걸렸어요. 기준표가 없어 같은 분의 다음 기록과 비교해요.` };
    const slow = v > ref.over;
    return {
      status: slow ? 'caution' : 'normal',
      label: slow ? '평균보다 느림' : '평균 이내',
      valid: true, reason: '',
      reference: { text: `${ref.band} ${ref.over}초 초과면 평균보다 느림 (참고: 15초 이상은 나이 무관 기준)`, cutoff: ref.over, source: 'Bohannon 2006' },
      easy: slow ? `5번 일어서는 데 ${v}초 걸렸어요. 또래 평균(${ref.over}초)보다 조금 느려서 다리 힘을 키우면 좋아요.`
        : `5번 일어서는 데 ${v}초 걸렸어요. 또래 평균 범위 안이라 괜찮은 편이에요.`,
    };
  }

  // tug
  if (completed === false) {
    return { status: 'unknown', label: '무효', valid: false, reason: '끝까지 완료하지 못함', reference: null, easy: '끝까지 걷지 못해 기록으로 쓰지 않았어요.' };
  }
  if (v == null || v <= 0) return { status: 'unknown', label: '값 없음', valid: false, reason: '시간 없음', reference: null, easy: '' };
  const slow = v >= TUG_RISK_SEC;
  return {
    status: slow ? 'caution' : 'normal',
    label: slow ? '12초 이상(주의)' : '12초 미만',
    valid: true, reason: '',
    reference: { text: `${TUG_RISK_SEC}초 이상이면 낙상 위험 신호`, cutoff: TUG_RISK_SEC, source: 'CDC STEADI' },
    easy: slow ? `일어나 3m 걷고 돌아와 앉는 데 ${v}초 걸렸어요. 12초 이상이라 넘어지지 않게 균형·다리 힘 운동이 도움이 돼요.`
      : `일어나 3m 걷고 돌아와 앉는 데 ${v}초 걸렸어요. 12초보다 빨라서 괜찮은 편이에요.`,
  };
}

// ── 저장 레코드 ──────────────────────────────────────────────────────
// 필드 이름은 inferReportType 에 걸리지 않게 고른다(heightCm·mode·type·summary·analysis 금지).
export function buildSeniorRecord({
  testId, value, subject = {}, armsUsed = false, completed = true,
  startedAt = null, endedAt = null, hr = null, trainerNote = '', precheck = null, repLog = [], metronomeBpm = null, auto = null,
} = {}) {
  const meta = SENIOR_TESTS[testId];
  const evalResult = evaluateSeniorTest(testId, value, { age: subject.age, sex: subject.sex, armsUsed, completed });
  return {
    kind: SENIOR_KIND,
    testId,
    testLabel: meta?.label || testId,
    value: num(value),
    unit: meta?.unit || '',
    armsUsed: Boolean(armsUsed),
    completed: completed !== false,
    status: evalResult.status,
    statusLabel: evalResult.label,
    valid: evalResult.valid,
    invalidReason: evalResult.reason || '',
    reference: evalResult.reference,
    easySummary: evalResult.easy,
    subject: {
      age: num(subject.age), sex: normalizeSex(subject.sex) || null,
      weightKg: num(subject.weightKg), heightCm: num(subject.heightCm),
      systolic: num(subject.systolic), diastolic: num(subject.diastolic),
    },
    precheck: precheck || null,
    hr: hr || null,
    repLog: Array.isArray(repLog) ? repLog.slice(0, 60) : [],
    metronomeBpm: num(metronomeBpm),
    auto: auto && auto.used ? { used: true, autoValue: num(auto.autoValue), autoCount: num(auto.autoCount), walked: num(auto.walked), offset: num(auto.offset) || 0 } : null,
    trainerNote: String(trainerNote || '').slice(0, 500),
    startedAt, endedAt,
  };
}

// 측정 이력 카드 요약 칩(값만)
export function seniorHistoryMetrics(payload = {}) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const out = [];
  if (Number.isFinite(p.value)) out.push({ key: 'value', label: p.testLabel || '기록', displayValue: String(p.value), unit: p.unit || '', value: p.value });
  if (p.statusLabel) out.push({ key: 'status', label: '판정', displayValue: p.statusLabel, unit: '', value: null });
  if (Number.isFinite(p.hr?.avgBpm)) out.push({ key: 'avgHr', label: '평균 심박', displayValue: String(p.hr.avgBpm), unit: 'bpm', value: p.hr.avgBpm });
  if (Number.isFinite(p.hr?.maxBpm)) out.push({ key: 'maxHr', label: '최고 심박', displayValue: String(p.hr.maxBpm), unit: 'bpm', value: p.hr.maxBpm });
  return out;
}

// 같은 테스트끼리만 묶는다(종합분석·추이용).
export function seniorGroupKey(p = {}) {
  return String(p?.testId || '');
}

// 직전(같은 테스트) 대비 변화. 무효 기록은 비교에서 뺀다.
export function seniorChange(current, previous) {
  if (!current || !previous || current.testId !== previous.testId) return null;
  if (!Number.isFinite(current.value) || !Number.isFinite(previous.value) || current.valid === false || previous.valid === false) return null;
  const meta = SENIOR_TESTS[current.testId];
  const diff = Math.round((current.value - previous.value) * 10) / 10;
  const improved = meta?.higherBetter ? diff > 0 : diff < 0;
  const direction = diff === 0 ? 'same' : improved ? 'improved' : 'worsened';
  return { diff, direction, unit: meta?.unit || '', previousValue: previous.value };
}
