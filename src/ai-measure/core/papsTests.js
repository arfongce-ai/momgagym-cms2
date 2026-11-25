// ai-measure/core/papsTests.js
// ════════════════════════════════════════════════════════════════════════
//  [PAPS 탭 2026-11-25] 유소년·청소년 체력평가(PAPS 계열) 측정 — 측정자 입력형 1차 버전.
//  · 팔굽혀펴기 · 윗몸말아올리기 · 턱걸이 · 오래매달리기 · 사이드스텝(20초) · 앉아윗몸앞으로굽히기(좌전굴)
//    · 서서윗몸앞으로굽히기(체전굴) · 악력.  (윗몸일으키기 1분은 2026-11-25 대표님 결정으로 뺌 — 윗몸말아올리기 하나만)
//  · 영상촬영(video): primary=카메라 기본(영상+스켈레톤+인식률+HUD 저장) · optional=선택(악력은 하는 모습만 녹화).  (제자리멀리뛰기=7번, 달리기=5번, 신체정보=1번은 기존 탭을 쓴다)
//  · 등급(1~5등급)은 core/papsNorms.js 표가 있는 테스트(윗몸말아올리기·앉아윗몸앞으로굽히기·악력)만, 초3~고3+성별이 있을 때 낸다.
//    그 외 테스트·학년은 숫자를 지어 넣지 않고 값만 저장한다.
//    값·무효 여부·측정 조건을 그대로 저장하고, 같은 테스트끼리 회차별 변화만 비교한다(status 는 항상 'unknown').
//  · 기준표가 확인되면 evaluatePapsTest 안에서만 판정을 추가한다(나머지 화면은 status 를 그대로 쓴다).
//  · 이상·무효 값도 저장을 막지 않는다. 무효는 valid:false + 사유로 남긴다.
// ════════════════════════════════════════════════════════════════════════
import { PAPS_GRADE_WORD, PAPS_NORM_SOURCE, papsGradeOf, papsNormText } from './papsNorms';
import { ADULT_NORM_SOURCE, adultBandIndex, adultItemLevel, relativeGripPct } from './adultNorms';

export const PAPS_KIND = 'paps_test';

/** 종합분석·모미에 넘기는 기준 설명. 등급표는 확인 전이라 값·회차 비교만 한다고 분명히 적는다. */
// 등급표 키: 팔굽혀펴기는 남=pushup(봉), 여=pushupKnee(무릎대고). 방식이 안 맞으면 null(임의 준용 금지).
export function papsNormId(testId, sex, variant) {
  if (testId !== 'pushup') return testId;
  const knee = variant === 'knee';
  return sex === 'female' ? (knee ? 'pushupKnee' : null) : (knee ? null : 'pushup');
}

export function papsCriteriaText(report = {}) {
  const label = `${report.testLabel || 'PAPS 테스트'}${report.variant === 'knee' ? '(무릎 대고)' : ''}`;
  if (report.grade) {
    const norm = papsNormText(papsNormId(report.testId, report.subject?.sex, report.variant), report.subject?.sex, report.subject?.grade, report.unit || '');
    return `${label}: PAPS ${report.subject?.grade || ''} ${report.subject?.sex === 'male' ? '남' : '여'} 기준 ${report.grade}등급(${PAPS_GRADE_WORD[report.grade]}). 기준(${norm}). 기준표는 학교건강검사규칙 별표 4(2025.3.10 개정)입니다. 이전 기록과의 변화도 함께 봅니다.`;
  }
  return `${label}: 초3~고3 학년·성별이 모두 있을 때만 PAPS 1~5등급을 냅니다(윗몸말아올리기·팔굽혀펴기(중·고, 여는 무릎대고)·앉아윗몸앞으로굽히기·악력). 이 기록은 공식 등급 기준이 없어(성인·표에 없는 조합 포함) 값·영상·인식률·이전 기록과의 변화로 평가합니다. 값이 늘면 좋아진 것, 무효 기록은 비교에서 뺍니다.`;
}

