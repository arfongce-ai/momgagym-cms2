import { describe, expect, it, vi } from 'vitest';
import { NotionClient, parseConsentRow, parseVideoQueueRow } from '../../scripts/content-video/notionClient.mjs';
import { runNotionVideoWorkflow } from '../../scripts/content-video/notionWorkflow.mjs';

const consentDatabaseId = '11111111-1111-4111-8111-111111111111';
const calendarDatabaseId = '22222222-2222-4222-8222-222222222222';
const pageId = '33333333-3333-4333-8333-333333333333';
const clipId = 'CLP-1234-5678';
const ref = 'CONSENT-1234';
const rich = (value) => ({ rich_text: [{ plain_text: value }] });
const consentPage = (overrides = {}) => ({
  id: pageId,
  properties: {
    '동의 참조값': rich(ref),
    '클립 ID': rich(clipId),
    '공개 콘텐츠 허용': { checkbox: true },
    '허용 채널': { multi_select: [{ name: 'instagram' }] },
    '철회': { checkbox: false },
    '만료일': { date: { start: '2027-12-31' } },
    '회원 이름': rich('must not be copied'),
    ...overrides,
  },
});
const queuePage = (overrides = {}) => ({
  id: pageId,
  properties: {
    '클립 ID': rich(clipId),
    '동의 참조값': rich(ref),
    '대본': rich('운동은 천천히 시작하세요.'),
    '시작 초': { number: 0 },
    '끝 초': { number: 20 },
    '채널': { select: { name: '인스타그램' } },
    '마지막 처리 시각': { date: null },
    ...overrides,
  },
});

function fakeClient({ consentPages = [], queuePages = [], editingPages = [] } = {}) {
  const updates = [];
  return {
    updates,
    async queryDataSource(dataSourceId, filter) {
      if (dataSourceId === consentDatabaseId) return consentPages;
      if (dataSourceId !== calendarDatabaseId) throw new Error('NOTION');
      if (filter?.and?.some((part) => part.property === '제작 상태' && part.select?.equals === '편집 중')) return editingPages;
      return queuePages;
    },
    async updatePage(id, properties) { updates.push({ id, properties }); return {}; },
  };
}

