/**
 * @module test/qdrant/download
 * Download, verify (SHA-256), extract and cache the official Qdrant release binary for this platform; network + fs + `tar` child process.
 * Cache: `QDRANT_CACHE_DIR` or `<cwd>/node_modules/.cache/qdrant/<version>`; populated atomically (stage dir, then rename). The cached executable is re-hashed against its pinned digest on every use.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  QDRANT_VERSION,
  type QdrantAsset,
  qdrantAssetUrl,
  selectQdrantAsset,
} from './assets';

const execFileAsync = promisify(execFile);

/**
 * Default cache directory for the pinned Qdrant version.
 *
 * @param env - Environment (reads `QDRANT_CACHE_DIR`).
 * @returns The versioned cache directory.
 */
export function qdrantCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const root =
    env['QDRANT_CACHE_DIR'] ??
    join(process.cwd(), 'node_modules', '.cache', 'qdrant');
  return join(root, QDRANT_VERSION);
}

/**
 * Throw unless `data` has the expected SHA-256.
 *
 * @param data - Downloaded bytes.
 * @param expected - Expected lower-case hex digest.
 * @throws On mismatch.
 */
export function verifyDigest(
  data: Uint8Array,
  expected: string,
  what = 'Qdrant archive',
): void {
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== expected) {
    throw new Error(
      `${what} SHA-256 mismatch: expected ${expected}, got ${actual}`,
    );
  }
}

/**
 * Throw unless the executable at `binaryPath` has the pinned SHA-256.
 *
 * @param binaryPath - Path to the Qdrant executable.
 * @param expected - Expected lower-case hex digest.
 * @throws On mismatch or when the file cannot be read.
 */
export async function verifyBinaryDigest(
  binaryPath: string,
  expected: string,
): Promise<void> {
  verifyDigest(await readFile(binaryPath), expected, 'Qdrant executable');
}

/**
 * The `tar` executable: on Windows the bundled bsdtar (reads `.zip`), never a
 * GNU tar that happens to be first on PATH.
 */
function tarCommand(): string {
  if (process.platform !== 'win32') return 'tar';
  return join(
    process.env['SystemRoot'] ?? 'C:\\Windows',
    'System32',
    'tar.exe',
  );
}

/**
 * Run `<binary> --version` and check it reports the pinned version.
 *
 * @param binaryPath - Path to the Qdrant executable.
 * @throws When it does not run or reports another version.
 */
export async function verifyQdrantBinary(binaryPath: string): Promise<void> {
  const { stdout } = await execFileAsync(binaryPath, ['--version'], {
    timeout: 30_000,
  });
  if (!stdout.includes(QDRANT_VERSION)) {
    throw new Error(
      `Unexpected Qdrant version output: ${JSON.stringify(stdout.trim())}`,
    );
  }
}

/** Download, verify and extract `asset` into `cacheDir` (atomically). */
async function populateCache(
  asset: QdrantAsset,
  cacheDir: string,
): Promise<void> {
  const url = qdrantAssetUrl(asset);
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${String(res.status)}`);
  }
  const data = new Uint8Array(await res.arrayBuffer());
  verifyDigest(data, asset.sha256);

  const stage = `${cacheDir}.stage-${String(process.pid)}`;
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  try {
    const archive = join(stage, asset.name);
    await writeFile(archive, data);
    await execFileAsync(tarCommand(), ['-xf', archive, '-C', stage], {
      timeout: 120_000,
    });
    await rm(archive, { force: true });
    const binary = join(stage, asset.binaryName);
    if (!existsSync(binary)) {
      throw new Error(`${asset.name} has no ${asset.binaryName}`);
    }
    if (process.platform !== 'win32') await chmod(binary, 0o755);
    await verifyBinaryDigest(binary, asset.binarySha256);
    await verifyQdrantBinary(binary);
    await rm(cacheDir, { recursive: true, force: true });
    await rename(stage, cacheDir);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/**
 * Return a verified Qdrant executable for this platform, downloading it into
 * the cache on first use, or when the cached copy no longer has the pinned
 * SHA-256 or fails to run.
 *
 * @param cacheDir - Versioned cache directory (default {@link qdrantCacheDir}).
 * @returns Absolute path of the executable.
 * @throws When the platform is unsupported or download/extraction fails.
 */
export async function ensureQdrantBinary(
  cacheDir: string = qdrantCacheDir(),
): Promise<string> {
  const asset = selectQdrantAsset(process.platform, process.arch);
  if (!asset) {
    throw new Error(
      `No Qdrant ${QDRANT_VERSION} release binary for ${process.platform}-${process.arch}`,
    );
  }
  const binary = join(cacheDir, asset.binaryName);
  if (existsSync(binary)) {
    try {
      await verifyBinaryDigest(binary, asset.binarySha256);
      await verifyQdrantBinary(binary);
      return binary;
    } catch {
      // Tampered, corrupt or foreign cache entry: fetch a fresh copy below.
    }
  }
  await populateCache(asset, cacheDir);
  return binary;
}
