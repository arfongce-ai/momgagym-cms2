// functions/_shared/verifyFirebaseToken.js
// 클라이언트가 보낸 role 문자열은 위조 가능하다(예전 보안 갭 — voice-command.js가
// body.role을 검증 없이 그대로 믿던 문제). 이 파일은 그 대신 요청의
// Authorization: Bearer <Firebase ID 토큰>을 서버에서 직접 검증해서, 진짜 role을
// 구한다. AuthContext.jsx의 resolveRole()과 동일한 두 단계 규칙을 그대로 따른다:
//   ① 커스텀 클레임(token.admin === true) 우선
//   ② 없으면 Firestore roles/{uid} 문서로 폴백
// 서비스 계정 키 없이도 ②가 가능한 이유: firestore.rules가
//   match /roles/{uid} { allow read: if isSignedIn(); }
// 로 로그인한 사용자의 읽기를 이미 허용해두고 있어서, 검증에 쓴 바로 그 ID
// 토큰을 Firestore REST API 호출에도 그대로 Bearer로 실어 보내면 별도 자격증명
// 없이 조회할 수 있다(Firestore가 그 토큰을 자체적으로 다시 검증하므로 이중 방어).
//
// 실패(토큰 없음/검증 실패/역할 조회 실패)는 항상 'trainer'로 안전하게 떨어진다
// — "확인 안 되면 관리자로 취급"이 아니라 "확인 안 되면 가장 낮은 권한으로 취급"
// 이 유일하게 안전한 기본값이다.
import { createRemoteJWKSet, jwtVerify } from 'jose';

const FIREBASE_PROJECT_ID = 'momgagym-cms';
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/[email protected]';

let _jwks = null;
function getJWKS() {
  if (!_jwks) _jwks = createRemoteJWKSet(new URL(JWKS_URL));
  return _jwks;
}

/** Authorization 헤더 문자열에서 Bearer 토큰만 뽑아낸다. 없으면 null. */
export function extractBearerToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

/** Firestore REST API로 roles/{uid} 문서를 조회해 role 문자열을 반환한다(없으면 null). */
async function fetchRoleFromFirestore(uid, idToken) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/roles/${encodeURIComponent(uid)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  if (!res.ok) return null; // 404(문서 없음) 포함 — 정상적인 "역할 미배정" 상태
  const doc = await res.json();
  return doc?.fields?.role?.stringValue || null;
}

/**
 * 요청의 Authorization 헤더를 검증해서 신뢰할 수 있는 role('admin'|'trainer')을 구한다.
 * @param {string|null} authHeader  request.headers.get('Authorization')
 * @returns {Promise<{role:'admin'|'trainer', uid:string|null}>}
 */
export async function resolveVerifiedRole(authHeader) {
  const idToken = extractBearerToken(authHeader);
  if (!idToken) return { role: 'trainer', uid: null };

  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, getJWKS(), {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID,
    }));
  } catch (e) {
    console.warn('[verifyFirebaseToken] ID 토큰 검증 실패(trainer로 처리):', e?.message || e);
    return { role: 'trainer', uid: null };
  }

  const uid = payload.sub || null;
  if (payload.admin === true) return { role: 'admin', uid };

  try {
    const role = uid ? await fetchRoleFromFirestore(uid, idToken) : null;
    return { role: role === 'admin' ? 'admin' : 'trainer', uid };
  } catch (e) {
    console.warn('[verifyFirebaseToken] roles 문서 조회 실패(trainer로 처리):', e?.message || e);
    return { role: 'trainer', uid };
  }
}
