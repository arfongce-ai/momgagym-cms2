// functions/api/nutrition-session.js
// ════════════════════════════════════════════════════════════════════════
//  GET /api/nutrition-session — 영양 앱이 "지금 이 회원이 앱을 써도 되는지"를
//  매번(실행/새로고침/포그라운드 복귀/기록조회·저장/사진업로드/피드백조회
//  시점마다) 서버에서 재확인하기 위한 엔드포인트. 요청 스펙 섹션 5 확정안:
//  "새로운 기간 계산 로직을 따로 만들지 말고 기존 isMemberExpired()를
//  재사용" — 그래서 CMS가 이미 쓰는 src/services/sessionExpiry.js의
//  isMemberExpired()를 그대로 import해서 쓴다(재구현 아님, 진짜 재사용).
//  실제 판정은 functions/_shared/nutritionEligibility.js 한 곳에 모아
//  nutrition-summary.js(기록 저장 API)와 공유한다.
//
//  ⚠️ 알아둘 것(2026-09-17 조사): CMS 안에도 isMemberExpired가 두 곳에
//  있다 — src/utils/dates.js(오래된 365일 고정 버전, Members.jsx 목록
//  배지가 아직 이걸 씀)과 src/services/sessionExpiry.js(결제·세션·회차
//  기준의 새 버전, MemberDetail.jsx가 씀 — sessionExpiry.js 자체 주석에
//  "dates.js의 옛 버전을 대체"한다고 명시됨). 이 엔드포인트는 더 정확한
//  sessionExpiry.js 버전을 기준으로 삼는다. 두 버전이 갈라져 있는 건
//  이 연동과 무관한 기존 CMS 이슈이며, 설계문서 섹션 3에 별도로 남겨둠.
//
//  판정 순서: 1) 연동 토큰 검증(memberRef, jti) — nutritionConnections의
//  activeJti와 다르면(연결 해제됨) 즉시 거부. 2) checkNutritionEligibility로
//  회원 존재·isActive·isMemberExpired 확인.
// ════════════════════════════════════════════════════════════════════════
import { verifyConnectionToken } from '../_shared/nutritionToken.js';
import { getGoogleAccessToken, getDocument, docToPlain, json } from '../_shared/firestoreRest.js';
import { checkNutritionEligibility } from '../_shared/nutritionEligibility.js';

function tokenErrorCode() {
  return 'LINK_INVALID';
}

export async function onRequestGet({ request, env }) {
  let memberRef, jti;
  try {
    ({ memberRef, jti } = await verifyConnectionToken(env, request.headers.get('Authorization')));
  } catch (error) {
    return json({ ok: false, code: tokenErrorCode(), message: error.message }, error.status || 401);
  }

  try {
    const accessToken = await getGoogleAccessToken(env);

    const connectionDoc = await getDocument(accessToken, `nutritionConnections/${encodeURIComponent(memberRef)}`);
    const connection = docToPlain(connectionDoc);
    if (!connection?.activeJti || connection.activeJti !== jti) {
      return json({ ok: false, code: 'LINK_DISCONNECTED', message: '연결이 해제되었습니다. 센터에 문의해 다시 연결해주세요.' }, 403);
    }

    const result = await checkNutritionEligibility(accessToken, memberRef);
    if (!result.ok) return json({ ok: false, code: result.code, message: result.message }, result.status);

    return json({ ok: true, memberRef, eligible: true });
  } catch (error) {
    console.error('[nutrition-session]', error?.message || error);
    return json({ ok: false, code: 'SERVICE_UNAVAILABLE', message: '이용권한 확인에 실패했습니다. 잠시 후 다시 시도하세요.' }, error?.status || 500);
  }
}
