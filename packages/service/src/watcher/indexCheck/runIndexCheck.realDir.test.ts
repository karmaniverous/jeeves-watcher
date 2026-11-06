/**
 * @module watcher/indexCheck/runIndexCheck.realDir.test
 * The index check's default `lstat` checks on a real directory (D197): a gone file is deleted, one on disk is kept, a missing root is skipped.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runIndexCheck } from './runIndexCheck';
import { file, kept, PAD, setup } from './runIndexCheck.fixtures';

describe('runIndexCheck on a real directory (default lstat checks)', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('deletes a file that is gone, keeps one on disk, and skips a missing root', async () => {
    dir = await mkdtemp(join(tmpdir(), 'index-check-'));
    await writeFile(join(dir, 'here.md'), 'x');
    const missingRoot = `${dir}-missing`;
    const pads = [kept(dir), kept(join(dir, 'sub'))];
    const s = setup({
      roots: [dir, missingRoot],
      inventory: pads.flatMap((p) => p.paths),
      payloads: [
        ...pads.flatMap((p) => p.payloads),
        file(join(dir, 'here.md')),
        file(join(dir, 'gone.md')),
        file(join(missingRoot, 'a.md')),
      ],
    });
    delete s.deps.isGone;
    delete s.deps.rootGone;
    s.deps.platform = process.platform;
    await runIndexCheck(s.deps);
    expect(s.calls).toEqual([
      `vcs unlink ${join(dir, 'gone.md')}`,
      `delete ${join(dir, 'gone.md')}`,
    ]);
    expect(s.health.snapshot()).toMatchObject({
      checked: 2 * PAD + 2,
      removed: 1,
      skippedRoots: 1,
    });
  });
});
