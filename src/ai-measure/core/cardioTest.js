// ai-measure/core/cardioTest.js
// ════════════════════════════════════════════════════════════════════════
//  [11번 심폐지구력 2026-11-12] 테스트 정의·기록 요약·VO2max 참고 추정·누적 보정.
//  원칙(프로젝트 설계 원칙: AI가 확정 판정하지 않는다)
//   · 1초 단위 원본(심박·와트·케이던스·거리)을 그대로 저장한다 → 나중에 공식·보정을
//     바꿔도 과거 기록을 다시 계산할 수 있다.
//   · 추정값은 전부 "참고 추정치" + 계산 방법 + 신뢰 등급을 함께 남긴다.
//   · 기록이 쌓일수록 정확해지는 3가지
//       ① 개인 최대심박: 220-나이 → 실제로 찍힌 최고 심박이 더 높으면 그 값으로 교체
//       ② 심박-파워 직선: 같은 회원·같은 장비의 단계 테스트 점을 모아(최근 180일) 다시 맞춤
//       ③ 기준값 보정: 트레이너가 다른 곳에서 잰 실측 VO2max 를 넣어 두면 그 비율로 보정
//  순수 함수만 둔다(화면·블루투스 없음) — 테스트에서 직접 실행해 검증한다.
// ════════════════════════════════════════════════════════════════════════
import { maxHeartRateFromAge } from './heartRateBle';
import { run12Reference, run2400Reference, run15Percentile, vo2maxFromRun12 } from './norms';
import { computeChangeRow, summarizeChanges } from './measurementComparison';

export const CARDIO_RECORD_KIND = 'cardio_test';
export const CARDIO_SERIES_MAX_SEC = 3600; // 1초 단위 원본 저장 상한(1시간)
export const RECOVERY_SEC = 60;             // 테스트 종료 후 회복 심박 기록 시간
const POOL_DAYS = 180;                      // 심박-파워 직선에 모으는 과거 기간

export const CARDIO_MACHINES = {
  rower: { id: 'rower', label: '로잉머신', model: 'KeyTec', cadenceUnit: 'spm', ble: true },
  bike: { id: 'bike', label: '에어바이크', model: 'KeyTec', cadenceUnit: 'rpm', ble: true },
  ski: { id: 'ski', label: '스키에르고미터', model: 'Overmax', cadenceUnit: 'spm', ble: true },
  treadmill: { id: 'treadmill', label: '커브드 트레드밀', model: 'Seared', cadenceUnit: '', ble: false },
  climber: { id: 'climber', label: '마운틴 클라이머', model: '', cadenceUnit: '', ble: false },
  // [2026-11-23] 교재(Laboratory Manual for Exercise Physiology 8장) 현장 테스트 — 트랙·평지·모터 트레드밀. 장비 연결 없음.
  field: { id: 'field', label: '트랙·평지(필드)', model: '교재 8장', cadenceUnit: '', ble: false },
};

export const MILE_M = 1609.344;
export const MILE15_M = 2414; // 1.5마일 = 2.4km (400m 트랙 6바퀴 + 14m)
export const MILE1_M = 1609;  // 1마일 (400m 트랙 4바퀴 + 9m)

// 단계 테스트(최대하) 기본 시작·증가 와트.
export const STEP_DEFAULTS = {
  rower: { startW: 60, incW: 30 },
  bike: { startW: 50, incW: 25 },
  ski: { startW: 40, incW: 20 },
};
export const STEP_STAGE_SEC = 180;
export const STEP_STOP_PCT = 85; // 최대심박의 85%에 닿으면 종료(최대하 원칙)

