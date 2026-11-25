// ai-measure/core/papsTests.js
// ════════════════════════════════════════════════════════════════════════
//  [PAPS 탭 2026-11-25] 유소년·청소년 체력평가(PAPS 계열) 측정 — 측정자 입력형 1차 버전.
//  · 팔굽혀펴기 · 윗몸말아올리기 · 윗몸일으키기(1분) · 사이드스텝(20초) · 오래매달리기 · 턱걸이
//    · 앉아윗몸앞으로굽히기 · 악력.  (제자리멀리뛰기=7번, 달리기=5번, 신체정보=1번은 기존 탭을 쓴다)
//  · 등급(1~5등급)은 core/papsNorms.js 표가 있는 테스트(윗몸말아올리기·앉아윗몸앞으로굽히기·악력)만, 초4~6+성별이 있을 때 낸다.
//    그 외 테스트·학년은 숫자를 지어 넣지 않고 값만 저장한다.
//    값·무효 여부·측정 조건을 그대로 저장하고, 같은 테스트끼리 회차별 변화만 비교한다(status 는 항상 'unknown').
//  · 기준표가 확인되면 evaluatePapsTest 안에서만 판정을 추가한다(나머지 화면은 status 를 그대로 쓴다).
//  · 이상·무효 값도 저장을 막지 않는다. 무효는 valid:false + 사유로 남긴다.
// ════════════════════════════════════════════════════════════════════════
import { PAPS_GRADE_WORD, PAPS_NORM_SOURCE, papsGradeOf, papsNormText } from './papsNorms';

export const PAPS_KIND = 'paps_test';

/** 종합분석·모미에 넘기는 기준 설명. 등급표는 확인 전이라 값·회차 비교만 한다고 분명히 적는다. */
export function papsCriteriaText(report = {}) {
  const label = `${report.testLabel || 'PAPS 테스트'}${report.variant === 'knee' ? '(무릎 대고)' : ''}`;
  if (report.grade) {
    const norm = papsNormText(report.testId, report.subject?.sex, report.subject?.grade, report.unit || '');
    return `${label}: PAPS ${report.subject?.grade || ''} ${report.subject?.sex === 'male' ? '남' : '여'} 기준 ${report.grade}등급(${PAPS_GRADE_WORD[report.grade]}). 기준(${norm}). 기준표는 대표님 제공본이라 공식 원문과 대조 전입니다. 이전 기록과의 변화도 함께 봅니다.`;
  }
  return `${label}: 초4~6 학년·성별이 모두 있을 때만 PAPS 1~5등급을 냅니다(윗몸말아올리기·앉아윗몸앞으로굽히기·악력). 이 기록은 등급 기준이 없어 값과 이전 기록과의 변화만 비교합니다. 값이 늘면 좋아진 것, 무효 기록은 비교에서 뺍니다.`;
}

