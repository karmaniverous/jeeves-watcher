/**
 * @module test/qdrant/binary.test
 * startBinaryQdrant failure paths with real child processes: an executable that exits before ready rejects with its exit code and output tail, a missing executable rejects with the spawn error, and neither leaves its temp dir behind.
 */

import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startBinaryQdrant } from './binary';

/** The binary's temp dirs currently in the OS temp dir. */
async function qdrantTempDirs(): Promise<Set<string>> {
  const entries = await readdir(tmpdir());
  return new Set(entries.filter((e) => e.startsWith('jeeves-watcher-qdrant-')));
}

/** Expect no temp dir created since `before` to remain. */
async function expectNoNewTempDir(before: Set<string>): Promise<void> {
  const leaked = [...(await qdrantTempDirs())].filter((d) => !before.has(d));
  expect(leaked).toEqual([]);
}

describe('startBinaryQdrant failures', () => {
  let scriptDir: string;
  let failingScript: string;

  beforeAll(async () => {
    scriptDir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-binary-test-'));
    failingScript = join(scriptDir, 'fail.cjs');
    await writeFile(
      failingScript,
      "process.stderr.write('qdrant cannot start\\n'); process.exit(1);\n",
    );
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(scriptDir, { recursive: true, force: true });
  });

  it('rejects with the exit code and output tail when the process exits early', async () => {
    // Node stands in for Qdrant; the child inherits NODE_OPTIONS, so it runs
    // the failing script before anything else.
    // Forward slashes: NODE_OPTIONS treats a backslash in quotes as an escape.
    const script = failingScript.replaceAll('\\', '/');
    vi.stubEnv('NODE_OPTIONS', `--require "${script}"`);
    const before = await qdrantTempDirs();
    const error = await startBinaryQdrant(process.execPath).then(
      () => undefined,
      (e: unknown) => e,
    );
    vi.unstubAllEnvs();

    expect(error).toBeInstanceOf(Error);
    const { message } = error as Error;
    expect(message).toMatch(/not ready: process exited with code 1/);
    expect(message).toContain('--- qdrant output ---\nqdrant cannot start');
    await expectNoNewTempDir(before);
  });

  it('rejects with the spawn error for a missing executable', async () => {
    const before = await qdrantTempDirs();
    await expect(
      startBinaryQdrant(join(scriptDir, 'no-such-qdrant')),
    ).rejects.toThrow(/not ready: spawn .*ENOENT/);
    await expectNoNewTempDir(before);
  });
});