export const CARDIO_PROTOCOLS = [
  {
    id: 'rower_2k', machines: ['rower'], label: '2000m 기록 테스트', short: '2000m',
    target: { distanceM: 2000 }, maximal: true, estimate: 'hagerman',
    guide: '최대한 빠르게 2000m. 2000m에 닿으면 자동으로 끝나고 1분 회복 심박을 잽니다.',
    caution: '전력 테스트입니다. 재활·고령 회원은 단계 테스트를 쓰세요.',
    info: {
      what: '2000m를 얼마나 빨리 노를 저어 가는지로, 몸이 산소를 최대로 쓰는 능력(심폐지구력)을 추정합니다.',
      how: ['2~3분 가볍게 저으며 몸을 풉니다.', '시작을 누르고 최대한 빠르게 저어 갑니다.', '2000m가 되면 자동으로 끝나고, 1분 동안 가만히 앉아 회복 심박을 잽니다.'],
      read: '2000m 시간이 줄면 좋아진 것입니다. VO2max 숫자는 참고용이고, 같은 장비·같은 방법끼리 비교할 때 가장 정확합니다.',
      care: '전력 테스트입니다. 가슴 통증·어지럼·숨이 비정상적으로 차면 즉시 멈추세요.',
    },
  },
  {
    id: 'bike_astrand', machines: ['bike'], label: 'Åstrand 6분 테스트', short: '6분',
    target: { durationSec: 360 }, maximal: false, estimate: 'astrand',
    guide: '심박이 125~170 사이에 머무는 일정한 와트로 6분. 와트 숫자를 비슷하게 유지하세요.',
    caution: '',
    info: {
      what: '힘들지 않은 일정한 강도로 6분 탈 때 심박이 얼마나 오르는지 보고 최대 능력을 추정합니다. 같은 강도에서 심박이 덜 오를수록 체력이 좋은 것입니다.',
      how: ['와트를 정합니다(대략 여성 50~100W, 남성 75~150W).', '6분 동안 와트와 페달 속도를 일정하게 유지합니다.', '2분쯤 심박이 125보다 낮으면 조금 세게, 170보다 높으면 조금 약하게 조절합니다.', '6분이 되면 자동으로 끝나고 1분 회복 심박을 잽니다.'],
      read: '같은 와트에서 5~6분 심박이 낮아지면 좋아진 것입니다. 5분·6분 심박 차이가 5 이하여야 계산됩니다.',
      care: '심박을 낮추는 약(베타차단제 등)이나 카페인은 결과를 바꿉니다. 메모에 남겨 주세요.',
    },
  },
  {
    id: 'ski_1000', machines: ['ski'], label: '1000m 기록 테스트', short: '1000m',
    target: { distanceM: 1000 }, maximal: true, estimate: null,
    guide: '최대한 빠르게 1000m. 기록·평균 와트·심박을 남겨 회차별로 비교합니다.',
    caution: '전력 테스트입니다.',
    info: {
      what: '팔·몸통 위주의 지구력을 1000m 기록으로 봅니다. 스키에르고미터는 공인된 VO2max 계산식이 없어 기록과 와트로 비교합니다.',
      how: ['2~3분 가볍게 당기며 몸을 풉니다.', '시작을 누르고 최대한 빠르게 1000m를 당깁니다.', '1000m가 되면 자동으로 끝나고 1분 회복 심박을 잽니다.'],
      read: '시간이 줄고 평균 와트가 오르면 좋아진 것입니다. 1분 회복 심박이 커지면 회복이 빨라진 것입니다.',
      care: '전력 테스트입니다. 허리를 과하게 숙이지 않게 봐 주세요.',
    },
  },
  {
    id: 'step', machines: ['rower', 'bike', 'ski'], label: '단계 테스트(최대하)', short: '단계',
    target: { stageSec: STEP_STAGE_SEC }, maximal: false, estimate: 'hrPower',
    guide: `3분마다 목표 와트를 올립니다. 최대심박의 ${STEP_STOP_PCT}%에 닿으면 자동 종료. 재활·고령 회원에게 권장.`,
    caution: '',
    info: {
      what: '3분마다 조금씩 세게 하며 와트별 심박을 잽니다. 그 점들을 직선으로 이어 최대심박일 때의 파워를 추정합니다. 끝까지 전력을 다하지 않아 안전합니다.',
      how: ['화면의 목표 와트에 맞춰 운동합니다.', '3분마다 자동으로 다음 단계로 넘어가고 목표 와트가 올라갑니다.', '최대심박의 85%에 닿으면 자동으로 끝나고 1분 회복 심박을 잽니다.'],
      read: '추정 최대 파워가 오르면 좋아진 것입니다. 같은 장비로 반복할수록 점이 쌓여 신뢰 등급이 C→B→A로 올라갑니다. 에어바이크는 VO2max도 함께 계산합니다.',
      care: '재활·고령 회원에게 권장하는 방식입니다. 단계마다 와트를 목표에 최대한 맞춰야 정확합니다.',
    },
  },
  // [2026-11-23 교재 8장 현장 테스트] 평지(400m 트랙·야외·모터 트레드밀) 기준. 커브드와 달리 교재 표 8.2 백분위를 화면에 보여 준다.
  {
    id: 'field_cooper15', machines: ['field'], label: '쿠퍼 1.5마일 달리기/걷기', short: '1.5마일', basis: 'flat',
    target: { distanceM: MILE15_M }, maximal: true, estimate: 'cooper15',
    guide: '2.4km(400m 트랙 6바퀴+14m)를 최대한 빨리. 끝나는 순간 "운동 끝"을 누르거나 시간(분:초)을 입력합니다.',
    caution: '전력 테스트입니다. 운동 전 건강 점검이 필요하고, 운동 안 하던 분·심장 위험요인이 있는 분께는 권하지 않습니다(ACSM).',
    info: {
      what: '2.4km를 얼마나 빨리 가는지로 심폐지구력(VO2max)을 추정합니다. 걸어도 되지만 목표는 최대한 빨리 가는 것입니다.',
      how: ['체중을 재서 입력합니다(0.1kg 단위).', '약 10분 몸풀기(가벼운 달리기 5분 + 동적 스트레칭 5분).', '"시작"을 누르는 순간 출발합니다. 400m 트랙이면 6바퀴 + 14m.', '도착하면 "운동 끝"을 누르고 시간을 확인합니다(초 단위).', '천천히 걷고 스트레칭으로 마무리합니다.'],
      read: '시간이 줄면 좋아진 것입니다. 같은 나이·성별 백분위(교재 표 8.2)와 함께 봅니다. 추정 오차는 약 6%입니다.',
      care: '의욕·페이스 배분에 따라 결과가 크게 달라집니다. 가슴 통증·어지럼이 있으면 즉시 멈추세요.',
    },
  },
  {
    id: 'field_cooper12', machines: ['field'], label: '쿠퍼 12분 달리기/걷기', short: '12분', basis: 'flat',
    target: { durationSec: 720 }, maximal: true, estimate: 'cooper12',
    guide: '12분 동안 최대한 멀리. 12분이 되면 자동으로 끝나고, 간 거리(m)를 입력합니다. 400m 트랙은 바퀴 수×400m.',
    caution: '전력 테스트입니다. 운동 안 하던 분·심장 위험요인이 있는 분께는 권하지 않습니다(ACSM).',
    info: {
      what: '12분 동안 간 거리로 심폐지구력(VO2max)을 추정합니다(Cooper 1968 공식).',
      how: ['약 10분 몸풀기.', '"시작"과 동시에 출발, 12분 동안 최대한 멀리 갑니다.', '12분이 되면 앱이 알려 줍니다. 그 자리에서 멈춰 간 거리(m)를 확인합니다.', '결과 화면에 거리(m)를 입력합니다.'],
      read: '거리가 늘면 좋아진 것입니다. 연구마다 실측 VO2max와의 상관이 크게 다르므로(r=0.28~0.94) 참고용입니다.',
      care: '일정한 속도로 가는 것이 중요합니다. 가슴 통증·어지럼이 있으면 즉시 멈추세요.',
    },
  },
  {
    id: 'field_rockport', machines: ['field'], label: '록포트 1마일 걷기(최대하)', short: '1마일 걷기', basis: 'flat',
    target: { distanceM: MILE1_M }, maximal: false, estimate: 'rockport', needsHrAfter: true,
    guide: '1마일(1.6km, 400m 트랙 4바퀴+9m)을 가장 빠른 걸음으로. 끝나면 바로 15초 맥박×4 또는 밴드 심박을 입력합니다.',
    caution: '',
    info: {
      what: '1마일을 걷는 시간과 끝난 직후 심박으로 VO2max를 추정합니다. 달리지 않아 부담이 적어 일반·고령 회원에게 맞습니다.',
      how: ['체중·나이·성별을 확인합니다.', '"시작"과 동시에 최대한 빠르게 걷습니다(뛰지 않습니다).', '도착하면 "운동 끝"을 누르고 곧바로 15초 동안 맥박을 세어 ×4 합니다(손목·목 동맥, 엄지 금지). 목은 세게 누르지 않습니다.', '결과 화면에 종료 직후 심박을 입력합니다(밴드를 쓰면 자동으로 채웁니다).'],
      read: '같은 걸음이라도 끝난 직후 심박이 낮을수록 체력이 좋은 것입니다. 대학생 연령 남녀는 과대추정 보고가 있어 참고용입니다.',
      care: '걷는 속도는 "가장 빠르게"여야 합니다. 느리면 과소추정됩니다.',
    },
  },
  {
    id: 'field_bruce', machines: ['field'], label: '브루스 트레드밀(모터 트레드밀)', short: '브루스', basis: 'flat',
    target: {}, maximal: true, estimate: 'bruce', bruceStageSec: 180,
    guide: '3분마다 속도·경사를 올립니다(1.7→2.5→3.4→4.2→5.0→5.5mph). 더 못 가는 순간 "운동 끝"을 누르면 총 시간으로 VO2max를 추정합니다.',
    caution: '한계까지 가는 테스트입니다. 모터 트레드밀·건강 점검·중단 기준 확인이 필요하고 재활·고령 회원에게는 권하지 않습니다.',
    info: {
      what: '브루스 프로토콜에서 버틴 총 시간으로 VO2max를 추정합니다(교재 9장). 단계 시간(3분)을 정확히 지켜야 식이 맞습니다.',
      how: ['체중·나이·성별을 입력하고 3~5분 첫 단계 이하 강도로 몸을 풉니다.', '첫 단계를 시작하는 순간 "시작"을 누릅니다.', '3분마다 속도와 경사를 올립니다(화면에 현재 단계 표시).', '더 못 가거나 손잡이를 잡거나 중단 기준이 생기면 "운동 끝"을 누르고 속도 3mph·경사 0%로 5분 이상 걷습니다(심박 120 이하까지).'],
      read: '총 시간이 늘면 좋아진 것입니다. 식의 상관은 남 r=0.98, 여 r=0.91입니다.',
      care: '손잡이를 잡고 버티면 시간이 늘어 과대추정됩니다. 뒤에서 한 명이 받쳐 주세요.',
    },
  },
  // [2026-11-17 커브드 트레드밀] 시어드 커브드 트레드밀 전용 — 콘솔에 거리(DIS., 10m 단위)·시간이 나온다. 블루투스 연결은 없다.
  //  커브드는 같은 속도에서도 평지보다 훨씬 힘들어 교재 표(평지 기준)로 등급을 내지 않는다.
  //  같은 회원의 같은 테스트끼리 회차 변화로 본다. 교재 표 대비 위치는 연구용으로만 저장한다(researchData.js).
  {
    id: 'curved_2400', machines: ['treadmill'], label: '2.4km 달리기(커브드)', short: '2.4km', basis: 'curved',
    target: { distanceM: 2400 }, maximal: true, estimate: null,
    guide: '커브드 트레드밀에서 2.4km를 최대한 빠르게. 콘솔 DIS.가 2.40이 되는 순간 "운동 끝"을 누르고 콘솔 TIME을 입력합니다.',
    caution: '전력 테스트입니다. 재활·고령 회원에게는 권하지 않습니다.',
    info: {
      what: '2.4km(1.5마일)를 얼마나 빨리 달리는지로 심폐지구력을 봅니다. 시간이 줄면 좋아진 것입니다.',
      how: ['3~5분 가볍게 걷거나 뛰며 몸을 풉니다.', '벨트를 돌리기 시작하는 순간 "시작"을 누릅니다.', '콘솔 DIS.가 2.40이 되면 바로 "운동 끝"을 누릅니다.', '결과 화면에 콘솔 TIME(분:초)을 입력해 정확한 시간을 남깁니다.'],
      read: '같은 회원이 같은 커브드 트레드밀에서 반복했을 때의 시간 변화로 봅니다. 평지 달리기 표와 직접 비교하지 않습니다.',
      care: '전력 테스트입니다. 가슴 통증·어지럼이 있으면 즉시 멈추세요. 커브드는 몸무게와 달리는 방식에 따라 힘든 정도가 달라집니다.',
    },
  },
  {
    id: 'curved_12min', machines: ['treadmill'], label: '12분 달리기(커브드)', short: '12분', basis: 'curved',
    target: { durationSec: 720 }, maximal: true, estimate: null,
    guide: '커브드 트레드밀에서 12분 동안 최대한 멀리. 12분이 되면 자동으로 끝나고, 콘솔 DIS. 값을 입력합니다.',
    caution: '전력 테스트입니다. 재활·고령 회원에게는 권하지 않습니다.',
    info: {
      what: '12분 동안 얼마나 멀리 달리는지로 심폐지구력을 봅니다. 거리가 늘면 좋아진 것입니다.',
      how: ['3~5분 가볍게 걷거나 뛰며 몸을 풉니다.', '벨트를 돌리기 시작하는 순간 "시작"을 누릅니다.', '12분이 되면 앱이 알려 주고, 곧바로 콘솔 DIS.를 확인합니다(예: 2.43 → 2430m).', '결과 화면에 콘솔 DIS. 값을 입력합니다.'],
      read: '같은 회원이 같은 커브드 트레드밀에서 반복했을 때의 거리 변화로 봅니다. 콘솔 거리는 10m 단위입니다.',
      care: '전력 테스트입니다. 속도를 일정하게 유지하는 것이 중요합니다.',
    },
  },
  {
    id: 'free', machines: ['rower', 'bike', 'ski', 'treadmill', 'climber'], label: '자유 기록', short: '자유',
    target: {}, maximal: false, estimate: null,
    guide: '정해진 방식 없이 운동 내용을 그대로 기록합니다.',
    caution: '',
    info: {
      what: '정해진 테스트 없이 운동(인터벌 수업 등)을 그대로 기록합니다.',
      how: ['시작을 누르고 평소처럼 운동합니다.', '끝나면 "운동 끝"을 눌러 1분 회복 심박을 잽니다.'],
      read: '심박·와트 그래프와 1분 회복 심박으로 그날 컨디션과 변화를 비교합니다. VO2max는 계산하지 않습니다.',
      care: '',
    },
  },
];