// kind: reps_free(최대 횟수, 끝낼 때까지) · reps_timed(제한시간 안의 횟수) · hold(버틴 시간) · value(자로 잰 값)
export const PAPS_TESTS = {
  pushup: {
    id: 'pushup', label: '팔굽혀펴기', short: '팔굽혀펴기', kind: 'reps_free', unit: '회', higherBetter: true,
    hasKneeVariant: true, metronome: true,
    what: '팔 힘과 몸통 버티는 힘(상체 근지구력)을 최대 횟수로 봅니다.',
    how: [
      '손을 어깨너비로 짚고 몸을 일직선으로 만듭니다(무릎 대고 하는 방식이면 "무릎 대고"를 선택).',
      '가슴이 바닥에서 주먹 하나 높이까지 내려갔다 팔을 완전히 펴는 것을 1회로 셉니다.',
      '메트로놈을 쓰면 같은 박자로 하게 도와줍니다. 박자·방식은 매번 같게 해야 비교가 됩니다.',
      '허리가 꺾이거나 엉덩이가 들리면 측정자가 -1 하거나 거기서 종료합니다.',
    ],
    care: '손목·어깨 통증이 있으면 중단합니다.',
    easy: (v) => `팔굽혀펴기를 ${v}회 했어요. 같은 방법으로 다시 재서 숫자가 늘어나는지 비교해요.`,
  },
  curlup: {
    id: 'curlup', label: '윗몸말아올리기', short: '윗몸말아올리기', kind: 'reps_free', unit: '회', higherBetter: true,
    metronome: true,
    what: '배 근육(복근)의 지구력을 정해진 박자로 최대 횟수까지 봅니다.',
    how: [
      '누워 무릎을 세우고 팔은 몸 옆에 펴 둡니다.',
      '메트로놈 박자에 맞춰 어깨뼈가 바닥에서 뜨게 말아 올렸다 내려옵니다.',
      '박자를 놓치거나 반동을 쓰면 측정자가 거기서 종료합니다.',
      '박자(BPM)는 매번 같게 해서 기록과 함께 남깁니다.',
    ],
    care: '목·허리 통증이 있으면 중단합니다.',
    easy: (v) => `윗몸말아올리기를 ${v}회 했어요. 같은 박자로 다시 재서 늘어나는지 비교해요.`,
  },
  situp1m: {
    id: 'situp1m', label: '윗몸일으키기(1분)', short: '윗몸일으키기 1분', kind: 'reps_timed', unit: '회', higherBetter: true, durationSec: 60,
    what: '1분 동안 배 근육으로 몸을 몇 번 일으키는지 봅니다.',
    how: [
      '누워 무릎을 굽히고 발은 고정(파트너가 잡아 줌), 팔은 가슴 앞에 모읍니다.',
      '"시작"에서 팔꿈치가 무릎에 닿게 일어났다 등이 바닥에 닿게 눕는 것을 1회로 셉니다.',
      '1분이 되면 자동으로 끝납니다.',
    ],
    care: '목·허리 통증이 있으면 중단합니다.',
    easy: (v) => `1분 동안 윗몸일으키기를 ${v}회 했어요. 같은 방법으로 다시 재서 늘어나는지 비교해요.`,
  },
  sidestep20: {
    id: 'sidestep20', label: '사이드스텝(20초)', short: '사이드스텝 20초', kind: 'reps_timed', unit: '회', higherBetter: true, durationSec: 20,
    what: '20초 동안 좌우로 빠르게 옆걸음을 몇 번 하는지 봅니다(민첩성).',
    how: [
      '바닥에 가운데 선을 긋고 양옆 선을 일정 간격으로 붙입니다(간격은 매번 같게, 메모에 적기).',
      '"시작"에서 가운데 선을 기준으로 옆 선을 넘어갔다 오는 것을 1회로 셉니다.',
      '20초가 되면 자동으로 끝납니다.',
    ],
    care: '바닥이 미끄럽지 않은지 먼저 확인합니다.',
    easy: (v) => `20초 동안 옆으로 ${v}번 움직였어요. 같은 방법으로 다시 재서 늘어나는지 비교해요.`,
  },
  hang: {
    id: 'hang', label: '오래매달리기', short: '오래매달리기', kind: 'hold', unit: '초', higherBetter: true,
    what: '철봉에 매달려 버티는 시간으로 팔·어깨 근지구력을 봅니다.',
    how: [
      '철봉을 잡고 턱이 봉 위로 올라간 자세에서 시작합니다(받침 사용 가능).',
      '"시작"과 동시에 버티고, 턱이 봉 아래로 내려가면 측정자가 "멈춤"을 누릅니다.',
      '버틴 시간(초)이 기록입니다.',
    ],
    care: '손바닥 마찰·낙하에 주의하고 아래에 매트를 둡니다.',
    easy: (v) => `철봉에 ${v}초 매달렸어요. 같은 방법으로 다시 재서 늘어나는지 비교해요.`,
  },
  pullup: {
    id: 'pullup', label: '턱걸이', short: '턱걸이', kind: 'reps_free', unit: '회', higherBetter: true,
    what: '팔·등 힘을 최대 횟수로 봅니다.',
    how: [
      '철봉을 잡고 팔을 완전히 편 상태에서 시작합니다.',
      '턱이 봉 위로 올라갔다 팔을 완전히 펴고 내려오는 것을 1회로 셉니다.',
      '반동이 크거나 팔이 덜 펴지면 측정자가 -1 하거나 종료합니다.',
    ],
    care: '낙하에 주의하고 아래에 매트를 둡니다.',
    easy: (v) => `턱걸이를 ${v}회 했어요. 같은 방법으로 다시 재서 늘어나는지 비교해요.`,
  },
  sitreach: {
    id: 'sitreach', label: '앉아윗몸앞으로굽히기', short: '앉아윗몸앞으로굽히기', kind: 'value', unit: 'cm', higherBetter: true,
    fields: ['1차', '2차'], decimals: 1,
    what: '허벅지 뒤쪽과 허리의 유연성을 앞으로 뻗은 거리(cm)로 봅니다.',
    how: [
      '발바닥을 측정기에 대고 무릎을 편 채 앉습니다.',
      '두 손을 모아 천천히 앞으로 밀어 최대한 멀리 뻗고 2초 유지한 거리를 읽습니다.',
      '2번 재서 더 좋은 값을 기록합니다. 발끝보다 못 가면 마이너스(−)로 적습니다.',
    ],
    care: '반동을 주지 말고 천천히 뻗습니다. 허리 통증이 있으면 중단합니다.',
    easy: (v) => `앞으로 ${v}cm 뻗었어요. 같은 방법으로 다시 재서 늘어나는지 비교해요.`,
  },
  grip: {
    id: 'grip', label: '악력', short: '악력', kind: 'value', unit: 'kg', higherBetter: true,
    fields: ['왼손 1차', '왼손 2차', '오른손 1차', '오른손 2차'], decimals: 1,
    what: '손으로 쥐는 힘(kg)으로 전신 근력의 지표를 봅니다.',
    how: [
      '악력계를 손가락 둘째마디에 맞추고 팔을 몸 옆에 내린 채 선 자세로 잡습니다.',
      '몸에 닿지 않게 힘껏 3초 쥐고 값을 읽습니다.',
      '양손을 번갈아 2번씩 재고, 화면의 기록은 가장 높은 값입니다(손별 값은 모두 저장).',
    ],
    care: '손목 통증이 있으면 중단합니다.',
    easy: (v) => `손으로 쥐는 힘이 최고 ${v}kg이에요. 같은 방법으로 다시 재서 늘어나는지 비교해요.`,
  },
};

