/**
 * @module test/qdrant/download.provision.test
 * ensureQdrantBinary with injected fetch, execFile and asset: first-use download, cache hit without download, unsupported platform, tampered cache re-fetched, HTTP failure, archive digest checked before extraction, missing executable and wrong version leave no stage dir and no cache (temp dirs).
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QDRANT_VERSION, type QdrantAsset, qdrantAssetUrl } from './assets';
import { type DownloadDeps, ensureQdrantBinary } from './download';

const sha256 = (data: Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

const ARCHIVE = new TextEncoder().encode('pretend archive');
const BINARY = new TextEncoder().encode('pretend qdrant executable');

const ASSET: QdrantAsset = {
  name: 'qdrant-test.tar.gz',
  sha256: sha256(ARCHIVE),
  binaryName: 'qdrant-test',
  binarySha256: sha256(BINARY),
};

interface FakeOptions {
  status?: number;
  archive?: Uint8Array;
  /** Whether extraction produces the executable. */
  extracts?: boolean;
  /** `--version` output. */
  version?: string;
}

/** Injected I/O: a fake release download and a fake `tar` / `--version`. */
function fakeDeps(options: FakeOptions = {}) {
  const { status = 200, archive = ARCHIVE, extracts = true } = options;
  const version = options.version ?? `qdrant ${QDRANT_VERSION}`;
  const fetch = vi.fn<(url: string) => Promise<Response>>(() =>
    Promise.resolve(new Response(status === 200 ? archive : null, { status })),
  );
  const execFile = vi.fn<DownloadDeps['execFile']>(async (_file, args) => {
    if (args[0] === '-xf') {
      if (extracts) await writeFile(join(args[3], ASSET.binaryName), BINARY);
      return { stdout: '' };
    }
    return { stdout: `${version}\n` };
  });
  const deps: DownloadDeps = {
    fetch: fetch as unknown as typeof globalThis.fetch,
    execFile,
    asset: ASSET,
  };
  const extractions = () =>
    execFile.mock.calls.filter(([, args]) => args[0] === '-xf').length;
  return { deps, fetch, execFile, extractions };
}

describe('ensureQdrantBinary', () => {
  let root: string;
  let cacheDir: string;
  let binary: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'jeeves-watcher-provision-'));
    cacheDir = join(root, QDRANT_VERSION);
    binary = join(cacheDir, ASSET.binaryName);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** No stage directory is left next to the cache. */
  async function expectNoStage(): Promise<void> {
    const entries = await readdir(root);
    expect(entries.filter((e) => e.includes('.stage-'))).toEqual([]);
  }

  it('downloads, verifies, extracts and caches on first use', async () => {
    const { deps, fetch, execFile } = fakeDeps();
    await expect(ensureQdrantBinary(cacheDir, deps)).resolves.toBe(binary);
    expect(await readFile(binary)).toEqual(Buffer.from(BINARY));
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe(qdrantAssetUrl(ASSET));
    // The extracted executable is version-checked before it is cached.
    expect(execFile).toHaveBeenLastCalledWith(
      expect.stringContaining('.stage-'),
      ['--version'],
      expect.anything(),
    );
    await expectNoStage();
  });

  it('uses a verified cached executable without downloading', async () => {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(binary, BINARY);
    const { deps, fetch, execFile } = fakeDeps();
    await expect(ensureQdrantBinary(cacheDir, deps)).resolves.toBe(binary);
    expect(fetch).not.toHaveBeenCalled();
    expect(execFile).toHaveBeenCalledWith(
      binary,
      ['--version'],
      expect.anything(),
    );
  });

  it('re-downloads over a tampered cached executable', async () => {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(binary, new TextEncoder().encode('tampered'));
    const { deps, fetch } = fakeDeps();
    await expect(ensureQdrantBinary(cacheDir, deps)).resolves.toBe(binary);
    expect(fetch).toHaveBeenCalledOnce();
    expect(await readFile(binary)).toEqual(Buffer.from(BINARY));
  });

  it('refuses an unsupported platform without downloading', async () => {
    const { deps, fetch } = fakeDeps();
    await expect(
      ensureQdrantBinary(cacheDir, { ...deps, asset: undefined }),
    ).rejects.toThrow(`No Qdrant ${QDRANT_VERSION} release binary for`);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails on an HTTP error, leaving no stage and no cache', async () => {
    const { deps, extractions } = fakeDeps({ status: 404 });
    await expect(ensureQdrantBinary(cacheDir, deps)).rejects.toThrow(
      `GET ${qdrantAssetUrl(ASSET)} failed: 404`,
    );
    expect(extractions()).toBe(0);
    expect(existsSync(cacheDir)).toBe(false);
    await expectNoStage();
  });

  it('checks the archive digest before extracting anything', async () => {
    const { deps, extractions } = fakeDeps({
      archive: new TextEncoder().encode('tampered archive'),
    });
    await expect(ensureQdrantBinary(cacheDir, deps)).rejects.toThrow(
      /Qdrant archive SHA-256 mismatch/,
    );
    expect(extractions()).toBe(0);
    expect(existsSync(cacheDir)).toBe(false);
    await expectNoStage();
  });

  it.each([
    [
      'an archive without the executable',
      { extracts: false },
      `${ASSET.name} has no ${ASSET.binaryName}`,
    ],
    [
      'an executable reporting another version',
      { version: 'qdrant 0.0.1' },
      'Unexpected Qdrant version output: "qdrant 0.0.1"',
    ],
  ])('rejects %s, removing the stage', async (_label, options, message) => {
    const { deps } = fakeDeps(options);
    await expect(ensureQdrantBinary(cacheDir, deps)).rejects.toThrow(message);
    expect(existsSync(cacheDir)).toBe(false);
    await expectNoStage();
  });
});