describe('Notion 연결과 제작 쓰기 허용 목록', () => {
  it('429 응답은 Retry-After를 따라 재시도하고 최대 세 번 요청한다', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ status: 429, ok: false, headers: { get: () => '2' } })
      .mockResolvedValueOnce({ status: 429, ok: false, headers: { get: () => '1' } })
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ results: [], has_more: false }) });
    const sleep = vi.fn(async () => {});
    const client = new NotionClient({ token: 'test-not-a-real-token', fetchImpl, sleep });
    expect(await client.queryDataSource(consentDatabaseId)).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[2000], [1000]]);
    expect(String(fetchImpl.mock.calls[0][0])).toBe(`https://api.notion.com/v1/data_sources/${consentDatabaseId}/query`);
  });

  it('429가 세 번 이어지면 NOTION으로 끝나고 응답·토큰을 오류에 넣지 않는다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 429, ok: false, headers: { get: () => '0' } });
    const client = new NotionClient({ token: 'private-test-token', fetchImpl, sleep: async () => {} });
    await expect(client.queryDataSource(consentDatabaseId)).rejects.toThrow(/^NOTION$/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each(['검수 상태', '최종 게시 승인', '게시 승인', '게시완료', '임의 속성'])('쓰기 허용 목록 밖 %s는 Notion 호출 전 거부한다', async (property) => {
    const fetchImpl = vi.fn();
    const client = new NotionClient({ token: 'test-not-a-real-token', access: 'write', fetchImpl });
    await expect(client.updatePage(pageId, { [property]: 'x' })).rejects.toThrow('NOTION');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('허용 상태 외 게시 상태 및 비허용 해시를 거부한다', async () => {
    const client = new NotionClient({ token: 'test-not-a-real-token', access: 'write', fetchImpl: vi.fn() });
    await expect(client.updatePage(pageId, { '제작 상태': '게시 승인' })).rejects.toThrow('NOTION');
    await expect(client.updatePage(pageId, { '결과 해시': 'not-a-hash' })).rejects.toThrow('NOTION');
  });

  it('읽기 전용 동의 클라이언트는 허용 속성도 쓰지 못한다', async () => {
    const fetchImpl = vi.fn();
    const client = new NotionClient({ token: 'test-not-a-real-token', access: 'read', fetchImpl });
    await expect(client.updatePage(pageId, { '제작 상태': '검수 대기' })).rejects.toThrow('NOTION');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('동의/대기 행 파서는 명시적으로 허용한 속성만 뽑는다', () => {
    expect(parseConsentRow(consentPage())).not.toHaveProperty('회원 이름');
    expect(parseVideoQueueRow(queuePage())).toMatchObject({ clipId, consentReference: ref, channels: ['instagram'], startSec: 0, endSec: 20 });
  });

  it('동의 스냅샷 조회/파싱 실패 시 어떤 콘텐츠도 처리하거나 변경하지 않는다', async () => {
    const consentClient = fakeClient({ consentPages: [consentPage({ '철회': {} })] });
    const calendarClient = fakeClient({ queuePages: [queuePage()] });
    const processClip = vi.fn();
    const result = await runNotionVideoWorkflow({ consentClient, calendarClient, consentDataSourceId: consentDatabaseId, calendarDataSourceId: calendarDatabaseId, processClip });
    expect(result.blocked).toBe('NOTION');
    expect(processClip).not.toHaveBeenCalled();
    expect(calendarClient.updates).toEqual([]);
  });

  it('대기 영상을 선점하고 성공하면 해시/시각과 검수 대기만 기록한다', async () => {
    const consentClient = fakeClient({ consentPages: [consentPage()] });
    const calendarClient = fakeClient({ queuePages: [queuePage()] });
    const processClip = vi.fn(async () => ({ results: [{ clipId, resultCode: 'OK' }], outputHashes: { [clipId]: 'a'.repeat(64) } }));
    const now = new Date('2026-10-06T00:00:00.000Z');
    const result = await runNotionVideoWorkflow({ consentClient, calendarClient, consentDataSourceId: consentDatabaseId, calendarDataSourceId: calendarDatabaseId, processClip, now });
    expect(result).toMatchObject({ processed: 1, reviewed: 1, failed: {} });
    expect(calendarClient.updates.map((item) => item.properties['제작 상태'])).toEqual(['편집 중', '검수 대기']);
    expect(calendarClient.updates[1].properties).toMatchObject({ '결과 해시': 'a'.repeat(64), '마지막 처리 시각': now.toISOString() });
    expect(calendarClient.updates.flatMap((item) => Object.keys(item.properties)).some((key) => ['검수 상태', '최종 게시 승인', '게시 승인', '게시완료'].includes(key))).toBe(false);
    expect(processClip.mock.calls[0][0].consentSnapshot.records[0]).not.toHaveProperty('회원 이름');
  });

  it('동의 불일치 클립은 해당 행만 오류코드 기록하고 다른 클립은 계속 처리한다', async () => {
    const badPage = queuePage({ '채널': { select: { name: '알 수 없는 채널' } } });
    const secondId = '44444444-4444-4444-8444-444444444444';
    const second = { ...queuePage(), id: secondId };
    const consentClient = fakeClient({ consentPages: [consentPage()] });
    const calendarClient = fakeClient({ queuePages: [badPage, second] });
    const processClip = vi.fn(async () => ({ results: [{ clipId, resultCode: 'OK' }], outputHashes: { [clipId]: 'b'.repeat(64) } }));
    const result = await runNotionVideoWorkflow({ consentClient, calendarClient, consentDataSourceId: consentDatabaseId, calendarDataSourceId: calendarDatabaseId, processClip, now: new Date('2026-10-06T00:00:00.000Z') });
    expect(result.reviewed).toBe(1);
    expect(result.failed.CHANNEL).toBe(1);
    expect(processClip).toHaveBeenCalledTimes(1);
    expect(calendarClient.updates[0].properties['오류 요약']).toBe('CHANNEL');
  });

  it('30분이 지난 편집 중 행은 영상 제작 대기로 복구한다', async () => {
    const consentClient = fakeClient({ consentPages: [consentPage()] });
    const calendarClient = fakeClient({ editingPages: [queuePage({ '마지막 처리 시각': { date: { start: '2026-10-05T23:00:00.000Z' } } })] });
    const result = await runNotionVideoWorkflow({ consentClient, calendarClient, consentDataSourceId: consentDatabaseId, calendarDataSourceId: calendarDatabaseId, processClip: vi.fn(), now: new Date('2026-10-06T00:00:00.000Z') });
    expect(result.processed).toBe(0);
    expect(calendarClient.updates[0].properties['제작 상태']).toBe('영상 제작 대기');
  });
});
