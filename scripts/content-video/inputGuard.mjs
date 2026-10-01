import path from 'node:path';
import { lstat, realpath, readdir } from 'node:fs/promises';

export const CLIP_ID_PATTERN = /^CLP-\d{4}-\d{4}$/;

function isNetworkPath(value) {
  return typeof value !== 'string' || value.startsWith('\\\\') || value.startsWith('//');
}

function assertLocalAbsolutePath(value, referenceRoot = null) {
  if (isNetworkPath(value) || !path.isAbsolute(value)) throw new Error('PATH_REJECTED');
  const winPath = path.win32;
  const parsed = winPath.parse(value);
  if (parsed.root.startsWith('\\\\')) throw new Error('PATH_REJECTED');
  if (referenceRoot) {
    const rootParsed = winPath.parse(referenceRoot);
    if (parsed.root && rootParsed.root && parsed.root.toLowerCase() !== rootParsed.root.toLowerCase()) {
      throw new Error('PATH_REJECTED');
    }
    if (process.platform === 'win32' && parsed.root.toLowerCase() !== rootParsed.root.toLowerCase()) {
      throw new Error('PATH_REJECTED');
    }
  }
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function canonicalDirectory(root, fs) {
  assertLocalAbsolutePath(root);
  const rootInfo = await fs.lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('PATH_REJECTED');
  const canonical = await fs.realpath(root);
  assertLocalAbsolutePath(canonical, root);
  return canonical;
}

/** Resolve only a direct child named from the validated clip ID; never accepts a manifest path. */
export async function resolveClipInput(root, clipId, { fs = { lstat, realpath, readdir } } = {}) {
  if (!CLIP_ID_PATTERN.test(clipId || '')) throw new Error('PATH_REJECTED');
  try {
    const canonicalRoot = await canonicalDirectory(root, fs);
    const entries = await fs.readdir(canonicalRoot, { withFileTypes: true });
    const matching = entries.filter((entry) => entry.name.toLowerCase() === clipId.toLowerCase() || entry.name.toLowerCase().startsWith(`${clipId.toLowerCase()}.`));
    const allowed = matching.filter((entry) => ['.mp4', '.mov'].includes(path.extname(entry.name).toLowerCase()));
    if (matching.some((entry) => !['.mp4', '.mov'].includes(path.extname(entry.name).toLowerCase()))) throw new Error('BAD_EXT');
    if (allowed.length !== 1) throw new Error(allowed.length ? 'PATH_REJECTED' : (matching.length ? 'BAD_EXT' : 'PATH_REJECTED'));

    const filePath = path.join(canonicalRoot, allowed[0].name);
    assertLocalAbsolutePath(filePath, canonicalRoot);
    const canonicalFile = await fs.realpath(filePath);
    assertLocalAbsolutePath(canonicalFile, canonicalRoot);
    if (!isWithinRoot(canonicalRoot, canonicalFile)) throw new Error('PATH_REJECTED');
    const info = await fs.lstat(filePath);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('PATH_REJECTED');
    if (!['.mp4', '.mov'].includes(path.extname(canonicalFile).toLowerCase())) throw new Error('BAD_EXT');
    return canonicalFile;
  } catch (error) {
    if (error?.message === 'BAD_EXT' || error?.message === 'PATH_REJECTED') throw error;
    throw new Error('PATH_REJECTED');
  }
}

/** Resolve one output filename directly under its configured local root. */
export async function resolveOutputPath(root, filename, { fs = { lstat, realpath } } = {}) {
  if (typeof filename !== 'string' || !filename || path.basename(filename) !== filename || filename === '.' || filename === '..') {
    throw new Error('PATH_REJECTED');
  }
  try {
    const canonicalRoot = await canonicalDirectory(root, fs);
    const candidate = path.join(canonicalRoot, filename);
    assertLocalAbsolutePath(candidate, canonicalRoot);
    if (!isWithinRoot(canonicalRoot, candidate)) throw new Error('PATH_REJECTED');
    try {
      const canonicalFile = await fs.realpath(candidate);
      if (!isWithinRoot(canonicalRoot, canonicalFile)) throw new Error('PATH_REJECTED');
      const info = await fs.lstat(candidate);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error('PATH_REJECTED');
      return canonicalFile;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      return candidate;
    }
  } catch {
    throw new Error('PATH_REJECTED');
  }
}

export async function resolveBrandAsset(brandRoot, filename, options = {}) {
  if (typeof filename !== 'string' || !filename || path.basename(filename) !== filename || !['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(filename).toLowerCase())) {
    throw new Error('BAD_EXT');
  }
  const fs = options.fs || { lstat, realpath, readdir };
  const root = await canonicalDirectory(brandRoot, fs);
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const entry = entries.find((item) => item.name === filename);
    if (!entry) throw new Error('PATH_REJECTED');
    const candidate = path.join(root, filename);
    const canonicalFile = await fs.realpath(candidate);
    assertLocalAbsolutePath(canonicalFile, root);
    if (!isWithinRoot(root, canonicalFile)) throw new Error('PATH_REJECTED');
    const info = await fs.lstat(candidate);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('PATH_REJECTED');
    return canonicalFile;
  } catch (error) {
    if (error?.message === 'BAD_EXT' || error?.message === 'PATH_REJECTED') throw error;
    throw new Error('PATH_REJECTED');
  }
}
