// functions/api/momi.js
// Cloudflare Pages Function — POST /api/momi
// 리포트 화면의 "🤖 모미에게 물어보기" 버튼이 호출하는 엔드포인트.
// Anthropic API 키는 여기(서버)에서만 쓰이고 브라우저에는 절대 노출되지 않는다.

import { MOMI_SYSTEM_PROMPT } from '../_shared/momiPrompt.js';
import { resolveVerifiedRole } from '../_shared/verifyFirebaseToken.js';
import {
  applyMomiSafetyGuard,
  clampText,
  enforceMomiRateLimit,
  jsonResponse,
  normalizeMomiHistory,
  readMomiJson,
} from '../_shared/momiRequest.js';
import { recordPaidAiCost, reservePaidAiCall } from '../_shared/aiBudget.js';

const MODEL = 'claude-sonnet-5';
const PROMPT_VERSION = '2.2';

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
패턴)도 요청이 있으면 짚어줄 수 있습니다. businessContext 필드(잔여 세션·미출석
기간 등)가 함께 왔다면 참고하되, 없으면 억지로 추측하지 않습니다. 근거가 부족한
추측은 하지 않습니다.`;

const TRAINER_ROLE_SUFFIX = `

---

[트레이너 모드]
이 요청은 담당 트레이너가 보낸 것입니다. 회원의 신체 상태·운동 코칭에만 집중하고,
회원의 재등록 가능성·매출 기여도·이탈 위험 같은 비즈니스·경영 관점의 언급은 하지
않습니다.`;

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await readMomiJson(request);

    // src/services/momiService.js가 buildProblemFocus() 등으로 만들어 보내는 payload.
    // kind: 'posture'|'rom'|'jump'|'gait' 등, report: 해당 측정의 리포트 요약,
    // member: { name, category, ... }, question?: 자유 질문(음성 자유질문 대응),
    // businessContext?: 잔여세션·미출석기간 등 비즈니스 신호(admin 전용, 아래 참고)
    // history?: [{role, content}, ...] 이전 대화 턴(Axis4 — 양방향 소통, 아래 참고)
    const { kind, report, member, crossContext, businessContext, question, history } = body || {};

    if (!report || !member) {
      return jsonResponse({ error: 'report와 member 정보가 필요합니다.' }, 400);
    }

    // [보안] 클라이언트는 role을 안 보낸다 — Authorization 헤더의 Firebase ID 토큰을
    // 서버가 직접 검증해서 role을 구한다(voice-command.js와 동일 패턴, 위조 불가 —
    // functions/_shared/verifyFirebaseToken.js 참고). 실패 시 안전하게 trainer로 떨어짐.
    const { authenticated, role: effectiveRole, uid } = await resolveVerifiedRole(request.headers.get('Authorization'));
    if (!authenticated) {
      return jsonResponse({ error: '로그인이 만료되었거나 유효하지 않습니다. 다시 로그인해주세요.' }, 401);
    }
    await enforceMomiRateLimit(env, `momi:${uid}`);
    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse({ error: 'MOMI 서버 설정이 완료되지 않았습니다.' }, 503);
    }
    const budgetReservation = await reservePaidAiCall(env);
    const roleSuffix = effectiveRole === 'admin' ? ADMIN_ROLE_SUFFIX : TRAINER_ROLE_SUFFIX;

    // [매출 데이터 연결 배선 준비 2026-08-08] businessContext는 admin일 때만 프롬프트에
    // 태운다 — 클라이언트(momiService.js)가 role 상관없이 항상 같이 보내도, 여기서
    // 서버가 검증한 role로 최종 필터링한다(클라이언트 판단을 안 믿는 게 최종 방어선).
    const effectiveBusinessContext = effectiveRole === 'admin' ? businessContext || null : null;

    // [Axis4 시작 2026-08-08] 트레이너-모미 양방향 소통 — 지금까지는 매 호출이
    // 무상태(stateless)라 "지난번 답변에 이어서 물어보기"가 불가능했다(연결성
    // 논의 때 확인한 구조적 한계). history(이전 턴 배열)가 오면 대화로 이어붙인다.
    // history: [{role:'user'|'assistant', content: string}, ...] — 서버는 이걸
    // 그대로 신뢰하지 않고 role 값이 저 둘 중 하나인 것만 통과시킨다(형식 방어).
    const validHistory = normalizeMomiHistory(history);
    const safeQuestion = clampText(question, 2000);

    // 후속 질문에도 현재 리포트의 압축 컨텍스트를 함께 보낸다. 예전 UI history에는
    // 실제 리포트가 아니라 "이 리포트를 분석해줘"라는 문장만 들어가서, 두 번째
    // 질문부터 각도·좌우차 같은 원본 근거를 잃는 문제가 있었다.
    let userMessageContent;
    if (validHistory.length > 0) {
      const currentContext = JSON.stringify({
        kind,
        report,
        member,
        crossContext: crossContext || null,
        businessContext: effectiveBusinessContext,
      }, null, 2);
      userMessageContent = `${safeQuestion || '앞선 분석을 현재 자료에 맞춰 이어서 설명해주세요.'}\n\n[현재 회원·측정 컨텍스트 — 앞선 답변보다 이 자료를 우선하세요]\n${currentContext}`;
    } else {
      const userContent = JSON.stringify(
        {
          kind,
          report,
          member,
          crossContext: crossContext || null,
          businessContext: effectiveBusinessContext,
          question: safeQuestion || null,
        },
        null,
        2
      );
      userMessageContent = `아래는 회원의 측정 리포트 데이터입니다. 시스템 프롬프트의 4단계 출력 프로세스(또는 예외 규정 해당 시 그 규칙)를 따라 응답해주세요.\n\n${userContent}`;
    }

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
        // [비용 절감 2026-08-11] MOMI_SYSTEM_PROMPT+roleSuffix는 같은 role이면
        // 호출마다 글자 하나 안 틀리고 똑같다(회원 리포트·질문 내용은 전부
        // 아래 messages 쪽에 따로 들어가지 여기 안 섞임) — 그래서 통째로
        // 캐싱 대상이다. voice-command.js와 동일한 이유·동일한 방식.
        system: [{ type: 'text', text: MOMI_SYSTEM_PROMPT + roleSuffix, cache_control: { type: 'ephemeral' } }],
        messages: [
          ...validHistory,
          {
            role: 'user',
            content: userMessageContent,
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.warn('[momi] Anthropic API 호출 실패:', anthropicRes.status, errText.slice(0, 500));
      return jsonResponse({ error: 'MOMI 분석 서비스 호출에 실패했습니다.' }, anthropicRes.status);
    }

    const data = await anthropicRes.json();
    await recordPaidAiCost(env, budgetReservation, MODEL, data.usage);
    const modelText = (data.content || [])
      .map((block) => (block.type === 'text' ? block.text : ''))
      .filter(Boolean)
      .join('\n');
    const text = applyMomiSafetyGuard({ kind, report, question: safeQuestion, text: modelText });

    return jsonResponse({ text, model: MODEL, promptVersion: PROMPT_VERSION });
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status >= 500) console.error('[momi] 서버 오류:', err);
    return jsonResponse({ error: err?.message || '서버 오류', code: err?.code || undefined }, status);
  }
}
