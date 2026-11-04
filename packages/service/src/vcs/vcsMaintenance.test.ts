/**
 * @module vcs/vcsMaintenance.test
 * Startup and scheduled maintenance (D66, D167, D178): temp-file listing, the hour-old sweep, the post-kill stability check, the branch-state warning (never a checkout), and the hourly sweep under the lock.
 */

import { mkdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  commitAll,
  git,
  makeFastVcsConfig,
  makeTempRepo,
} from '../test/vcsRepo';
import { RootGitLock } from './RootGitLock';
import {
  cleanTempFilesAfterKill,
  listTempFiles,
  sweepTempFiles,
} from './tempFiles';
import { untrackMarkerPath } from './untrackPending';
import {
  runStartupMaintenance,
  sweepOnSchedule,
  warnBranchState,
} from './vcsMaintenance';

let repo: string;

/** Create a temp object file, optionally backdated by `ageMs`. */
async function tempFile(rel: string, ageMs = 0): Promise<string> {
  const path = join(repo, '.git', 'objects', rel);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, 'partial');
  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs);
    await utimes(path, when, when);
  }
  return path;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

beforeEach(async () => {
  repo = await makeTempRepo('vcs-maint-');
  await writeFile(join(repo, 'a.md'), 'a');
  await commitAll(repo, 'seed');
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(repo, { recursive: true, force: true });
});

describe('temp files (D66)', () => {
  it('lists tmp_pack_, tmp_idx_, tmp_obj_ and tmp_objdir- entries only', async () => {
    const found = [
      await tempFile('pack/tmp_pack_abc'),
      await tempFile('pack/tmp_idx_abc'),
      await tempFile('ab/tmp_obj_xyz'),
      await tempFile('tmp_objdir-123/x'),
    ];
    await tempFile('pack/pack-real.pack');

    const listed = await listTempFiles(repo);

    expect(listed.sort()).toEqual(
      [
        ...found.slice(0, 3),
        join(repo, '.git', 'objects', 'tmp_objdir-123'),
      ].sort(),
    );
  });

  it('sweeps entries untouched for over an hour and keeps fresh ones', async () => {
    const stale = await tempFile('pack/tmp_pack_old', 2 * 3_600_000);
    const fresh = await tempFile('pack/tmp_pack_new');

    expect(await sweepTempFiles(repo)).toEqual([stale]);
    expect(await exists(fresh)).toBe(true);
  });

  it('after a kill, deletes a new temp file that stopped changing and keeps one still growing', async () => {
    const before = await tempFile('pack/tmp_pack_before');
    const snapshot = new Set(await listTempFiles(repo));
    const stalled = await tempFile('pack/tmp_pack_stalled');
    const growing = await tempFile('pack/tmp_pack_growing');
    const grow = setInterval(() => {
      void writeFile(growing, `more ${String(Date.now())}`);
    }, 20);

    const deleted = await cleanTempFilesAfterKill(repo, snapshot, 300).finally(
      () => {
        clearInterval(grow);
      },
    );

    expect(deleted).toEqual([stalled]);
    expect(await exists(growing)).toBe(true);
    expect(await exists(before)).toBe(true);
  });
});

describe('warnBranchState (D167)', () => {
  it('stays quiet on the configured branch with no orphan branches', async () => {
    const logger = pino({ level: 'silent' });
    const warn = vi.spyOn(logger, 'warn');

    await warnBranchState(repo, 'master', logger);

    expect(warn).not.toHaveBeenCalled();
  });

  it('warns about a detached HEAD and a leftover orphan branch without switching', async () => {
    await git(repo, 'branch', '__squash_orphan_1700000000');
    await git(repo, 'checkout', '-q', '--detach');
    const logger = pino({ level: 'silent' });
    const warn = vi.spyOn(logger, 'warn');

    await warnBranchState(repo, 'master', logger);

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        root: repo,
        head: '(detached)',
        orphanBranches: ['__squash_orphan_1700000000'],
      }),
      expect.stringContaining('never switches branches'),
    );
    expect(
      (await git(repo, 'status', '--porcelain=v2', '--branch')).split('\n')[1],
    ).toBe('# branch.head (detached)');
  });

  it('warns on the configured branch when an orphan branch is left, and on another branch', async () => {
    const logger = pino({ level: 'silent' });
    const warn = vi.spyOn(logger, 'warn');

    await git(repo, 'branch', '__squash_orphan_1700000000');
    await warnBranchState(repo, 'master', logger);
    expect(warn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        head: 'master',
        orphanBranches: ['__squash_orphan_1700000000'],
      }),
      expect.any(String),
    );

    await git(repo, 'branch', '-D', '-q', '__squash_orphan_1700000000');
    await git(repo, 'checkout', '-q', '-b', 'other');
    await warnBranchState(repo, 'master', logger);
    expect(warn).toHaveBeenLastCalledWith(
      expect.objectContaining({ head: 'other', orphanBranches: [] }),
      expect.any(String),
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('runStartupMaintenance', () => {
  it('sweeps stale temp files, recovers the untrack marker and keeps HEAD', async () => {
    const stale = await tempFile('pack/tmp_pack_old', 2 * 3_600_000);
    await writeFile(
      untrackMarkerPath(repo),
      JSON.stringify({ oldHead: 'x', newCommit: '0'.repeat(40), paths: [] }),
    );
    const head = await git(repo, 'rev-parse', 'HEAD');

    await runStartupMaintenance(
      repo,
      makeFastVcsConfig(),
      pino({ level: 'silent' }),
    );

    expect(await exists(stale)).toBe(false);
    expect(await exists(untrackMarkerPath(repo))).toBe(false);
    expect(await git(repo, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('logs an in-progress operation', async () => {
    await mkdir(join(repo, '.git', 'rebase-merge'));
    const logger = pino({ level: 'silent' });
    const error = vi.spyOn(logger, 'error');

    await runStartupMaintenance(repo, makeFastVcsConfig(), logger);

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ root: repo, marker: 'rebase-merge' }),
      expect.stringContaining('Stale in-progress git operation'),
    );
  });
});

describe('sweepOnSchedule', () => {
  it('sweeps under the lock on each interval', async () => {
    const stale = await tempFile('pack/tmp_pack_old', 2 * 3_600_000);
    const logger = pino({ level: 'silent' });
    const lock = new RootGitLock(repo, logger);
    const run = vi.spyOn(lock, 'run');

    const timer = sweepOnSchedule(repo, lock, logger, 50);
    try {
      await vi.waitFor(async () => {
        expect(await exists(stale)).toBe(false);
      });
    } finally {
      clearInterval(timer);
    }
    expect(run).toHaveBeenCalledWith('sweep', expect.any(Function));
  });
});
