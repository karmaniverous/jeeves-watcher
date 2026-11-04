/**
 * @module vcs/SquashManager.plumbing.test
 * D166 plumbing details of the squash rewrite: untracked-but-present files survive byte for byte, messages are kept byte for byte, identities and timezones are kept, the reflog names the squash, skewed dates and races are safe, and the tree check stops a bad rewrite. Real git against temp repos.
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { VcsConfig } from '@karmaniverous/jeeves-watcher-core';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { execFileAsync } from '../test/git';
import {
  createCommit,
  createSquashableHistory,
  daysAgo,
  initTestRepo,
  makeRetention,
  makeSquashManager,
} from '../test/squashRepo';
import { parseRawCommit } from './squashPlumbing';
import { VcsManager } from './VcsManager';

const silentLogger = pino({ level: 'silent' });

let tempDir: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: tempDir });
  return stdout.trim();
}

/** Raw commit object bytes. */
function catCommit(hash: string): Buffer {
  return spawnSync('git', ['cat-file', 'commit', hash], { cwd: tempDir })
    .stdout;
}

/**
 * Commit the current index on HEAD with an exact message and identities
 * (`commit-tree -F -`), then move the branch.
 */
async function rawCommit(
  message: Buffer,
  author: string,
  authorDate: string,
  committerDate: string,
): Promise<string> {
  const tree = await git('write-tree');
  const parent = await git('rev-parse', 'HEAD');
  const [name, email] = author.split('|');
  const result = spawnSync(
    'git',
    ['commit-tree', tree, '-p', parent, '-F', '-'],
    {
      cwd: tempDir,
      input: message,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: name,
        GIT_AUTHOR_EMAIL: email,
        GIT_AUTHOR_DATE: authorDate,
        GIT_COMMITTER_NAME: `${name} (committer)`,
        GIT_COMMITTER_EMAIL: email,
        GIT_COMMITTER_DATE: committerDate,
      },
    },
  );
  const hash = (result.stdout as Buffer).toString('utf8').trim();
  await git('update-ref', 'HEAD', hash);
  return hash;
}