// 결과 화면 '용어 설명'
// Tanaka(2001): 208 − 0.7×나이 — 이제 기본 최대심박 식이다(heartRateBle.maxHeartRateFromAge 와 같은 값).
export const hrMaxTanaka = (age) => (Number(age) > 0 ? Math.round(208 - 0.7 * Number(age)) : null);

export const CARDIO_GLOSSARY = [
  ['오차 범위(SEE)', '추정식이 평균적으로 틀리는 크기. 추정값 ±SEE 안에 실제 값이 있을 확률이 약 68%, ±2SEE 안이면 약 95%입니다(교재 4장).'],
  ['설명력(r²)', '상관계수 r을 제곱한 값. 예: r=0.90이면 81%는 이 테스트로 설명되고 19%는 설명되지 않는 오차입니다.'],
  ['중단 기준', '가슴 통증·협심증 느낌 / 운동을 늘려도 심박이 오르지 않음 / 어지럼·창백·구역·식은땀·혼동 / 숨참·쌕쌕거림·다리 경련 / 심장박동 이상 / 본인이 멈추길 원함 / 장비 고장 — 하나라도 있으면 바로 멈춥니다(ACSM).'],
  ['VO2max', '1분에 몸 1kg이 쓸 수 있는 최대 산소량(mL/kg/min). 클수록 심폐지구력이 좋습니다. 여기 값은 호흡가스 검사가 아닌 참고 추정치입니다.'],
  ['1분 회복 심박', '운동이 끝난 직후 심박에서 1분 뒤 심박을 뺀 값. 클수록 회복이 빠릅니다.'],
  ['최대심박', '처음엔 208−0.7×나이(Tanaka)로 계산하고, 실제로 그보다 높게 찍힌 기록이 생기면 그 값으로 바뀝니다.'],
  ['신뢰 등급', 'A: 3회차 이상·점 6개 이상이 직선에 잘 맞음 / B: 점 3개 이상이 잘 맞음 / C: 기록이 적거나 공식이 장비와 다름(참고만).'],
  ['보정', '다른 곳에서 잰 실측 VO2max를 넣어 두면, 그 회원의 다음 추정값을 실측/추정 비율로 맞춥니다.'],
];

export function protocolsForMachine(machineId) {
  return CARDIO_PROTOCOLS.filter((p) => p.machines.includes(machineId));
}
export function getProtocol(id) {
  return CARDIO_PROTOCOLS.find((p) => p.id === id) || null;
}

// 콘솔 거리 입력: 'DIS. 2.43'(km) 또는 2430(m) 모두 받는다. 50 이하이거나 소수점이 있으면 km 로 본다.
export function parseDistanceM(raw) {
  const t = String(raw ?? '').replace(',', '.').replace(/[^\d.]/g, '');
  if (!t || t === '.') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  const m = t.includes('.') || n <= 50 ? n * 1000 : n;
  return Math.round(m / 10) * 10; // 콘솔 단위(10m)
}

