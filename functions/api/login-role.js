import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  getFirestoreDocument,
  getGoogleAccessToken,
  setRoleDocument,
} from './trainer-account.js';

const PROJECT_ID = 'momgagym-cms';
const OWNER_EMAIL = 'momgagym@naver.com';
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

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

async function verifyUser(request) {
  const idToken = bearer(request);
  if (!idToken) throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401 });
  try {
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    });
    if (!payload.sub || !payload.email) throw new Error('missing user identity');
    return {
      idToken,
      uid: payload.sub,
      email: String(payload.email).trim().toLowerCase(),
      isAdmin: payload.admin === true || String(payload.email).trim().toLowerCase() === OWNER_EMAIL,
    };
  } catch {
    throw Object.assign(new Error('로그인이 만료되었습니다. 다시 로그인하세요.'), { status: 401 });
  }
}

async function verifyRequiredDataRead(idToken) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/members?pageSize=1&mask.fieldPaths=id`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  );
  if (!response.ok) {
    throw Object.assign(
      new Error('로그인 역할은 복구했지만 회원 데이터 읽기 권한이 아직 적용되지 않았습니다.'),
      { status: 503 },
    );
  }
}

function stringField(document, field) {
  return document?.fields?.[field]?.stringValue || '';
}

async function findTrainerByLoginEmail(accessToken, email) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'trainers' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'loginEmail' },
              op: 'EQUAL',
              value: { stringValue: email },
            },
          },
          limit: 2,
        },
      }),
    },
  );
  if (!response.ok) throw Object.assign(new Error('트레이너 계정 연결 정보를 확인하지 못했습니다.'), { status: 503 });
  const rows = await response.json();
  const matches = rows.map(row => row.document).filter(Boolean);
  if (matches.length !== 1) return null;
  return matches[0];
}

async function linkTrainerUid(accessToken, trainerDocument, uid) {
  const name = trainerDocument?.name || '';
  const marker = '/documents/trainers/';
  const index = name.indexOf(marker);
  if (index < 0) throw Object.assign(new Error('트레이너 정보 경로가 올바르지 않습니다.'), { status: 503 });
  const trainerId = name.slice(index + marker.length);
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/trainers/${encodeURIComponent(trainerId)}?updateMask.fieldPaths=authUid`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ fields: { authUid: { stringValue: uid } } }),
    },
  );
  if (!response.ok) throw Object.assign(new Error('트레이너 계정 연결 저장에 실패했습니다.'), { status: 503 });
  return trainerId;
}

export async function onRequestPost({ request, env }) {
  try {
    const user = await verifyUser(request);
    const accessToken = await getGoogleAccessToken(env);

    if (user.isAdmin) {
      await setRoleDocument(accessToken, user.uid, 'admin', user.email);
      await verifyRequiredDataRead(user.idToken);
      return json({ ok: true, role: 'admin' });
    }

    const roleDocument = await getFirestoreDocument(accessToken, `roles/${encodeURIComponent(user.uid)}`);
    const existingRole = stringField(roleDocument, 'role');
    const roleEmail = stringField(roleDocument, 'email').trim().toLowerCase();
    if (existingRole === 'admin') {
      await verifyRequiredDataRead(user.idToken);
      return json({ ok: true, role: 'admin' });
    }
    if ((existingRole === 'trainer' || existingRole === 'staff') && roleEmail === user.email) {
      await verifyRequiredDataRead(user.idToken);
      return json({ ok: true, role: existingRole === 'staff' ? 'trainer' : existingRole });
    }

    const trainer = await findTrainerByLoginEmail(accessToken, user.email);
    if (!trainer) throw Object.assign(new Error('이 계정과 연결된 트레이너 정보를 찾지 못했습니다.'), { status: 403 });
    const linkedUid = stringField(trainer, 'authUid');
    if (linkedUid && linkedUid !== user.uid) {
      throw Object.assign(new Error('이 이메일은 다른 로그인 계정에 연결되어 있습니다. 관리자에게 계정 재저장을 요청하세요.'), { status: 403 });
    }

    await setRoleDocument(accessToken, user.uid, 'trainer', user.email);
    const trainerId = await linkTrainerUid(accessToken, trainer, user.uid);
    await verifyRequiredDataRead(user.idToken);
    return json({ ok: true, role: 'trainer', trainerId });
  } catch (error) {
    console.error('[login-role]', error?.message || error);
    return json({ ok: false, error: error?.message || '로그인 권한 확인에 실패했습니다.' }, error?.status || 500);
  }
}