export const PAPS_TEST_ORDER = ['pushup', 'curlup', 'situp1m', 'sidestep20', 'hang', 'pullup', 'sitreach', 'grip'];

export const PAPS_GRADE_OPTIONS = ['초1', '초2', '초3', '초4', '초5', '초6', '중1', '중2', '중3', '고1', '고2', '고3'];

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normalizeSexValue(s) {
  const v = String(s || '').toLowerCase();
  if (['m', 'male', '남', '남자', '남성'].includes(v)) return 'male';
  if (['f', 'female', '여', '여자', '여성'].includes(v)) return 'female';
  return null;
}

/** value-형 테스트의 입력 칸들 → 가장 좋은 값(높을수록 좋음 → 최댓값). */
export function bestOfTrials(trials = []) {
  const vals = (trials || []).map((t) => num(t?.value ?? t)).filter((v) => v != null);
  return vals.length ? Math.max(...vals) : null;
}

/**
 * 판정. 등급 기준표를 확인하기 전이라 status 는 항상 'unknown' — 값과 유효 여부만 정리한다.
 * opts: { invalid: boolean(측정자가 자세 불량 등으로 무효 처리), variant }
 */
export function evaluatePapsTest(testId, value, opts = {}) {
  const meta = PAPS_TESTS[testId];
  const v = num(value);
  if (!meta) return { status: 'unknown', label: '알 수 없는 테스트', valid: false, reason: '테스트 종류 없음', reference: null, easy: '' };
  if (opts.invalid) {
    return { status: 'unknown', label: '무효', valid: false, reason: '측정자가 무효로 표시(자세 불량·중단 등)', reference: null, easy: '자세가 맞지 않거나 중간에 멈춰서 기록으로 쓰지 않았어요.' };
  }
  if (v == null) return { status: 'unknown', label: '값 없음', valid: false, reason: '값 없음', reference: null, easy: '' };
  if (v < 0 && testId !== 'sitreach') return { status: 'unknown', label: '확인 필요', valid: false, reason: '0보다 작은 값', reference: null, easy: '' };
  const sg = opts.subject || {};
  const g = papsGradeOf(testId, v, { sex: sg.sex, grade: sg.grade });
  if (g) {
    const norm = papsNormText(testId, sg.sex, sg.grade, meta.unit);
    return {
      status: 'unknown', grade: g, label: `${g}등급 (${PAPS_GRADE_WORD[g]})`, valid: true, reason: '', reference: norm,
      source: PAPS_NORM_SOURCE.label,
      easy: `${meta.easy(v)} ${sg.grade} ${sg.sex === 'male' ? '남' : '여'} 기준으로 ${g}등급(${PAPS_GRADE_WORD[g]})이에요.`,
    };
  }
  const hasTable = ['curlup', 'sitreach', 'grip'].includes(testId);
  return {
    status: 'unknown', grade: null, label: hasTable ? '기록(학년·성별 확인 시 등급)' : '기록(등급표 없음)', valid: true,
    reason: '', reference: null, easy: meta.easy(v),
  };
}

