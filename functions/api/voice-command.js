// functions/api/voice-command.js
// Cloudflare Pages Function — POST /api/voice-command
// "모미야" 다음에 들린 말(transcript)을 분류한다.
//  · 화면 이동으로 해석되면(tool_use) → { type:'navigate', destinationId, memberName?, testId? }
//  · 그 외(코칭성 질문 등)면 모미 페르소나로 짧게 대답 → { type:'chat', text }
//
// destinationId 목록은 src/voice/commandRegistry.js의 VOICE_DESTINATIONS와 반드시 같은
// id를 써야 한다(백엔드·프론트가 별도 번들이라 직접 import는 안 되고, 값만 동기화해서 씀).
// role에 따라 애초에 후보 도구 자체를 다르게 넘겨서, 트레이너 음성으로는 관리자 전용
// 화면(트레이너 관리·매출관리)이 선택지에 아예 없다.
import { MOMI_SYSTEM_PROMPT } from '../_shared/momiPrompt.js';

const MODEL = 'claude-sonnet-5';

// commandRegistry.js VOICE_DESTINATIONS 와 id를 맞출 것.
const ALL_TOOLS = [
  { name: 'go_home', destinationId: 'home', roles: ['trainer', 'admin'],
    description: '홈(대시보드) 화면을 연다. 오늘 일정, 이번 주 캘린더 등을 볼 때.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'go_members', destinationId: 'members', roles: ['trainer', 'admin'],
    description: '회원 관리 화면을 연다.',
    input_schema: { type: 'object', properties: {
      memberName: { type: 'string', description: '들린 회원 이름 그대로. 언급 없으면 생략.' } } } },
  { name: 'go_schedule', destinationId: 'schedule', roles: ['trainer', 'admin'],
    description: '스케줄(수업 일정) 화면을 연다.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'go_settings', destinationId: 'settings', roles: ['trainer', 'admin'],
    description: '설정 화면을 연다.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'go_trainers', destinationId: 'trainers', roles: ['admin'],
    description: '트레이너 관리 화면을 연다. 관리자 전용.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'go_revenue', destinationId: 'revenue', roles: ['admin'],
    description: '매출 관리 화면을 연다. 관리자 전용.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'go_ai_measure', destinationId: 'ai_measure', roles: ['trainer', 'admin'],
    description: 'AI측정 화면을 연다. "OO님 점프/자세/보행/ROM 측정하게 해줘" 같은 요청.',
    input_schema: { type: 'object', properties: {
      memberName: { type: 'string', description: '들린 회원 이름 그대로. 언급 없으면 생략.' },
      testId: { type: 'string', enum: ['jump', 'posture', 'gait', 'rom'], description: '언급된 측정 종류. 없으면 생략.' } } } },
  { name: 'go_report', destinationId: 'report', roles: ['trainer', 'admin'],
    description: '리포트 화면을 연다. "OO님 리포트 열어줘" 같은 요청.',
    input_schema: { type: 'object', properties: {
      memberName: { type: 'string', description: '들린 회원 이름 그대로. 언급 없으면 생략.' },
      testId: { type: 'string', enum: ['jump', 'posture', 'gait', 'rom'], description: '언급된 측정 종류. 없으면 생략.' } } } },
];

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const { transcript, role } = body || {};

    if (!transcript) {
      return new Response(JSON.stringify({ error: 'transcript가 필요합니다.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const effectiveRole = role === 'admin' ? 'admin' : 'trainer';
    // role에 안 맞는 도구는 애초에 Claude에게 후보로도 전달하지 않는다.
    const tools = ALL_TOOLS.filter((t) => t.roles.includes(effectiveRole)).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        system:
          MOMI_SYSTEM_PROMPT +
          '\n\n---\n\n[음성 명령 라우터 모드] 사용자가 "모미야" 다음에 한 말이 위 도구 목록 중 하나로 화면 이동을 요청하는 것이면 해당 도구를 호출하세요. 화면 이동 요청이 아니라 코칭 질문 등 자유 발화라면 도구를 호출하지 말고, 위 시스템 프롬프트의 모미 페르소나로 1~2문장 이내로 짧게 답하세요.',
        tools,
        messages: [{ role: 'user', content: transcript }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return new Response(JSON.stringify({ error: 'Anthropic API 호출 실패', detail: errText }), {
        status: anthropicRes.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await anthropicRes.json();
    const toolUse = (data.content || []).find((block) => block.type === 'tool_use');

    if (toolUse) {
      const matched = ALL_TOOLS.find((t) => t.name === toolUse.name);
      // role 필터링을 우회해 도구가 호출되더라도 이중 방어.
      if (!matched || !matched.roles.includes(effectiveRole)) {
        return new Response(
          JSON.stringify({ type: 'chat', text: '죄송해요, 그 화면은 권한이 없어서 열어드릴 수 없어요.' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          type: 'navigate',
          destinationId: matched.destinationId,
          memberName: toolUse.input?.memberName || null,
          testId: toolUse.input?.testId || null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const textBlock = (data.content || []).find((block) => block.type === 'text');
    return new Response(
      JSON.stringify({ type: 'chat', text: textBlock ? textBlock.text : '네, 말씀하세요!' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: '서버 오류', detail: String(err && err.message ? err.message : err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
