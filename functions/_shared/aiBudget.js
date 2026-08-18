const localDailyUsage = new Map();

function kstDay() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function readUsage(env, key) {
  if (env?.MOMI_USAGE?.get) {
    try {
      const stored = await env.MOMI_USAGE.get(key, { type: 'json' });
      return stored && typeof stored === 'object' ? stored : { calls: 0, usd: 0 };
    } catch (error) {
      console.warn('[ai-budget] KV 읽기 실패, isolate 카운터 사용:', error?.message || error);
    }
  }
  return localDailyUsage.get(key) || { calls: 0, usd: 0 };
}

async function writeUsage(env, key, usage) {
  if (env?.MOMI_USAGE?.put) {
    try {
      await env.MOMI_USAGE.put(key, JSON.stringify(usage), { expirationTtl: 3 * 24 * 60 * 60 });
      return;
    } catch (error) {
      console.warn('[ai-budget] KV 쓰기 실패, isolate 카운터 사용:', error?.message || error);
    }
  }
  localDailyUsage.set(key, usage);
}

/** 유료 AI를 호출하기 직전에 서버 전체 일일 한도를 검사하고 호출 1회를 예약한다. */
export async function reservePaidAiCall(env) {
  const key = `paid-ai:${kstDay()}`;
  const usage = await readUsage(env, key);
  const callLimit = positiveNumber(env?.MOMI_DAILY_CLAUDE_CALL_LIMIT, 100);
  const budgetUsd = positiveNumber(env?.MOMI_DAILY_CLAUDE_BUDGET_USD, 1);
  if (Number(usage.calls || 0) >= callLimit || Number(usage.usd || 0) >= budgetUsd) {
    const error = new Error('오늘의 유료 AI 사용 한도에 도달했어요. 화면 이동, 예약, 데이터 조회 등 무료 기능은 계속 사용할 수 있어요.');
    error.status = 429;
    error.code = 'AI_DAILY_BUDGET_REACHED';
    throw error;
  }
  const next = { ...usage, calls: Number(usage.calls || 0) + 1, updatedAt: new Date().toISOString() };
  await writeUsage(env, key, next);
  return { key, usage: next, callLimit, budgetUsd };
}

const PRICE_PER_MILLION = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};

export function estimateAnthropicCostUsd(model, usage = {}) {
  const price = PRICE_PER_MILLION[model];
  if (!price) return 0;
  return (
    Number(usage.input_tokens || 0) * price.input
    + Number(usage.output_tokens || 0) * price.output
    + Number(usage.cache_creation_input_tokens || 0) * price.cacheWrite
    + Number(usage.cache_read_input_tokens || 0) * price.cacheRead
  ) / 1_000_000;
}

export async function recordPaidAiCost(env, reservation, model, anthropicUsage) {
  if (!reservation?.key) return;
  const current = await readUsage(env, reservation.key);
  const cost = estimateAnthropicCostUsd(model, anthropicUsage);
  await writeUsage(env, reservation.key, {
    ...current,
    usd: Number(current.usd || 0) + cost,
    updatedAt: new Date().toISOString(),
  });
}