// 같은 테스트끼리만 비교하는 키(팔굽혀펴기는 무릎 방식이 다르면 별도 추이)
export function papsGroupKey(p = {}) {
  const base = String(p?.testId || '');
  return p?.variant ? `${base}_${p.variant}` : base;
}

// ── 저장 레코드 ──────────────────────────────────────────────────────
// 필드 이름은 inferReportType 에 걸리지 않게 고른다(heightCm·mode·type·summary·analysis 금지).
export function buildPapsRecord({
  testId, value, subject = {}, variant = '', invalid = false, trials = [], metronomeBpm = null,
  startedAt = null, endedAt = null, trainerNote = '', repLog = [], hr = null, auto = null,
} = {}) {
  const meta = PAPS_TESTS[testId];
  const ev = evaluatePapsTest(testId, value, { invalid, subject });
  return {
    kind: PAPS_KIND,
    testId,
    testLabel: meta?.label || testId,
    variant: variant || '',
    value: num(value),
    unit: meta?.unit || '',
    invalid: Boolean(invalid),
    status: ev.status,
    statusLabel: ev.label,
    valid: ev.valid,
    invalidReason: ev.reason || '',
    reference: ev.reference || null,
    grade: ev.grade || null,
    gradeSource: ev.grade ? PAPS_NORM_SOURCE.label : null,
    easySummary: ev.easy,
    trials: Array.isArray(trials) ? trials.slice(0, 8).map((t) => ({ label: String(t.label || ''), value: num(t.value) })) : [],
    subject: {
      age: num(subject.age), sex: normalizeSexValue(subject.sex),
      grade: subject.grade ? String(subject.grade) : null,
      weightKg: num(subject.weightKg), heightCm: num(subject.heightCm),
    },
    metronomeBpm: num(metronomeBpm),
    hr: hr || null,
    auto: auto && auto.used ? { used: true, autoValue: num(auto.autoValue), autoCount: num(auto.autoCount), offset: num(auto.offset) || 0 } : null,
    repLog: Array.isArray(repLog) ? repLog.slice(0, 120) : [],
    trainerNote: String(trainerNote || '').slice(0, 500),
    startedAt, endedAt,
  };
}

// 측정 이력 카드 요약 칩
export function papsHistoryMetrics(payload = {}) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const out = [];
  if (Number.isFinite(p.value)) {
    const label = `${p.testLabel || '기록'}${p.variant === 'knee' ? '(무릎)' : ''}`;
    out.push({ key: 'value', label, displayValue: String(p.value), unit: p.unit || '', value: p.value });
  }
  if (p.grade) out.push({ key: 'grade', label: `${p.testLabel || ''} 등급`, displayValue: `${p.grade}등급`, unit: '', value: p.grade });
  if (p.statusLabel && p.valid === false) out.push({ key: 'status', label: '판정', displayValue: p.statusLabel, unit: '', value: null });
  return out;
}

// 직전(같은 테스트·같은 방식) 대비 변화. 무효 기록은 비교에서 뺀다.
export function papsChange(current, previous) {
  if (!current || !previous || papsGroupKey(current) !== papsGroupKey(previous)) return null;
  if (!Number.isFinite(current.value) || !Number.isFinite(previous.value) || current.valid === false || previous.valid === false) return null;
  const meta = PAPS_TESTS[current.testId];
  const diff = Math.round((current.value - previous.value) * 10) / 10;
  const improved = meta?.higherBetter === false ? diff < 0 : diff > 0;
  const direction = diff === 0 ? 'same' : improved ? 'improved' : 'worsened';
  return { diff, direction, unit: meta?.unit || '', previousValue: previous.value };
}
