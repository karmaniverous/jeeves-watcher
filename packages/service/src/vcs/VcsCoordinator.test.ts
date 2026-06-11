/**
 * @module vcs/VcsCoordinator.test
 * Tests for VcsCoordinator routing and lifecycle.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { VcsCoordinator } from './VcsCoordinator';
import { VcsManager } from './VcsManager';

const execFileAsync = promisify(execFile);
const silentLogger = pino({ level: 'silent' });

/**
 * Count commits in the repo. Returns 0 for repos with no commits.
 */
async function commitCount(cwd: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-list', '--count', 'HEAD'],
      { cwd },
    );
    return parseInt(stdout.trim(), 10);
  } catch {
    return 0;
  }
}

describe('VcsCoordinator', () => {
  let rootA: string;
  let rootB: string;

  beforeEach(async () => {
    rootA = await mkdtemp(join(tmpdir(), 'vcs-coord-a-'));
    rootB = await mkdtemp(join(tmpdir(), 'vcs-coord-b-'));

    // Initialize git repos
    for (const root of [rootA, rootB]) {
      await VcsManager.initRepo(root);
      await execFileAsync('git', ['config', 'user.email', 'test@test.com'], {
        cwd: root,
      });
      await execFileAsync('git', ['config', 'user.name', 'Test'], {
        cwd: root,
      });
    }
  });

  afterEach(async () => {
    await rm(rootA, { recursive: true, force: true });
    await rm(rootB, { recursive: true, force: true });
  });

  function makeConfig(roots: string[]): JeevesWatcherConfig {
    return {
      vcs: {
        enabled: true,
        commitDebounceMs: 60000,
        maxBatchSize: 1000,
      },
      watch: {
        paths: roots,
        ignored: [],
      },
    } as unknown as JeevesWatcherConfig;
  }

  it('routes file changes to the correct root manager', async () => {
    const config = makeConfig([rootA, rootB]);
    const coordinator = new VcsCoordinator(config, silentLogger);
    coordinator.start();

    // Write files to both roots
    const fileA = join(resolve(rootA), 'a.txt');
    const fileB = join(resolve(rootB), 'b.txt');
    await writeFile(fileA, 'content A', 'utf8');
    await writeFile(fileB, 'content B', 'utf8');

    coordinator.onFileChange(fileA, 'add');
    coordinator.onFileChange(fileB, 'change');

    await coordinator.stop();

    // Each root should have exactly one commit
    for (const root of [rootA, rootB]) {
      expect(await commitCount(root)).toBe(1);
      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: root },
      );
      expect(stdout).toContain('1 files');
    }
  });

  it('ignores files that do not match any root', async () => {
    const config = makeConfig([rootA]);
    const coordinator = new VcsCoordinator(config, silentLogger);
    coordinator.start();

    // A file outside all roots — should be silently ignored
    coordinator.onFileChange('/nonexistent/path/file.txt', 'add');

    await coordinator.stop();

    // Root A should have no commits
    expect(await commitCount(rootA)).toBe(0);
  });

  it('does not create managers when VCS is disabled', async () => {
    const config = {
      vcs: { enabled: false, commitDebounceMs: 5000, maxBatchSize: 1000 },
      watch: { paths: [rootA], ignored: [] },
    } as unknown as JeevesWatcherConfig;

    const coordinator = new VcsCoordinator(config, silentLogger);
    coordinator.start();

    const fileA = join(resolve(rootA), 'a.txt');
    await writeFile(fileA, 'content', 'utf8');
    coordinator.onFileChange(fileA, 'add');

    await coordinator.stop();

    // No commits should exist
    expect(await commitCount(rootA)).toBe(0);
  });

  it('handles unlink events by staging deletions', async () => {
    const config = makeConfig([rootA]);
    const coordinator = new VcsCoordinator(config, silentLogger);
    coordinator.start();

    // Create and commit a file first
    const filePath = join(resolve(rootA), 'to-remove.txt');
    await writeFile(filePath, 'remove me', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: rootA });
    await execFileAsync('git', ['commit', '-m', 'add file'], { cwd: rootA });

    // Delete from disk and notify
    await rm(filePath);
    coordinator.onFileChange(filePath, 'unlink');

    await coordinator.stop();

    // Should have a second commit removing the file
    expect(await commitCount(rootA)).toBe(2);
  });

  it('stop flushes all pending changes', async () => {
    const config = makeConfig([rootA, rootB]);
    const coordinator = new VcsCoordinator(config, silentLogger);
    coordinator.start();

    // Add files to both roots without flushing
    const fileA = join(resolve(rootA), 'pending-a.txt');
    const fileB = join(resolve(rootB), 'pending-b.txt');
    await writeFile(fileA, 'pending A', 'utf8');
    await writeFile(fileB, 'pending B', 'utf8');
    coordinator.onFileChange(fileA, 'add');
    coordinator.onFileChange(fileB, 'add');

    // Stop should flush both
    await coordinator.stop();

    for (const root of [rootA, rootB]) {
      expect(await commitCount(root)).toBe(1);
    }
  });
});
