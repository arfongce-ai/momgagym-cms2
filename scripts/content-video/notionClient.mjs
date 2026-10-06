const NOTION_API_ORIGIN = 'https://api.notion.com';
const NOTION_API_VERSION = '2026-03-11';
const PAGE_SIZE = 100;
const WRITE_PROPERTIES = new Set(['제작 상태', '검수 결과 링크', '결과 해시', '마지막 처리 시각', '오류 요약']);
const WRITE_STATUSES = new Set(['편집 중', '검수 대기', '영상 제작 대기']);

function notionError() {
  return new Error('NOTION');
}

function validId(value) {
  return typeof value === 'string' && /^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(value, now = Date.now()) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value || '');
  return Number.isFinite(date) ? Math.max(0, date - now) : 1000;
}

/** Fetch is intentionally confined to this client and a fixed Notion API origin. */
export class NotionClient {
  constructor({ token, access = 'read', fetchImpl = globalThis.fetch, sleep = wait } = {}) {
    if (typeof token !== 'string' || token.trim().length < 10 || typeof fetchImpl !== 'function' || !['read', 'write'].includes(access)) throw notionError();
    this.token = token;
    this.access = access;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
  }

  async request(route, body) {
    if (!/^\/v1\/(data_sources\/[0-9a-f-]+\/query|pages\/[0-9a-f-]+)$/i.test(route)) throw notionError();
    const url = new URL(route, NOTION_API_ORIGIN);
    if (url.origin !== NOTION_API_ORIGIN) throw notionError();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response;
      try {
        response = await this.fetchImpl(url, {
          method: route.endsWith('/query') ? 'POST' : 'PATCH',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Notion-Version': NOTION_API_VERSION,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
      } catch {
        throw notionError();
      }
      if (response.status === 429 && attempt < 2) {
        await this.sleep(retryDelay(response.headers?.get?.('Retry-After')));
        continue;
      }
      if (!response.ok) throw notionError();
      try {
        const result = await response.json();
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw notionError();
        return result;
      } catch {
        throw notionError();
      }
    }
    throw notionError();
  }

  async queryDataSource(dataSourceId, filter = undefined) {
    if (!validId(dataSourceId)) throw notionError();
    const results = [];
    let cursor;
    do {
      const page = await this.request(`/v1/data_sources/${dataSourceId}/query`, {
        page_size: PAGE_SIZE,
        ...(filter ? { filter } : {}),
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      if (!Array.isArray(page.results)) throw notionError();
      results.push(...page.results);
      cursor = page.has_more ? page.next_cursor : null;
      if (page.has_more && (typeof cursor !== 'string' || !cursor)) throw notionError();
    } while (cursor);
    return results;
  }

  async updatePage(pageId, properties) {
    if (this.access !== 'write') throw notionError();
    if (!validId(pageId) || !properties || typeof properties !== 'object' || Array.isArray(properties)) throw notionError();
    for (const [name, value] of Object.entries(properties)) {
      if (!WRITE_PROPERTIES.has(name)) throw notionError();
      if (name === '제작 상태' && (!WRITE_STATUSES.has(value) || value === '게시 승인' || value === '게시완료')) throw notionError();
      if (name === '결과 해시' && value !== null && (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value))) throw notionError();
      if (name === '검수 결과 링크' && value !== null) {
        try { if (new URL(value).protocol !== 'https:') throw notionError(); } catch { throw notionError(); }
      }
      if (name === '마지막 처리 시각' && value !== null && Number.isNaN(Date.parse(value))) throw notionError();
      if (name === '오류 요약' && value !== null && !/^(NO_CONSENT|REVOKED|EXPIRED|CHANNEL|CLIP_MISMATCH|PATH_REJECTED|BAD_EXT|TOO_LONG|FFMPEG|UNKNOWN|NOTION)$/.test(value)) throw notionError();
    }
    const notionProperties = {};
    for (const [name, value] of Object.entries(properties)) {
      if (name === '제작 상태') notionProperties[name] = { select: { name: value } };
      else if (name === '검수 결과 링크') notionProperties[name] = { url: value };
      else if (name === '결과 해시' || name === '오류 요약') notionProperties[name] = { rich_text: value ? [{ text: { content: value } }] : [] };
      else if (name === '마지막 처리 시각') notionProperties[name] = { date: value ? { start: value } : null };
    }
    return this.request(`/v1/pages/${pageId}`, { properties: notionProperties });
  }
}

export const CONTENT_QUEUE_FILTER = {
  and: [
    { property: '콘텐츠 유형', select: { equals: '숏폼 영상' } },
    { property: '제작 상태', select: { equals: '영상 제작 대기' } },
  ],
};

export function parseConsentRow(page) {
  const p = page?.properties;
  if (!page || !validId(page.id) || !p || typeof p !== 'object') throw notionError();
  const richText = (name) => p[name]?.rich_text?.map((part) => part?.plain_text || '').join('').trim() || '';
  const date = p['만료일']?.date?.start;
  const channels = p['허용 채널']?.multi_select;
  if (typeof p['공개 콘텐츠 허용']?.checkbox !== 'boolean' || typeof p['철회']?.checkbox !== 'boolean' || !Array.isArray(channels)) throw notionError();
  return {
    reference: richText('동의 참조값'),
    clipId: richText('클립 ID'),
    publicContent: p['공개 콘텐츠 허용'].checkbox,
    revoked: p['철회'].checkbox,
    allowedChannels: channels.map((item) => item?.name).filter((value) => typeof value === 'string'),
    expiresAt: date || null,
  };
}

export function parseVideoQueueRow(page) {
  const p = page?.properties;
  if (!page || !validId(page.id) || !p || typeof p !== 'object') throw notionError();
  const text = (name) => p[name]?.rich_text?.map((part) => part?.plain_text || '').join('').trim() || '';
  const numeric = (name) => p[name]?.number;
  const channelItems = p['채널']?.select ? [p['채널'].select] : p['채널']?.multi_select;
  const aliases = new Map([
    ['인스타그램', 'instagram'], ['릴스', 'instagram'], ['instagram', 'instagram'],
    ['유튜브 쇼츠', 'youtube_shorts'], ['유튜브쇼츠', 'youtube_shorts'], ['쇼츠', 'youtube_shorts'], ['youtube shorts', 'youtube_shorts'], ['youtube_shorts', 'youtube_shorts'],
    ['당근', 'daangn'], ['당근 소식', 'daangn'], ['daangn', 'daangn'],
    ['네이버 클립', 'naver_clip'], ['클립', 'naver_clip'], ['naver_clip', 'naver_clip'],
  ]);
  const channels = Array.isArray(channelItems) ? channelItems.map((item) => aliases.get(String(item?.name || '').trim().toLowerCase()) || `UNKNOWN:${String(item?.name || '').slice(0, 40)}`).filter(Boolean) : [];
  return {
    pageId: page.id,
    clipId: text('클립 ID'),
    consentReference: text('동의 참조값'),
    captionDraft: text('대본'),
    startSec: numeric('시작 초'),
    endSec: numeric('끝 초'),
    channels,
    lastProcessedAt: p['마지막 처리 시각']?.date?.start || null,
  };
}

export function isStaleEdit(lastProcessedAt, now = new Date()) {
  const timestamp = Date.parse(lastProcessedAt || '');
  // 처리 시각이 없는 '편집 중' 행은 선점 기록이 없는 것이므로 복구 대상으로 본다.
  if (!Number.isFinite(timestamp)) return true;
  return now.getTime() - timestamp > 30 * 60 * 1000;
}
