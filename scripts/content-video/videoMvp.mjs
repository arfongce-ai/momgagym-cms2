import path from 'node:path';

export const MIN_CLIP_SECONDS = 10;
export const MAX_CLIP_SECONDS = 30;
export const DEFAULT_CONSENT_SNAPSHOT_MAX_AGE_DAYS = 7;

export function validateClip(clip) {
  const errors = [];
  if (!clip || typeof clip !== 'object') return ['클립 항목이 올바르지 않습니다.'];
  if (!/^[a-z0-9][a-z0-9_-]{2,80}$/i.test(clip.id || '')) errors.push('id는 개인정보 없는 영문·숫자 식별자여야 합니다.');
  if (typeof clip.source !== 'string' || !clip.source.trim()) errors.push('source 영상 경로가 필요합니다.');
  if (clip.consent?.publicContent !== true) errors.push('공개 콘텐츠 동의(publicContent: true)가 확인되지 않았습니다.');
  if (typeof clip.consent?.reference !== 'string' || !clip.consent.reference.trim()) errors.push('동의 기록 참조값(reference)이 필요합니다.');
  const start = Number(clip.trim?.startSec ?? 0);
  const end = Number(clip.trim?.endSec);
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end <= start) {
    errors.push('trim.startSec과 trim.endSec을 올바르게 입력해야 합니다.');
  } else if (end - start < MIN_CLIP_SECONDS || end - start > MAX_CLIP_SECONDS) {
    errors.push(`편집 길이는 ${MIN_CLIP_SECONDS}~${MAX_CLIP_SECONDS}초여야 합니다.`);
  }
  if (typeof clip.captionDraft !== 'string' || !clip.captionDraft.trim()) errors.push('검수할 자막 초안(captionDraft)이 필요합니다.');
  return errors;
}

/**
 * Notion에서 사람이 내보낸 동의 현황 스냅샷을 검사한다.
 * 실제 서명 원본은 이 파일에 넣지 않고, 공개 가능 여부만 익명 참조값으로 대조한다.
 */
export function validateConsentSnapshot(snapshot, { reference, channels, now = new Date(), maxAgeDays = DEFAULT_CONSENT_SNAPSHOT_MAX_AGE_DAYS } = {}) {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return ['동의 스냅샷 파일 형식이 올바르지 않습니다.'];
  if (!Array.isArray(snapshot.records)) return ['동의 스냅샷에 records 목록이 필요합니다.'];
  if (typeof reference !== 'string' || !reference.trim()) return ['동의 기록 참조값이 필요합니다.'];
  if (!Array.isArray(channels) || channels.length === 0 || channels.some((channel) => typeof channel !== 'string' || !channel.trim())) {
    return ['게시 예정 채널 목록이 필요합니다.'];
  }

  const exportedAt = new Date(snapshot.exportedAt);
  if (Number.isNaN(exportedAt.getTime())) return ['동의 스냅샷의 exportedAt 시간이 올바르지 않습니다.'];
  const ageMs = now.getTime() - exportedAt.getTime();
  if (ageMs > maxAgeDays * 86_400_000) errors.push(`동의 스냅샷은 ${maxAgeDays}일 이내에 다시 내보내야 합니다.`);
  if (ageMs < -300_000) errors.push('동의 스냅샷 시간이 현재보다 미래입니다.');

  const record = snapshot.records.find((item) => item?.reference === reference.trim());
  if (!record) return [...errors, '동의 기록 참조값을 스냅샷에서 찾지 못했습니다.'];
  if (record.publicContent !== true) errors.push('해당 동의는 공개 콘텐츠 사용으로 승인되지 않았습니다.');
  if (record.revoked === true) errors.push('해당 동의는 철회되어 처리할 수 없습니다.');

  if (!Array.isArray(record.allowedChannels) || channels.some((channel) => !record.allowedChannels.includes(channel.trim()))) {
    errors.push('해당 동의의 허용 채널에 게시 예정 채널이 모두 포함되지 않습니다.');
  }
  if (record.expiresAt !== null && record.expiresAt !== undefined && record.expiresAt !== '') {
    const expiresAt = new Date(`${record.expiresAt}T23:59:59.999`);
    if (Number.isNaN(expiresAt.getTime())) errors.push('동의 만료일 형식이 올바르지 않습니다.');
    else if (expiresAt.getTime() < now.getTime()) errors.push('해당 동의가 만료되었습니다.');
  }
  return errors;
}