/** Epoch seconds `days` days ago. */
function epochDaysAgo(days: number): number {
  return Math.floor((Date.now() - days * 86_400_000) / 1000);
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'squash-plumbing-'));
  await initTestRepo(tempDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('SquashManager plumbing rewrite (D166)', () => {
  it('keeps an untracked-but-present file byte-identical and git status unchanged', async () => {
    await createSquashableHistory(tempDir);
    // file2.txt untracked by an exclude: still in history, gone from the
    // index, newest content on disk.
    await writeFile(join(tempDir, 'file2.txt'), 'newest \u00e9 bytes', 'utf8');
    await writeFile(join(tempDir, '.git', 'info', 'exclude'), '/file2.txt\n');
    await git('rm', '--cached', '-q', 'file2.txt');
    await git('commit', '-q', '-m', 'untrack file2');
    const statusBefore = await git('status', '--porcelain', '--ignored');

    const result = await makeSquashManager(
      tempDir,
      makeRetention(),
      silentLogger,
    ).runSquash();

    expect(result.squashed).toBe(true);
    expect(await readFile(join(tempDir, 'file2.txt'), 'utf8')).toBe(
      'newest \u00e9 bytes',
    );
    expect(await git('status', '--porcelain', '--ignored')).toBe(statusBefore);
  }, 30000);

  it.each([
    ['with a trailing newline', 'subject\n\nbody line\n'],
    ['without a trailing newline', 'subject only, no newline'],
    [
      'with blank lines and unicode',
      'caf\u00e9 \u2014 fix\n\n\n  indented\n\n',
    ],
  ])(
    'keeps each retained message byte for byte (%s), with identities and timezones',
    async (_label, text) => {
      await createCommit(tempDir, 'old1.txt', 'a', daysAgo(60));
      await createCommit(tempDir, 'old2.txt', 'b', daysAgo(50));
      await writeFile(join(tempDir, 'new.txt'), 'n', 'utf8');
      await git('add', 'new.txt');
      const original = await rawCommit(
        Buffer.from(text, 'utf8'),
        'Ann \u00c9|ann@example.com',
        `${String(epochDaysAgo(2))} +0530`,
        `${String(epochDaysAgo(1))} -0800`,
      );
      const before = parseRawCommit(catCommit(original));

      expect(
        (
          await makeSquashManager(
            tempDir,
            makeRetention(),
            silentLogger,
          ).runSquash()
        ).squashed,
      ).toBe(true);

      const after = parseRawCommit(catCommit(await git('rev-parse', 'HEAD')));
      expect(after.message.equals(Buffer.from(text, 'utf8'))).toBe(true);
      expect(after.author).toEqual(before.author);
      expect(after.committer).toEqual(before.committer);
      expect(after.tree).toBe(before.tree);
    },
    30000,
  );

  it('records the squash in the reflog', async () => {
    await createSquashableHistory(tempDir);

    await makeSquashManager(tempDir, makeRetention(), silentLogger).runSquash();

    expect(await git('reflog', '-1', '--format=%gs', 'master')).toBe(
      'jeeves-watcher squash',
    );
  }, 30000);

  it('uses first-parent order when author dates are skewed', async () => {
    await createCommit(tempDir, 'a.txt', 'a', daysAgo(60));
    await createCommit(tempDir, 'b.txt', 'b', daysAgo(1));
    // Older author date after a newer one (a clock-skewed machine).
    await createCommit(tempDir, 'c.txt', 'c', daysAgo(90));
    await createCommit(tempDir, 'd.txt', 'd', daysAgo(1));
    const treeBefore = await git('rev-parse', 'HEAD^{tree}');

    const result = await makeSquashManager(
      tempDir,
      makeRetention(),
      silentLogger,
    ).runSquash();

    expect(result).toEqual({
      squashed: true,
      commitsRemoved: 1,
      commitsRetained: 3,
    });
    expect(await git('rev-parse', 'HEAD^{tree}')).toBe(treeBefore);
  }, 30000);

  it('changes nothing when a foreign commit moves the branch mid-squash', async () => {
    await createSquashableHistory(tempDir);
    let foreign = '';
    const manager = makeSquashManager(tempDir, makeRetention(), silentLogger, {
      hooks: {
        beforeUpdateRef: async () => {
          foreign = await createCommit(tempDir, 'foreign.txt', 'f');
        },
      },
    });

    const result = await manager.runSquash();

    expect(result).toEqual({
      squashed: false,
      error: 'Squash skipped: the branch moved during the squash',
    });
    expect(await git('rev-parse', 'master')).toBe(foreign);
  }, 30000);

  it('moves no ref when the tree check fails', async () => {
    await createSquashableHistory(tempDir);
    const tip = await git('rev-parse', 'HEAD');
    const manager = makeSquashManager(tempDir, makeRetention(), silentLogger, {
      hooks: { rebuiltTip: () => git('rev-parse', 'HEAD~1') },
    });

    const result = await manager.runSquash();

    expect(result).toEqual({
      squashed: false,
      error: 'Squash stopped: rebuilt tree differs from the branch tip',
    });
    expect(await git('rev-parse', 'master')).toBe(tip);
  }, 30000);

  it('commits pending changes before rewriting, so continuous writes are never lost', async () => {
    await createSquashableHistory(tempDir);
    const config: VcsConfig = {
      enabled: true,
      commitThrottleMs: 60_000,
      maxBatchSize: 1000,
      staleLockThresholdMs: 60_000,
      maxConsecutiveFailures: 5,
      circuitBreakerCooldownMs: 300_000,
      branch: 'master',
      retention: makeRetention(),
    };
    const manager = new VcsManager(tempDir, config, silentLogger);
    await manager.start();
    manager.endBaseline();
    const file = join(tempDir, 'written-during.txt');
    await writeFile(file, 'pending', 'utf8');
    manager.fileChanged(file);

    const result = await manager.runSquash();
    await manager.stop();

    expect(result?.squashed).toBe(true);
    expect(await git('show', 'HEAD:written-during.txt')).toBe('pending');
    expect(await git('status', '--porcelain')).toBe('');
  }, 30000);
});
