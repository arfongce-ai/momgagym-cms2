// functions/_shared/nutritionToken.js
// ════════════════════════════════════════════════════════════════════════
//  영양 앱(nutrition-cms)은 CMS(momgagym-cms)와 별도 Firebase 프로젝트라는
//  전제로 설계한다(2026-09-17 조사 — 실제로 같은 프로젝트인지는 Cloudflare
//  Pages 환경변수 확인 후 재검토 필요, claude/2026-09-17_영양앱-CMS연동_
//  1단계조사_설계문서.md 참고). 별도 프로젝트이므로 nutrition-cms가 발급한
//  Firebase Auth ID 토큰을 CMS 서버가 검증할 수 없다(발급 주체가 다름).
//
//  대신 CMS가 "연결코드 교환"(nutrition-link.js exchange) 시점에 이
//  HS256 JWT를 직접 서명해서 내려주고, 이후 모든 /nutrition/* 요청은 이
//  토큰을 Authorization: Bearer로 실어 보낸다. 토큰 자체에는 memberRef와
//  버전(jti)만 담는다 — "지금 유효기간이 지났는지"는 담지 않는다(그건 매
//  요청마다 CMS가 members/payments/settings를 다시 읽어 최신값으로 판정 —
//  섹션 5 "이용기간 재검증" 원칙과 일치).
//
//  회원의 "연결 해제"는 nutritionConnections/{memberRef}.activeJti를
//  회전(rotate)시키는 것만으로 기존에 발급된 토큰을 전부 무효화한다(토큰의
//  jti가 최신 activeJti와 다르면 거부) — 별도 블록리스트 불필요.
// ════════════════════════════════════════════════════════════════════════
import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'momgagym-cms/nutrition-link';
const AUDIENCE = 'nutrition-cms';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 365; // 1년 — "연결 유지" 성격 토큰. 매 요청 서버가 실제 이용권한을 다시 계산하므로 길게 잡아도 안전.

function getSecret(env) {
  if (!env.NUTRITION_LINK_SECRET) {
    throw Object.assign(new Error('영양 앱 연동 비밀키(NUTRITION_LINK_SECRET)가 설정되지 않았습니다.'), { status: 503 });
  }
  return new TextEncoder().encode(env.NUTRITION_LINK_SECRET);
}

export async function signConnectionToken(env, { memberRef, jti }) {
  const secret = getSecret(env);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ memberRef })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(memberRef)
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_SECONDS)
    .sign(secret);
}

/** 요청의 Authorization 헤더에서 연결 토큰을 검증한다. 실패 시 예외(status 포함). */
export async function verifyConnectionToken(env, authHeader) {
  const value = authHeader || '';
  const token = value.startsWith('Bearer ') ? value.slice(7).trim() : '';
  if (!token) throw Object.assign(new Error('연동 토큰이 없습니다. 다시 연결해주세요.'), { status: 401 });

  const secret = getSecret(env);
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: AUDIENCE });
    if (!payload.memberRef || !payload.jti) throw new Error('토큰 형식이 올바르지 않습니다.');
    return { memberRef: String(payload.memberRef), jti: String(payload.jti) };
  } catch (e) {
    throw Object.assign(new Error('연동 토큰이 유효하지 않습니다. 다시 연결해주세요.'), { status: 401 });
  }
}

/** crypto.randomUUID는 Cloudflare Workers 런타임에 기본 내장. */
export function newJti() {
  return crypto.randomUUID();
}

export function newLinkCode() {
  // 사람이 읽기 쉬운 8자 코드(대문자+숫자, 혼동되는 0/O/1/I 제외) — 트레이너가 회원에게 불러줄 수 있는 길이.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}
