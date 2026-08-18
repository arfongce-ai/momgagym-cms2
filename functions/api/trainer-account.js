import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';

const PROJECT_ID = 'momgagym-cms';
const API_KEY = 'AIzaSyC9R63MgGXKE0lQ_hfCR8LHRmMRv1jiugk';
const OWNER_EMAIL = 'momgagym@naver.com';
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function bearer(request) {
  const value = request.headers.get('Authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

async function verifyAdmin(request, accessToken) {
  const idToken = bearer(request);
  if (!idToken) throw Object.assign(new Error('관리자 로그인이 필요합니다.'), { status: 401 });
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    }));
  } catch {
    throw Object.assign(new Error('관리자 로그인이 만료되었습니다. 다시 로그인하세요.'), { status: 401 });
  }
  const email = String(payload.email || '').toLowerCase();
  if (payload.admin === true || email === OWNER_EMAIL) return payload;

  const roleDoc = await getFirestoreDocument(accessToken, `roles/${encodeURIComponent(payload.sub || '')}`);
  if (roleDoc?.fields?.role?.stringValue === 'admin') return payload;
  throw Object.assign(new Error('관리자만 계정을 변경할 수 있습니다.'), { status: 403 });
}

export async function getGoogleAccessToken(env) {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - 60_000) return cachedAccessToken;
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw Object.assign(new Error('Firebase 관리자 키가 설정되지 않았습니다.'), { status: 503 });
  }
  let serviceAccount;
  try { serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON); }
  catch { throw Object.assign(new Error('Firebase 관리자 키 형식이 잘못되었습니다.'), { status: 503 }); }
  if (serviceAccount.project_id !== PROJECT_ID || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw Object.assign(new Error('Firebase 관리자 키가 현재 프로젝트와 맞지 않습니다.'), { status: 503 });
  }

  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(serviceAccount.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/cloud-platform' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(serviceAccount.client_email)
    .setSubject(serviceAccount.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) {
    throw Object.assign(new Error('Firebase 관리자 인증에 실패했습니다.'), { status: 503 });
  }
  cachedAccessToken = tokenData.access_token;
  cachedAccessTokenExpiresAt = Date.now() + Number(tokenData.expires_in || 3600) * 1000;
  return cachedAccessToken;
}

