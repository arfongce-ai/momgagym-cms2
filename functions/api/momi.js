// functions/api/momi.js
// Cloudflare Pages Function — POST /api/momi
// 리포트 화면의 "🤖 모미에게 물어보기" 버튼이 호출하는 엔드포인트.
// Anthropic API 키는 여기(서버)에서만 쓰이고 브라우저에는 절대 노출되지 않는다.

import { MOMI_SYSTEM_PROMPT } from '../_shared/momiPrompt.js';

const MODEL = 'claude-sonnet-5';

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    // src/services/momiService.js가 buildProblemFocus() 등으로 만들어 보내는 payload.
    // kind: 'posture'|'rom'|'jump'|'gait' 등, report: 해당 측정의 리포트 요약,
    // member: { name, category, ... }, question?: 자유 질문(음성 자유질문 대응)
    const { kind, report, member, crossContext, question } = body || {};

    if (!report || !member) {
      return new Response(
        JSON.stringify({ error: 'report와 member 정보가 필요합니다.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const userContent = JSON.stringify(
      { kind, report, member, crossContext: crossContext || null, question: question || null },
      null,
      2
    );

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: MOMI_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `아래는 회원의 측정 리포트 데이터입니다. 시스템 프롬프트의 4단계 출력 프로세스(또는 예외 규정 해당 시 그 규칙)를 따라 응답해주세요.\n\n${userContent}`,
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return new Response(
        JSON.stringify({ error: 'Anthropic API 호출 실패', detail: errText }),
        { status: anthropicRes.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const data = await anthropicRes.json();
    const text = (data.content || [])
      .map((block) => (block.type === 'text' ? block.text : ''))
      .filter(Boolean)
      .join('\n');

    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: '서버 오류', detail: String(err && err.message ? err.message : err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
