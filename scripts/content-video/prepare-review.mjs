import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { CLIP_ID_PATTERN, resolveBrandAsset, resolveClipInput, resolveOutputPath } from './inputGuard.mjs';
import { buildFfmpegArgs, buildReviewIndexHtml, outputPaths, srtText, validateClip, validateConsentSnapshot } from './videoMvp.mjs';

const FAILURE_CODES = new Set(['NO_CONSENT', 'REVOKED', 'EXPIRED', 'CHANNEL', 'CLIP_MISMATCH', 'PATH_REJECTED', 'BAD_EXT', 'TOO_LONG', 'FFMPEG', 'UNKNOWN']);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(SCRIPT_DIR, '../../content-video');
const LEDGER_DIR = path.join(CONTENT_DIR, 'state');

function option(name, args = process.argv) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] || null;
}

function failureCode(error) {
  return FAILURE_CODES.has(error?.message) ? error.message : 'UNKNOWN';
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function writeLedger(ledger, ledgerDir = LEDGER_DIR, fs = { mkdir, writeFile, rename, rm }) {
  await fs.mkdir(ledgerDir, { recursive: true });
  const temp = path.join(ledgerDir, 'ledger.tmp.json');
  const target = path.join(ledgerDir, 'ledger.json');
  await fs.writeFile(temp, JSON.stringify(ledger, null, 2), 'utf8');
  await fs.rename(temp, target);
}

async function loadJson(file, fs = { readFile }) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

/** Testable local-only pipeline. All roots are supplied by the ignored local config. */
export async function prepareReview({ config, manifest, consentSnapshot, ledgerDir = LEDGER_DIR, fs = { mkdir, readFile, writeFile, rename, rm }, run = spawnSync, now = new Date() }) {
  if (!config || !['inputRoot', 'outputRoot', 'brandRoot'].every((key) => typeof config[key] === 'string' && path.isAbsolute(config[key]) && !config[key].startsWith('\\\\') && !config[key].startsWith('//'))) {
    throw new Error('PATH_REJECTED');
  }
  const results = [];
  const reviewItems = [];
  const ledger = await loadJson(path.join(ledgerDir, 'ledger.json'), fs).catch(() => ({ records: {} }));
  if (!ledger.records || typeof ledger.records !== 'object' || Array.isArray(ledger.records)) ledger.records = {};

  const runtime = run('ffmpeg', ['-version'], { encoding: 'utf8', stdio: 'ignore' });
  if (runtime.error || runtime.status !== 0) throw new Error('FFMPEG');

  await fs.mkdir(config.outputRoot, { recursive: true });
  const channels = manifest.publishing?.channels;
  const clips = Array.isArray(manifest.clips) ? manifest.clips : [];

  for (const clip of clips) {
    let id = CLIP_ID_PATTERN.test(clip?.clipId || '') ? clip.clipId : 'UNKNOWN';
    let inputHash = null;
    const cleanupPaths = [];
    try {
      const clipErrors = validateClip(clip);
      if (clipErrors.length) throw new Error(clipErrors[0]);
      id = clip.clipId;
      const consentErrors = validateConsentSnapshot(consentSnapshot, {
        reference: clip.consent.reference,
        channels,
        clipId: clip.clipId,
        now,
      });
      if (consentErrors.length) throw new Error(consentErrors[0]);

      const inputFile = await resolveClipInput(config.inputRoot, clip.clipId);
      inputHash = await sha256(inputFile);
      const names = outputPaths('', clip);
      const videoFile = await resolveOutputPath(config.outputRoot, path.basename(names.video));
      const subtitleFile = await resolveOutputPath(config.outputRoot, path.basename(names.subtitle));
      const reviewFile = await resolveOutputPath(config.outputRoot, path.basename(names.review));
      const prior = ledger.records[clip.clipId];
      if (prior?.inputSha256 === inputHash && prior?.resultCode === 'OK' && prior?.outputSha256 && await sha256(videoFile).then((hash) => hash === prior.outputSha256).catch(() => false)) {
        reviewItems.push({ clipId: id, videoFile: path.basename(videoFile), subtitleFile: path.basename(subtitleFile) });
        results.push({ clipId: id, resultCode: 'SKIPPED' });
        continue;
      }

      let logoPath = null;
      let endCardPath = null;
      if (manifest.brand?.logoFile) logoPath = await resolveBrandAsset(config.brandRoot, manifest.brand.logoFile);
      if (manifest.brand?.endCardFile) endCardPath = await resolveBrandAsset(config.brandRoot, manifest.brand.endCardFile);

      const tempVideo = await resolveOutputPath(config.outputRoot, `${path.basename(videoFile, '.mp4')}.tmp.mp4`);
      const tempSubtitle = await resolveOutputPath(config.outputRoot, `${path.basename(subtitleFile, '.srt')}.tmp.srt`);
      const tempReview = await resolveOutputPath(config.outputRoot, `${path.basename(reviewFile, '.json')}.tmp.json`);
      cleanupPaths.push(tempVideo, tempSubtitle, tempReview);
      const command = buildFfmpegArgs({ clip, inputFile, outputFile: tempVideo, logoPath, endCardPath });
      const rendered = run('ffmpeg', command, { stdio: 'ignore' });
      if (rendered.error || rendered.status !== 0) throw new Error('FFMPEG');

      await fs.writeFile(tempSubtitle, srtText(clip), 'utf8');
      await fs.writeFile(tempReview, JSON.stringify({
        clipId: clip.clipId,
        outputFile: path.basename(videoFile),
        subtitleFile: path.basename(subtitleFile),
        status: 'review_required',
        publishAllowed: false,
      }, null, 2));
      await fs.rename(tempVideo, videoFile);
      await fs.rename(tempSubtitle, subtitleFile);
      await fs.rename(tempReview, reviewFile);

      const outputHash = await sha256(videoFile);
      ledger.records[clip.clipId] = { inputSha256: inputHash, outputSha256: outputHash, recordedAt: now.toISOString(), resultCode: 'OK' };
      reviewItems.push({ clipId: id, videoFile: path.basename(videoFile), subtitleFile: path.basename(subtitleFile) });
      results.push({ clipId: id, resultCode: 'OK' });
    } catch (error) {
      await Promise.all(cleanupPaths.map((file) => fs.rm(file, { force: true }).catch(() => {})));
      const code = failureCode(error);
      if (id !== 'UNKNOWN') ledger.records[id] = { inputSha256: inputHash, outputSha256: null, recordedAt: now.toISOString(), resultCode: code };
      results.push({ clipId: id, resultCode: code });
    }
  }

  await fs.writeFile(await resolveOutputPath(config.outputRoot, 'review_index.html'), buildReviewIndexHtml(reviewItems), 'utf8');
  await writeLedger(ledger, ledgerDir, fs);
  return { results, failedCount: results.filter((item) => FAILURE_CODES.has(item.resultCode)).length };
}

async function main() {
  const manifestName = option('--manifest');
  if (!manifestName || path.basename(manifestName) !== manifestName || !manifestName.endsWith('.local.json')) {
    console.error('PATH_REJECTED');
    process.exitCode = 1;
    return;
  }
  try {
    const [config, manifest, consentSnapshot] = await Promise.all([
      loadJson(path.join(CONTENT_DIR, 'config.local.json')),
      loadJson(path.join(CONTENT_DIR, manifestName)),
      loadJson(path.join(CONTENT_DIR, 'consents.local.json')),
    ]);
    const { failedCount } = await prepareReview({ config, manifest, consentSnapshot });
    if (failedCount > 0) process.exitCode = 1;
  } catch (error) {
    console.error(failureCode(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
