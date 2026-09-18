// src/services/teacherNutritionService.js
// CMS 화면(회원상세 "영양 기록" 탭)이 쓰는 클라이언트 래퍼. 트레이너/관리자가
// 로그인한 Firebase ID 토큰으로 functions/api/teacher-nutrition.js를 부른다.
// nutritionLinkService.js와 동일한 패턴 — 서버가 담당 회원 여부를 다시
// 검증하므로(memberHasTrainer), 여기서는 그냥 memberRef만 넘기면 된다.
import { auth } from '../firebase';

async function authedFetch(url, options = {}) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('로그인이 필요합니다.');
  const idToken = await currentUser.getIdToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${idToken}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || '영양 데이터 조회에 실패했습니다.');
  return data;
}

/** 이 회원의 최근 일일 영양 요약 목록(최신순, 최대 두 달치). */
export async function fetchNutritionSummaries(memberRef) {
  const data = await authedFetch(`/api/teacher-nutrition?resource=summary&memberRef=${encodeURIComponent(memberRef)}`);
  return data.summaries || [];
}

/** 이 회원에 대한 피드백 이력(최신순). */
export async function fetchNutritionFeedback(memberRef) {
  const data = await authedFetch(`/api/teacher-nutrition?resource=feedback&memberRef=${encodeURIComponent(memberRef)}`);
  return data.feedback || [];
}

/** 이 회원에게 새 피드백을 남긴다. date는 선택(특정 날짜 기록에 대한 코멘트일 때만). */
export async function sendNutritionFeedback(memberRef, message, date) {
  const data = await authedFetch('/api/teacher-nutrition', {
    method: 'POST',
    body: JSON.stringify({ memberRef, message, ...(date ? { date } : {}) }),
  });
  return data;
}
