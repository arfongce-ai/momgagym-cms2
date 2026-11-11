// utils/trainerSelf.js
// ════════════════════════════════════════════════════════════════════════
//  [트레이너 본인 기록 2026-11-11] 등록된 트레이너도 회원처럼 본인의 신체정보·
//  체력측정을 기록·분석·비교할 수 있게 하는 "본인 기록 대상".
//
//  · members 컬렉션에 문서를 만들지 않는다 → 회원 수·매출·만료 알림·대시보드·
//    Notion 집계에 섞이지 않는다.
//  · 기록은 기존 컬렉션(body, ai, gait/posture/rom_reports)에 `trself_<트레이너ID>`
//    를 대상 ID로 저장한다. 기존 저장·이력·비교·리포트 코드가 ID만 보고 동작하므로
//    그대로 재사용된다.
//  · 이름·생년월일·성별은 트레이너 문서(대표가 트레이너 관리에서 입력)에서 가져온다.
//  · 열람 범위: 트레이너는 본인만, 관리자(대표)는 전체 트레이너. 직원(staff)은 없음.
//    (화면 단 구분이다 — Firestore 규칙은 기존 측정 기록과 동일하게 로그인 사용자 공통.)
// ════════════════════════════════════════════════════════════════════════

export const TRAINER_SELF_PREFIX = 'trself_';

export function trainerSelfId(trainerId) {
  return trainerId ? `${TRAINER_SELF_PREFIX}${trainerId}` : '';
}

export function isTrainerSelfId(id) {
  return typeof id === 'string' && id.startsWith(TRAINER_SELF_PREFIX) && id.length > TRAINER_SELF_PREFIX.length;
}

// 트레이너 문서 → 회원 모양의 기록 대상. 측정 허브·리포트·회원 상세(신체정보/측정이력
// 탭)가 회원 객체를 받는 자리에 그대로 넣을 수 있다. 전화번호 등 연락처는 넣지 않는다.
export function buildTrainerSelfSubject(trainer) {
  if (!trainer || !trainer.id) return null;
  return {
    id: trainerSelfId(trainer.id),
    name: `${trainer.name || '트레이너'} (트레이너)`,
    isTrainerSelf: true,
    selfTrainerId: trainer.id,
    gender: trainer.gender || '',
    birthDate: trainer.birthDate || '',
    phone: '',
    trainerSessions: {},
  };
}

// 로그인 사용자가 볼 수 있는 본인 기록 대상 목록.
export function trainerSelfSubjectsFor(user, trainers = []) {
  const list = Array.isArray(trainers) ? trainers : [];
  if (user?.role === 'admin') return list.map(buildTrainerSelfSubject).filter(Boolean);
  if (user?.role === 'trainer') {
    const tid = user.trainerId || user.id;
    return list.filter((t) => t && t.id === tid).map(buildTrainerSelfSubject).filter(Boolean);
  }
  return [];
}

// 회원 목록 앞에 본인 기록 대상을 붙인다(선택기에서 회원과 함께 고를 수 있게).
export function withTrainerSelfSubjects(members = [], user, trainers = []) {
  return [...trainerSelfSubjectsFor(user, trainers), ...members];
}
