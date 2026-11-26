// 바벨 리프팅 촬영 위치 안내(측면·정면·후면·대각선). 종목마다 권장 위치와, 위치별로 "무엇이 잘 보이는지"를 쉬운 말로 알려준다.
// 순수 데이터 — 계산에는 want(side/front/any)만 쓰이고, 선택값은 기록용으로 리포트에 같이 저장한다.
export const VIEWS = {
  side: {
    key: 'side', label: '측면', want: 'side', icon: '➡️',
    sees: '바가 위아래·앞뒤로 얼마나 움직였는지(속도·궤적·바가 몸에서 멀어지는지), 허리·무릎 각도',
    blind: '좌우 기울기·좌우 균형은 잘 안 보입니다',
    place: '몸의 옆쪽, 허리 높이, 3m 이상 떨어져서 전신과 바벨 양 끝이 다 보이게',
  },
  front: {
    key: 'front', label: '정면', want: 'front', icon: '⬆️',
    sees: '바가 좌우로 기울었는지(한쪽이 올라가는지), 양 무릎·어깨의 좌우 균형',
    blind: '바가 앞뒤로 얼마나 움직였는지는 정확하지 않습니다(속도가 낮게 나올 수 있음)',
    place: '몸 정면, 허리 높이, 3m 이상 떨어져서 전신이 보이게',
  },
  back: {
    key: 'back', label: '후면', want: 'front', icon: '⬇️',
    sees: '정면과 같이 좌우 기울기·균형. 스쿼트·데드에서 무릎이 모이는지, 골반이 틀어지는지',
    blind: '바가 앞뒤로 움직인 정도는 정확하지 않습니다',
    place: '몸 뒤쪽, 허리 높이, 3m 이상 떨어져서 전신이 보이게',
  },
  diagonal: {
    key: 'diagonal', label: '대각선(45°)', want: 'any', icon: '↗️',
    sees: '앞뒤 움직임과 좌우 기울기를 둘 다 어느 정도 봅니다(눈으로 확인하기 좋음)',
    blind: '속도·각도 수치는 측면보다 조금 낮게/부정확하게 나옵니다',
    place: '몸의 앞(또는 뒤) 비스듬히 45°, 허리 높이, 3m 이상 떨어져서',
  },
};

// 종목별 권장 위치(첫 번째가 기본 권장) + 이유.
const REC = {
  squat: { views: ['side', 'back', 'front', 'diagonal'], why: '스쿼트 깊이와 허리 각도는 측면, 무릎 모임·좌우 쏠림은 정면/후면에서 잘 보입니다.' },
  deadlift: { views: ['side', 'back', 'diagonal', 'front'], why: '바가 몸에 붙어 올라오는지·허리 각도는 측면, 골반 틀어짐은 후면에서 봅니다.' },
  bench_press: { views: ['side', 'front', 'diagonal', 'back'], why: '바 궤적은 측면(머리 쪽 옆), 좌우 균형은 머리 쪽 정면에서 봅니다.' },
  snatch: { views: ['side', 'front', 'diagonal', 'back'], why: '스내치는 바가 몸에 붙어 올라오는 궤적이 핵심이라 측면이 기본입니다. 정면은 캐치 때 좌우 균형 확인용입니다.' },
  clean: { views: ['side', 'front', 'diagonal', 'back'], why: '클린은 당기기→캐치 궤적을 보려면 측면이 기본입니다. 정면은 랙 포지션 좌우 확인용입니다.' },
  clean_jerk: { views: ['side', 'front', 'diagonal', 'back'], why: '클린&저크는 측면에서 바 궤적과 저크 드라이브를, 정면에서 오버헤드 좌우 균형을 봅니다.' },
};
const FALLBACK = { views: ['side', 'front', 'back', 'diagonal'], why: '바의 위아래 움직임을 보려면 측면이 기본입니다.' };

export function recommendedViews(exerciseType) {
  const r = REC[exerciseType] || FALLBACK;
  return { why: r.why, views: r.views.map((k, i) => ({ ...VIEWS[k], recommended: i === 0 })) };
}

export function wantForView(viewKey) {
  return VIEWS[viewKey]?.want || 'side';
}
export const defaultView = (exerciseType) => (REC[exerciseType] || FALLBACK).views[0];

/**
 * 촬영 위치 자동 인식(선택 불필요). 어깨 가로 간격을 몸통 길이로 나눈 비율로 판정:
 *  측면(<0.25) · 대각선(<0.65) · 정면/후면(그 이상, 코가 안 보이고 귀만 보이면 후면). 못 잡으면 null.
 * lms: 33점 정규화 좌표. aspect 는 영상 가로/세로(없으면 1) — 정규화 x 를 세로 기준 길이로 맞춘다.
 */
export function detectView(lms, aspect = 1) {
  if (!lms || lms.length < 25) return null;
  const v = (p) => p && (p.visibility == null || p.visibility >= 0.4);
  const ls = lms[11], rs = lms[12], lh = lms[23], rh = lms[24];
  if (!v(ls) || !v(rs) || !v(lh) || !v(rh)) return null;
  const gap = Math.abs(ls.x - rs.x) * aspect;
  const torso = Math.hypot(((ls.x + rs.x) / 2 - (lh.x + rh.x) / 2) * aspect, (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2);
  if (torso < 0.05) return null;
  const r = gap / torso;
  if (r < 0.25) return 'side';
  if (r < 0.65) return 'diagonal';
  const nose = lms[0];
  const earsSeen = v(lms[7]) && v(lms[8]);
  return !v(nose) && earsSeen ? 'back' : 'front';
}

/** 화면 안내 문구에 붙일 한 줄. 측면이 아니면 무엇이 부정확한지 짧게 알려 준다. */
export function viewStatusText(viewKey) {
  const v = VIEWS[viewKey];
  if (!v) return '';
  return viewKey === 'side' ? `촬영 위치 ${v.label}` : `촬영 위치 ${v.label} · ${v.blind}`;
}
