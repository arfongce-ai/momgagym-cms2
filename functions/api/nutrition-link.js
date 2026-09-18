// functions/api/nutrition-link.js
// ════════════════════════════════════════════════════════════════════════
//  영양 앱(nutrition-cms) ↔ CMS 회원 연결. 이름·전화번호 등 개인정보를
//  영양 앱에 다시 입력받지 않기 위해, "CMS가 발급한 1회용 연결코드"로만
//  연결한다(요청 스펙 섹션 4·13-2 확정안). 자세한 설계 배경은
//  claude/2026-09-17_영양앱-CMS연동_1단계조사_설계문서.md 참고.
//
//  action=issue      : CMS(관리자/트레이너)가 회원 1명에 대해 8자리 코드 발급. 10분 유효, 1회용.
//  action=exchange    : 영양 앱이 그 코드를 memberRef + 장기 연동토큰으로 교환(1회만 가능).
//  action=disconnect  : 회원이 영양 앱에서 "연결 해제"할 때 — 연동토큰으로 자기 연결만 해제.
//
//  CMS 쪽 Firestore 접근은 서비스 계정 access token(REST, firestore.rules 우회)을
//  쓴다 — trainer-account.js/login-role.js와 동일 패턴. linkCodes/nutritionConnections
//  컬렉션은 firestore.rules에서 클라이언트 직접 접근을 전부 막아뒀다(서버 함수 전용).
// ════════════════════════════════════════════════════════════════════════
import { resolveVerifiedRole } from '../_shared/verifyFirebaseToken.js';
import { getGoogleAccessToken, getDocument, setDocument, patchDocument, json } from '../_shared/firestoreRest.js';
import { signConnectionToken, verifyConnectionToken, newJti, newLinkCode } from '../_shared/nutritionToken.js';

const LINK_CODE_TTL_MS = 10 * 60 * 1000; // 10분

async function handleIssue({ request, env }) {
  const auth = await resolveVerifiedRole(request.headers.get('Authorization'));
  if (!auth.authenticated) {
    return json({ ok: false, error: '로그인이 필요합니다.' }, 401);
  }
  const body = await request.json().catch(() => ({}));
  const memberId = String(body.memberId || '').trim();
  if (!memberId) return json({ ok: false, error: 'memberId가 필요합니다.' }, 400);

  const accessToken = await getGoogleAccessToken(env);
  const member = await getDocument(accessToken, `members/${encodeURIComponent(memberId)}`);
  if (!member) return json({ ok: false, error: '해당 회원을 찾을 수 없습니다.' }, 404);

  const code = newLinkCode();
  const now = new Date();
  await setDocument(accessToken, `linkCodes/${encodeURIComponent(code)}`, {
    memberId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + LINK_CODE_TTL_MS).toISOString(),
    used: false,
    issuedByUid: auth.uid,
  });

  return json({ ok: true, code, expiresInSec: LINK_CODE_TTL_MS / 1000 });
}

async function handleExchange({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const code = String(body.code || '').trim().toUpperCase();
  if (!code) return json({ ok: false, error: '연결코드를 입력하세요.' }, 400);

  const accessToken = await getGoogleAccessToken(env);
  const linkDoc = await getDocument(accessToken, `linkCodes/${encodeURIComponent(code)}`);
  if (!linkDoc) return json({ ok: false, error: '연결코드를 찾을 수 없습니다.' }, 404);

  const fields = linkDoc.fields || {};
  const used = fields.used?.booleanValue === true;
  const expiresAt = fields.expiresAt?.stringValue || '';
  const memberId = fields.memberId?.stringValue || '';
  if (used) return json({ ok: false, error: '이미 사용된 연결코드입니다. 새 코드를 요청하세요.' }, 410);
  if (!expiresAt || new Date(expiresAt).getTime() < Date.now()) {
    return json({ ok: false, error: '연결코드가 만료되었습니다. 새 코드를 요청하세요.' }, 410);
  }
  if (!memberId) return json({ ok: false, error: '연결코드 정보가 올바르지 않습니다.' }, 500);

  const member = await getDocument(accessToken, `members/${encodeURIComponent(memberId)}`);
  if (!member) return json({ ok: false, error: '연결된 회원을 찾을 수 없습니다.' }, 404);

  // 1회용 — 즉시 소모 처리(교환 성공 여부와 무관하게 재사용 자체를 막음).
  await patchDocument(accessToken, `linkCodes/${encodeURIComponent(code)}`, { used: true });

  const jti = newJti();
  await setDocument(accessToken, `nutritionConnections/${encodeURIComponent(memberId)}`, {
    memberId,
    activeJti: jti,
    connectedAt: new Date().toISOString(),
  });

  const connectionToken = await signConnectionToken(env, { memberRef: memberId, jti });
  return json({ ok: true, memberRef: memberId, connectionToken });
}

async function handleDisconnect({ request, env }) {
  const { memberRef } = await verifyConnectionToken(env, request.headers.get('Authorization'));
  const accessToken = await getGoogleAccessToken(env);
  // activeJti를 비워 기존에 발급된 토큰을 전부 즉시 무효화. 문서는 남겨 재연결 이력 파악용으로 유지.
  await patchDocument(accessToken, `nutritionConnections/${encodeURIComponent(memberRef)}`, {
    activeJti: '',
    disconnectedAt: new Date().toISOString(),
  });
  return json({ ok: true, disconnected: true });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.clone().json().catch(() => ({}));
    switch (body.action) {
      case 'issue': return await handleIssue(context);
      case 'exchange': return await handleExchange(context);
      case 'disconnect': return await handleDisconnect(context);
      default: return json({ ok: false, error: '지원하지 않는 action입니다.' }, 400);
    }
  } catch (error) {
    console.error('[nutrition-link]', error?.message || error);
    return json({ ok: false, error: error?.message || '연동 처리에 실패했습니다.' }, error?.status || 500);
  }
}
