const CACHE_KEY = 'momi_safe_voice_cache_v1';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 40;

const SAFE_FAQ_PATTERNS = [
  /(사용법|이용방법|뭘할수|뭐할수|무엇을할수|어떻게써)/u,
  /(운영시간|영업시간|몇시.*열|몇시.*닫)/u,
  /(준비물|주차|위치|주소|문의방법)/u,
  /(수업종류|운동프로그램|프로그램종류)/u,
];

export function normalizeVoiceCacheKey(text) {
  return String(text || '').normalize('NFC').toLowerCase().replace(/[\s.!?~]+/g, '');
}

export function isSafeVoiceCacheQuestion(transcript, { memberNames = [], history = [] } = {}) {
  if (Array.isArray(history) && history.length > 0) return false;
  const key = normalizeVoiceCacheKey(transcript);
  if (!key || key.length > 100) return false;
  if ((memberNames || []).some((name) => {
    const memberKey = normalizeVoiceCacheKey(name);
    return memberKey && key.includes(memberKey);
  })) return false;
  if (/(오늘|내일|이번달|예약|매출|세션|잔여|전화|연락처|회원|측정|리포트|통증|아파|나이|혈압)/u.test(key)) {
    return false;
  }
  return SAFE_FAQ_PATTERNS.some((pattern) => pattern.test(key));
}

function readCache(storage) {
  if (!storage) return {};
  try {
    const value = JSON.parse(storage.getItem(CACHE_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export function getCachedVoiceResponse(transcript, options = {}) {
  if (!isSafeVoiceCacheQuestion(transcript, options)) return null;
  const storage = options.storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  const cache = readCache(storage);
  const item = cache[normalizeVoiceCacheKey(transcript)];
  if (!item || Date.now() - Number(item.savedAt || 0) > CACHE_TTL_MS) return null;
  return typeof item.text === 'string' && item.text ? { type: 'chat', text: item.text, source: 'safe-cache' } : null;
}

export function cacheVoiceResponse(transcript, text, options = {}) {
  if (!isSafeVoiceCacheQuestion(transcript, options) || !text) return false;
  const storage = options.storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  if (!storage) return false;
  const cache = readCache(storage);
  cache[normalizeVoiceCacheKey(transcript)] = { text: String(text), savedAt: Date.now() };
  const trimmed = Object.fromEntries(
    Object.entries(cache)
      .sort((a, b) => Number(b[1]?.savedAt || 0) - Number(a[1]?.savedAt || 0))
      .slice(0, MAX_ENTRIES)
  );
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(trimmed));
    return true;
  } catch {
    return false;
  }
}

