// functions/api/teacher-nutrition.js
// ════════════════════════════════════════════════════════════════════════
//  CMS(트레이너/관리자)가 담당 회원의 영양 요약·피드백을 보고 쓰는 API.
//  CMS 자체 Firebase 프로젝트의 로그인 계정이므로(별도 프로젝트 가정인
//  nutrition-cms와 달리) 기존 verifyFirebaseToken.js의 resolveVerifiedRole을
//  그대로 재사용한다(login-role.js/voice-command.js와 동일 인증 방식).
//
//  담당 배정 판정은 새 컬렉션을 만들지 않고 기존 member.trainerSessions
//  맵을 그대로 쓴다(설계문서 섹션 3 — "배정 = trainerSessions", N:M 구조
//  유지 확정, 9-1). trainerId는 trainers/{id}.authUid == uid로 역조회한다
//  (AuthContext.jsx의 findTrainerByEmail과 동일 원리, uid 기준으로만 다름).
//
//  GET  ?resource=members                       → 담당(또는 전체, admin) 회원 목록(최소 필드)
//  GET  ?resource=summary&memberRef=X[&date=X]   → 그 회원의 일일 요약(들)
//  GET  ?resource=feedback&memberRef=X           → 그 회원에 대한 피드백 이력
//  POST { memberRef, message }                    → 담당 회원에게 피드백 작성
// ════════════════════════════════════════════════════════════════════════
import { resolveVerifiedRole } from '../_shared/verifyFirebaseToken.js';
import {
  getGoogleAccessToken, getDocument, docToPlain, queryEquals, setDocument, json,
} from '../_shared/firestoreRest.js';

async function requireAuth(request) {
  const auth = await resolveVerifiedRole(request.headers.get('Authorization'));
  if (!auth.authenticated) {
    throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401 });
  }
  return auth;
}

/** admin이면 null(=필터 없음) 반환, trainer면 자기 trainerId, 못 찾으면 예외. */
async function resolveTrainerScope(accessToken, auth) {
  if (auth.role === 'admin') return null;
  const matches = await queryEquals(accessToken, 'trainers', 'authUid', auth.uid, 2);
  if (matches.length !== 1) {
    throw Object.assign(new Error('이 계정과 연결된 트레이너 정보를 찾지 못했습니다.'), { status: 403 });
  }
  return matches[0].id;
}

function memberHasTrainer(member, trainerId) {
  if (!trainerId) return true; // admin
  return Boolean(member?.trainerSessions && Object.prototype.hasOwnProperty.call(member.trainerSessions, trainerId));
}

async function listMembers(accessToken, trainerScope) {
  // members 컬렉션은 회원 수가 많지 않은 소형 센터 기준(기존 CMS도 전체 로드 방식) — 전체를 읽고 담당만 필터.
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/momgagym-cms/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'members' }], limit: 1000 } }),
    },
  );
  if (!res.ok) throw Object.assign(new Error('회원 목록을 불러오지 못했습니다.'), { status: 503 });
  const rows = await res.json();
  const members = rows.map(r => docToPlain(r.document)).filter(Boolean);
  return members
    .filter(m => memberHasTrainer(m, trainerScope))
    .map(m => ({ memberRef: m.id, name: m.name || '', isActive: m.isActive !== false }));
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAuth(request);
    const accessToken = await getGoogleAccessToken(env);
    const trainerScope = await resolveTrainerScope(accessToken, auth);
    const url = new URL(request.url);
    const resource = url.searchParams.get('resource');
    const memberRef = url.searchParams.get('memberRef') || '';

    if (resource === 'members') {
      const members = await listMembers(accessToken, trainerScope);
      return json({ ok: true, members });
    }

    if (!memberRef) return json({ ok: false, error: 'memberRef가 필요합니다.' }, 400);
    const member = docToPlain(await getDocument(accessToken, `members/${encodeURIComponent(memberRef)}`));
    if (!member) return json({ ok: false, error: '회원을 찾을 수 없습니다.' }, 404);
    if (!memberHasTrainer(member, trainerScope)) {
      return json({ ok: false, error: '담당하지 않는 회원입니다.' }, 403);
    }

    if (resource === 'summary') {
      const date = url.searchParams.get('date');
      if (date) {
        const doc = await getDocument(accessToken, `nutritionSummaries/${encodeURIComponent(`${memberRef}_${date}`)}`);
        return json({ ok: true, summary: docToPlain(doc) });
      }
      const all = await queryEquals(accessToken, 'nutritionSummaries', 'memberRef', memberRef, 62); // 최근 두 달치 정도
      all.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      return json({ ok: true, summaries: all });
    }

    if (resource === 'feedback') {
      const items = await queryEquals(accessToken, 'nutritionFeedback', 'memberRef', memberRef, 100);
      items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      return json({ ok: true, feedback: items });
    }

    return json({ ok: false, error: '지원하지 않는 resource입니다.' }, 400);
  } catch (error) {
    console.error('[teacher-nutrition:get]', error?.message || error);
    return json({ ok: false, error: error?.message || '조회에 실패했습니다.' }, error?.status || 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuth(request);
    const accessToken = await getGoogleAccessToken(env);
    const trainerScope = await resolveTrainerScope(accessToken, auth);

    const body = await request.json().catch(() => ({}));
    const memberRef = String(body.memberRef || '').trim();
    const message = String(body.message || '').trim().slice(0, 1000);
    if (!memberRef || !message) {
      return json({ ok: false, error: 'memberRef와 message가 필요합니다.' }, 400);
    }

    const member = docToPlain(await getDocument(accessToken, `members/${encodeURIComponent(memberRef)}`));
    if (!member) return json({ ok: false, error: '회원을 찾을 수 없습니다.' }, 404);
    if (!memberHasTrainer(member, trainerScope)) {
      return json({ ok: false, error: '담당하지 않는 회원에게는 피드백을 작성할 수 없습니다.' }, 403);
    }

    const feedbackId = crypto.randomUUID();
    const payload = {
      memberRef,
      trainerId: trainerScope || 'admin',
      authorUid: auth.uid,
      message,
      date: body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null,
      createdAt: new Date().toISOString(),
      readByMember: false,
      memberReply: null,
    };
    await setDocument(accessToken, `nutritionFeedback/${encodeURIComponent(feedbackId)}`, payload);
    return json({ ok: true, feedbackId });
  } catch (error) {
    console.error('[teacher-nutrition:post]', error?.message || error);
    return json({ ok: false, error: error?.message || '피드백 저장에 실패했습니다.' }, error?.status || 500);
  }
}
