// ai-measure/core/interpretation.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-11-17] 모든 측정의 '해석' 문구를 한 곳에서 만든다.
//   · 상세 리포트(트레이너·회원용 전문 버전): 지표마다 "무엇을 재는가 → 이 값이 어느 쪽인가 → 어떻게 읽는가".
//   · 쉬운 버전(회원 공유용): 초등학생도 이해할 수 있는 짧은 문장 — 잘한 점 / 신경 쓸 점 / 다음에 할 일.
//   · 입력은 unifiedReport.buildSummaryData() 가 만든 요약(keyMetrics·status·overallScore)뿐이다 → 측정 종류가 늘어나도
//     지표 문구(GUIDE)만 한 줄 추가하면 된다. 없는 지표는 용어 사전(REPORT_TERM_MAP) 설명으로 대신한다.
//   · 원칙: 확정 진단을 하지 않는다("가능성", "참고"). 검증된 기준이 없는 지표는 등급 없이 값과 회차 변화로 읽는다.
//  순수 함수만 둔다.
// ════════════════════════════════════════════════════════════════════════
import { getLaymanTerm } from './unifiedReport';

// key → { what(상세 설명), easyName, easyWhat, better('higher'|'lower'|null), why?(주의일 때 뜻) }
//  종류별로 뜻이 다른 키는 `${reportType}.${key}` 로 따로 둔다.
const GUIDE = {
  // ── 점프 ──
  jumpHeight: { what: '점프로 몸이 올라간 높이입니다. 높을수록 하체 순발력이 크다는 뜻이지만, 나이·성별·종목·측정 방식에 따라 크게 달라 등급은 내지 않습니다.', easyName: '점프 높이', easyWhat: '얼마나 높이 뛰었는지 보여줘요', better: 'higher' },
  peakPower: { what: '점프 중 낸 최대 파워(W)입니다. 체중이 무거우면 커지는 경향이 있어, 같은 회원의 회차 변화로 읽습니다.', easyName: '점프 힘', easyWhat: '뛰어오를 때 낸 힘이에요', better: 'higher' },
  takeoffVelocity: { what: '발이 땅에서 떨어지는 순간의 위쪽 속도(m/s)입니다. 점프 높이를 정하는 값이라 빠를수록 높이 뜹니다.', easyName: '뛰어오르는 속도', easyWhat: '땅을 박차고 올라가는 빠르기예요', better: 'higher' },
  eur: { what: '반동점프(CMJ) 높이 ÷ 스쿼트점프(SJ) 높이입니다. 1보다 크면 반동이 점프에 보탬이 된 것입니다. 종목별 선수 집단 규준이라 일반 회원은 등급 없이 같은 회원의 회차 변화로 읽습니다.', easyName: '반동 쓰는 능력', easyWhat: '내려갔다 올라갈 때 반동을 얼마나 잘 쓰는지 봐요', better: null },
  comTakeoffVelocity: { what: '영상 속 몸 중심의 움직임으로 구한 이륙 속도(m/s)입니다. 힘판 실측이 아닌 참고값이며 실제보다 약간 높게 나오는 경향이 보고되어 있습니다. 체공 시간 기반 도약 속도와 함께 읽습니다.', easyName: '뛰어오르는 속도(참고)', easyWhat: '영상으로 다시 계산해 본 뛰어오르는 빠르기예요', better: 'higher' },
  comVelocityGap: { what: '영상 이륙 속도와 체공 시간 이륙 속도의 차이(%)입니다. 작을수록 두 방식이 잘 맞아 영상 측정을 믿을 수 있습니다. 크면 촬영 각도·프레임·가림을 확인하세요.', easyName: '두 계산 차이', easyWhat: '두 가지 방법으로 계산한 값이 얼마나 비슷한지 봐요', better: 'lower' },
  boscoPower: { what: '60초 반동점프를 반복했을 때의 체중당 기계적 파워(W/kg)입니다. 영상으로 잰 체공 시간 합계에 크게 좌우되므로 참고값이며, 같은 회원의 회차 변화로 읽습니다.', easyName: '오래 뛰는 힘', easyWhat: '1분 동안 계속 뛰면서 낸 힘이에요', better: 'higher' },
  boscoJumps: { what: '정해진 시간 동안 완료한 점프 횟수입니다. 같은 시간·같은 방법끼리만 비교합니다.', easyName: '점프 횟수', easyWhat: '1분 동안 몇 번 뛰었는지예요', better: 'higher' },
  boscoPercentile: { what: '교재 규준표(Maud & Foster 2005)에서 같은 성별 집단의 어느 구간인지입니다. 인원·측정 방식이 달라 참고로만 봅니다.', easyName: '또래 중 순위(참고)', easyWhat: '책에 나온 사람들과 비교한 대략적인 위치예요', better: 'higher' },
  horizontalPower5: { what: '체중 × 5m ÷ 5m 통과 시간(kg·m/s)입니다. 출발 가속 구간의 값이며 힘판 실측이 아닌 참고값입니다. 같은 조건의 회차 변화로 읽습니다.', easyName: '출발 가속 힘(참고)', easyWhat: '출발해서 5m까지 얼마나 힘 있게 달렸는지 보는 값이에요', better: 'higher' },
  horizontalPower10: { what: '체중 × 10m ÷ 10m 통과 시간(kg·m/s)입니다. 체중이 다른 회원끼리 비교할 때 쓰는 참고값이며, 체중×평균속도와 같은 값입니다.', easyName: '달리기 힘(참고)', easyWhat: '체중을 고려해 10m를 얼마나 힘 있게 달렸는지 보는 값이에요', better: 'higher' },
  olyPeakVelocity: { what: '스내치·클린&저크에서 바가 가장 빠르게 올라간 속도(m/s)입니다. 양 손목 중점으로 근사한 참고값이며 같은 조건의 회차 변화로 읽습니다.', easyName: '바가 가장 빠를 때 속도(참고)', easyWhat: '바벨을 끌어올릴 때 가장 빨랐던 속도예요', better: 'higher' },
  olyBarTop: { what: '출발 대비 바가 올라간 최고 높이(cm)입니다. 카메라 거리 보정에 따라 달라지는 참고값입니다.', easyName: '바가 올라간 높이(참고)', easyWhat: '바벨이 가장 높이 올라간 높이예요', better: null },
  olyCatchDepth: { what: '캐치 순간 고관절 높이와 일어선 뒤 높이의 차이(cm)입니다. 깊을수록 낮은 자세로 받았다는 뜻이며, 좋고 나쁨을 가르는 기준은 두지 않았습니다.', easyName: '받는 자세의 깊이(참고)', easyWhat: '바벨을 받을 때 엉덩이가 얼마나 낮아졌는지예요', better: null },
  horizontalPower: { what: '체중 × 이동거리 ÷ 시간(kg·m/s)으로 구한 교재 공식 값입니다. 힘판으로 잰 실측이 아니므로 참고값이며 회차 변화로 읽습니다.', easyName: '앞으로 뛰는 힘(참고)', easyWhat: '앞으로 멀리 뛸 때 낸 힘을 공식으로 계산했어요', better: 'higher' },
  landingKneeAngle: { what: '착지 순간의 무릎 각도(도)입니다. 개인을 가려내는 데 쓸 수 있는 검증된 정상 범위가 없어 판정하지 않고, 좌우 차이와 회차 변화로 읽습니다.', easyName: '착지할 때 무릎', easyWhat: '내려올 때 무릎이 얼마나 구부러졌는지예요', better: null },
  footLandingSymmetry: { what: '두 발이 착지한 위치의 차이를 환산한 값(%)입니다. 힘을 직접 잰 비대칭 기준과 바로 비교할 수 없어, 값과 회차 변화로 읽습니다.', easyName: '두 발 착지', easyWhat: '두 발이 비슷하게 닿았는지 봐요', better: null },
  pelvicImbalance: { what: '착지할 때 골반이 좌우로 기울어지는 정도(%)입니다. 작을수록 좌우 균형이 좋습니다.', easyName: '골반 균형', easyWhat: '내려올 때 골반이 한쪽으로 기울지 않는지 봐요', better: 'lower', why: '한쪽 다리에 힘이 더 실리거나 고관절 안정성이 떨어질 가능성이 있습니다(확정 진단은 아닙니다).' },
  rsi: { what: '짧게 딛고 빠르게 튀어 오르는 능력(반응 탄성)입니다. 클수록 반응이 빠릅니다. 낙하 높이와 방법에 따라 달라 등급 없이 회차 변화로 읽습니다.', easyName: '튕겨 오르는 힘', easyWhat: '땅에 닿자마자 통통 튀어 오르는 힘이에요', better: 'higher' },
  contactTime: { what: '발이 땅에 닿아 있던 시간(ms)입니다. 같은 높이를 뛰면서 짧을수록 반응이 빠른 것입니다.', easyName: '땅에 닿은 시간', easyWhat: '발이 땅에 붙어 있던 아주 짧은 시간이에요', better: 'lower' },
  flightTime: { what: '공중에 떠 있던 시간(ms)입니다. 길수록 높이 뜬 것입니다.', easyName: '공중에 뜬 시간', easyWhat: '점프해서 공중에 머문 시간이에요', better: 'higher' },
  // ── 자세 ──
  forwardHead: { what: '귀 위치가 어깨보다 앞으로 나온 거리(mm)입니다. 클수록 머리가 앞으로 빠진 자세입니다.', easyName: '머리 위치', easyWhat: '머리가 앞으로 나와 있는지 봐요', better: 'lower', why: '목·어깨 뒤쪽 근육이 오래 긴장하기 쉬운 자세입니다.' },
  thoracicKyphosis: { what: '등(가슴 높이 척추)이 굽은 정도를 각도로 본 참고값입니다. 사진 한 장으로는 오차가 있어 같은 조건의 회차 변화로 읽습니다.', easyName: '등 굽음', easyWhat: '등이 얼마나 둥글게 굽었는지 봐요', better: null },
  shoulderHeightDiff: { what: '왼쪽·오른쪽 어깨 높이의 차이(mm)입니다. 작을수록 좌우가 비슷합니다.', easyName: '어깨 높이', easyWhat: '왼쪽·오른쪽 어깨 높이가 같은지 봐요', better: 'lower', why: '한쪽 어깨·목 근육이 더 긴장했거나 몸통이 기울어 있을 가능성이 있습니다.' },
  pelvisHeightDiff: { what: '왼쪽·오른쪽 골반 높이의 차이(mm)입니다. 작을수록 좌우가 비슷합니다.', easyName: '골반 높이', easyWhat: '왼쪽·오른쪽 골반 높이가 같은지 봐요', better: 'lower', why: '서 있는 습관이나 다리 길이·근육 긴장의 차이가 영향을 줄 수 있습니다.' },
  centerOfGravity: { what: '몸의 무게중심이 가운데에서 벗어난 정도(%)입니다. 작을수록 양발에 고르게 실립니다.', easyName: '몸의 중심', easyWhat: '몸무게가 한쪽으로 쏠리지 않는지 봐요', better: 'lower', why: '한쪽 다리에 체중을 더 싣는 습관이 있을 수 있습니다.' },
  'posture.asymmetry': { what: '여러 부위의 좌우 차이를 평균한 비대칭 지수(%)입니다. 작을수록 좌우가 비슷합니다.', easyName: '왼쪽·오른쪽 차이', easyWhat: '몸의 왼쪽과 오른쪽이 얼마나 다른지 봐요', better: 'lower' },
  // ── 보행·러닝 ──
  cadence: { what: '1분 동안의 걸음 수(SPM)입니다. 걷기와 달리기는 기준이 달라 걸음 수로 구분해 판정합니다. 보폭이 너무 크면 걸음 수가 낮아지고 관절에 부담이 늘 수 있습니다.', easyName: '걸음 수', easyWhat: '1분 동안 몇 걸음 걷는지예요', better: null },
  stancePct: { what: '한 걸음 주기에서 발이 땅에 닿아 있는 비율(%)입니다. 속도가 빨라지면 줄어드는 것이 정상입니다.', easyName: '발이 땅에 닿는 시간', easyWhat: '한 걸음 중 발이 땅에 붙어 있는 비율이에요', better: null },
  pelvicDrop: { what: '한 발로 서는 순간 반대쪽 골반이 내려가는 정도(%)입니다. 작을수록 고관절 주변(엉덩이 옆 근육)이 골반을 잘 지탱하고 있다는 뜻입니다.', easyName: '골반 흔들림', easyWhat: '걸을 때 골반이 아래로 내려앉는지 봐요', better: 'lower', why: '엉덩이 옆 근육의 지탱력이 부족할 가능성이 있습니다(이 측정만으로 확정하지 않습니다).' },
  kneeSymmetry: { what: '왼쪽·오른쪽 무릎 움직임이 얼마나 비슷한지(%)입니다. 100에 가까울수록 좌우가 같습니다.', easyName: '무릎 움직임', easyWhat: '왼쪽과 오른쪽 무릎이 비슷하게 움직이는지 봐요', better: 'higher', why: '한쪽을 덜 쓰거나 아픈 쪽을 보호하는 걸음일 수 있습니다.' },
  verticalOscillation: { what: '걸을 때 몸이 위아래로 움직이는 크기(%)입니다. 너무 크면 에너지를 위로 쓰느라 효율이 떨어집니다.', easyName: '위아래 출렁임', easyWhat: '걸을 때 몸이 위아래로 얼마나 흔들리는지예요', better: null },
  // ── 스프린트·민첩성 ──
  totalTime: { what: '출발부터 도착까지 걸린 시간입니다. 짧을수록 빠릅니다. 같은 거리·같은 방법끼리만 비교합니다.', easyName: '달린 시간', easyWhat: '출발해서 도착할 때까지 걸린 시간이에요', better: 'lower' },
  'sprint.peakVelocity': { what: '구간 중 가장 빨랐던 속도(m/s)입니다. 클수록 빠릅니다.', easyName: '가장 빠른 속도', easyWhat: '달리는 동안 제일 빨랐던 속도예요', better: 'higher' },
  reactionTime: { what: '신호 뒤 움직이기 시작하기까지의 시간(ms)입니다. 영상 프레임·소리 출력 지연이 섞여 있어 등급 없이, 같은 조건의 회차 변화(짧을수록 빠름)로 읽습니다.', easyName: '출발 반응', easyWhat: '신호를 듣고 얼마나 빨리 움직였는지예요', better: 'lower' },
  avgVelocity: { what: '구간 전체의 평균 속도(m/s)입니다. 클수록 빠릅니다.', easyName: '평균 속도', easyWhat: '처음부터 끝까지 평균 빠르기예요', better: 'higher' },
  decelTime: { what: '멈추거나 방향을 바꿀 때 속도를 줄이는 데 걸린 시간(ms)입니다. 짧을수록 제동이 좋습니다.', easyName: '멈추는 시간', easyWhat: '달리다가 멈추는 데 걸린 시간이에요', better: 'lower', why: '제동 때 무릎·발목이 받는 부담이 커질 수 있습니다.' },
  peakVelocitySmooth: { what: '흔들림을 줄여 다시 계산한 최고 속도(m/s)입니다. 클수록 빠릅니다.', easyName: '가장 빠른 속도', easyWhat: '제일 빨랐던 속도를 다시 계산한 값이에요', better: 'higher' },
  maxAccel: { what: '출발 직후 속도가 붙는 정도(m/s²)입니다. 클수록 가속이 좋습니다.', easyName: '출발 가속', easyWhat: '출발할 때 얼마나 빨리 빨라지는지예요', better: 'higher' },
  firstHalf: { what: '앞쪽 절반 구간에 걸린 시간(ms)입니다. 짧을수록 빠릅니다.', easyName: '앞쪽 시간', easyWhat: '달린 거리의 앞 반을 가는 데 걸린 시간이에요', better: 'lower' },
  secondHalf: { what: '뒤쪽 절반 구간에 걸린 시간(ms)입니다. 앞쪽보다 크게 늘면 후반에 속도가 떨어진 것입니다.', easyName: '뒤쪽 시간', easyWhat: '달린 거리의 뒤 반을 가는 데 걸린 시간이에요', better: 'lower' },
  speedMaintenance: { what: '최고 속도 이후 속도를 얼마나 유지했는지(%)입니다. 클수록 끝까지 속도를 지킨 것입니다.', easyName: '속도 지키기', easyWhat: '끝까지 속도를 얼마나 지켰는지예요', better: 'higher' },
  // ── 관절가동범위 ──
  'rom.rom': { what: '관절이 움직인 최대 각도(도)입니다. 관절·동작마다 정상 범위가 달라, 같은 관절의 좌우 차이와 회차 변화로 읽습니다.', easyName: '관절 움직임', easyWhat: '관절이 얼마나 크게 움직이는지예요', better: 'higher' },
  'rom.asymmetry': { what: '좌우 대칭 정도를 나타내는 지수(%)입니다. 좌우가 비슷할수록 안정적입니다.', easyName: '왼쪽·오른쪽 차이', easyWhat: '왼쪽과 오른쪽이 비슷하게 움직이는지 봐요', better: null, why: '한쪽 관절이 더 뻣뻣하거나 근육이 짧아졌을 가능성이 있습니다.' },
  // ── 근력·속도 기반(1RM·VBT) ──
  oneRM: { what: '한 번 들 수 있는 최대 무게의 추정값(kg)입니다. 실제로 최대 무게를 들어 본 값이 아니라 공식으로 계산한 참고치입니다.', easyName: '최대 무게', easyWhat: '한 번 들 수 있는 가장 무거운 무게(추정)예요', better: 'higher' },
  formulaSpread: { what: '여러 추정 공식이 서로 얼마나 다른 값을 내는지(kg)입니다. 클수록 추정이 불안정하니 반복 횟수가 적은 세트로 다시 재는 편이 좋습니다.', easyName: '추정값 차이', easyWhat: '계산한 값들이 얼마나 다른지 봐요', better: 'lower' },
  meanVelocity: { what: '바벨을 올릴 때의 평균 속도(m/s)입니다. 같은 무게에서 빠르면 여유가 있고, 같은 세트에서 느려지면 피로가 쌓인 것입니다.', easyName: '바벨 속도', easyWhat: '바벨을 올릴 때 평균 빠르기예요', better: 'higher' },
  'vbt.peakVelocity': { what: '바벨을 올리는 중 가장 빨랐던 속도(m/s)입니다.', easyName: '가장 빠른 속도', easyWhat: '바벨이 제일 빨랐던 속도예요', better: 'higher' },
  'vbt.peakPower': { what: '바벨을 올릴 때 낸 힘(파워, W)입니다.', easyName: '낸 힘', easyWhat: '바벨을 올릴 때 낸 힘이에요', better: 'higher' },
  'vbt.rom': { what: '바벨이 움직인 거리(cm)입니다. 같은 동작이면 매번 비슷해야 비교가 맞습니다.', easyName: '움직인 거리', easyWhat: '바벨이 올라간 거리예요', better: null },
  velocityLoss: { what: '한 세트 안에서 첫 반복 대비 속도가 줄어든 정도(%)입니다. 연구(Pareja-Blanco 2017)에서 약 20%는 힘·파워 향상에 유리한 피로, 약 40%는 큰 피로로 비교됐습니다.', easyName: '느려진 정도', easyWhat: '세트가 끝날수록 얼마나 느려졌는지예요', better: 'lower', why: '근육이 많이 지쳐 있으니 휴식이나 세트 수 조절을 고려할 만합니다.' },
  // ── 균형·스쿼트 ──
  stanceHoldTime: { what: '한 발로 균형을 유지한 시간입니다. 길수록 좋습니다. 좌우를 비교해 차이가 큰 쪽을 봅니다.', easyName: '한 발로 서기', easyWhat: '한 발로 얼마나 오래 서 있었는지예요', better: 'higher' },
  stancePelvicTilt: { what: '한 발로 서는 동안 골반이 기운 각도(도)입니다. 작을수록 안정적입니다.', easyName: '골반 기울기', easyWhat: '한 발로 설 때 골반이 기울지 않는지 봐요', better: 'lower', why: '엉덩이 옆 근육의 지탱력이 부족할 가능성이 있습니다.' },
  squatDepth: { what: '스쿼트에서 앉은 깊이를 허벅지 기울기(도)로 본 값입니다. 깊이는 발목·고관절 가동성과 연결됩니다.', easyName: '앉은 깊이', easyWhat: '스쿼트에서 얼마나 깊이 앉았는지예요', better: null },
  squatTorsoLean: { what: '앉을 때 상체가 앞으로 숙여진 각도(도)입니다. 너무 크면 허리 부담이 커질 수 있습니다.', easyName: '상체 숙임', easyWhat: '앉을 때 상체가 얼마나 앞으로 기우는지예요', better: 'lower', why: '발목이나 고관절이 뻣뻣하거나 등 근력이 부족할 가능성이 있습니다.' },
  squatKneeValgus: { what: '앉을 때 무릎이 안쪽으로 모이는 각도(도)입니다. 작을수록 무릎이 발끝 방향을 잘 따라갑니다.', easyName: '무릎 모임', easyWhat: '앉을 때 무릎이 안쪽으로 모이지 않는지 봐요', better: 'lower', why: '엉덩이 근육의 힘이 부족하거나 발 아치가 무너질 가능성이 있습니다.' },
  squatPelvicTilt: { what: '앉을 때 골반이 좌우로 기운 각도(도)입니다. 작을수록 균형이 좋습니다.', easyName: '골반 기울기', easyWhat: '앉을 때 골반이 한쪽으로 기울지 않는지 봐요', better: 'lower' },
  squatArmDrop: { what: '앉을 때 팔이 떨어지는 정도(도)입니다. 어깨·가슴 가동성과 연결됩니다.', easyName: '팔 모양', easyWhat: '앉을 때 팔이 떨어지지 않는지 봐요', better: 'lower' },
  // ── 심폐지구력 ──
  vo2max: { what: '1분에 몸 1kg이 쓸 수 있는 최대 산소량(mL/kg/min)입니다. 클수록 심폐지구력이 좋습니다. 호흡가스 검사가 아닌 참고 추정치입니다.', easyName: '체력(숨 쉬는 힘)', easyWhat: '오래 달리는 데 쓰는 산소의 양이에요', better: 'higher' },
  maxPower: { what: '최대 심박에서 낼 수 있을 것으로 추정한 파워(W)입니다. 클수록 지구력이 좋습니다.', easyName: '낼 수 있는 힘', easyWhat: '아주 힘들 때까지 낼 수 있는 힘이에요', better: 'higher' },
  distanceM: { what: '이번 테스트에서 간 거리(m)입니다. 같은 시간 동안 멀리 갈수록 좋습니다.', easyName: '간 거리', easyWhat: '이번에 달리거나 저은 거리예요', better: 'higher' },
  durationSec: { what: '이번 테스트에 걸린 시간입니다. 같은 거리를 더 짧게 끝내면 좋아진 것입니다.', easyName: '걸린 시간', easyWhat: '이번 테스트를 끝내는 데 걸린 시간이에요', better: 'lower' },
  avgPowerW: { what: '운동하는 동안 낸 평균 파워(W)입니다. 같은 시간에 클수록 좋습니다.', easyName: '평균 힘', easyWhat: '운동하는 동안 평균으로 낸 힘이에요', better: 'higher' },
  drop60: { what: '운동 직후 심박에서 1분 뒤 심박을 뺀 값(bpm)입니다. 클수록 심장이 빨리 쉬는 것(회복이 빠름)입니다.', easyName: '심장이 쉬는 빠르기', easyWhat: '운동이 끝나고 1분 동안 심장박동이 얼마나 내려갔는지예요', better: 'higher' },
};

