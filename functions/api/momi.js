// functions/api/momi.js
// Cloudflare Pages Function — POST /api/momi
// 리포트 화면의 "🤖 모미에게 물어보기" 버튼이 호출하는 엔드포인트.
// Anthropic API 키는 여기(서버)에서만 쓰이고 브라우저에는 절대 노출되지 않는다.

import { MOMI_SYSTEM_PROMPT } from '../_shared/momiPrompt.js';
import { resolveVerifiedRole } from '../_shared/verifyFirebaseToken.js';

const MODEL = 'claude-sonnet-5';

// [역할별 응답 범위 2026-08-08] "관리자·트레이너 접근 구분을 모미에도 적용" 요청 대응.
// MOMI_SYSTEM_PROMPT 본문(momi-system-v2.0.md 확정본)은 그대로 두고, voice-command.js가
// 라우터 모드 지시를 suffix로 붙이는 것과 같은 방식으로 role별 지시만 덧붙인다.
// 트레이너는 순수 코칭·처방에만 집중하고, 관리자는 근거가 있을 때 비즈니스·매출
// 관점 인사이트도 요청 시 받을 수 있다. (데이터 범위 자체는 이미 별도로 회원 스코핑이
// 되어 있어 — scopeMembersToTrainer — 여기서 다루는 건 "같은 데이터를 얼마나 깊게/
// 어떤 관점까지 해석해주는지"다.)
const ADMIN_ROLE_SUFFIX = `

---

[관리자 모드]
이 요청은 센터 관리자가 보낸 것입니다. 위 코칭·처방 지침은 그대로 따르되, 데이터로
명확히 뒷받침되는 경우에 한해 비즈니스 관점 인사이트(예: 세션 참여 패턴에서 보이는
이탈 신호, 재등록 가능성을 시사하는 근거, 트레이너 배정·운영 관점에서 참고할 만한
패턴)도 요청이 있으면 짚어줄 수 있습니다. 근거가 부족한 추측은 하지 않습니다.`;

const TRAINER_ROLE_SUFFIX = `

---

[트레이너 모드]
이 요청은 담당 트레이너가 보낸 것입니다. 회원의 신체 상태·운동 코칭에만 집중하고,
회원의 재등록 가능성·매출 기여도·이탈 위험 같은 비즈니스·경영 관점의 언급은 하지
않습니다.`;

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

    // [보안] 클라이언트는 role을 안 보낸다 — Authorization 헤더의 Firebase ID 토큰을
    // 서버가 직접 검증해서 role을 구한다(voice-command.js와 동일 패턴, 위조 불가 —
    // functions/_shared/verifyFirebaseToken.js 참고). 실패 시 안전하게 trainer로 떨어짐.
    const { role: effectiveRole } = await resolveVerifiedRole(request.headers.get('Authorization'));
    const roleSuffix = effectiveRole === 'admin' ? ADMIN_ROLE_SUFFIX : TRAINER_ROLE_SUFFIX;

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
        system: MOMI_SYSTEM_PROMPT + roleSuffix,
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
