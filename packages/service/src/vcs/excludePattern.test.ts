/**
 * @module vcs/excludePattern.test
 * The exclude's git work under RootGitLock (D71, D102, D178): the push follows the untrack commit in the same hold; a lock busy past the wait gives up with nothing written; a leftover untrack marker is finished first; a second CAS failure removes the appended line and writes nothing; a crash after the reference update keeps the line for recovery; an exclude queued behind a batch runs after it (FIFO). Real git.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { JeevesWatcherConfig } from '@karmaniverous/jeeves-watcher-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { silentLogger } from '../test/vcsHandlers';
import { commitAll, git, makeTempRepo } from '../test/vcsRepo';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { ConfirmRequiredError, runExclude } from './excludePattern';
import { LockWaitTimeoutError } from './RootGitLock';
import { untrackMarkerPath } from './untrackPending';
import { VcsCoordinator } from './VcsCoordinator';
import type { VcsManager } from './VcsManager';

let repo: string;
let manager: VcsManager;
const cleanup: string[] = [];

const g = async (...args: string[]) => (await git(repo, ...args)).trim();
const excludeText = () =>
  readFile(join(repo, '.git', 'info', 'exclude'), 'utf8');
const exists = (path: string) =>
  readFile(path).then(
    () => true,
    () => false,
  );

const request = (
  overrides: Partial<Parameters<typeof runExclude>[1]> = {},
) => ({
  pattern: '/a.tmp',
  relativeGlob: 'a.tmp',
  remove: false,
  confirm: false,
  ...overrides,
});

function managerFor(root: string, remote?: string): VcsManager {
  const config = {
    vcs: { enabled: true, commitThrottleMs: 60000, maxBatchSize: 1000 },
    watch: {
      paths: [remote ? { path: root, vcs: { remote } } : root],
      ignored: [],
    },
  } as unknown as JeevesWatcherConfig;
  const found = new VcsCoordinator(config, silentLogger).getManager(root);
  if (!found) throw new Error('no manager');
  return found;
}

beforeEach(async () => {
  repo = normalizeSlashes(await makeTempRepo('exclude-pattern-'));
  cleanup.push(repo);
  await writeFile(join(repo, 'a.tmp'), 'a');
  await writeFile(join(repo, 'keep.md'), 'k');
  await commitAll(repo, 'seed');
  await writeFile(join(repo, '.git', 'info', 'exclude'), '', 'utf8');
  manager = managerFor(repo);
});

afterEach(async () => {
  for (const dir of cleanup.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('runExclude', { timeout: 20_000 }, () => {
  it('pushes the untrack commit in the same hold', async () => {
    const bare = normalizeSlashes(
      await mkdtemp(join(tmpdir(), 'exclude-bare-')),
    );
    cleanup.push(bare);
    await git(bare, 'init', '-q', '--bare');
    manager = managerFor(repo, bare);
    const branch = await g('rev-parse', '--abbrev-ref', 'HEAD');

    await runExclude(manager, request(), silentLogger);

    expect((await git(bare, 'rev-parse', branch)).trim()).toBe(
      await g('rev-parse', 'HEAD'),
    );
  });

  it('gives up when the lock stays busy past the wait, writing nothing', async () => {
    let release!: () => void;
    const held = manager.lock.run(
      'commit',
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const head = await g('rev-parse', 'HEAD');

    await expect(
      runExclude(manager, request(), silentLogger, 50),
    ).rejects.toBeInstanceOf(LockWaitTimeoutError);

    expect(await excludeText()).toBe('');
    expect(await g('rev-parse', 'HEAD')).toBe(head);
    release();
    await held;
  });

  it('runs after a batch that holds the lock (FIFO)', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = manager.lock.run('commit', async () => {
      await gate;
      order.push('commit');
    });
    const excluded = runExclude(manager, request(), silentLogger).then(() => {
      order.push('exclude');
    });

    release();
    await Promise.all([held, excluded]);
    expect(order).toEqual(['commit', 'exclude']);
  });
  it('finishes a leftover untrack marker before its own work (D178)', async () => {
    await expect(
      runExclude(
        manager,
        request({
          hooks: { afterUpdateRef: () => Promise.reject(new Error('crash')) },
        }),
        silentLogger,
      ),
    ).rejects.toThrow('crash');
    expect(await exists(untrackMarkerPath(repo))).toBe(true);
    expect(await excludeText()).toBe('/a.tmp\n');

    await runExclude(
      manager,
      request({ pattern: '/none', relativeGlob: 'none' }),
      silentLogger,
    );

    expect(await exists(untrackMarkerPath(repo))).toBe(false);
    expect(await g('ls-files')).toBe('keep.md');
  });

  it('removes its line and writes nothing when the CAS fails twice', async () => {
    const head = await g('rev-parse', 'HEAD');
    let n = 0;
    const foreign = async () => {
      n++;
      await writeFile(join(repo, `f${String(n)}.md`), 'f');
      await g('add', `f${String(n)}.md`);
      await g('commit', '-q', '-m', `foreign ${String(n)}`);
    };

    await expect(
      runExclude(
        manager,
        request({ hooks: { beforeUpdateRef: foreign } }),
        silentLogger,
      ),
    ).rejects.toThrow();

    expect(await excludeText()).toBe('');
    expect(await g('rev-parse', 'HEAD~2')).toBe(head);
    expect(await g('ls-files')).toContain('a.tmp');
  });

  it('keeps a line that was there before a refused call', async () => {
    await writeFile(join(repo, '.git', 'info', 'exclude'), '/a.tmp\n', 'utf8');

    await expect(
      runExclude(
        manager,
        request({
          hooks: {
            beforeUpdateRef: () => Promise.reject(new Error('boom')),
          },
        }),
        silentLogger,
      ),
    ).rejects.toThrow('boom');

    expect(await excludeText()).toBe('/a.tmp\n');
  });

  it('carries the count on ConfirmRequiredError', () => {
    expect(new ConfirmRequiredError('/x', 101)).toMatchObject({
      name: 'ConfirmRequiredError',
      pattern: '/x',
      untracked: 101,
    });
  });
});
