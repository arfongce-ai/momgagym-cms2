import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveClipInput, resolveOutputPath } from '../../scripts/content-video/inputGuard.mjs';
import { buildFfmpegArgs, buildReviewIndexHtml, srtText, validateClip, validateConsentSnapshot } from '../../scripts/content-video/videoMvp.mjs';
import { prepareReview } from '../../scripts/content-video/prepare-review.mjs';

const roots = [];
const ids = ['CLP-1234-5678', 'CLP-2222-3333', 'CLP-4444-5555'];
const makeClip = (clipId, reference = `CONSENT-${clipId}`) => ({
  clipId,
  consent: { publicContent: true, reference },
  trim: { startSec: 2, endSec: 22 },
  captionDraft: '운동은 천천히 시작하세요.',
});
const makeRecord = (clip) => ({
  reference: clip.consent.reference,
  clipId: clip.clipId,
  publicContent: true,
  revoked: false,
  allowedChannels: ['instagram'],
  expiresAt: '2027-12-31',
});

async function tempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'content-video-dummy-'));
  roots.push(root);
  return root;
}

async function setupJob({ count = 3, failIds = [] } = {}) {
  const base = await tempRoot();
  const inputRoot = path.join(base, 'inputs');
  const outputRoot = path.join(base, 'outputs');
  const ledgerDir = path.join(base, 'ledger');
  const brandRoot = path.join(base, 'brand');
  await Promise.all([mkdir(inputRoot), mkdir(outputRoot), mkdir(brandRoot)]);
  const clips = ids.slice(0, count).map((id) => makeClip(id));
  await Promise.all(clips.map((clip) => writeFile(path.join(inputRoot, `${clip.clipId}.mp4`), `dummy:${clip.clipId}`)));
  let renderCount = 0;
  const syncRun = (command, args) => {
    if (args[0] === '-version') return { status: 0 };
    renderCount += 1;
    const output = args.at(-1);
    const clipId = ids.find((id) => output.includes(id));
    if (failIds.includes(clipId)) {
      writeFileSync(output, 'partial-output');
      return { status: 1 };
    }
    writeFileSync(output, `rendered:${clipId}`);
    return { status: 0 };
  };
  return {
    base,
    config: { inputRoot, outputRoot, brandRoot },
    ledgerDir,
    manifest: { publishing: { channels: ['instagram'] }, clips },
    consentSnapshot: { exportedAt: '2026-10-01T00:00:00.000Z', records: clips.map(makeRecord) },
    syncRun,
    get renderCount() { return renderCount; },
  };
}

