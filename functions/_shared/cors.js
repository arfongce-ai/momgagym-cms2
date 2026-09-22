// functions/_shared/cors.js
// ════════════════════════════════════════════════════════════════════════
//  nutrition-cms(영양 앱)는 momgagym-nutrition.pages.dev에서 서비스되고,
//  이 CMS(momgagym-cms2.pages.dev)의 API를 절대경로로 호출한다 — 서로 다른
//  Cloudflare Pages 프로젝트(=다른 오리진)이므로 CORS 허용이 없으면 브라우저가
//  차단한다. functions/api/nutrition-link.js, nutrition-session.js,
//  nutrition-summary.js, nutrition-feedback.js(=회원 앱이 직접 부르는
//  엔드포인트)만 이 헬퍼를 쓴다. teacher-nutrition.js는 CMS 자기 자신의
//  화면에서만 호출하므로 CORS가 필요 없다(같은 오리진).
//
//  허용 오리진은 화이트리스트로 명시한다(요청 Origin을 무조건 반사하지 않음
//  — 관리자 API가 아니라도 습관적으로 * 를 쓰지 않는다). 로컬 개발용 포트도
//  포함해 nutrition-cms를 로컬에서 띄워 CMS API를 테스트할 수 있게 한다.
// ════════════════════════════════════════════════════════════════════════
const ALLOWED_ORIGINS = new Set([
  'https://momgagym-nutrition.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

function resolveOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  return ALLOWED_ORIGINS.has(origin) ? origin : null;
}

export function corsHeaders(request) {
  const origin = resolveOrigin(request);
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
  };
}

/** OPTIONS 프리플라이트 응답. 허용 오리진이 아니면 빈 204(헤더 없이 — 브라우저가 알아서 차단). */
export function handlePreflight(request) {
  const origin = resolveOrigin(request);
  return new Response(null, {
    status: 204,
    headers: origin ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    } : {},
  });
}

/** 이미 만든 JSON Response에 CORS 헤더를 얹어 새 Response로 돌려준다. */
export function withCors(request, response) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(request)).forEach(([k, v]) => headers.set(k, v));
  return new Response(response.body, { status: response.status, headers });
}
