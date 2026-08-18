import {
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth } from '../firebase';

async function callTrainerAccountAdmin(payload) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('관리자 로그인이 필요합니다.');
  const idToken = await currentUser.getIdToken();
  const response = await fetch('/api/trainer-account', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || '트레이너 로그인 계정 처리에 실패했습니다.');
  return data;
}

/**
 * 관리자가 CMS 안에서 트레이너 로그인 계정을 만든다.
 * 보조 Firebase 앱을 사용하므로 현재 관리자 로그인은 끊기지 않는다.
 * 비밀번호는 Firebase Authentication으로만 전달되고 Firestore에는 저장하지 않는다.
 */
export async function provisionTrainerAccount(email, password, options = {}) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedEmail) throw new Error('로그인 이메일을 입력하세요.');
  const result = await callTrainerAccountAdmin({
    action: 'upsert',
    uid: options.uid || '',
    currentEmail: options.currentEmail || '',
    email: normalizedEmail,
    password: password || '',
    displayName: options.displayName || '',
  });
  return {
    uid: result.uid,
    created: result.created,
    hadAccess: Boolean(result.hadAccess),
  };
}

export async function deleteTrainerAuthAccount(uid, email) {
  return callTrainerAccountAdmin({ action: 'delete', uid: uid || '', email: email || '' });
}

export async function grantTrainerAccess(uid, email = '') {
  if (!uid) throw new Error('트레이너 계정 UID가 없습니다.');
  await callTrainerAccountAdmin({ action: 'grant', uid, email: (email || '').trim().toLowerCase() });
}

export async function revokeTrainerAccess(uid) {
  if (!uid) return;
  await callTrainerAccountAdmin({ action: 'revoke', uid });
}

export async function sendTrainerPasswordReset(email) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedEmail) throw new Error('먼저 로그인 이메일을 입력하세요.');
  try {
    await sendPasswordResetEmail(auth, normalizedEmail);
  } catch (error) {
    if (error?.code === 'auth/too-many-requests') {
      throw new Error('요청이 너무 많아 Firebase가 잠시 차단했습니다. 잠시 후 한 번만 다시 시도하세요.');
    }
    if (error?.code === 'auth/invalid-email') throw new Error('이메일 형식을 확인하세요.');
    throw new Error('비밀번호 재설정 메일을 보내지 못했습니다. 잠시 후 다시 시도하세요.');
  }
}
