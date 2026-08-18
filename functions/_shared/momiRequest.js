const MAX_BODY_BYTES = 256 * 1024;
const MAX_HISTORY_TURNS = 12;
const MAX_HISTORY_CONTENT = 4000;
const localRateBuckets = new Map();

export async function readMomiJson(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) {
    const error = new Error('요청 데이터가 너무 큽니다.');
    error.status = 413;
    throw error;
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    const error = new Error('요청 데이터가 너무 큽니다.');
    error.status = 413;
    throw error;
  }

  try {
    return JSON.parse(raw || '{}');
  } catch {
    const error = new Error('요청 JSON 형식이 올바르지 않습니다.');
    error.status = 400;
    throw error;
  }
}

export function normalizeMomiHistory(history) {
  if (!Array.isArray(history)) return [];
  const merged = [];
  history
    .filter((turn) => turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string')
    .forEach((turn) => {
      const content = turn.content.trim().slice(0, MAX_HISTORY_CONTENT);
      if (!content) return;
      const previous = merged[merged.length - 1];
      if (previous?.role === turn.role) {
        previous.content = `${previous.content}\n${content}`.slice(0, MAX_HISTORY_CONTENT);
      } else {
        merged.push({ role: turn.role, content });
      }
    });

  let limited = merged.slice(-MAX_HISTORY_TURNS);
  if (limited[0]?.role === 'assistant') limited = limited.slice(1);
  return limited;
}

export function clampText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

/** Cloudflare Rate Limiting binding이 있으면 우선 사용하고, 없으면 isolate 단위로 방어한다. */
export async function enforceMomiRateLimit(env, key, { limit = 20, windowMs = 60000 } = {}) {
  if (env?.MOMI_RATE_LIMITER?.limit) {
    const result = await env.MOMI_RATE_LIMITER.limit({ key: String(key || 'unknown') });
    if (!result?.success) {
      const error = new Error('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
      error.status = 429;
      throw error;
    }
    return;
  }

  const now = Date.now();
  const bucketKey = String(key || 'unknown');
  const current = localRateBuckets.get(bucketKey);
  const bucket = !current || now - current.startedAt >= windowMs
    ? { startedAt: now, count: 0 }
    : current;
  bucket.count += 1;
  localRateBuckets.set(bucketKey, bucket);
  if (localRateBuckets.size > 1000) {
    for (const [storedKey, value] of localRateBuckets) {
      if (now - value.startedAt >= windowMs) localRateBuckets.delete(storedKey);
    }
  }
  if (bucket.count > limit) {
    const error = new Error('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
    error.status = 429;
    throw error;
  }
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

const EMERGENCY_TERMS = ['대소변 조절 장애', '하지 근력의 급격한 저하', '심각한 감각 이상'];
const ACUTE_RED_FLAGS = ['찌릿한 통증', '방사통', '휴식 시 통증', '급성 부종'];

function searchableInput({ report, question }) {
  try {
    return `${question || ''}\n${JSON.stringify(report || {})}`;
  } catch {
    return String(question || '');
  }
}

function severityOf(report) {
  return report?.severity || report?.summary?.severity || report?.problem_focus?.severity || null;
}

/**
 * 모델 지침 누락 시에도 최소 안전 문구를 보장한다. 일반적인 동작 위험(risk)은
 * 답변을 유지하되 트레이너 확인을 붙이고, 통증/응급 레드플래그는 처방을 보류한다.
 */
export function applyMomiSafetyGuard({ kind, report, question, text }) {
  const input = searchableInput({ report, question });
  const emergency = EMERGENCY_TERMS.some((term) => input.includes(term));
  if (emergency) {
    return '현재 내용에는 즉시 확인이 필요한 신경학적 위험 신호가 포함되어 있습니다. 운동을 시작하거나 계속하지 말고 즉시 응급실 또는 신경외과 응급 진료를 받으세요.';
  }

  const acute = ACUTE_RED_FLAGS.some((term) => input.includes(term));
  const painNrs = Number(report?.measurements?.painNrs ?? report?.painNrs);
  if (acute || (kind === 'daily' && Number.isFinite(painNrs) && painNrs >= 7)) {
    return '현재는 운동 처방보다 안전 확인이 우선입니다. 오늘 운동은 보류하고 정형외과 등 전문의의 평가를 받은 뒤, 결과를 담당 트레이너와 공유해 프로그램을 다시 조정하세요.';
  }

  const cleanText = typeof text === 'string' && text.trim()
    ? text.trim()
    : '분석 결과를 만들지 못했습니다. 잠시 후 다시 시도해주세요.';
  if (severityOf(report) === 'risk' && !cleanText.includes('트레이너')) {
    return `${cleanText}\n\n※ 위험 판정이 포함되어 있으므로 실행 전 담당 트레이너가 측정 품질과 현재 증상을 함께 확인해야 합니다.`;
  }
  return cleanText;
}