async function executeJob(job, overrides = {}) {
  return prepareReview({ ...job, run: job.syncRun, ...overrides, now: new Date('2026-10-01T12:00:00.000Z') });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('콘텐츠 영상 입력 가드와 로컬 렌더', () => {
  it.each(['../x', 'C:\\outside.mp4', '/outside/file.mp4', 'CLP-1234- 678'])('잘못된 클립 ID %s는 파일 접근 전에 PATH_REJECTED', async (clipId) => {
    let calls = 0;
    const fakeFs = { lstat: async () => { calls += 1; }, realpath: async () => { calls += 1; }, readdir: async () => { calls += 1; } };
    await expect(resolveClipInput(path.resolve(os.tmpdir()), clipId, { fs: fakeFs })).rejects.toThrow('PATH_REJECTED');
    expect(calls).toBe(0);
  });

  it('루트 바로 아래 파일만 찾고 하위 폴더 파일은 무시한다', async () => {
    const root = await tempRoot();
    await mkdir(path.join(root, 'nested'));
    await writeFile(path.join(root, 'nested', `${ids[0]}.mp4`), 'dummy');
    await expect(resolveClipInput(root, ids[0])).rejects.toThrow('PATH_REJECTED');
    await writeFile(path.join(root, `${ids[0]}.mov`), 'dummy');
    expect(await resolveClipInput(root, ids[0])).toBe(path.join(root, `${ids[0]}.mov`));
  });

  it.each([`${ids[0]}.exe`, `${ids[0]}.mp4.exe`, ids[0]])('잘못된 확장자 %s는 BAD_EXT', async (filename) => {
    const root = await tempRoot();
    await writeFile(path.join(root, filename), 'dummy');
    await expect(resolveClipInput(root, ids[0])).rejects.toThrow('BAD_EXT');
  });

  it('루트 밖을 가리키는 심볼릭 링크를 거부한다', async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await writeFile(path.join(outside, 'outside.mp4'), 'dummy');
    try {
      await symlink(path.join(outside, 'outside.mp4'), path.join(root, `${ids[0]}.mp4`));
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return;
      throw error;
    }
    const statPaths = [];
    const spyFs = {
      lstat: async (file) => { statPaths.push(path.resolve(file)); return lstat(file); },
      realpath,
      readdir,
    };
    await expect(resolveClipInput(root, ids[0], { fs: spyFs })).rejects.toThrow('PATH_REJECTED');
    expect(statPaths).not.toContain(path.join(outside, 'outside.mp4'));
  });

  it('출력 파일명 경로 탈출과 심볼릭 링크를 거부한다', async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await expect(resolveOutputPath(root, '../escape.mp4')).rejects.toThrow('PATH_REJECTED');
    await writeFile(path.join(outside, 'target.mp4'), 'dummy');
    try {
      await symlink(path.join(outside, 'target.mp4'), path.join(root, 'linked.mp4'));
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return;
      throw error;
    }
    await expect(resolveOutputPath(root, 'linked.mp4')).rejects.toThrow('PATH_REJECTED');
  });

  it('클립은 경로 대신 ID만 받고 클립 길이와 자막을 확인한다', () => {
    const clip = makeClip(ids[0]);
    expect(validateClip(clip)).toEqual([]);
    expect(validateClip({ ...clip, source: 'ignored' })).toContain('PATH_REJECTED');
    expect(validateClip({ ...clip, trim: { startSec: 0, endSec: 31 } })).toContain('TOO_LONG');
    expect(validateClip({ ...clip, clipId: '../outside' })).toContain('PATH_REJECTED');
  });

  it('같은 동의 참조의 모든 기록이 유효해야 하며 클립 ID가 없거나 다르면 거부한다', () => {
    const clip = makeClip(ids[0], 'DUPLICATE');
    const snapshot = { exportedAt: '2026-10-01T00:00:00.000Z', records: [makeRecord(clip), { ...makeRecord(clip), revoked: true }] };
    const options = { reference: clip.consent.reference, channels: ['instagram'], clipId: clip.clipId, now: new Date('2026-10-01T12:00:00Z') };
    expect(validateConsentSnapshot(snapshot, options)).toContain('REVOKED');
    expect(validateConsentSnapshot({ ...snapshot, records: [{ ...makeRecord(clip), clipId: ids[1] }] }, options)).toContain('CLIP_MISMATCH');
    const { clipId, ...withoutId } = makeRecord(clip);
    expect(validateConsentSnapshot({ ...snapshot, records: [withoutId] }, options)).toContain('CLIP_MISMATCH');
  });

  it('매니페스트의 자기 신고 없이 동의 레코드의 공개 허용으로 검증한다', () => {
    const clip = makeClip(ids[0]);
    const snapshot = { exportedAt: '2026-10-01T00:00:00.000Z', records: [makeRecord(clip)] };
    const options = { reference: clip.consent.reference, channels: ['instagram'], clipId: clip.clipId, now: new Date('2026-10-01T12:00:00Z') };
    expect(validateClip({ ...clip, consent: { ...clip.consent, publicContent: false } })).toEqual([]);
    expect(validateConsentSnapshot(snapshot, options)).toEqual([]);
    expect(validateConsentSnapshot({ ...snapshot, records: [{ ...makeRecord(clip), publicContent: false }] }, options)).toContain('NO_CONSENT');
  });

  it('3개 중 FFmpeg 1개 실패해도 나머지를 만들고 인덱스에 성공 2개만 싣는다', async () => {
    const job = await setupJob({ failIds: [ids[1]] });
    const result = await executeJob(job);
    const index = await readFile(path.join(job.config.outputRoot, 'review_index.html'), 'utf8');
    expect(result.failedCount).toBe(1);
    expect(result.results.map(({ resultCode }) => resultCode)).toEqual(['OK', 'FFMPEG', 'OK']);
    expect(index).toContain(ids[0]);
    expect(index).toContain(ids[2]);
    expect(index).not.toContain(ids[1]);
    expect(await readdir(job.config.outputRoot)).not.toContain(`${ids[1]}-review.mp4`);
    expect(await readdir(job.config.outputRoot)).not.toContain(`${ids[1]}-review.tmp.mp4`);
  });

  it('FFmpeg 실패는 기존 검수본을 보존하고 임시 출력만 정리한다', async () => {
    const job = await setupJob({ count: 1, failIds: [ids[0]] });
    const prior = path.join(job.config.outputRoot, `${ids[0]}-review.mp4`);
    await writeFile(prior, 'previous-review');
    await executeJob(job);
    expect(await readFile(prior, 'utf8')).toBe('previous-review');
    expect(await readdir(job.config.outputRoot)).not.toContain(`${ids[0]}-review.tmp.mp4`);
  });

  it('같은 클립·같은 입력 해시는 다시 렌더하지 않는다', async () => {
    const job = await setupJob({ count: 1 });
    await executeJob(job);
    const firstCount = job.renderCount;
    const second = await executeJob(job);
    expect(job.renderCount).toBe(firstCount);
    expect(second.results[0].resultCode).toBe('SKIPPED');
  });

  it('검수 JSON과 원장은 publishAllowed false이며 경로·동의 참조를 저장하지 않는다', async () => {
    const job = await setupJob({ count: 1 });
    await executeJob(job);
    const review = await readFile(path.join(job.config.outputRoot, `${ids[0]}-review.json`), 'utf8');
    const ledger = await readFile(path.join(job.ledgerDir, 'ledger.json'), 'utf8');
    expect(JSON.parse(review).publishAllowed).toBe(false);
    expect(review).not.toContain(job.config.inputRoot);
    expect(review).not.toContain(job.manifest.clips[0].consent.reference);
    expect(ledger).toContain('inputSha256');
    expect(ledger).toContain('outputSha256');
    expect(ledger).not.toContain(job.config.inputRoot);
    expect(ledger).not.toContain(`${ids[0]}.mp4`);
  });

  it('FFmpeg 명령은 입력 ID로 검증된 경로를 받고 지정한 임시 출력만 덮어쓴다', () => {
    const clip = makeClip(ids[0]);
    const args = buildFfmpegArgs({ clip, inputFile: 'guarded-input.mp4', outputFile: 'result.tmp.mp4', logoPath: 'logo.png', endCardPath: 'end-card.png' });
    expect(args[0]).toBe('-y');
    expect(args).toContain('guarded-input.mp4');
    expect(args.at(-1)).toBe('result.tmp.mp4');
    expect(args).not.toContain('result.mp4');
  });

  it('자막과 검수 갤러리는 경로·동의 참조를 노출하지 않는다', () => {
    const clip = makeClip(ids[0]);
    expect(srtText(clip)).toContain('00:00:00,000 --> 00:00:20,000');
    const html = buildReviewIndexHtml([{ clipId: ids[0], videoFile: `${ids[0]}-review.mp4`, subtitleFile: `${ids[0]}-review.srt` }]);
    expect(html).toContain(`${ids[0]}-review.mp4`);
    expect(html).not.toContain(clip.consent.reference);
  });
});