// kind: reps_free(최대 횟수, 끝낼 때까지) · reps_timed(제한시간 안의 횟수) · hold(버틴 시간) · value(자로 잰 값)
export const PAPS_TESTS = {
  pushup: {
    id: 'pushup', label: '팔굽혀펴기', short: '팔굽혀펴기', kind: 'reps_free', unit: '회', higherBetter: true,
    hasKneeVariant: true, metronome: true, video: 'primary', range: [0, 150], rangeInt: true,
    camera: '옆모습(측면) 전신이 보이게. 어깨·팔꿈치·손목이 가려지지 않게 세웁니다.',
    countRule: '팔꿈치 각도가 접힘(약 100° 이하)까지 내려갔다가 다시 펴지면(약 150° 이상) 1회. 문턱값은 앱 시작값이라 실기기에서 조정합니다.',
    what: '팔 힘과 몸통 버티는 힘(상체 근지구력)을 최대 횟수로 봅니다.',
    how: [
      '(남) 30cm 높이 봉을 어깨너비로 잡고 양발을 모아, 머리부터 어깨·등·허리·발끝까지 일직선을 만듭니다. 내려갔을 때 가슴과 봉 사이는 10cm 이하, 팔꿈치 90°입니다.',
      '(여) 무릎을 꿇고 발끝을 세워 발등이 바닥에 닿지 않게 하고, 상체는 곧게 합니다. 내려갔을 때 가슴과 바닥 사이는 15cm 이하, 팔꿈치 90°입니다.',
      '팔을 굽혔다가 펴는 것을 1회로 하며, 더 이상 반복하지 못할 때까지의 횟수를 잽니다.',
      '허리가 꺾이거나 엉덩이가 들리면 측정자가 거기서 종료합니다.',
    ],
    verified: ['남 팔굽혀펴기: 봉 높이 30cm·넓이 110cm 이상, 양발 모으고 양손 어깨너비로 봉을 잡음, 머리~발끝 일직선, 내려간 동작에서 가슴-봉 10cm 이하·팔꿈치 90°, 더 이상 반복하지 못할 때까지의 횟수 (별표 3 6-1).', '여 무릎대고 팔굽혀펴기: 무릎 꿇고 발끝 세워 발등이 지면에 안 닿게, 상체 반듯, 손 간격 조정, 내려간 동작에서 가슴-지면 15cm 이하·팔꿈치 90°, 더 이상 반복하지 못할 때까지의 횟수 (별표 3 6-2).'],
    unverified: ['법령(별표 3)에 박자(회/분) 규정은 없습니다 — 메트로놈은 선택 보조입니다. 앱의 팔꿈치 접힘 문턱(100°)·가슴-봉/지면 거리(10·15cm)는 카메라로 재지 못해 측정자가 확인해야 합니다. 초등은 하지 않고 중·고에서 남=봉, 여=무릎대고입니다.'],
    care: '손목·어깨 통증이 있으면 중단합니다.',
    easy: (v) => `팔굽혀펴기를 ${v}회 했어요. 같은 방법으로 다시 재서 숫자가 늘어나는지 비교해요.`,
  },
  curlup: {
    id: 'curlup', label: '윗몸말아올리기', short: '윗몸말아올리기', kind: 'reps_free', unit: '회', higherBetter: true,
    metronome: true, metronomeBpm: 20, video: 'primary', range: [0, 200], rangeInt: true,
    camera: '옆모습(측면)에서 어깨·엉덩이·무릎이 보이게 눕습니다.',
    countRule: '몸통 기울기가 약 20° 이상 올라왔다가 다시 눕혀지면 1회(앱 시작값, 실기기에서 조정). 공식 규칙은 3초에 1번 신호음에 맞춰 손바닥으로 무릎을 감싸는 것이며, 간격 이탈 판정은 측정자가 합니다. 메트로놈 박자는 기록과 영상에 함께 남깁니다.',
    what: '배 근육(복근)의 근지구력을 3초에 1번 신호음에 맞춰 반복 가능한 횟수로 봅니다.',
    how: [
      '매트에 머리와 등을 대고 눕고, 무릎을 약 90°로 굽혀 세웁니다. 발바닥은 바닥에 평평하게, 발과 무릎 사이는 주먹 하나 간격입니다.',
      '팔은 곧게 뻗어 손바닥을 넓적다리 위에 올려 둡니다.',
      '3초에 1번 울리는 신호음(메트로놈 20BPM)에 맞춰 손이 넓적다리를 타고 올라가 손바닥으로 무릎을 감쌀 때까지 상체를 말아 올립니다.',
      '무릎을 감싼 뒤 바로 준비 자세로 돌아옵니다.',
    ],
    verified: ['자세·측정 방법 전부: 학교건강검사규칙 별표 3(7. 윗몸말아올리기) — 머리·등을 대고 누움, 무릎 약 90°, 발-무릎 주먹 하나 간격, 팔 곧게 뻗어 손바닥을 넓적다리 위, 3초에 1번 신호음에 맞춰 손바닥으로 무릎을 감싸게 말아 올림, 감싼 뒤 바로 준비 자세.', '1회/3초 간격을 처음 한 번 못 지키면 그 한 번만 계수하지 않고 계속, 두 번째로 못 지키면 계수를 종료하고 그때까지의 총 횟수를 기록(별표 3).'],
    unverified: ['앱은 신호음 간격 준수(첫 번째 이탈 1회 제외·두 번째 이탈 종료)를 자동 판정하지 못합니다 — 측정자가 영상·메트로놈으로 확인해 종료 시점의 횟수를 입력하세요. 손바닥이 무릎에 닿는지는 카메라로 판정하지 못하고, 몸통 기울기 20° 문턱은 앱 시작값입니다.'],
    care: '목·허리 통증이 있으면 중단합니다.',
    easy: (v) => `윗몸말아올리기를 ${v}회 했어요. 같은 박자로 다시 재서 늘어나는지 비교해요.`,
  },
  sidestep20: {
    id: 'sidestep20', label: '사이드스텝(20초)', short: '사이드스텝 20초', kind: 'reps_timed', unit: '회', higherBetter: true, durationSec: 20,
    video: 'primary', needsDistance: true,
    camera: '정면 또는 후면 전신. 시작 1초는 가운데 선 위에 서서 중심을 잡습니다.',
    countRule: '골반이 중심에서 한쪽 끝까지 갔다가 반대쪽 끝에 닿을 때마다 1회(골반 너비 단위). 거리는 측정자가 cm로 지정해 기록에 남깁니다.',
    official: false,
    unverified: ['나이스 PAPS 매뉴얼의 필수평가 종목에 없는 종목이라 공식 기준·등급표가 없습니다(보조 측정). 공식 사이드스텝의 선 간격(거리) 원문은 확인 못 함 — 측정자가 매번 같은 거리를 cm로 입력합니다. 5번(보행·스프린터) 탭의 거리 지정 측정과 병행하지 않고 여기서 함께 저장합니다.'],
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
    video: 'primary',
    camera: '정면 또는 측면에서 머리·팔·철봉이 한 화면에 보이게. 초시계가 영상에 같이 찍힙니다.',
    countRule: '횟수가 아니라 버틴 시간입니다. 측정자가 시작·멈춤을 누르는 초시계 방식입니다(카메라는 영상·스켈레톤 기록용).',
    official: false,
    unverified: ['나이스 PAPS 매뉴얼의 필수평가 종목에 없는 종목이라 공식 기준·등급표가 없습니다(보조 측정). 공식 오래매달리기의 시작 자세(턱 위치·팔 각도) 원문은 확인 못 함 — 측정자가 같은 기준으로 판단합니다.'],
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
    video: 'primary',
    camera: '옆모습(측면)에서 어깨·팔꿈치·손목이 보이게. 철봉 높이 전체가 화면에 들어오게 합니다.',
    countRule: '팔꿈치 각도가 접힘(약 75° 이하)까지 올라왔다가 다시 펴지면(약 150° 이상) 1회(앱 시작값).',
    official: false,
    unverified: ['나이스 PAPS 매뉴얼의 필수평가 종목에 없는 종목이라 공식 기준·등급표가 없습니다(보조 측정). 공식 턱걸이의 인정 기준(턱 위치·반동) 원문은 확인 못 함 — 측정자가 -1/+1로 보정합니다.'],
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
    id: 'sitreach', label: '앉아윗몸앞으로굽히기(좌전굴)', short: '앉아윗몸앞으로굽히기', kind: 'value', unit: 'cm', higherBetter: true,
    fields: ['1차', '2차'], decimals: 1, video: 'primary', range: [-40, 50],
    camera: '옆모습(측면)에서 발·무릎·엉덩이·손끝이 보이게. 무릎이 펴져 있는지 영상으로 확인합니다.',
    countRule: '횟수 없음 — 영상 녹화와 스켈레톤으로 자세(무릎 펴짐)를 남기고, 거리(cm)는 측정기 눈금을 측정자가 읽어 입력합니다.',
    what: '허벅지 뒤쪽과 허리의 유연성을 앞으로 뻗은 거리(cm)로 봅니다.',
    how: [
      '신발을 벗고 두 발 사이 5cm 이내로, 양 발바닥을 측정기 전면에 완전히 대고 무릎을 펴고 앉습니다.',
      '한 손을 다른 손 위에 겹쳐 올리고, 고개를 숙이며 윗몸을 앞으로 굽혀 눈금 쪽으로 뻗습니다.',
      '무릎이 올라오지 않게 굽힌 자세를 2초 이상 유지하고, 양 손 손가락 끝이 멈춘 지점의 눈금을 읽습니다.',
      '2회 실시하여 0.1cm 단위로 기록하고, 평가는 높은 기록으로 합니다.',
    ],
    verified: ['발 사이 5cm 이내·발바닥 측정기 전면 밀착·무릎 펴고 앉음·한 손을 다른 손 위에 겹침·고개 숙이고 눈금 쪽으로 뻗음(별표 3 4-가)', '무릎이 올라오지 않게 굽힌 자세 2초 이상 유지·손가락 끝이 멈춘 지점 눈금·2회 실시 0.1cm 단위·평가는 높은 기록(별표 3 4-나)', '입력 범위 −40.0~50.0cm, 소수 첫째자리 (나이스 PAPS 매뉴얼 v1.11)'],
    unverified: ['앱은 무릎 펴짐·2초 유지를 카메라로 판정하지 못합니다 — 영상으로 남기고 측정자가 확인합니다. 무릎이 굽혀진 시도의 처리(재검사)는 별표 3에 명시가 없어 확인 못 함.'],
    care: '반동을 주지 말고 천천히 뻗습니다. 허리 통증이 있으면 중단합니다.',
    easy: (v) => `앞으로 ${v}cm 뻗었어요. 같은 방법으로 다시 재서 늘어나는지 비교해요.`,
  },
  standbend: {
    id: 'standbend', label: '서서윗몸앞으로굽히기(체전굴)', short: '서서윗몸앞으로굽히기', kind: 'value', unit: 'cm', higherBetter: true,
    fields: ['1차', '2차'], decimals: 1, video: 'primary',
    camera: '옆모습(측면) 전신. 무릎이 펴져 있는지, 손끝이 어디까지 내려가는지 보이게 합니다.',
    countRule: '횟수 없음 — 영상 녹화와 스켈레톤으로 자세(무릎 펴짐)를 남기고, 거리(cm)는 측정자가 읽어 입력합니다. 발바닥 기준선보다 아래로 내려가면 +, 못 닿으면 −.',
    what: '서서 앞으로 숙일 때 허벅지 뒤쪽·허리·엉덩이의 유연성을 손끝 거리(cm)로 봅니다.',
    how: [
      '측정대(또는 단) 위에 발을 모으고 서서 무릎을 편 채로 둡니다.',
      '두 손을 모아 천천히 아래로 숙여 손끝이 내려간 거리를 읽습니다.',
      '무릎이 굽혀지거나 반동을 쓰면 다시 잽니다.',
    ],
    official: false,
    unverified: ['나이스 PAPS 매뉴얼의 필수평가 종목에 없는 종목이라 공식 기준·등급표가 없습니다(보조 측정). 서서윗몸앞으로굽히기의 공식 절차(측정대·횟수·유지 시간)는 이번 검색에서 원문 확인 못 함 — 측정자가 매번 같은 방식으로 재고, 등급표 없이 값과 변화만 봅니다.'],
    care: '반동을 주지 말고 천천히 숙입니다. 허리 통증이 있으면 중단합니다.',
    easy: (v) => `서서 숙였을 때 손끝이 ${v}cm 였어요. 같은 방법으로 다시 재서 늘어나는지 비교해요.`,
  },
  grip: {
    id: 'grip', label: '악력', short: '악력', kind: 'value', unit: 'kg', higherBetter: true,
    fields: ['오른손 1차', '왼손 1차', '오른손 2차', '왼손 2차'], decimals: 1, video: 'optional', range: [0, 200],
    camera: '선택 — 악력계를 잡은 팔 전체가 보이게 하는 모습만 녹화합니다(횟수·스켈레톤 판정 없음).',
    countRule: '횟수 없음 — 숫자는 악력계에서 읽어 입력합니다.',
    what: '손으로 쥐는 힘(kg)으로 전신 근력의 지표를 봅니다.',
    how: [
      '발을 바닥에 평평하게 붙이고 두 다리를 어깨너비로 벌려 바로 섭니다.',
      '악력계 폭을 자기 손에 맞게 조절하고, 손가락 제2관절이 직각이 되도록 잡습니다.',
      '오른손 → 왼손 → 오른손 → 왼손 순서로 각 2회 측정합니다.',
      '0.1kg 단위로 기록하되 0.01kg 단위에서 올림하며, 평가는 가장 높은 기록입니다.',
    ],
    verified: ['측정 자세·순서(오른-왼-오른-왼 각 2회)·0.1kg 단위(0.01 올림)·평가는 최고 기록 (별표 3 8. 악력)'],
    care: '손목 통증이 있으면 중단합니다.',
    easy: (v) => `손으로 쥐는 힘이 최고 ${v}kg이에요. 같은 방법으로 다시 재서 늘어나는지 비교해요.`,
  },
};

