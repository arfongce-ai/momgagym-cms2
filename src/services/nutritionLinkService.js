// src/services/nutritionLinkService.js
// CMS 화면(회원상세)에서 "영양 앱 연결코드 발급" 버튼이 쓰는 클라이언트 래퍼.
// trainerAccountService.js의 callTrainerAccountAdmin과 동일한 패턴 —
// 현재 로그인한 Firebase ID 토큰을 Authorization으로 실어 functions/api/
// nutrition-link.js를 호출한다. 실제 코드 발급·저장·검증은 전부 서버에서
// 처리(이 파일은 fetch 래퍼일 뿐, 코드를 클라이언트에서 만들지 않음).
import { auth } from '../firebase';

async function callNutritionLink(payload) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('로그인이 필요합니다.');
  const idToken = await currentUser.getIdToken();
  const response = await fetch('/api/nutrition-link', {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || '영양 앱 연결 처리에 실패했습니다.');
  return data;
}

/** 이 회원용 1회용 연결코드(10분 유효)를 발급한다. */
export async function issueNutritionLinkCode(memberId) {
  if (!memberId) throw new Error('memberId가 필요합니다.');
  const result = await callNutritionLink({ action: 'issue', memberId });
  return { code: result.code, expiresInSec: result.expiresInSec };
}
