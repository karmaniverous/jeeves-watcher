/**
 * @module vcs/VcsCoordinator.reconciliation.test
 * Startup deletion reconciliation through the coordinator (#249): the
 * baseline commit records tracked deletions made while stopped, limited to
 * the owning root and the watch scope (globs minus `watch.ignored`).
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { commitAll, commitCount, git, makeTempRepo } from '../test/vcsRepo';
import { VcsCoordinator } from './VcsCoordinator';

const silentLogger = pino({ level: 'silent' });

function makeConfig(
  paths: string[],
  ignored: string[] = [],
): JeevesWatcherConfig {
  return {
    vcs: { enabled: true, commitThrottleMs: 60000, maxBatchSize: 1000 },
    watch: { paths, ignored },
  } as unknown as JeevesWatcherConfig;
}

async function seed(files: string[]): Promise<void> {
  for (const f of files) {
    await mkdir(resolve(f, '..'), { recursive: true });
    await writeFile(f, 'x', 'utf8');
  }
}

describe('VcsCoordinator startup deletion reconciliation (#249)', () => {
  let root: string;

  beforeEach(async () => {
    root = resolve(await makeTempRepo('vcs-coord-recon-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('commits in-scope deletions and leaves out-of-glob and ignored deletions', async () => {
    const inScope = join(root, 'sub', 'gone.txt');
    const outOfGlob = join(root, 'gone.md');
    const ignoredFile = join(root, 'sub', 'ignored', 'gone.txt');
    const survivor = join(root, 'keep.txt');
    await seed([inScope, outOfGlob, ignoredFile, survivor]);
    await commitAll(root, 'initial');
    // Deleted while the watcher was not running
    for (const f of [inScope, outOfGlob, ignoredFile]) await rm(f);

    const coordinator = new VcsCoordinator(
      makeConfig([`${root}/**/*.txt`], ['**/ignored/**']),
      silentLogger,
    );
    await coordinator.start();
    // The initial scan emits only `add` for surviving files
    coordinator.onFileChange(survivor, 'add');
    await coordinator.onInitialScanComplete();
    await coordinator.stop();

    expect(await commitCount(root)).toBe(2);
    expect(await git(root, 'log', '-1', '--format=%s')).toContain('baseline:');
    const tracked = await git(root, 'ls-files');
    expect(tracked).not.toContain('sub/gone.txt');
    expect(tracked).toContain('gone.md');
    expect(tracked).toContain('sub/ignored/gone.txt');
    expect(tracked).toContain('keep.txt');
  });

  it('reconciles every root in its own repo', async () => {
    const other = resolve(await makeTempRepo('vcs-coord-recon-b-'));
    try {
      await seed([join(root, 'a.txt'), join(other, 'b.txt')]);
      await commitAll(root, 'a');
      await commitAll(other, 'b');
      await rm(join(root, 'a.txt'));
      await rm(join(other, 'b.txt'));

      const coordinator = new VcsCoordinator(
        makeConfig([root, other]),
        silentLogger,
      );
      await coordinator.start();
      await coordinator.onInitialScanComplete();
      await coordinator.stop();

      for (const repo of [root, other]) {
        expect(await commitCount(repo)).toBe(2);
        expect(await git(repo, 'ls-files')).toBe('');
      }
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });
});
