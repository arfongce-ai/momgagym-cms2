import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { buildFfmpegArgs, buildReviewIndexHtml, outputPaths, srtText, validateClip } from './videoMvp.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

const manifestPath = option('--manifest');
if (!manifestPath) {
  console.error('사용법: node scripts/content-video/prepare-review.mjs --manifest content-video/approved.local.json');
  process.exit(1);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const outputDir = path.resolve(manifest.outputDir || 'content-video/review');
const clips = Array.isArray(manifest.clips) ? manifest.clips : [];
const invalid = clips.flatMap((clip) => validateClip(clip).map((message) => `${clip?.id || '(id 없음)'}: ${message}`));
if (invalid.length) {
  console.error('동의/길이/자막 검증에 실패했습니다. 원본 영상은 처리하지 않습니다.');
  invalid.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

const runtime = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
if (runtime.error || runtime.status !== 0) {
  console.error('FFmpeg를 찾지 못했습니다. 설치 후 다시 실행하세요. 원본 영상은 변경되지 않았습니다.');
  process.exit(1);
}

await mkdir(outputDir, { recursive: true });
const reviewItems = [];
for (const clip of clips) {
  await access(clip.source);
  const files = outputPaths(outputDir, clip);
  const command = buildFfmpegArgs({
    clip,
    outputFile: files.video,
    logoPath: manifest.brand?.logoPath || null,
    endCardPath: manifest.brand?.endCardPath || null,
  });
  const result = spawnSync('ffmpeg', command, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
  await writeFile(files.subtitle, srtText(clip), 'utf8');
  await writeFile(files.review, JSON.stringify({
    id: clip.id,
    consentReference: clip.consent.reference,
    source: clip.source,
    output: files.video,
    subtitleDraft: files.subtitle,
    status: 'review_required',
    publishAllowed: false,
  }, null, 2));
  reviewItems.push({ id: clip.id, videoFile: path.basename(files.video), subtitleFile: path.basename(files.subtitle) });
  console.log(`검수 대기 생성: ${files.video}`);
}
await writeFile(path.join(outputDir, 'review_index.html'), buildReviewIndexHtml(reviewItems), 'utf8');
console.log(`검수 갤러리 생성: ${path.join(outputDir, 'review_index.html')}`);
