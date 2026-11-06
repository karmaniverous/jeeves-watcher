/**
 * @module watcher/FileSystemWatcher.parcel.vcs.heavy.test
 * Version control with the real `@parcel/watcher` (D129, D146, D152): on Linux, a 1,000-file tree with nested folders moved into a watched root, a later write into a nested folder and a rename inside it are all indexed after the next renew-and-reconcile and committed by a real VcsManager, the rename recorded by git as a rename; on Linux and Windows, the watcher's own 20,000-file commit adds nothing to the queue with `watch.ignored` lacking `**\/.git/**`. In the serial `heavy` vitest project. Writes temp files and runs git.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import { git, makeFastVcsConfig } from '../test/vcsRepo';
import {
  eventsOf as of,
  startWatcherHarness,
  waitFor,
  type WatcherHarness,
} from '../test/watcherHarness';
import { VcsManager } from '../vcs/VcsManager';

const execFileAsync = promisify(execFile);
const linux = process.platform === 'linux';

/** Files in the moved-in tree (spec: 1,000). */
const TREE = 1000;
/** Files in the watcher's own commit (spec: 20,000). */
const COMMIT = 20_000;

/** Relative path of tree file `i`: two levels of nested folders. */
const treeFile = (i: number) =>
  `n${String(i % 10)}/m${String(i % 3)}/f${String(i)}.md`;

/**
 * Write `count` files under `dir` named by `name`, 500 at a time.
 *
 * @param dir - Parent directory.
 * @param count - How many files.
 * @param name - Relative path of file `i`.
 */
async function writeMany(
  dir: string,
  count: number,
  name: (i: number) => string,
): Promise<void> {
  for (let start = 0; start < count; start += 500) {
    await Promise.all(
      Array.from({ length: Math.min(500, count - start) }, async (_, k) => {
        const path = join(dir, name(start + k));
        await mkdir(join(path, '..'), { recursive: true });
        await writeFile(path, `content ${String(start + k)}`);
      }),
    );
  }
}

describe('FileSystemWatcher (parcel) with version control', () => {
  let harness: WatcherHarness | undefined;
  let manager: VcsManager | undefined;
  let outside: string | undefined;

  afterEach(async () => {
    await manager?.stop().catch(() => undefined);
    manager = undefined;
    await harness?.close();
    harness = undefined;
    if (outside) await rm(outside, { recursive: true, force: true });
    outside = undefined;
  });

  it.runIf(linux)(
    'indexes and commits a moved-in nested tree, a later nested write and a rename after the next renewal (D129, D146)',
    async () => {
      outside = await mkdtemp(join(tmpdir(), 'jeeves-watcher-tree-'));
      await writeMany(join(outside, 'tree'), TREE, treeFile);
      harness = await startWatcherHarness({
        before: async (root) => {
          manager = new VcsManager(
            root,
            makeFastVcsConfig(),
            pino({ level: 'silent' }),
          );
          await manager.start();
          await git(root, 'config', 'user.email', 'test@test.com');
          await git(root, 'config', 'user.name', 'Test');
          manager.endBaseline();
        },
        watch: () => ({ changeSource: 'parcel' }),
        options: () => ({
          getReconcileIntervalMs: () => 3_000,
          onVcsFileChange: (path, event) => {
            if (event === 'unlink') manager!.handleUnlink(path);
            else manager!.fileChanged(path);
          },
        }),
      });
      const h = harness;
      const vcs = manager!;

      // Moved in: the directory-create reconcile finds every file at once.
      await rename(join(outside, 'tree'), join(h.root, 'moved'));
      await waitFor(() => of(h, 'create').length >= TREE, 30_000);
      await vcs.flush();
      expect((await git(h.root, 'ls-files')).trim().split('\n')).toHaveLength(
        TREE,
      );

      // Before the next renewal: a write into a nested folder and a rename
      // inside one. Parcel may not see either until the renewal (D129).
      await writeFile(join(h.root, 'moved', 'n1', 'm1', 'late.md'), 'late');
      await rename(
        join(h.root, 'moved', treeFile(2)),
        join(h.root, 'moved', 'n2', 'm2', 'f2-renamed.md'),
      );
      await waitFor(
        () =>
          of(h, 'create').includes('moved/n1/m1/late.md') &&
          (of(h, 'create').includes('moved/n2/m2/f2-renamed.md') ||
            of(h, 'move').length > 0),
        20_000,
      );
      // The rename's old path leaves the index (a delete, or a move).
      await waitFor(
        () =>
          of(h, 'delete').includes(`moved/${treeFile(2)}`) ||
          of(h, 'move').length > 0,
        20_000,
      );
      await vcs.flush();

      const tracked = (await git(h.root, 'ls-files')).trim().split('\n');
      expect(tracked).toHaveLength(TREE + 1);
      expect(tracked).toContain('moved/n1/m1/late.md');
      expect(tracked).toContain('moved/n2/m2/f2-renamed.md');
      expect(tracked).not.toContain(`moved/${treeFile(2)}`);
      const follow = await git(
        h.root,
        'log',
        '--follow',
        '-M',
        '--name-status',
        '--format=',
        '--',
        'moved/n2/m2/f2-renamed.md',
      );
      expect(follow).toMatch(
        new RegExp(
          `^R\\d+\\s+moved/${treeFile(2)}\\s+moved/n2/m2/f2-renamed\\.md$`,
          'm',
        ),
      );
    },
    120_000,
  );

  it("adds nothing to the queue for the watcher's own 20,000-file commit, without **/.git/** in watch.ignored (D152)", async () => {
    harness = await startWatcherHarness({
      before: async (root) => {
        await git(root, 'init', '-q');
        await writeMany(
          root,
          COMMIT,
          (i) => `c${String(i % 20)}/f${String(i)}.md`,
        );
      },
      watch: () => ({ changeSource: 'parcel', ignored: [] }),
    });
    const h = harness;
    await waitFor(() => h.events.length >= COMMIT, 120_000);
    const before = h.events.length;
    expect(before).toBe(COMMIT);

    const gitArgs = [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      '-c',
      'commit.gpgsign=false',
    ];
    await execFileAsync('git', [...gitArgs, 'add', '-A'], {
      cwd: h.root,
      maxBuffer: 64 * 1024 * 1024,
    });
    await execFileAsync('git', [...gitArgs, 'commit', '-q', '-m', 'bulk'], {
      cwd: h.root,
      maxBuffer: 64 * 1024 * 1024,
    });
    expect((await git(h.root, 'rev-list', '--count', 'HEAD')).trim()).toBe('1');
    // Well past the stability window: anything the commit caused is in.
    await sleep(3_000);
    expect(h.events).toHaveLength(before);
    expect(h.seen().filter((s) => s.includes('.git/'))).toEqual([]);
  }, 300_000);
});
