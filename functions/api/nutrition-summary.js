// functions/api/nutrition-summary.js
// ════════════════════════════════════════════════════════════════════════
//  PUT /api/nutrition-summary — 영양 앱이 회원의 "하루 요약"만 CMS로 보낸다.
//  요청 스펙 섹션 6 확정 필드만 받는다(원본 사진·상세 건강정보는 절대
//  받지 않음). dailyNote는 회원이 별도 동의(consent)한 경우에만 포함.
//
//  저장 전 checkNutritionEligibility()로 한 번 더 이용권한을 확인한다
//  (섹션 5: "기록 저장" 시점에도 재검증 대상) — /api/nutrition-session과
//  동일한 판정 함수를 공유해서 두 엔드포인트의 판정이 갈라지지 않게 한다.
//
//  문서 id는 `${memberRef}_${date}` — 회원별 날짜 1건, 재전송 시 덮어씀
//  (setDocument = 전체 교체, 하루 안에서 여러 번 갱신돼도 항상 최신값만 남음).
// ════════════════════════════════════════════════════════════════════════
import { verifyConnectionToken } from '../_shared/nutritionToken.js';
import { getGoogleAccessToken, getDocument, docToPlain, setDocument, json } from '../_shared/firestoreRest.js';
import { checkNutritionEligibility } from '../_shared/nutritionEligibility.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC_TOTAL_KEYS = ['calories', 'carbG', 'proteinG', 'fatG', 'sugarG', 'sodiumMg', 'waterMl'];

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sanitizeTotals(totals = {}) {
  const out = {};
  NUMERIC_TOTAL_KEYS.forEach((key) => { out[key] = toFiniteNumber(totals[key]); });
  return out;
}

export async function onRequestPut({ request, env }) {
  let memberRef, jti;
  try {
    ({ memberRef, jti } = await verifyConnectionToken(env, request.headers.get('Authorization')));
  } catch (error) {
    return json({ ok: false, code: 'LINK_INVALID', message: error.message }, error.status || 401);
  }

  const body = await request.json().catch(() => ({}));
  const date = String(body.date || '').trim();
  if (!DATE_RE.test(date)) {
    return json({ ok: false, code: 'INVALID_DATE', message: 'date는 YYYY-MM-DD 형식이어야 합니다.' }, 400);
  }

  try {
    const accessToken = await getGoogleAccessToken(env);

    const connectionDoc = await getDocument(accessToken, `nutritionConnections/${encodeURIComponent(memberRef)}`);
    const connection = docToPlain(connectionDoc);
    if (!connection?.activeJti || connection.activeJti !== jti) {
      return json({ ok: false, code: 'LINK_DISCONNECTED', message: '연결이 해제되었습니다. 센터에 문의해 다시 연결해주세요.' }, 403);
    }

    const eligibility = await checkNutritionEligibility(accessToken, memberRef);
    if (!eligibility.ok) return json({ ok: false, code: eligibility.code, message: eligibility.message }, eligibility.status);

    // 명세된 최소 필드만 저장 — 그 외 전송된 필드(사진 URL, 건강정보 등)는 전부 버린다.
    const payload = {
      memberRef,
      date,
      recordedMealCount: Math.max(0, Math.trunc(toFiniteNumber(body.recordedMealCount))),
      dayCompleted: Boolean(body.dayCompleted),
      totals: sanitizeTotals(body.totals),
      missingNutrition: Boolean(body.missingNutrition),
      sourceUpdatedAt: typeof body.sourceUpdatedAt === 'string' ? body.sourceUpdatedAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (body.consent === true && typeof body.dailyNote === 'string' && body.dailyNote.trim()) {
      payload.dailyNote = body.dailyNote.trim().slice(0, 1000);
    }

    await setDocument(accessToken, `nutritionSummaries/${encodeURIComponent(`${memberRef}_${date}`)}`, payload);

    return json({ ok: true, saved: true, memberRef, date });
  } catch (error) {
    console.error('[nutrition-summary]', error?.message || error);
    return json({ ok: false, code: 'SERVICE_UNAVAILABLE', message: '저장에 실패했습니다. 잠시 후 다시 시도하세요.' }, error?.status || 500);
  }
}