// 커브드 테스트: 같은 회원·같은 장비·같은 테스트끼리의 직전 기록과 비교(시간은 짧을수록, 거리는 길수록 좋음)
export function curvedComparison(current, previous) {
  const c = current && typeof current === 'object' ? current : null;
  const p = previous && typeof previous === 'object' ? previous : null;
  if (!c || !p || c.protocolId !== p.protocolId || c.machineId !== p.machineId) return null;
  const proto = getProtocol(c.protocolId);
  if (proto?.basis !== 'curved') return null;
  const isTime = Boolean(proto.target?.distanceM);
  const cur = isTime ? c.result?.durationSec : c.result?.distanceM;
  const prev = isTime ? p.result?.durationSec : p.result?.distanceM;
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  const diff = cur - prev;
  const better = isTime ? diff < 0 : diff > 0;
  return { kind: isTime ? 'time' : 'distance', current: cur, previous: prev, diff, direction: diff === 0 ? 'same' : (better ? 'improved' : 'worsened'), previousDate: String(p.startedAt || p.endedAt || '').slice(0, 10) };
}

// [전·후 비교 2026-11-23] 일반(비 커브드) 심폐지구력 측정도 같은 장비·같은 테스트의 직전 기록과 비교한다.
//  VO2max 추정·최대파워·거리·평균와트·1분 회복은 클수록 좋고, 정해진 거리 테스트의 시간은 짧을수록 좋다.
//  평균 심박은 같은 부하일 때만 의미가 있어 '자유 측정'이 아닌 정해진 테스트에서만 비교한다(낮을수록 좋음).
export function cardioChangeSummary(current, previous) {
  const c = current && typeof current === 'object' ? current : null;
  const p = previous && typeof previous === 'object' ? previous : null;
  if (!c || !p || c.protocolId !== p.protocolId || c.machineId !== p.machineId) return null;
  const proto = getProtocol(c.protocolId);
  const v = (r) => (Number.isFinite(r?.confirmedVo2max) ? r.confirmedVo2max : (r?.estimates?.vo2max?.calibratedValue ?? r?.estimates?.vo2max?.value));
  const rows = [
    computeChangeRow('VO2max(참고)', v(p), v(c), '', 'higherBetter'),
    computeChangeRow('추정 최대파워', p.estimates?.maxPower?.value, c.estimates?.maxPower?.value, 'W', 'higherBetter'),
    computeChangeRow('거리', p.result?.distanceM, c.result?.distanceM, 'm', 'higherBetter'),
    proto?.target?.distanceM ? computeChangeRow('기록 시간', p.result?.durationSec, c.result?.durationSec, '초', 'lowerBetter') : null,
    computeChangeRow('평균 와트', p.result?.avgPowerW, c.result?.avgPowerW, 'W', 'higherBetter'),
    c.protocolId !== 'free' ? computeChangeRow('평균 심박', p.result?.avgHr, c.result?.avgHr, 'bpm', 'lowerBetter') : null,
    computeChangeRow('1분 회복', p.recovery?.drop60, c.recovery?.drop60, 'bpm', 'higherBetter'),
  ];
  return summarizeChanges(rows, String(p.startedAt || p.endedAt || p.measuredAt || '').slice(0, 10));
}

export function normalizeSex(v) {
  const s = String(v || '').toLowerCase();
  if (!s) return null;
  if (s.startsWith('f') || s.includes('여') || s === 'w' || s.includes('woman')) return 'female';
  if (s.startsWith('m') || s.includes('남')) return 'male';
  return null;
}

// ── 1초 단위 기록 ────────────────────────────────────────────────────────
// 화면이 1초마다 tick({ hr, powerW, cadence, distanceM }) 을 넣는다.
// 거리는 장비 누적값 → 시작 시점 값을 빼서 이번 테스트 거리로 바꾼다.
export function createRecorder() {
  return { t: [], hr: [], w: [], cad: [], dist: [], startDist: null };
}

const num = (v) => (Number.isFinite(v) ? v : null);

export function recordTick(rec, sec, { hr = null, powerW = null, cadence = null, distanceM = null } = {}) {
  if (!rec || rec.t.length >= CARDIO_SERIES_MAX_SEC) return rec;
  let d = num(distanceM);
  if (d != null) {
    if (rec.startDist == null || d < rec.startDist) rec.startDist = d; // 장비가 거리를 0으로 되돌린 경우 다시 기준
    d = d - rec.startDist;
  }
  rec.t.push(Math.round(sec));
  rec.hr.push(num(hr) != null && hr >= 30 && hr <= 240 ? Math.round(hr) : null);
  rec.w.push(num(powerW) != null && powerW >= 0 && powerW <= 3000 ? Math.round(powerW) : null);
  rec.cad.push(num(cadence) != null && cadence >= 0 && cadence <= 250 ? Math.round(cadence) : null);
  rec.dist.push(d != null ? Math.round(d) : null);
  return rec;
}