// 측정 종류별 읽는 법(상세 리포트 맨 위 안내)
const TYPE_NOTE = {
  posture: '자세는 사진 한 장의 값보다 같은 자세·같은 거리·같은 옷차림으로 반복 촬영했을 때의 변화가 더 믿을 만합니다. 좌우 차이와 앞뒤 정렬을 함께 봅니다.',
  rom: '관절 가동범위는 관절과 동작마다 기준이 다릅니다. 같은 관절의 좌우 차이, 그리고 회차별 변화를 중심으로 읽습니다.',
  gait: '걷기와 달리기는 걸음 수로 구분해 기준을 다르게 적용합니다. 한 번의 값보다 같은 속도·같은 장소에서 반복했을 때의 변화를 봅니다.',
  jump: '점프 높이·파워는 나이·성별·종목에 따라 정상이 크게 달라 등급을 내지 않습니다. 착지 균형처럼 기준이 있는 지표만 판정하고, 나머지는 회차 변화로 읽습니다.',
  sprint: '스프린트·민첩성은 거리와 방법이 같을 때만 비교됩니다. 출발 반응은 영상·소리 지연이 섞여 있어 같은 조건의 회차 변화로 읽습니다.',
  squat: '스쿼트는 앞·옆 두 방향의 값을 함께 봅니다. 한 번만 보인 신호는 "관찰", 반복되면 "주의/위험"으로 올립니다.',
  stance: '한 발 서기는 좌우를 비교하고, 눈을 뜬 상태와 감은 상태를 나누어 봅니다. 한 번만 나온 신호는 재측정으로 확인합니다.',
  one_rm: '1RM은 실제 최대 시도가 아니라 공식으로 추정한 값입니다. 공식마다 값이 달라, 같은 운동·같은 방법으로 반복해 변화를 봅니다.',
  vbt: '바벨 속도는 같은 무게·같은 동작에서 비교합니다. 세트가 진행되며 속도가 줄어드는 정도로 피로를 읽습니다.',
  cardio: '심폐지구력은 같은 장비·같은 방법으로 반복했을 때의 변화가 가장 정확합니다. 추정값은 병원 호흡가스 검사를 대신하지 않습니다.',
  general: '이 측정은 값 자체와 다음 회차와의 변화로 읽습니다.',
};

