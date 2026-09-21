// functions/_shared/nutritionEligibility.js
// ════════════════════════════════════════════════════════════════════════
//  "이 회원이 지금 영양 앱을 써도 되는가"를 판정하는 단일 지점.
//  nutrition-session.js(세션 재확인 API)와 nutrition-summary.js(기록 저장
//  API, 저장 직전에도 한 번 더 확인)가 공통으로 쓴다 — 판정 로직이 두 곳에
//  따로 구현되어 갈라지는 것을 막기 위해 반드시 이 함수를 거치게 한다.
//
//  실제 만료 계산은 CMS가 이미 쓰는 src/services/sessionExpiry.js의
//  isMemberExpired()를 그대로 호출한다(재구현 금지 — 2026-09-17 확정).
// ════════════════════════════════════════════════════════════════════════
import { getDocument, queryEquals, docToPlain } from './firestoreRest.js';
import { isMemberExpired } from '../../src/services/sessionExpiry.js';

/**
 * @returns {Promise<{ ok:true, member:object } | { ok:false, status:number, code:string, message:string }>}
 */
export async function checkNutritionEligibility(accessToken, memberRef) {
  const memberDoc = await getDocument(accessToken, `members/${encodeURIComponent(memberRef)}`);
  if (!memberDoc) {
    return { ok: false, status: 404, code: 'MEMBER_NOT_FOUND', message: '회원 정보를 찾을 수 없습니다. 센터에 문의해주세요.' };
  }
  const member = docToPlain(memberDoc);

  if (member.isActive === false) {
    return { ok: false, status: 403, code: 'SERVICE_SUSPENDED', message: '이용이 정지되었습니다. 센터에 문의해주세요.' };
  }

  const [payments, settingsDoc] = await Promise.all([
    queryEquals(accessToken, 'payments', '__mid', memberRef, 200),
    getDocument(accessToken, 'settings/config'),
  ]);
  const settings = settingsDoc ? docToPlain(settingsDoc) : null;

  if (isMemberExpired(member, payments, settings)) {
    return { ok: false, status: 403, code: 'SERVICE_EXPIRED', message: '이용기간이 종료되었습니다. 계속 이용하려면 몸가짐 센터에 문의해 주세요.' };
  }

  return { ok: true, member };
}
