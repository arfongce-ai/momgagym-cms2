// ai-measure/core/measureHowTo.js
// [2026-11-24] 측정 메뉴를 열면 뜨는 "측정 방법(순서·설명)" 팝업의 내용과 '일주일간 보지 않기' 로직.
//  · 내용은 앱에 이미 있는 촬영 기준(CaptureGuideStrip MEASURE_TIPS)·메뉴 설명·점프 종류 안내를 그대로 따른다 — 새 기준을 만들지 않는다.
//  · 순수 함수만 둔다(저장소는 인자로 받는다 → 테스트·저장 불가 기기 대응).
export const HOWTO_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000; // 일주일
const KEY_PREFIX = 'momgagym.measureHowTo.snoozeUntil.';

const SAVE_STEP = '측정이 끝나면 기록을 확인하고, "저장하시겠습니까?"에서 저장을 눌러야 기록됩니다.';

// 메뉴 id → { title, steps[], note? } (id 는 registry.js 와 같다)
export const MEASURE_HOWTO = {
  body: { title: '신체 정보', steps: ['키와 몸무게(필요하면 혈압)를 입력합니다.', '분석을 눌러 결과를 확인합니다.', SAVE_STEP] },
  posture: {
    title: '자세·체형 측정',
    steps: [
      '폰을 삼각대에 고정합니다. 카메라는 몸에서 1.8m 이상, 높이는 배꼽 높이(약 1m)에 둡니다.',
      '양발을 어깨너비로 편하게 벌리고 정면을 봅니다.',
      '정면 → 측면 → 후면 순서로 모두 촬영합니다. 측면이 없으면 거북목·굽은 등을 계산할 수 없습니다.',
      '화면 위 신호등이 초록일 때 촬영합니다.',
      SAVE_STEP,
    ],
  },
  rom: {
    title: 'ROM 좌우 비교',
    steps: [
      '카메라와 2~2.5m 떨어져 폰을 고정합니다.',
      '움직이는 관절이 카메라와 수직이 되게 섭니다(어깨 굴곡은 측면).',
      '팔·다리가 화면 밖으로 나가지 않게 움직입니다.',
      '왼쪽·오른쪽을 같은 방법으로 각각 측정해 비교합니다.',
      SAVE_STEP,
    ],
  },
  gait: {
    title: '보행 & 러닝 (트레드밀용)',
    steps: [
      '트레드밀 옆(측면) 또는 뒤(후면) 2~3m에 폰을 고정합니다.',
      '발이 벨트에 닿는 모습이 잘리지 않게 합니다.',
      '속도가 안정된 뒤 20걸음 이상 측정합니다.',
      SAVE_STEP,
    ],
  },
  sprint: {
    title: '보행 & 스프린터 (필드용)',
    steps: [
      '폰을 가로로 두고, 출발선부터 끝선까지 모두 보이도록 측면 멀리에 고정합니다.',
      '카메라는 달리는 방향과 수직으로 둡니다. 창문 정면 같은 역광은 피합니다.',
      '화면에서 바닥 기준점 2곳을 눌러 거리를 맞춥니다.',
      '5m/10m 스프린트 또는 5-0-5 방향전환을 측정합니다.',
      SAVE_STEP,
    ],
  },
  jump: {
    title: '점프 & RSI',
    steps: [
      '측면 2.5~3m에 폰을 고정합니다. 점프 최고점까지 머리가 잘리지 않게 위쪽 여유를 둡니다.',
      '착지 지점이 화면 안에 들어오게 합니다.',
      '세부 종류(CMJ·SJ·DJ·SLJ·RSI·연속점프 60초)를 고르면 그 종류의 설명이 나옵니다. 같은 방식으로 반복해야 비교가 정확합니다.',
      'EUR(반동 활용 비율)을 보려면 같은 날 CMJ와 SJ를 둘 다 측정해 저장합니다.',
      SAVE_STEP,
    ],
    note: '점프 높이는 체공 시간으로 계산하며, 힘판으로 잰 값이 아닙니다.',
  },
  broadjump: {
    title: '제자리멀리뛰기',
    steps: [
      '폰을 가로로 두고 측면 3m 이상에 고정합니다. 출발부터 착지까지 모두 화면 안에 들어와야 합니다.',
      '바닥 기준선(테이프)이 화면에 보이게 합니다.',
      '두 발을 모아 출발선에 맞춰 서고, 팔과 무릎 반동으로 최대한 멀리 뜁니다.',
      '두 발로 착지한 뒤 균형을 잡고 마무리합니다.',
      SAVE_STEP,
    ],
  },
  lifting: {
    title: '바벨 리프팅',
    steps: [
      '측면에서 바벨 끝(원판)이 잘 보이게 폰을 고정합니다. 거리는 3.2m 이상입니다.',
      '바벨 양 끝과 움직이는 경로 전체가 화면 안에 들어오게 합니다.',
      '운동 종류를 고르고 측정합니다. 속도(VBT)와 1RM 추정을 볼 수 있습니다.',
      SAVE_STEP,
    ],
  },
  stance: {
    title: '한다리서기 (SLST)',
    steps: [
      '정면 1.8m 이상에 폰을 고정하고, 양팔·양발이 모두 보이게 합니다.',
      '넘어질 때 잡을 곳이 있는 안전한 자리에서 합니다.',
      '선택한 쪽 다리로 서고 반대쪽 발을 들어 올립니다. 왼쪽·오른쪽을 각각 측정합니다.',
      SAVE_STEP,
    ],
  },
  squat: {
    title: '오버헤드 딥 스쿼트',
    steps: [
      '정면 1회, 측면 1회 촬영합니다.',
      '팔을 머리 위로 뻗었을 때 손끝까지 화면 안에 들어오게 합니다.',
      '천천히 가장 깊게 앉았다가 일어납니다.',
      SAVE_STEP,
    ],
  },
  cardio: {
    title: '심폐지구력 · 실내용',
    steps: [
      '로잉·에어바이크·스키·트레드밀 중 장비를 고릅니다.',
      '장비를 연결하면 기록이 자동으로 들어옵니다. 심박 밴드를 차면 심박·회복도 함께 기록됩니다.',
      '결과의 VO2max는 참고값입니다.',
      SAVE_STEP,
    ],
  },
  cardio_field: {
    title: '심폐지구력 · 필드용',
    steps: [
      '테스트(쿠퍼 1.5마일·쿠퍼 12분·록포트·브루스)를 고릅니다.',
      '트랙이나 평지에서 안내에 맞춰 진행하고 기록을 입력합니다.',
      '결과의 VO2max는 참고값입니다.',
      SAVE_STEP,
    ],
  },
  senior: {
    title: '시니어 기능 테스트',
    steps: [
      '30초 의자 일어서기·5회 일어서기·TUG 중 테스트를 고릅니다. 나이·성별·혈압은 등록정보에서 자동으로 들어옵니다.',
      '횟수는 측정자가 +1 버튼으로 세거나, 카메라 자동 카운트를 골라 쓸 수 있습니다. 심박 밴드를 연결하면 심박도 함께 기록됩니다.',
      '끝나면 측정자가 값을 확인·수정하고 저장합니다. 팔을 쓰거나 끝까지 못 한 경우도 그대로 저장되며 확인 필요로 표시됩니다.',
    ],
    note: '낙상 위험이 있으니 측정자는 바로 옆에서 대기합니다.',
  },
  compare: { title: '전/후 비교 (오버레이)', steps: ['비교할 전·후 사진 또는 영상을 고릅니다.', '두 장을 겹쳐 보고, 발목 기준으로 자동 정렬된 모습을 확인합니다.'] },
  imaging: { title: '근골격계 영상 확인', steps: ['X-ray·CT·초음파·MRI 파일을 올립니다.', '각도와 거리를 재고 소견을 태그로 남깁니다.'], note: '내부 참고용 도구입니다.' },
  record: { title: '일반 영상 녹화', steps: ['카메라로 녹화합니다.', '녹화가 끝나면 저장합니다.'] },
  timer: { title: '초시계·메트로놈', steps: ['초시계·타이머·인터벌·메트로놈 중 필요한 도구를 고릅니다.'] },
};

export function getMeasureHowTo(menuId) {
  return MEASURE_HOWTO[menuId] || null;
}

const keyOf = (menuId) => `${KEY_PREFIX}${menuId}`;

// storage: localStorage 처럼 getItem/setItem 이 있는 객체(없거나 오류 나면 "안 숨김"으로 본다).
export function isHowToSnoozed(storage, menuId, now = Date.now()) {
  try {
    const raw = storage?.getItem?.(keyOf(menuId));
    const until = Number(raw);
    return Number.isFinite(until) && until > now;
  } catch (e) {
    return false;
  }
}

export function snoozeHowTo(storage, menuId, now = Date.now()) {
  const until = now + HOWTO_SNOOZE_MS;
  try { storage?.setItem?.(keyOf(menuId), String(until)); } catch (e) { /* 저장 불가 기기 — 다음에 다시 뜬다 */ }
  return until;
}

// 팝업을 띄울지: 안내 내용이 있고 일주일 숨김 중이 아닐 때.
export function shouldShowHowTo(storage, menuId, now = Date.now()) {
  return Boolean(getMeasureHowTo(menuId)) && !isHowToSnoozed(storage, menuId, now);
}