const STATUS_WORD = { normal: '양호', caution: '주의', risk: '확인 필요', observed: '관찰', unknown: '기준 없음' };

function lookup(reportType, key) {
  const k = String(key || '');
  const base = k.replace(/(Left|Right)$/, '');
  return GUIDE[`${reportType}.${k}`] || GUIDE[k] || GUIDE[`${reportType}.${base}`] || GUIDE[base] || null;
}

const fmtNum = (v) => (Number.isFinite(Number(v)) ? String(Math.round(Number(v) * 10) / 10) : String(v));

function fmtRange(r, unit) {
  if (!Array.isArray(r) || r.length < 2) return '';
  const [a, b] = r;
  const u = unit || '';
  if (a === 0) return `${fmtNum(b)}${u} 이하`;
  if (b === 100 && u === '%') return `${fmtNum(a)}${u} 이상`;
  return `${fmtNum(a)}~${fmtNum(b)}${u}`;
}

function valueText(m) {
  const v = m.displayValue ?? m.value;
  return `${v}${m.unit ? (/^[a-z%]/i.test(m.unit) ? '' : '') + m.unit : ''}`;
}

/** 지표 하나의 상세 해석 문장. */
export function interpretMetricDetail(reportType, m) {
  const g = lookup(reportType, m.key);
  const term = g ? null : getLaymanTerm(m.key);
  const what = g ? g.what : (term?.description || '측정에서 확인한 항목입니다.');
  const status = m.status?.key || 'unknown';
  const good = m.range?.good; const warn = m.range?.warn;
  let judge;
  if (status === 'normal') {
    judge = good ? `${valueText(m)}로 기준 범위(${fmtRange(good, m.unit)}) 안이라 양호합니다.` : `${valueText(m)}로 양호한 쪽으로 판정됐습니다.`;
  } else if (status === 'caution') {
    judge = good && warn
      ? `${valueText(m)}로 기준 범위(${fmtRange(good, m.unit)})를 벗어났지만 허용 한계(${fmtRange(warn, m.unit)}) 안이라 "주의"입니다.`
      : `${valueText(m)}로 "주의" 단계로 판정됐습니다.`;
    if (g?.why) judge += ` ${g.why}`;
  } else if (status === 'risk') {
    judge = warn ? `${valueText(m)}로 허용 한계(${fmtRange(warn, m.unit)})를 넘어 "확인 필요" 단계입니다.` : `${valueText(m)}로 "확인 필요" 단계로 판정됐습니다.`;
    if (g?.why) judge += ` ${g.why}`;
    judge += ' 같은 조건으로 한 번 더 재서 반복되는지 확인하고, 트레이너와 원인을 함께 살펴보세요.';
  } else if (status === 'observed') {
    judge = `${valueText(m)} — 한 번만 관찰되고 반복 확인이 되지 않아 판정을 보류했습니다. 재측정으로 확인하세요.`;
  } else {
    const dir = g?.better === 'higher' ? '클수록 좋은 지표입니다.' : g?.better === 'lower' ? '작을수록 좋은 지표입니다.' : '';
    judge = `${valueText(m)} — 검증된 기준이 없어 등급은 내지 않고 값과 다음 회차와의 변화로 읽습니다. ${dir}`.trim();
  }
  return { key: m.key, label: m.label || g?.easyName || m.key, statusKey: status, statusWord: STATUS_WORD[status] || STATUS_WORD.unknown, valueText: valueText(m), what, judge };
}

