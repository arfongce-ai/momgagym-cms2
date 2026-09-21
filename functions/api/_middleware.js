// functions/api/_middleware.js
// ════════════════════════════════════════════════════════════════════════
//  Cloudflare Pages Functions의 디렉터리 미들웨어 — functions/api/ 아래 모든
//  요청을 거친다. 여기서는 딱 하나만 한다: 영양 앱(nutrition-cms,
//  momgagym-nutrition.pages.dev)이 직접 호출하는 4개 엔드포인트에만 CORS
//  허용 헤더를 붙인다(functions/_shared/cors.js의 화이트리스트 기준).
//
//  다른 엔드포인트(trainer-account.js, login-role.js, teacher-nutrition.js,
//  momi.js, voice-command.js)는 전부 CMS 자기 자신(같은 오리진)에서만 호출
//  하므로 손대지 않는다 — 여기서 실수로 전체를 열어버리지 않도록 경로를
//  화이트리스트로 명시한다.
// ════════════════════════════════════════════════════════════════════════
import { corsHeaders, handlePreflight } from '../_shared/cors.js';

const CORS_ENABLED_PATHS = new Set([
  '/api/nutrition-link',
  '/api/nutrition-session',
  '/api/nutrition-summary',
  '/api/nutrition-feedback',
]);

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  if (!CORS_ENABLED_PATHS.has(url.pathname)) {
    return next();
  }

  if (request.method === 'OPTIONS') {
    return handlePreflight(request);
  }

  const response = await next();
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(request)).forEach(([k, v]) => headers.set(k, v));
  return new Response(response.body, { status: response.status, headers });
}
