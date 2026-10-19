// sprintTests.js — 스프린트/왕복 달리기 종목 정의 (2026-10)
//
// 현장 방식(대표님 확정): 카메라를 트랙 옆(측면)에 두고, 콘 두 개로 화면 '가로' 길이를 정해
// 그 길이를 기준(캘리브레이션)으로 삼는다. 출발 카운트다운과 신호음은 폰 안에서 낸다.
// 종목은 세 가지: 10m 스프린트 / 5m 왕복 달리기 / 10m 왕복 달리기.
//
// 라이브(SprintLiveAnalysis)와 업로드(SprintUploadAnalysis)가 같은 정의를 쓰도록 한 곳에 모은다.
// ⚠️ 기존 저장 기록과의 호환: testKey 'sprint5'·'sprint10'·'agility505' 는 그대로 유지한다.
//    'agility505' 는 이제 '5m 왕복 달리기'로 표시한다(5m 갔다가 되돌아오는 같은 측정).

const metres = (n) => Array.from({ length: n }, (_, i) => i + 1);

export const SPRINT_TEST_TYPES = Object.freeze({
  sprint10: { label: '10m 스프린트', mode: 'sprint', splitDistancesM: metres(10), trackDistanceM: 10 },
  agility505: { label: '5m 왕복 달리기', mode: 'agility', splitDistancesM: metres(5), trackDistanceM: 5 },
  shuttle10: { label: '10m 왕복 달리기', mode: 'agility', splitDistancesM: metres(10), trackDistanceM: 10 },
  sprint5: { label: '5m 스프린트', mode: 'sprint', splitDistancesM: metres(5), trackDistanceM: 5 },
});

/** 화면에 보여줄 종목 순서(대표 종목 먼저). sprint5 는 기존 기록 호환용으로만 남긴다. */
export const SPRINT_TEST_ORDER = ['sprint10', 'agility505', 'shuttle10'];

/** 촬영 방식 기본값: 측면(가로) 기준. */
export const DEFAULT_CAM_ANGLE = 'lateral';