/** 지표 하나의 쉬운 문장(초등학생 수준). */
export function interpretMetricEasy(reportType, m) {
  const g = lookup(reportType, m.key);
  const status = m.status?.key || 'unknown';
  const name = g?.easyName || m.label || '이 항목';
  const what = g?.easyWhat || '이번에 잰 값이에요';
  let verdict;
  if (status === 'normal') verdict = '지금 좋아요 😊';
  else if (status === 'caution') verdict = '조금만 더 신경 써요';
  else if (status === 'risk') verdict = '선생님과 같이 살펴봐요';
  else if (status === 'observed') verdict = '한 번 더 재서 확인해요';
  else if (g?.better === 'higher') verdict = '숫자가 커지면 더 좋아진 거예요';
  else if (g?.better === 'lower') verdict = '숫자가 작아지면 더 좋아진 거예요';
  else verdict = '다음에 또 재서 비교해요';
  return { key: m.key, name, status, text: `${what}. ${verdict}` };
}

const EASY_HEAD = {
  normal: { emoji: '😊', text: '전체적으로 아주 좋아요! 지금처럼 하면 돼요.' },
  caution: { emoji: '🙂', text: '잘하고 있어요. 몇 가지만 더 신경 쓰면 더 좋아져요.' },
  risk: { emoji: '💪', text: '선생님과 같이 자세히 살펴보면 좋은 부분이 있어요.' },
  observed: { emoji: '👀', text: '한 번 더 재보면 더 정확하게 알 수 있어요.' },
  unknown: { emoji: '📋', text: '이번 숫자를 기록해 뒀어요. 다음에 또 재서 얼마나 좋아졌는지 비교해요.' },
};

