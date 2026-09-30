/**
 * @module vcs/VcsManager.staging.test
 * What a VcsManager commit records (#249): empty batches are no-ops,
 * missing paths never fail a batch, startup reconciliation records
 * deletions made while stopped, and stale git operations are reported.
 * All tests run real git against temp repos.
 */

import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  commitAll,
  commitCount,
  countCalls,
  git,
  type LogSpy,
  makeTempRepo,
  makeVcsConfig,
} from '../test/vcsRepo';
import { VcsManager } from './VcsManager';

describe('VcsManager staging (#249)', () => {
  let tempDir: string;
  let manager: VcsManager | undefined;

  /** Start a manager past baseline with spied logger methods. */
  async function startManager(): Promise<{
    info: LogSpy;
    error: LogSpy;
  }> {
    const logger = pino({ level: 'silent' });
    const info = vi.spyOn(logger, 'info');
    const error = vi.spyOn(logger, 'error');
    manager = new VcsManager(tempDir, makeVcsConfig(), logger);
    await manager.start();
    manager.endBaseline();
    return { info, error };
  }

  beforeEach(async () => {
    tempDir = await makeTempRepo('vcs-staging-');
    manager = undefined;
  });

  afterEach(async () => {
    await manager?.stop();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('no-op detection', () => {
    it('treats an unchanged file with untracked noise outside the batch as a no-op', async () => {
      const file = join(tempDir, 'a.txt');
      await writeFile(file, 'a', 'utf8');
      await commitAll(tempDir, 'initial');
      await writeFile(join(tempDir, 'noise.pdf'), 'noise', 'utf8');
      const spies = await startManager();

      manager?.fileChanged(file);
      await manager?.flush();

      expect(spies.info).toHaveBeenCalledWith(
        expect.objectContaining({ root: tempDir }),
        'VCS commit skipped — nothing staged',
      );
      expect(countCalls(spies.error, 'VCS commit failed')).toBe(0);
      expect(manager?.breakerState.consecutiveFailures).toBe(0);
      expect(await commitCount(tempDir)).toBe(1);
    });

    it('treats an unchanged file with an unstaged tracked deletion outside the batch as a no-op', async () => {
      const a = join(tempDir, 'a.txt');
      const b = join(tempDir, 'b.txt');
      await writeFile(a, 'a', 'utf8');
      await writeFile(b, 'b', 'utf8');
      await commitAll(tempDir, 'initial');
      await rm(b); // never reported to the manager
      const spies = await startManager();

      manager?.fileChanged(a);
      await manager?.flush();

      expect(countCalls(spies.error, 'VCS commit failed')).toBe(0);
      expect(await commitCount(tempDir)).toBe(1);
      // The unreported deletion stays unstaged: out of this batch's scope.
      expect(await git(tempDir, 'ls-files')).toContain('b.txt');
    });
  });

  describe('missing paths in a batch', () => {
    it('drops a vanished untracked path and still commits the rest', async () => {
      const spies = await startManager();
      const real = join(tempDir, 'real.txt');
      await writeFile(real, 'real', 'utf8');
      // Never tracked, and its directory is gone too (ENOENT)
      manager?.fileChanged(join(tempDir, 'gone-dir', 'ghost.json'));
      manager?.fileChanged(real);
      await manager?.flush();

      expect(countCalls(spies.error, 'VCS commit failed')).toBe(0);
      expect(await git(tempDir, 'ls-files')).toBe('real.txt\n');
      expect(manager?.breakerState.pendingCount).toBe(0);
    });

    it('records the deletion of a tracked path alongside other changes', async () => {
      const doomed = join(tempDir, 'doomed.txt');
      await writeFile(doomed, 'bye', 'utf8');
      await commitAll(tempDir, 'initial');
      const spies = await startManager();

      await rm(doomed);
      const added = join(tempDir, 'added.txt');
      await writeFile(added, 'hi', 'utf8');
      manager?.handleUnlink(doomed);
      manager?.fileChanged(added);
      await manager?.flush();

      expect(countCalls(spies.error, 'VCS commit failed')).toBe(0);
      expect(await commitCount(tempDir)).toBe(2);
      expect(await git(tempDir, 'ls-files')).toBe('added.txt\n');
      expect(await git(tempDir, 'status', '--porcelain')).toBe('');
    });

    it('commits a batch that is only a deletion', async () => {
      const doomed = join(tempDir, 'only.txt');
      await writeFile(doomed, 'x', 'utf8');
      await writeFile(join(tempDir, 'stay.txt'), 'x', 'utf8');
      await commitAll(tempDir, 'initial');
      await startManager();

      await rm(doomed);
      manager?.handleUnlink(doomed);
      await manager?.flush();

      expect(await commitCount(tempDir)).toBe(2);
      expect(
        (
          await git(tempDir, 'show', '--name-status', '--format=', 'HEAD')
        ).trim(),
      ).toMatch(/^D\s+only\.txt$/);
    });
  });

  describe('startup deletion reconciliation', () => {
    it('queues in-scope tracked deletions and the baseline commit records them', async () => {
      await mkdir(join(tempDir, 'sub'));
      await writeFile(join(tempDir, 'keep.txt'), 'keep', 'utf8');
      await writeFile(join(tempDir, 'sub', 'gone.txt'), 'gone', 'utf8');
      await writeFile(join(tempDir, 'other.md'), 'md', 'utf8');
      await commitAll(tempDir, 'initial');
      // Deleted while the watcher wasn't running
      await rm(join(tempDir, 'sub', 'gone.txt'));
      await rm(join(tempDir, 'other.md'));

      manager = new VcsManager(
        tempDir,
        makeVcsConfig(),
        pino({ level: 'silent' }),
      );
      await manager.start();
      await manager.reconcileDeletions((p) => p.endsWith('.txt'));
      expect(manager.breakerState.pendingCount).toBe(1);
      await manager.flush();

      expect(await git(tempDir, 'log', '-1', '--format=%s')).toContain(
        'baseline:',
      );
      const tracked = await git(tempDir, 'ls-files');
      expect(tracked).not.toContain('sub/gone.txt');
      expect(tracked).toContain('keep.txt');
      // Out-of-scope deletion is left alone
      expect(tracked).toContain('other.md');
    });

    it('logs and continues when the index cannot be read', async () => {
      const logger = pino({ level: 'silent' });
      const warnSpy = vi.spyOn(logger, 'warn');
      manager = new VcsManager(tempDir, makeVcsConfig(), logger);
      await manager.start();
      await writeFile(join(tempDir, '.git', 'index'), 'not an index', 'utf8');

      await expect(
        manager.reconcileDeletions(() => true),
      ).resolves.toBeUndefined();

      expect(countCalls(warnSpy, 'deletion reconciliation failed')).toBe(1);
      expect(manager.breakerState.pendingCount).toBe(0);
    });
  });

  describe('stale git operation on start', () => {
    it('reports (and never clears) an abandoned cherry-pick sequencer', async () => {
      const sequencer = join(tempDir, '.git', 'sequencer');
      await mkdir(sequencer);
      const logger = pino({ level: 'silent' });
      const errorSpy = vi.spyOn(logger, 'error');
      manager = new VcsManager(tempDir, makeVcsConfig(), logger);
      await manager.start();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ root: tempDir, marker: 'sequencer' }),
        expect.stringContaining('Stale in-progress git operation detected'),
      );
      await expect(access(sequencer)).resolves.toBeUndefined();
    });
  });
});