export const PAPS_TEST_ORDER = ['pushup', 'curlup', 'pullup', 'hang', 'sidestep20', 'sitreach', 'standbend', 'grip'];

/** 영상촬영이 기본(primary)·선택(optional)인 테스트인지. */
export const papsVideoMode = (testId) => PAPS_TESTS[testId]?.video || null;

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
  if (v < 0 && !(meta.range && meta.range[0] < 0)) return { status: 'unknown', label: '확인 필요', valid: false, reason: '0보다 작은 값', reference: null, easy: '' };
  if (meta.range && (v < meta.range[0] || v > meta.range[1] || (meta.rangeInt && !Number.isInteger(v)))) {
    return {
      status: 'unknown', label: '확인 필요', valid: false, reference: null,
      reason: `나이스 입력 범위(${meta.range[0]}~${meta.range[1]}${meta.unit}${meta.rangeInt ? ', 정수' : ''})를 벗어난 값`,
      easy: '입력 가능한 범위를 벗어난 값이라 기록으로 쓰지 않았어요. 값은 그대로 저장돼요.',
    };
  }
  const sg = opts.subject || {};
  // 팔굽혀펴기: 공식 표는 남=팔굽혀펴기(봉), 여=무릎대고팔굽혀펴기(중·고). 방식이 다르면 표 없음(임의 준용 금지).
  const normId = papsNormId(testId, sg.sex, opts.variant);
  const g = normId ? papsGradeOf(normId, v, { sex: sg.sex, grade: sg.grade }) : null;
  if (g) {
    const norm = papsNormText(normId, sg.sex, sg.grade, meta.unit);
    return {
      status: 'unknown', grade: g, label: `${g}등급 (${PAPS_GRADE_WORD[g]})`, valid: true, reason: '', reference: norm,
      source: PAPS_NORM_SOURCE.label,
      easy: `${meta.easy(v)} ${sg.grade} ${sg.sex === 'male' ? '남' : '여'} 기준으로 ${g}등급(${PAPS_GRADE_WORD[g]})이에요.`,
    };
  }
  // 성인(19~64세): 국민체력100 항목별 기준(앉아윗몸앞으로굽히기·상대악력). 종합 1~6등급은 전 종목을 재야 나오므로 내지 않는다.
  const adultKey = { sitreach: 'sitreach', grip: 'relgrip' }[testId];
  if (adultKey && sg.sex && adultBandIndex(sg.age) >= 0 && !sg.grade) {
    const rel = adultKey === 'relgrip' ? relativeGripPct(v, sg.weightKg) : v;
    const a = adultItemLevel(adultKey, rel, { sex: sg.sex, age: sg.age });
    if (a) {
      const word = a.level ? `국민체력100 ${a.level}등급 기준 이상` : '국민체력100 3등급 기준 미만';
      const what = adultKey === 'relgrip' ? `상대악력 ${rel}%(악력 ${v}kg ÷ 체중 ${sg.weightKg}kg)` : `${v}cm`;
      return {
        status: 'unknown', grade: null, adultLevel: a.level, label: word, valid: true, reason: '', reference: `${a.band} 기준 ${a.reference}${adultKey === 'relgrip' ? '%' : 'cm'} 이상`,
        source: ADULT_NORM_SOURCE.label,
        easy: `${meta.easy(v)} ${a.band} 국민체력100 항목 기준으로 ${what}는 ${word}이에요(최종 등급은 전 종목을 재야 정해져요).`,
      };
    }
    if (adultKey === 'relgrip') return { status: 'unknown', grade: null, label: '기록(체중 입력 시 국민체력100 항목 기준)', valid: true, reason: '', reference: null, easy: meta.easy(v) };
  }
  const hasTable = ['pushup', 'curlup', 'sitreach', 'grip'].includes(testId);
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
  recognition = null, video = null, conditions = null, previous = null,
} = {}) {
  const meta = PAPS_TESTS[testId];
  const ev = evaluatePapsTest(testId, value, { invalid, subject, variant });
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
    gradeSource: ev.grade ? PAPS_NORM_SOURCE.label : ev.adultLevel != null ? ADULT_NORM_SOURCE.label : null,
    adultLevel: ev.adultLevel ?? null,
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
    recognition: recognition && Number.isFinite(recognition.ratio)
      ? { ratio: recognition.ratio, frames: num(recognition.frames), goodFrames: num(recognition.goodFrames) } : null,
    video: video ? { recorded: Boolean(video.recorded), fileName: String(video.fileName || ''), method: String(video.method || '') } : null,
    conditions: conditions ? {
      distanceCm: num(conditions.distanceCm), metronomeBpm: num(conditions.metronomeBpm), cameraUsed: Boolean(conditions.cameraUsed),
    } : null,
    evaluationText: papsEvaluationText({ testId, value: num(value), unit: meta?.unit || '', variant, valid: ev.valid, grade: ev.grade, adultLabel: ev.adultLevel != null ? ev.label : '', adultReference: ev.adultLevel != null ? ev.reference : '', reference: ev.reference, subject, recognition, hr }, previous),
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

/**
 * 측정·평가 문장(학생·성인 공통). 등급은 PAPS 공식 기준표가 있는 초3~고3 학생에게만 붙이고,
 * 성인(19~64세)은 국민체력100 항목별 기준(앉아윗몸앞으로굽히기·상대악력)을 붙이고, 그 외는 값·직전 대비 변화·인식률로 평가한다. 없는 기준을 만들어 내지 않는다.
 */
export function papsEvaluationText(p = {}, previous = null) {
  const meta = PAPS_TESTS[p.testId];
  const label = `${meta?.label || p.testLabel || '기록'}${p.variant === 'knee' ? '(무릎 대고)' : ''}`;
  if (p.valid === false) return `${label}: 무효 또는 확인 필요 기록이라 평가에서 뺍니다.`;
  if (!Number.isFinite(p.value)) return `${label}: 값이 없어 평가하지 않았습니다.`;
  const parts = [`${label} ${p.value}${p.unit || meta?.unit || ''}`];
  if (p.grade) parts.push(`PAPS ${p.subject?.grade || ''} ${p.subject?.sex === 'male' ? '남' : '여'} 기준 ${p.grade}등급(${PAPS_GRADE_WORD[p.grade]})`);
  else if (p.adultLabel) parts.push(`${p.adultReference} → ${p.adultLabel}(국민체력100 항목별 기준, 종합 등급은 전 종목 측정 후)`);
  else parts.push('PAPS 등급은 초3~고3 학생·공식 기준표가 있는 종목에만 붙여서, 이 기록은 값과 변화로 평가합니다');
  const ch = previous ? papsChange({ ...p, valid: true }, previous) : null;
  if (ch) parts.push(`직전 대비 ${ch.diff > 0 ? '+' : ''}${ch.diff}${ch.unit} (${ch.direction === 'improved' ? '좋아짐' : ch.direction === 'worsened' ? '줄어듦' : '동일'})`);
  if (p.recognition && Number.isFinite(p.recognition.ratio)) parts.push(`동작 인식률 ${Math.round(p.recognition.ratio * 100)}%${p.recognition.ratio < 0.7 ? '(낮음 — 카운트는 측정자 확인값 기준)' : ''}`);
  return `${parts.join(' · ')}.`;
}