const firestoreDocumentUrl = path =>
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`;

export async function getFirestoreDocument(accessToken, path) {
  const response = await fetch(firestoreDocumentUrl(path), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw Object.assign(new Error('Firebase 권한 정보를 읽지 못했습니다.'), { status: 503 });
  return response.json();
}

export async function setRoleDocument(accessToken, uid, role, email = '') {
  const fields = { role: { stringValue: role } };
  if (email) fields.email = { stringValue: String(email).trim().toLowerCase() };
  const response = await fetch(firestoreDocumentUrl(`roles/${encodeURIComponent(uid)}`), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) throw Object.assign(new Error('로그인 역할 저장에 실패했습니다.'), { status: 503 });
}

export async function deleteRoleDocument(accessToken, uid) {
  if (!uid) return;
  const response = await fetch(firestoreDocumentUrl(`roles/${encodeURIComponent(uid)}`), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok && response.status !== 404) {
    throw Object.assign(new Error('로그인 역할 삭제에 실패했습니다.'), { status: 503 });
  }
}

async function identityRequest(path, accessToken, body) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = data?.error?.message || 'FIREBASE_ADMIN_ERROR';
    const messages = {
      EMAIL_EXISTS: '이미 다른 계정에서 사용 중인 이메일입니다.',
      INVALID_EMAIL: '이메일 형식을 확인하세요.',
      USER_NOT_FOUND: 'Firebase 로그인 계정을 찾을 수 없습니다.',
      INVALID_PASSWORD: '비밀번호는 6글자 이상으로 입력하세요.',
      INSUFFICIENT_PERMISSION: '서비스 계정에 Firebase 사용자 관리 권한이 없습니다.',
    };
    throw Object.assign(new Error(messages[code] || `Firebase 계정 처리 실패: ${code}`), { status: 400 });
  }
  return data;
}

async function lookupUser(accessToken, { uid, email }) {
  const body = uid ? { localId: [uid] } : { email: [email] };
  const data = await identityRequest('accounts:lookup', accessToken, body);
  return data.users?.[0] || null;
}

async function upsertAccount(accessToken, input) {
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  const currentEmail = String(input.currentEmail || '').trim().toLowerCase();
  if (!email || !email.includes('@')) throw Object.assign(new Error('올바른 로그인 이메일을 입력하세요.'), { status: 400 });
  if (password && password.length < 6) throw Object.assign(new Error('비밀번호는 6글자 이상으로 입력하세요.'), { status: 400 });

  let user = null;
  if (input.uid) user = await lookupUser(accessToken, { uid: input.uid });
  if (!user && currentEmail) user = await lookupUser(accessToken, { email: currentEmail });
  if (!user && currentEmail !== email) user = await lookupUser(accessToken, { email });

  if (user) {
    const update = { localId: user.localId, email, emailVerified: true };
    if (password) update.password = password;
    if (input.displayName) update.displayName = String(input.displayName).slice(0, 256);
    const result = await identityRequest('accounts:update', accessToken, update);
    return { uid: result.localId || user.localId, email, created: false };
  }

  if (!password) throw Object.assign(new Error('새 계정을 만들 비밀번호를 입력하세요.'), { status: 400 });
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts?key=${encodeURIComponent(API_KEY)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, displayName: String(input.displayName || '').slice(0, 256), emailVerified: true }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = result?.error?.message || 'FIREBASE_CREATE_ERROR';
    throw Object.assign(new Error(code === 'EMAIL_EXISTS' ? '이미 사용 중인 이메일입니다.' : `Firebase 계정 생성 실패: ${code}`), { status: 400 });
  }
  return { uid: result.localId, email, created: true };
}

export async function onRequestPost({ request, env }) {
  try {
    const accessToken = await getGoogleAccessToken(env);
    await verifyAdmin(request, accessToken);
    const input = await request.json();
    if (input.action === 'upsert') {
      const account = await upsertAccount(accessToken, input);
      const previousRole = await getFirestoreDocument(accessToken, `roles/${encodeURIComponent(account.uid)}`);
      const hadAccess = previousRole?.fields?.role?.stringValue === 'trainer';
      try {
        await setRoleDocument(accessToken, account.uid, 'trainer', account.email);
      } catch (error) {
        if (account.created) {
          try { await identityRequest('accounts:delete', accessToken, { localId: account.uid }); } catch { /* 원래 오류 유지 */ }
        }
        throw error;
      }
      return json({ ok: true, ...account, hadAccess });
    }
    if (input.action === 'delete') {
      let user = null;
      if (input.uid) user = await lookupUser(accessToken, { uid: input.uid });
      if (!user && input.email) user = await lookupUser(accessToken, { email: String(input.email).trim().toLowerCase() });
      await deleteRoleDocument(accessToken, input.uid || user?.localId || '');
      if (user) await identityRequest('accounts:delete', accessToken, { localId: user.localId });
      return json({ ok: true, deleted: Boolean(user) });
    }
    if (input.action === 'grant') {
      if (!input.uid) return json({ ok: false, error: '트레이너 계정 UID가 없습니다.' }, 400);
      await setRoleDocument(accessToken, input.uid, 'trainer', input.email || '');
      return json({ ok: true });
    }
    if (input.action === 'revoke') {
      await deleteRoleDocument(accessToken, input.uid || '');
      return json({ ok: true });
    }
    return json({ ok: false, error: '지원하지 않는 계정 작업입니다.' }, 400);
  } catch (error) {
    console.error('[trainer-account]', error?.message || error);
    return json({ ok: false, error: error?.message || '계정 처리에 실패했습니다.' }, error?.status || 500);
  }
}