/**
 * @param {object} summary unifiedReport.buildSummaryData() 결과(또는 같은 모양)
 * @param {{reportType?:string, extra?:{detail?:string[], easy?:string[]}}} [opt]
 */
export function buildInterpretation(summary, opt = {}) {
  if (!summary) return null;
  const reportType = opt.reportType || summary.reportType || 'general';
  const metrics = Array.isArray(summary.keyMetrics) ? summary.keyMetrics.filter((m) => m && m.key) : [];
  const judged = metrics.filter((m) => ['normal', 'caution', 'risk'].includes(m.status?.key));
  const count = (k) => judged.filter((m) => m.status.key === k).length;
  const hasScore = summary.status && summary.status !== 'unknown';

  // ── 상세 ──
  const overview = [];
  if (hasScore) {
    overview.push(`종합 ${summary.overallScore}점 · ${summary.statusLabel || STATUS_WORD[summary.status] || ''}. 기준이 있는 지표 ${judged.length}개 중 양호 ${count('normal')}개 · 주의 ${count('caution')}개 · 확인 필요 ${count('risk')}개를 반영한 점수입니다(양호 100·주의 65·확인 필요 35 기준 평균, 확정된 주의/위험 판정이 있으면 그 단계를 넘지 않게 제한).`);
  } else {
    overview.push('이번 측정은 기준이 있는 지표가 부족해 종합 점수를 내지 않았습니다. 값과 다음 회차와의 변화로 읽습니다.');
  }
  overview.push(TYPE_NOTE[reportType] || TYPE_NOTE.general);
  const detailMetrics = metrics.map((m) => interpretMetricDetail(reportType, m));
  const worst = [...judged].sort((a, b) => (b.status.rank || 0) - (a.status.rank || 0))[0];
  const best = judged.find((m) => m.status.key === 'normal');
  const reading = [];
  if (best) reading.push(`잘 나온 점: ${best.label}(${valueText(best)}).`);
  if (worst && worst.status.key !== 'normal') reading.push(`우선 확인할 점: ${worst.label}(${valueText(worst)}).`);
  if (!judged.length && metrics.length) reading.push('판정 기준이 있는 지표가 없어 우열을 가리지 않았습니다. 같은 조건으로 반복 측정해 변화를 확인하세요.');
  const next = (summary.recommendations || []).filter(Boolean)[0] || '같은 조건으로 다시 측정해 변화를 비교해 보세요.';
  const detail = {
    overview,
    reading,
    metrics: detailMetrics,
    next,
    extra: opt.extra?.detail || [],
    caution: '이 해석은 측정값에 근거한 참고 설명이며 의학적 진단이 아닙니다. 통증·불편이 있으면 전문의와 상의하세요.',
  };

  // ── 쉬운 버전 ──
  const head = EASY_HEAD[hasScore ? summary.status : 'unknown'] || EASY_HEAD.unknown;
  const easyMetrics = metrics.slice(0, 6).map((m) => interpretMetricEasy(reportType, m));
  const lines = [head.text];
  if (best) { const e = interpretMetricEasy(reportType, best); lines.push(`잘한 점: ${e.name}이(가) 좋아요.`); }
  if (worst && worst.status.key !== 'normal') { const e = interpretMetricEasy(reportType, worst); lines.push(`더 신경 쓸 점: ${e.name}을(를) 선생님과 같이 봐요.`); }
  lines.push('다음에 또 재서 얼마나 좋아졌는지 비교해요.');
  const easy = { emoji: head.emoji, headline: head.text, lines, metrics: easyMetrics, extra: opt.extra?.easy || [] };

  return { reportType, detail, easy };
}