export function srtText(clip) {
  const duration = Number(clip.trim.endSec) - Number(clip.trim.startSec);
  const endMs = Math.max(1, Math.round(duration * 1000));
  const toSrtTime = (ms) => {
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    const seconds = Math.floor((ms % 60_000) / 1_000);
    const milliseconds = ms % 1_000;
    return [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':') + `,${String(milliseconds).padStart(3, '0')}`;
  };
  return `1\n${toSrtTime(0)} --> ${toSrtTime(endMs)}\n${clip.captionDraft.trim()}\n`;
}

export function outputPaths(outputDir, clip) {
  const stem = `${clip.id}-review`;
  return {
    video: path.join(outputDir, `${stem}.mp4`),
    subtitle: path.join(outputDir, `${stem}.srt`),
    review: path.join(outputDir, `${stem}.json`),
  };
}

/** 원본 경로·동의 참조값을 노출하지 않는 로컬 검수 페이지를 만든다. */
export function buildReviewIndexHtml(items) {
  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const cards = items.map(({ id, videoFile, subtitleFile }) => `
    <article>
      <h2>${escapeHtml(id)}</h2>
      <video controls preload="metadata" src="${escapeHtml(videoFile)}"></video>
      <p><a href="${escapeHtml(subtitleFile)}">자막 초안(SRT) 열기</a></p>
      <p class="notice">공개 전 얼굴·배경·음성·자막을 확인하세요. 이 파일은 자동 게시되지 않습니다.</p>
    </article>`).join('\n');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>몸가짐 콘텐츠 검수 대기</title><style>body{font-family:system-ui,sans-serif;max-width:960px;margin:32px auto;padding:0 16px;background:#111;color:#f5f5f5}article{margin:24px 0;padding:16px;background:#202020;border-radius:12px}video{width:100%;max-height:720px;background:#000}.notice{color:#f8d56b}</style></head>
<body><h1>콘텐츠 검수 대기</h1><p>이 페이지는 로컬 검수용입니다. 승인 전 외부 게시 금지.</p>${cards || '<p>생성된 영상이 없습니다.</p>'}</body></html>`;
}

/** ffmpeg가 설치된 로컬 PC에서만 실행한다. 원본은 복사·업로드하지 않는다. */
export function buildFfmpegArgs({ clip, outputFile, logoPath = null, endCardPath = null }) {
  const duration = Number(clip.trim.endSec) - Number(clip.trim.startSec);
  const baseFilter = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1';
  const args = ['-y', '-ss', String(clip.trim.startSec), '-t', String(duration), '-i', clip.source];
  if (logoPath) args.push('-i', logoPath);
  if (endCardPath) args.push('-loop', '1', '-t', '2', '-i', endCardPath);

  if (logoPath || endCardPath) {
    const filters = [`[0:v]${baseFilter}[base]`];
    let current = 'base';
    if (logoPath) {
      filters.push(`[1:v]scale=180:-1[logo]`, `[${current}][logo]overlay=W-w-48:48[branded]`);
      current = 'branded';
    }
    if (endCardPath) {
      const endIndex = logoPath ? 2 : 1;
      filters.push(`[${endIndex}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[end]`, `[${current}][end]concat=n=2:v=1:a=0[v]`);
    } else {
      filters.push(`[${current}]null[v]`);
    }
    args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '0:a?');
  } else {
    args.push('-vf', baseFilter);
  }
  return [...args, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'aac', '-movflags', '+faststart', outputFile];
}
