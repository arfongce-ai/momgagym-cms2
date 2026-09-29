import path from 'node:path';

export const MIN_CLIP_SECONDS = 10;
export const MAX_CLIP_SECONDS = 30;

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
