import { CONTENT_QUEUE_FILTER, isStaleEdit, parseConsentRow, parseVideoQueueRow } from './notionClient.mjs';
import { normalizeClip, validateNormalizedClip, validateConsentSnapshot } from './videoMvp.mjs';

const CONSENT_FILTER = { property: '클립 ID', rich_text: { is_not_empty: true } };
const EDITING_FILTER = { and: [
  { property: '콘텐츠 유형', select: { equals: '숏폼 영상' } },
  { property: '제작 상태', select: { equals: '편집 중' } },
] };
const ERROR_CODES = new Set(['NO_CONSENT', 'REVOKED', 'EXPIRED', 'CHANNEL', 'CLIP_MISMATCH', 'PATH_REJECTED', 'BAD_EXT', 'TOO_LONG', 'FFMPEG', 'UNKNOWN', 'NOTION']);

function codeFor(errors) {
  return errors.find((code) => ERROR_CODES.has(code)) || 'UNKNOWN';
}

function firstError(result) {
  if (!result || !Array.isArray(result.results)) return 'UNKNOWN';
  const row = result.results[0];
  return row?.resultCode === 'SKIPPED' || row?.resultCode === 'OK' ? null : codeFor([row?.resultCode]);
}

/** One bounded Notion run. Only the consent and content-calendar clients are used. */
export async function runNotionVideoWorkflow({ consentClient, calendarClient, consentDataSourceId, calendarDataSourceId, processClip, now = new Date() }) {
  if (!consentClient || !calendarClient || typeof processClip !== 'function') throw new Error('NOTION');
  const summary = { processed: 0, reviewed: 0, skipped: 0, failed: {} };
  let consentPages;
  try {
    consentPages = await consentClient.queryDataSource(consentDataSourceId, CONSENT_FILTER);
  } catch {
    return { ...summary, blocked: 'NOTION' };
  }
  let records;
  try {
    records = consentPages.map(parseConsentRow);
  } catch {
    return { ...summary, blocked: 'NOTION' };
  }
  const consentSnapshot = { exportedAt: now.toISOString(), records };

  let queuePages;
  let editingPages;
  try {
    [queuePages, editingPages] = await Promise.all([
      calendarClient.queryDataSource(calendarDataSourceId, CONTENT_QUEUE_FILTER),
      calendarClient.queryDataSource(calendarDataSourceId, EDITING_FILTER),
    ]);
  } catch {
    return { ...summary, blocked: 'NOTION' };
  }

  for (const page of editingPages) {
    try {
      const row = parseVideoQueueRow(page);
      if (!isStaleEdit(row.lastProcessedAt, now)) continue;
      await calendarClient.updatePage(row.pageId, {
        '제작 상태': '영상 제작 대기',
        '마지막 처리 시각': now.toISOString(),
        '오류 요약': 'UNKNOWN',
      });
    } catch {
      summary.failed.NOTION = (summary.failed.NOTION || 0) + 1;
    }
  }

  for (const page of queuePages) {
    let row;
    try {
      row = parseVideoQueueRow(page);
    } catch {
      summary.failed.NOTION = (summary.failed.NOTION || 0) + 1;
      continue;
    }
    summary.processed += 1;
    const clip = normalizeClip({
      clipId: row.clipId,
      consent: { reference: row.consentReference },
      trim: { startSec: row.startSec, endSec: row.endSec },
      captionDraft: row.captionDraft,
    });
    const clipErrors = validateNormalizedClip(clip);
    const consentErrors = validateConsentSnapshot(consentSnapshot, {
      reference: row.consentReference,
      clipId: row.clipId,
      channels: row.channels,
      now,
    });
    if (clipErrors.length || consentErrors.length) {
      const code = codeFor([...clipErrors, ...consentErrors]);
      try {
        await calendarClient.updatePage(row.pageId, {
          '제작 상태': '영상 제작 대기',
          '마지막 처리 시각': now.toISOString(),
          '오류 요약': code,
        });
      } catch {
        summary.failed.NOTION = (summary.failed.NOTION || 0) + 1;
      }
      summary.failed[code] = (summary.failed[code] || 0) + 1;
      continue;
    }

    try {
      await calendarClient.updatePage(row.pageId, {
        '제작 상태': '편집 중',
        '마지막 처리 시각': now.toISOString(),
        '오류 요약': null,
      });
    } catch {
      summary.failed.NOTION = (summary.failed.NOTION || 0) + 1;
      continue;
    }

    let result;
    try {
      result = await processClip({ clip, channels: row.channels, consentSnapshot });
    } catch {
      result = null;
    }
    const failure = firstError(result);
    const resultHash = result?.outputHashes?.[row.clipId];
    const succeeded = !failure && typeof resultHash === 'string' && /^[a-f0-9]{64}$/i.test(resultHash);
    const code = succeeded ? null : (failure || 'UNKNOWN');
    try {
      await calendarClient.updatePage(row.pageId, {
        '제작 상태': succeeded ? '검수 대기' : '영상 제작 대기',
        '결과 해시': succeeded ? resultHash : null,
        '마지막 처리 시각': now.toISOString(),
        '오류 요약': code,
      });
    } catch {
      summary.failed.NOTION = (summary.failed.NOTION || 0) + 1;
      continue;
    }
    if (succeeded) {
      summary.reviewed += 1;
      summary.skipped += result.results[0].resultCode === 'SKIPPED' ? 1 : 0;
    } else {
      summary.failed[code] = (summary.failed[code] || 0) + 1;
    }
  }
  return summary;
}

export function consentQueryFilter() { return CONSENT_FILTER; }