function vals(arr, from = 0, to = arr.length) {
  return arr.slice(from, to).filter((v) => v != null);
}
function mean(arr) {
  const v = arr.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
const r0 = (v) => (v == null ? null : Math.round(v));
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

// 5초 구간 중앙값의 최대 — 순간 튀는 값(접촉 불량)이 최대심박으로 잡히지 않게.
function median(v) {
  const s = [...v].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
export function smoothedMax(arr, win = 5) {
  let best = null;
  for (let i = 0; i + win <= arr.length; i += 1) {
    const w = vals(arr, i, i + win);
    if (w.length < Math.ceil(win * 0.6)) continue;
    const m = median(w);
    if (best == null || m > best) best = m;
  }
  return r0(best);
}

export function lastDistance(rec) {
  for (let i = rec.dist.length - 1; i >= 0; i -= 1) if (rec.dist[i] != null) return rec.dist[i];
  return null;
}

// 구간 [from, to) 초의 평균
export function windowAvg(rec, key, fromSec, toSec) {
  const out = [];
  for (let i = 0; i < rec.t.length; i += 1) {
    if (rec.t[i] >= fromSec && rec.t[i] < toSec && rec[key][i] != null) out.push(rec[key][i]);
  }
  return mean(out);
}

// 운동 구간 요약 (회복 구간은 제외: workEndSec 이전만)
export function summarizeWork(rec, workEndSec) {
  const end = rec.t.findIndex((s) => s >= workEndSec);
  const idx = end === -1 ? rec.t.length : end;
  const sub = { hr: rec.hr.slice(0, idx), w: rec.w.slice(0, idx), cad: rec.cad.slice(0, idx), dist: rec.dist.slice(0, idx) };
  const durationSec = Math.round(workEndSec);
  let distanceM = null;
  for (let i = sub.dist.length - 1; i >= 0; i -= 1) if (sub.dist[i] != null) { distanceM = sub.dist[i]; break; }
  const hrN = vals(sub.hr).length;
  return {
    durationSec,
    distanceM,
    avgPowerW: r0(mean(sub.w)),
    maxPowerW: sub.w.some((v) => v != null) ? Math.max(...vals(sub.w)) : null,
    avgCadence: r0(mean(sub.cad)),
    avgHr: r0(mean(sub.hr)),
    peakHr: smoothedMax(sub.hr),
    paceSec500: distanceM ? r1(durationSec / (distanceM / 500)) : null,
    hrCoveragePct: idx ? Math.round((hrN / idx) * 100) : 0,
    powerCoveragePct: idx ? Math.round((vals(sub.w).length / idx) * 100) : 0,
  };
}

// 회복 심박: 운동 끝(마지막 10초 평균) − 60초 뒤(55~65초 평균)
export function summarizeRecovery(rec, workEndSec) {
  const endHr = windowAvg(rec, 'hr', workEndSec - 10, workEndSec + 1);
  const hr60 = windowAvg(rec, 'hr', workEndSec + 55, workEndSec + 66);
  return {
    endHr: r0(endHr),
    hr60: r0(hr60),
    drop60: endHr != null && hr60 != null ? r0(endHr - hr60) : null,
  };
}

// 단계 테스트: 각 단계 마지막 60초 평균(심박이 안정된 구간)
export function summarizeStages(rec, workEndSec, stageSec = STEP_STAGE_SEC) {
  const stages = [];
  for (let s = 0; s * stageSec < workEndSec; s += 1) {
    const from = s * stageSec;
    const to = Math.min((s + 1) * stageSec, workEndSec);
    const complete = to - from >= stageSec * 0.9;
    const avgW = windowAvg(rec, 'w', Math.max(from, to - 60), to);
    const avgHr = windowAvg(rec, 'hr', Math.max(from, to - 60), to);
    stages.push({ stage: s + 1, fromSec: from, toSec: Math.round(to), complete, avgPowerW: r0(avgW), avgHr: r0(avgHr) });
  }
  return stages;
}

// ── 추정 공식 ──────────────────────────────────────────────────────────
// 로잉 2000m → Hagerman(Concept2 계산기 근거): VO2(mL/min) = 14.72 × W + 250.39
//  W 는 2000m 기록(시간)에서 Concept2 파워 공식 W = 2.8 / (초/미터)^3 으로 구한다.
export function wattsFromPace(timeSec, distanceM) {
  if (!timeSec || !distanceM) return null;
  const secPerM = timeSec / distanceM;
  return 2.8 / (secPerM ** 3);
}
export function hagermanVo2max({ timeSec, distanceM, weightKg }) {
  const w = wattsFromPace(timeSec, distanceM);
  if (!w || !weightKg) return null;
  return r1((14.72 * w + 250.39) / weightKg);
}

// Åstrand(1954/1960) 나이 보정 계수. 사이 나이는 직선 보간.
const ASTRAND_AGE = [[15, 1.1], [25, 1.0], [35, 0.87], [40, 0.83], [45, 0.78], [50, 0.75], [55, 0.71], [60, 0.68], [65, 0.65]];
// ── [2026-11-23] 교재 8장 공식 ──────────────────────────────────────────────
// 쿠퍼 1.5마일(남/여 따로): VO2max = 상수 − 0.1656×체중(kg) − 2.767×시간(분)  (r=0.90, SEE≈6%)
export function cooper15Vo2max({ sex, weightKg, timeSec }) {
  const kg = Number(weightKg); const t = Number(timeSec) / 60;
  const c = sex === 'male' ? 91.736 : sex === 'female' ? 88.020 : null;
  if (!c || !(kg > 0) || !(t > 0)) return null;
  return r1(c - 0.1656 * kg - 2.767 * t);
}
// 교재 '다른 방법'(성별 변수형, r=0.86, SEE 3.37): 65.404 + 7.707×성별(남1) − 0.159×체중 − 0.843×시간 — 비교용으로만 저장
export function cooper15Vo2maxAlt({ sex, weightKg, timeSec }) {
  const kg = Number(weightKg); const t = Number(timeSec) / 60;
  if (!(sex === 'male' || sex === 'female') || !(kg > 0) || !(t > 0)) return null;
  return r1(65.404 + (sex === 'male' ? 7.707 : 0) - 0.159 * kg - 0.843 * t);
}
// 록포트 1마일 걷기. 18~29세: Dolgener 식(체중 lb 계수 0.0957), 30~79세: Kline 식.
// ※ 교재 190쪽은 30~79세 식의 체중 계수 0.1692 를 'lbs'로 적었지만 0.1692 는 kg 기준(= lb 기준 0.0769)이다.
//    교재대로 lb 에 곱하면 값이 약 15 낮게 나와 kg 에 곱한다(상수 132.853·139.168 과 18~29세 식의 상수 차이로 교차 검증).
export function rockportVo2max({ sex, age, weightKg, timeSec, hr }) {
  const kg = Number(weightKg); const a = Number(age); const t = Number(timeSec) / 60; const h = Number(hr);
  if (!(sex === 'male' || sex === 'female') || !(kg > 0) || !(a >= 18 && a <= 79) || !(t > 0) || !(h >= 60 && h <= 220)) return null;
  const lb = kg * 2.20462;
  const male = sex === 'male';
  const v = a < 30
    ? (male ? 97.660 : 88.768) - 0.0957 * lb - 1.4537 * t - 0.1194 * h
    : (male ? 139.168 : 132.853) - 0.3877 * a - 0.1692 * kg - 3.2649 * t - 0.1565 * h;
  return r1(v);
}

// [2026-11-23 교재 4장 상관·예측] 추정값에 오차 범위(SEE)와 설명력(r²)을 붙인다. 교재: 오차는 정규분포라 ±1 SEE 안에 약 68%, ±2 SEE 안에 약 95%.
// 값은 교재 8·9장에 적힌 것만 쓴다(없으면 null): 쿠퍼 1.5마일 r=0.90·SEE 약 6%, 록포트 SEE 범위(연령·성별별), 브루스 r=0.98(남)/0.91(여).
export function estimateAccuracy(method, value, { sex, age } = {}) {
  const v = Number(value);
  if (!(v > 0)) return null;
  let r = null; let seeLow = null; let seeHigh = null;
  if (method === 'cooper15') { r = 0.90; seeLow = seeHigh = r1(v * 0.06); }
  else if (method === 'bruce') { r = sex === 'male' ? 0.98 : sex === 'female' ? 0.91 : null; }
  else if (method === 'rockport') {
    const young = Number(age) < 30;
    [seeLow, seeHigh] = young ? (sex === 'male' ? [3.5, 5.8] : [3.0, 4.8]) : (sex === 'male' ? [4.5, 5.3] : [2.7, 5.3]);
  } else return null;
  const out = { r, r2: r ? Math.round(r * r * 100) : null, seeLow, seeHigh };
  if (seeHigh != null) { out.range68 = [r1(v - seeHigh), r1(v + seeHigh)]; out.range95 = [r1(v - 2 * seeHigh), r1(v + 2 * seeHigh)]; }
  return out;
}

// Bruce 프로토콜 총 시간(분)로 VO2max 추정(교재 9장): 남 14.76 − 1.379T + 0.451T² − 0.012T³ (r=0.98), 여 4.38T − 3.90 (r=0.91)
export function bruceVo2max({ sex, timeSec }) {
  const T = Number(timeSec) / 60;
  if (!(T >= 1 && T <= 30)) return null;
  if (sex === 'male') return r1(14.76 - 1.379 * T + 0.451 * T * T - 0.012 * T * T * T);
  if (sex === 'female') return r1(4.38 * T - 3.90);
  return null;
}
export const BRUCE_STAGES_MPH = [1.7, 2.5, 3.4, 4.2, 5.0, 5.5];
export const bruceStageAt = (sec) => {
  const i = Math.min(BRUCE_STAGES_MPH.length - 1, Math.floor(Math.max(0, sec) / 180));
  return { stage: i + 1, mph: BRUCE_STAGES_MPH[i], nextInSec: i === BRUCE_STAGES_MPH.length - 1 ? null : 180 - (sec % 180) };
};

export function astrandAgeFactor(age) {
  const a = Number(age);
  if (!Number.isFinite(a)) return 1;
  if (a <= ASTRAND_AGE[0][0]) return ASTRAND_AGE[0][1];
  for (let i = 1; i < ASTRAND_AGE.length; i += 1) {
    const [x1, y1] = ASTRAND_AGE[i];
    const [x0, y0] = ASTRAND_AGE[i - 1];
    if (a <= x1) return y0 + ((a - x0) / (x1 - x0)) * (y1 - y0);
  }
  return ASTRAND_AGE[ASTRAND_AGE.length - 1][1];
}
// workload: 와트 × 6.12 = kg·m/min. 결과 L/min → 나이 보정 → mL/kg/min
export function astrandVo2max({ sex, watts, hrSs, age, weightKg }) {
  if (!watts || !hrSs || !weightKg || !sex) return null;
  const load = watts * 6.12;
  const lpm = sex === 'female'
    ? ((0.00193 * load + 0.326) / (0.769 * hrSs - 56.1)) * 100
    : ((0.00212 * load + 0.299) / (0.769 * hrSs - 48.5)) * 100;
  if (!Number.isFinite(lpm) || lpm <= 0) return null;
  return r1((lpm * astrandAgeFactor(age) * 1000) / weightKg);
}

// 최소제곱 직선 y = a + b·x 와 결정계수 r²
export function linearFit(points) {
  const p = points.filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
  const n = p.length;
  if (n < 2) return null;
  const mx = p.reduce((s, q) => s + q.x, 0) / n;
  const my = p.reduce((s, q) => s + q.y, 0) / n;
  let sxx = 0; let sxy = 0; let syy = 0;
  for (const q of p) { sxx += (q.x - mx) ** 2; sxy += (q.x - mx) * (q.y - my); syy += (q.y - my) ** 2; }
  if (sxx === 0) return null;
  const b = sxy / sxx;
  const a = my - b * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { a, b, r2, n };
}

// 신뢰 등급: 점 개수·직선 적합도·모은 회차 수
export function confidenceGrade({ n = 0, r2 = 0, sessions = 1 } = {}) {
  if (n >= 6 && r2 >= 0.9 && sessions >= 3) return 'A';
  if (n >= 3 && r2 >= 0.85) return 'B';
  return 'C';
}

// ── 누적 데이터 ────────────────────────────────────────────────────────
// 이 회원의 과거 15번 기록(ai 세션) 중 같은 장비 기록만 고른다.
export function pastCardioRecords(sessions = [], machineId, { now = Date.now(), days = POOL_DAYS } = {}) {
  return (Array.isArray(sessions) ? sessions : [])
    .map((s) => s?.data)
    .filter((d) => d && d.kind === CARDIO_RECORD_KIND && d.machineId === machineId)
    .filter((d) => {
      const at = Date.parse(d.startedAt || '');
      return !Number.isFinite(at) || now - at <= days * 86400000;
    });
}

// 개인 최대심박: 220-나이 와 실제 기록된 최고 심박(전력 테스트 포함 전체) 중 큰 값.
// [2026-11-23] 기본값은 Tanaka 208−0.7×나이. 실제 기록 최고 심박은 '실내(장비)'와 '필드(트랙·평지)'를 나눠 모은다 —
// 로잉·스키 등 장비는 달리기보다 최고 심박이 낮게 찍혀서 섞으면 한쪽 최대심박이 틀어진다. context 를 주면 같은 쪽 기록만 쓴다.
export const cardioContext = (machineId) => (machineId === 'field' ? 'field' : 'indoor');
export function personalMaxHr({ age, sessions = [], currentPeak = null, context = null }) {
  const byAge = maxHeartRateFromAge(age);
  let observed = Number.isFinite(currentPeak) ? currentPeak : null;
  for (const s of Array.isArray(sessions) ? sessions : []) {
    const d = s?.data;
    if (context && d?.machineId && cardioContext(d.machineId) !== context) continue;
    if (d?.kind === CARDIO_RECORD_KIND && Number.isFinite(d?.result?.peakHr)) {
      observed = observed == null ? d.result.peakHr : Math.max(observed, d.result.peakHr);
    }
  }
  if (observed != null && byAge != null && observed > byAge) return { value: observed, source: 'observed' };
  if (byAge != null) return { value: byAge, source: 'age' };
  if (observed != null) return { value: observed, source: 'observed' };
  return { value: null, source: 'none' };
}

// 기준값 보정 계수: 과거 기록 중 (참고 추정, 트레이너가 넣은 실측) 쌍의 비율 중앙값.
export function calibrationFactor(past = [], method) {
  const ratios = past
    .filter((d) => d?.estimates?.vo2max?.method === method && Number.isFinite(d?.referenceVo2max) && Number.isFinite(d?.estimates?.vo2max?.value) && d.estimates.vo2max.value > 0)
    .map((d) => d.referenceVo2max / d.estimates.vo2max.value)
    .filter((x) => x > 0.5 && x < 1.5)
    .sort((a, b) => a - b);
  if (!ratios.length) return null;
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return { factor: Math.round(median * 1000) / 1000, pairs: ratios.length };
}

// ── 전체 계산 ──────────────────────────────────────────────────────────
// rec: 1초 기록, workEndSec: 운동 끝(회복 시작) 초, subject: { age, sex, weightKg }
// past: pastCardioRecords() 결과, allSessions: 최대심박 계산용 전체 세션
// manual: 장비 미연결 시 트레이너 수기 입력 { timeSec, distanceM, avgPowerW }
export function computeCardioResult({ protocolId, machineId, rec, workEndSec, subject = {}, past = [], allSessions = [], manual = null, stageSec = STEP_STAGE_SEC }) {
  const protocol = getProtocol(protocolId);
  const result = summarizeWork(rec, workEndSec);
  if (manual) {
    if (Number.isFinite(manual.timeSec) && manual.timeSec > 0) { result.durationSec = Math.round(manual.timeSec); result.manualTime = true; }
    if (Number.isFinite(manual.distanceM) && manual.distanceM > 0) { result.distanceM = Math.round(manual.distanceM); result.manualDistance = true; }
    if (Number.isFinite(manual.hrAfter) && manual.hrAfter > 0) result.hrAfter = Math.round(manual.hrAfter);
    if (Number.isFinite(manual.avgPowerW) && manual.avgPowerW > 0) { result.avgPowerW = Math.round(manual.avgPowerW); result.manualPower = true; }
    if (result.distanceM && result.durationSec) result.paceSec500 = r1(result.durationSec / (result.distanceM / 500));
  }
  // [2026-11-17] 커브드 2.4km: 끝낼 때 DIS.=2.40 이라 거리는 2400m 로 본다(입력이 없을 때). 12분: 시간은 720초.
  if (protocol?.basis === 'curved' || protocol?.basis === 'flat') {
    if (protocol.target?.distanceM && !(result.distanceM > 0)) { result.distanceM = protocol.target.distanceM; result.distanceAssumed = true; }
    if (protocol.target?.durationSec && !result.manualTime && Math.abs(result.durationSec - protocol.target.durationSec) <= 5) result.durationSec = protocol.target.durationSec;
  }
  const recovery = summarizeRecovery(rec, workEndSec);
  const hrMax = personalMaxHr({ age: subject.age, sessions: allSessions, currentPeak: result.peakHr, context: cardioContext(machineId) });
  const sex = normalizeSex(subject.sex);
  const weightKg = Number(subject.weightKg) || null;
  const estimates = { vo2max: null, maxPower: null };
  let stages = null;
  const notes = [];

  if (protocol?.estimate === 'hagerman') {
    const done = result.distanceM != null && result.distanceM >= (protocol.target.distanceM || 2000) * 0.98;
    const value = done ? hagermanVo2max({ timeSec: result.durationSec, distanceM: result.distanceM, weightKg }) : null;
    estimates.vo2max = {
      value, method: 'hagerman', unit: 'mL/kg/min', grade: value ? 'C' : null, valid: Boolean(value),
      reason: !done ? '2000m를 끝까지 하지 않아 계산하지 않았습니다.' : !weightKg ? '체중이 없어 계산하지 않았습니다.' : 'Concept2 기준 공식이라 다른 장비에서는 참고용입니다.',
    };
  }

  if (protocol?.estimate === 'astrand') {
    const hr5 = windowAvg(rec, 'hr', 240, 300);
    const hr6 = windowAvg(rec, 'hr', 300, 360);
    const watts = result.manualPower ? result.avgPowerW : windowAvg(rec, 'w', 240, 360);
    const hrSs = hr5 != null && hr6 != null ? (hr5 + hr6) / 2 : null;
    const steady = hr5 != null && hr6 != null && Math.abs(hr6 - hr5) <= 5;
    const inRange = hrSs != null && hrSs >= 125 && hrSs <= 170;
    const longEnough = workEndSec >= 350;
    const value = steady && inRange && longEnough ? astrandVo2max({ sex, watts, hrSs, age: subject.age, weightKg }) : null;
    estimates.vo2max = {
      value, method: 'astrand', unit: 'mL/kg/min', grade: value ? 'C' : null, valid: Boolean(value),
      hrSs: r0(hrSs), watts: r0(watts),
      reason: !longEnough ? '6분을 채우지 않아 계산하지 않았습니다.'
        : hrSs == null ? '5~6분 심박이 기록되지 않았습니다.'
          : !inRange ? `안정 심박 ${r0(hrSs)}이 125~170 밖이라 공식 적용이 안 됩니다. 와트를 조절해 다시 하세요.`
            : !steady ? '5분·6분 심박 차이가 5보다 커서 안정 상태가 아닙니다. 1분 더 하거나 다시 하세요.'
              : !sex || !weightKg ? '성별·체중이 없어 계산하지 않았습니다.'
                : '에어바이크 와트의 정밀도가 확인되지 않아 참고용입니다.',
    };
  }

  if (protocol?.estimate === 'hrPower') {
    stages = summarizeStages(rec, workEndSec, stageSec);
    const nowPts = stages.filter((s) => s.complete && s.avgPowerW > 0 && s.avgHr >= 90).map((s) => ({ x: s.avgPowerW, y: s.avgHr }));
    const pastPts = [];
    let pastSessions = 0;
    for (const d of past) {
      if (d.protocolId !== 'step' || !Array.isArray(d.stages)) continue;
      const pts = d.stages.filter((s) => s.complete && s.avgPowerW > 0 && s.avgHr >= 90).map((s) => ({ x: s.avgPowerW, y: s.avgHr }));
      if (pts.length) { pastPts.push(...pts); pastSessions += 1; }
    }
    // 이번 점만 / 과거 포함 — 둘 다 계산해 더 믿을 만한 쪽을 쓴다.
    const fitNow = linearFit(nowPts);
    const fitAll = pastPts.length ? linearFit([...nowPts, ...pastPts]) : null;
    const useAll = fitAll && fitAll.b > 0 && fitAll.r2 >= (fitNow?.r2 ?? 0) - 0.05;
    const fit = useAll ? fitAll : fitNow;
    const sessionsUsed = useAll ? pastSessions + 1 : 1;
    let wMax = null;
    if (fit && fit.b > 0 && hrMax.value) wMax = (hrMax.value - fit.a) / fit.b;
    if (wMax != null && (wMax <= 0 || wMax > 1500)) wMax = null;
    const grade = fit ? confidenceGrade({ n: fit.n, r2: fit.r2, sessions: sessionsUsed }) : null;
    estimates.maxPower = {
      value: r0(wMax), unit: 'W', method: 'hrPowerExtrapolation', grade, points: fit?.n || 0, r2: fit ? Math.round(fit.r2 * 1000) / 1000 : null,
      sessionsUsed, hrMaxUsed: hrMax.value,
      reason: !fit ? '완료한 단계가 2개 이상 있어야 계산합니다.' : fit.b <= 0 ? '와트가 올라도 심박이 오르지 않아 계산하지 않았습니다.' : `심박-와트 직선을 최대심박 ${hrMax.value}까지 연장한 값입니다.`,
    };
    if (machineId === 'bike' && wMax && weightKg) {
      // ACSM 다리 사이클 식: VO2 = 10.8 × W / kg + 7 (에어바이크는 팔 동작이 섞여 참고용)
      const value = r1((10.8 * wMax) / weightKg + 7);
      estimates.vo2max = { value, method: 'acsmCycle', unit: 'mL/kg/min', grade, valid: true, reason: '단계 테스트 심박-와트 연장 + ACSM 사이클 식. 에어바이크라 참고용입니다.' };
    }
    if (!stages.some((s) => s.complete)) notes.push('완료한 단계가 없습니다.');
  }

  // [2026-11-23] 교재 8장 현장 테스트 — 평지 기준이라 VO2max 추정과 표 8.2 백분위를 화면에 보여 준다.
  let fieldRank = null;
  if (protocol?.estimate === 'cooper15') {
    const done = result.manualTime || result.durationSec > 0;
    const value = done ? cooper15Vo2max({ sex, weightKg, timeSec: result.durationSec }) : null;
    estimates.vo2max = {
      value, method: 'cooper15', unit: 'mL/kg/min', grade: value ? 'B' : null, valid: Boolean(value),
      altValue: done ? cooper15Vo2maxAlt({ sex, weightKg, timeSec: result.durationSec }) : null,
      reason: !weightKg ? '체중이 없어 계산하지 않았습니다.' : !sex ? '성별이 없어 계산하지 않았습니다.' : '교재 8장 쿠퍼 1.5마일 식(오차 약 6%). 전력으로 달린 기록일 때만 의미가 있습니다.',
    };
    fieldRank = run15Percentile(sex, subject.age, result.durationSec);
    if (fieldRank) fieldRank = { ...fieldRank, test: 'run1_5mile', timeSec: result.durationSec };
  }
  if (protocol?.estimate === 'cooper12') {
    const d = result.distanceM > 0 && !result.distanceAssumed ? result.distanceM : null;
    const value = d ? vo2maxFromRun12(d) : null;
    estimates.vo2max = {
      value, method: 'cooper12', unit: 'mL/kg/min', grade: value ? 'C' : null, valid: Boolean(value),
      reason: !d ? '12분 동안 간 거리(m)를 입력하지 않아 계산하지 않았습니다.' : '교재 8장 12분 테스트(Cooper 1968 식: (거리m−504.9)/44.73). 실측과의 상관이 연구마다 달라 참고용입니다.',
    };
    if (value) notes.push('교재 190쪽의 12분 식 계수 0.0268 은 인쇄 오류로 보여, 원논문 Cooper(1968)의 (m−504.9)/44.73 을 썼습니다.');
  }
  if (protocol?.estimate === 'bruce') {
    const value = bruceVo2max({ sex, timeSec: result.durationSec });
    estimates.vo2max = {
      value, method: 'bruce', unit: 'mL/kg/min', grade: value ? 'B' : null, valid: Boolean(value),
      reason: !sex ? '성별이 없어 계산하지 않았습니다.' : !value ? '총 시간이 1~30분 밖이라 계산하지 않았습니다.' : '교재 9장 브루스 식. 단계 시간을 정확히 지켰고 손잡이를 잡지 않았을 때만 맞습니다.',
    };
  }
  if (protocol?.estimate === 'rockport') {
    // 입력이 없으면 밴드가 기록한 종료 직후 5초 평균 심박을 쓴다(밴드 없으면 null).
    const bandHr = windowAvg(rec, 'hr', workEndSec, workEndSec + 5);
    const hrAfter = Number(manual?.hrAfter) > 0 ? Number(manual.hrAfter) : (bandHr > 0 ? Math.round(bandHr) : null);
    const value = rockportVo2max({ sex, age: subject.age, weightKg, timeSec: result.durationSec, hr: hrAfter });
    estimates.vo2max = {
      value, method: 'rockport', unit: 'mL/kg/min', grade: value ? 'B' : null, valid: Boolean(value), hrAfter: hrAfter || null,
      reason: !hrAfter ? '끝난 직후 심박(15초×4)을 입력해야 계산됩니다.'
        : !weightKg || !sex || !subject.age ? '나이·성별·체중이 있어야 계산됩니다.'
          : !value ? '나이(18~79세)나 심박(60~220) 범위를 벗어나 계산하지 않았습니다.'
            : '교재 8장 록포트 식(최대하). 대학생 연령은 과대추정 보고가 있어 참고용입니다.',
    };
  }

  if (protocol?.basis === 'curved') {
    if (protocol.target?.durationSec && !(result.distanceM > 0)) notes.push('콘솔 DIS. 거리를 입력하지 않아 12분 기록이 비어 있습니다.');
    notes.push('커브드 트레드밀 기록입니다. 평지·모터 트레드밀과 직접 비교하지 말고, 같은 회원의 같은 테스트끼리 변화로 보세요.');
  }

  if (estimates.vo2max?.value) {
    const acc = estimateAccuracy(estimates.vo2max.method, estimates.vo2max.value, { sex, age: subject.age });
    if (acc) estimates.vo2max.accuracy = acc;
  }
  // 기준값 보정(트레이너가 넣은 실측 VO2max 가 과거에 있으면)
  if (estimates.vo2max?.value) {
    const cal = calibrationFactor(past, estimates.vo2max.method);
    if (cal) {
      estimates.vo2max.calibratedValue = r1(estimates.vo2max.value * cal.factor);
      estimates.vo2max.calibration = cal;
    }
  }

  // 연구용 저장 전용: 교재 표(평지 기준) 대비 위치. 화면에는 보여주지 않는다(대표님 결정 2026-11-17).
  let flatReference = null;
  if (protocol?.basis === 'curved') {
    flatReference = protocol.target?.distanceM
      ? run2400Reference(sex, subject.age, result.durationSec)
      : run12Reference(sex, subject.age, result.distanceM);
    if (flatReference) flatReference = { ...flatReference, test: protocol.target?.distanceM ? 'run2400' : 'run12min', note: '평지 기준표 — 커브드와 직접 비교 불가, 연구용' };
  }

  return {
    result,
    recovery,
    stages,
    estimates,
    flatReference,
    fieldRank,
    hrMax: { ...hrMax, formula: 'tanaka', context: cardioContext(machineId) },
    subject: { age: Number(subject.age) || null, sex, weightKg },
    notes,
  };
}

// 저장 페이로드. 필드 이름은 다른 측정 유형 판정(unifiedReport.inferReportType)에 걸리지 않게
// 고른다(summary·analysis·mode·type·heightCm·rsi·diagnosis 사용 금지).
export function buildCardioRecord({ protocolId, machineId, machine = null, startedAt, endedAt, rec, computed, hrSource = 'none', manual = null, trainerNote = '', confirmedVo2max = null, referenceVo2max = null, stepPlan = null }) {
  const protocol = getProtocol(protocolId);
  return {
    kind: CARDIO_RECORD_KIND,
    version: 1,
    protocolId,
    protocolLabel: protocol?.label || '',
    basis: protocol?.basis || 'standard',
    machineId,
    machineLabel: CARDIO_MACHINES[machineId]?.label || machineId,
    machine: machine ? { name: String(machine.name || '').slice(0, 40), protocol: machine.protocol || null, reportedKind: machine.machineKind || null, services: (machine.services || []).slice(0, 12), characteristics: (machine.characteristics || []).slice(0, 6), detectedKind: machine.detectedKind || null } : null,
    startedAt: startedAt || null,
    endedAt: endedAt || null,
    hrSource,
    subject: computed.subject,
    hrMax: computed.hrMax,
    result: computed.result,
    recovery: computed.recovery,
    stages: computed.stages,
    stepPlan: stepPlan || null,
    estimates: computed.estimates,
    flatReference: computed.flatReference || null,
    fieldRank: computed.fieldRank || null,
    notes: computed.notes,
    manual: manual || null,
    trainerNote: String(trainerNote || '').slice(0, 300),
    confirmedVo2max: Number.isFinite(confirmedVo2max) ? confirmedVo2max : null,
    referenceVo2max: Number.isFinite(referenceVo2max) ? referenceVo2max : null,
    series: { stepSec: 1, t: rec.t, hr: rec.hr, w: rec.w, cad: rec.cad, dist: rec.dist },
  };
}

export function formatPace(sec500) {
  if (!Number.isFinite(sec500) || sec500 <= 0) return '-';
  const m = Math.floor(sec500 / 60);
  const s = Math.round(sec500 % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatClock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// 측정 이력 카드 요약 칩(값만, 판정 없음)
export function cardioHistoryMetrics(payload = {}) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const out = [];
  const vo2 = p.estimates?.vo2max;
  const shownVo2 = Number.isFinite(p.confirmedVo2max) ? p.confirmedVo2max : (vo2?.calibratedValue ?? vo2?.value);
  if (Number.isFinite(shownVo2)) out.push({ key: 'vo2max', label: Number.isFinite(p.confirmedVo2max) ? 'VO2max(확인)' : 'VO2max(참고)', displayValue: String(shownVo2), unit: 'mL/kg/min', value: shownVo2 });
  if (Number.isFinite(p.estimates?.maxPower?.value)) out.push({ key: 'maxPower', label: '추정 최대파워', displayValue: String(p.estimates.maxPower.value), unit: 'W', value: p.estimates.maxPower.value });
  if (Number.isFinite(p.result?.distanceM) && p.result.distanceM > 0) out.push({ key: 'distanceM', label: '거리', displayValue: String(p.result.distanceM), unit: 'm', value: p.result.distanceM });
  if (Number.isFinite(p.result?.durationSec)) out.push({ key: 'durationSec', label: '시간', displayValue: formatClock(p.result.durationSec), unit: '', value: p.result.durationSec });
  if (Number.isFinite(p.result?.avgPowerW)) out.push({ key: 'avgPowerW', label: '평균 와트', displayValue: String(p.result.avgPowerW), unit: 'W', value: p.result.avgPowerW });
  if (Number.isFinite(p.recovery?.drop60)) out.push({ key: 'drop60', label: '1분 회복', displayValue: String(p.recovery.drop60), unit: 'bpm', value: p.recovery.drop60 });
  return out;
}
