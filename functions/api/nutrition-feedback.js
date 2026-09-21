// functions/api/nutrition-feedback.js
// ════════════════════════════════════════════════════════════════════════
//  영양 앱(회원) 쪽 피드백 API. 트레이너가 쓰는 쪽은 functions/api/
//  teacher-nutrition.js(피드백 작성)에 있다 — 이 파일은 "회원 본인 피드백
//  조회/읽음처리/답변"만 담당(요청 스펙 섹션 11: "회원 앱 피드백 조회·읽음·답변").
//
//  GET  /api/nutrition-feedback            → 연동 토큰의 memberRef로 자기 피드백 목록만 조회
//  POST /api/nutrition-feedback (action=read)  → 특정 피드백을 읽음 처리
//  POST /api/nutrition-feedback (action=reply) → 특정 피드백에 답변
//
//  둘 다 연동 토큰의 memberRef와 피드백 문서의 memberRef가 일치해야만
//  허용한다(다른 회원의 피드백 id를 넣어도 조회/조작 불가) — 회원 권한
//  "자신의 피드백에만 답변"(섹션 8) 원칙.
// ════════════════════════════════════════════════════════════════════════
import { verifyConnectionToken } from '../_shared/nutritionToken.js';
import {
  getGoogleAccessToken, getDocument, docToPlain, patchDocument, queryEquals, json,
} from '../_shared/firestoreRest.js';

async function requireActiveConnection(env, request) {
  const { memberRef, jti } = await verifyConnectionToken(env, request.headers.get('Authorization'));
  const accessToken = await getGoogleAccessToken(env);
  const connection = docToPlain(await getDocument(accessToken, `nutritionConnections/${encodeURIComponent(memberRef)}`));
  if (!connection?.activeJti || connection.activeJti !== jti) {
    throw Object.assign(new Error('연결이 해제되었습니다. 센터에 문의해 다시 연결해주세요.'), { status: 403, code: 'LINK_DISCONNECTED' });
  }
  return { memberRef, accessToken };
}

export async function onRequestGet({ request, env }) {
  try {
    const { memberRef, accessToken } = await requireActiveConnection(env, request);
    const items = await queryEquals(accessToken, 'nutritionFeedback', 'memberRef', memberRef, 100);
    items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return json({ ok: true, feedback: items });
  } catch (error) {
    console.error('[nutrition-feedback:get]', error?.message || error);
    return json({ ok: false, code: error.code || 'SERVICE_UNAVAILABLE', message: error.message || '피드백을 불러오지 못했습니다.' }, error.status || 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const { memberRef, accessToken } = await requireActiveConnection(env, request);
    const body = await request.json().catch(() => ({}));
    const feedbackId = String(body.feedbackId || '').trim();
    if (!feedbackId) return json({ ok: false, code: 'INVALID_INPUT', message: 'feedbackId가 필요합니다.' }, 400);

    const doc = docToPlain(await getDocument(accessToken, `nutritionFeedback/${encodeURIComponent(feedbackId)}`));
    if (!doc || doc.memberRef !== memberRef) {
      return json({ ok: false, code: 'NOT_FOUND', message: '피드백을 찾을 수 없습니다.' }, 404);
    }

    if (body.action === 'read') {
      await patchDocument(accessToken, `nutritionFeedback/${encodeURIComponent(feedbackId)}`, {
        readByMember: true,
        readAt: new Date().toISOString(),
      });
      return json({ ok: true, feedbackId, read: true });
    }

    if (body.action === 'reply') {
      const replyText = String(body.reply || '').trim().slice(0, 1000);
      if (!replyText) return json({ ok: false, code: 'INVALID_INPUT', message: '답변 내용이 비어 있습니다.' }, 400);
      await patchDocument(accessToken, `nutritionFeedback/${encodeURIComponent(feedbackId)}`, {
        // 필드명은 반드시 client(FeedbackSheet.jsx)가 읽는 `reply`와 맞춘다 —
        // 예전엔 memberReply로 저장해서 화면에 절대 안 뜨는 버그가 있었음(2026-09-18 수정).
        reply: replyText,
        repliedAt: new Date().toISOString(),
        readByMember: true,
      });
      return json({ ok: true, feedbackId, replied: true });
    }

    return json({ ok: false, code: 'INVALID_ACTION', message: '지원하지 않는 action입니다.' }, 400);
  } catch (error) {
    console.error('[nutrition-feedback:post]', error?.message || error);
    return json({ ok: false, code: error.code || 'SERVICE_UNAVAILABLE', message: error.message || '처리에 실패했습니다.' }, error.status || 500);
  }
}
