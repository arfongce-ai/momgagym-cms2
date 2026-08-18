const DESTINATIONS = new Set(['home', 'members', 'schedule', 'ai_measure', 'report', 'settings', 'trainers', 'revenue']);
const NAVIGATION_HINT = /(열|보여|이동|가자|가줘|데려가|들어가|띄워|화면|페이지|메뉴)/u;

function parseJsonObject(value) {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

/** Cloudflare 무료 AI는 실행이 아니라 모호한 화면 이동 의도 분류에만 사용한다. */
export async function classifyFreeNavigation(env, transcript, role) {
  if (!env?.AI?.run || !NAVIGATION_HINT.test(transcript || '') || String(transcript || '').length > 120) return null;
  try {
    const result = await env.AI.run('@cf/meta/llama-3.2-1b-instruct', {
      messages: [
        {
          role: 'system',
          content: '한국어 CMS 화면 이동 의도만 분류한다. JSON만 답한다: {"destinationId":"home|members|schedule|ai_measure|report|settings|trainers|revenue|unknown","confidence":0~1}. 질문·분석·데이터 조회는 unknown이다.',
        },
        { role: 'user', content: String(transcript || '') },
      ],
      max_tokens: 80,
      temperature: 0,
    });
    const parsed = parseJsonObject(result?.response);
    if (!parsed || Number(parsed.confidence) < 0.85 || !DESTINATIONS.has(parsed.destinationId)) return null;
    if ((parsed.destinationId === 'trainers' || parsed.destinationId === 'revenue') && role !== 'admin') return null;
    return parsed.destinationId;
  } catch (error) {
    console.warn('[free-ai-router] 무료 분류 실패, 기존 경로로 계속:', error?.message || error);
    return null;
  }
}
