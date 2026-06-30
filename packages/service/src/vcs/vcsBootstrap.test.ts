/**
 * @module vcs/vcsBootstrap.test
 * Tests for bootstrap utilities: checkGitAvailable, initRepo, ensureGitignore.
 */

import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execFileAsync } from './gitExec';
import {
  checkGitAvailable,
  configureRepoIdentity,
  detectAndRecoverOrphanBranch,
  ensureGitignore,
  initRepo,
} from './vcsBootstrap';

const silentLogger = pino({ level: 'silent' });

// ─── checkGitAvailable ───

describe('checkGitAvailable', () => {
  it('returns true when git is available', async () => {
    const result = await checkGitAvailable();
    expect(result).toBe(true);
  });
});

// ─── initRepo ───

describe('initRepo', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vcs-init-'));
  });

  it('initializes a git repo in an empty directory', async () => {
    await initRepo(tempDir);
    await expect(access(join(tempDir, '.git'))).resolves.toBeUndefined();
  });

  it('is idempotent — does not fail on existing repo', async () => {
    await initRepo(tempDir);
    await initRepo(tempDir);
    await expect(access(join(tempDir, '.git'))).resolves.toBeUndefined();
  });
});

// ─── configureRepoIdentity ───

describe('configureRepoIdentity', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vcs-identity-'));
    await initRepo(tempDir);
  });

  it('sets local git user.name and user.email', async () => {
    await configureRepoIdentity(tempDir, 'test-bot', 'bot@test.local');

    const { stdout: name } = await execFileAsync(
      'git',
      ['config', '--local', 'user.name'],
      { cwd: tempDir },
    );
    const { stdout: email } = await execFileAsync(
      'git',
      ['config', '--local', 'user.email'],
      { cwd: tempDir },
    );

    expect(name.trim()).toBe('test-bot');
    expect(email.trim()).toBe('bot@test.local');
  });

  it('overwrites existing local identity', async () => {
    await configureRepoIdentity(tempDir, 'first', 'first@test.local');
    await configureRepoIdentity(tempDir, 'second', 'second@test.local');

    const { stdout: name } = await execFileAsync(
      'git',
      ['config', '--local', 'user.name'],
      { cwd: tempDir },
    );
    const { stdout: email } = await execFileAsync(
      'git',
      ['config', '--local', 'user.email'],
      { cwd: tempDir },
    );

    expect(name.trim()).toBe('second');
    expect(email.trim()).toBe('second@test.local');
  });
});

// ─── ensureGitignore ───

describe('ensureGitignore', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vcs-gitignore-'));
  });

  it('creates .gitignore with default entries when file does not exist', async () => {
    await ensureGitignore(tempDir);
    const content = await readFile(join(tempDir, '.gitignore'), 'utf8');
    expect(content).toContain('.git/');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.jeeves-watcher/');
    expect(content).toContain('.jeeves-metadata/');
  });

  it('appends missing entries to existing .gitignore', async () => {
    await writeFile(
      join(tempDir, '.gitignore'),
      '.git/\ncustom-entry\n',
      'utf8',
    );
    await ensureGitignore(tempDir);
    const content = await readFile(join(tempDir, '.gitignore'), 'utf8');
    expect(content).toContain('.git/');
    expect(content).toContain('custom-entry');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.jeeves-watcher/');
    expect(content).toContain('.jeeves-metadata/');
    // Should not duplicate .git/
    const gitEntries = content.split('\n').filter((l) => l.trim() === '.git/');
    expect(gitEntries).toHaveLength(1);
  });

  it('does nothing when all entries already present', async () => {
    const existing =
      '.git/\nnode_modules/\n.jeeves-watcher/\n.jeeves-metadata/\n';
    await writeFile(join(tempDir, '.gitignore'), existing, 'utf8');
    await ensureGitignore(tempDir);
    const content = await readFile(join(tempDir, '.gitignore'), 'utf8');
    expect(content).toBe(existing);
  });

  it('handles existing file without trailing newline', async () => {
    await writeFile(
      join(tempDir, '.gitignore'),
      '.git/\nnode_modules/',
      'utf8',
    );
    await ensureGitignore(tempDir);
    const content = await readFile(join(tempDir, '.gitignore'), 'utf8');
    expect(content).toContain('.jeeves-watcher/');
    expect(content).toContain('.jeeves-metadata/');
    const lines = content.split('\n');
    expect(lines.filter((l) => l.length > 0).length).toBeGreaterThanOrEqual(4);
  });

  it('includes custom always-on entries', async () => {
    await ensureGitignore(tempDir, ['*.log', 'tmp/']);
    const content = await readFile(join(tempDir, '.gitignore'), 'utf8');
    expect(content).toContain('*.log');
    expect(content).toContain('tmp/');
  });
});

// ─── detectAndRecoverOrphanBranch (Bug 6) ───

describe('detectAndRecoverOrphanBranch', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vcs-orphan-'));
    await initRepo(tempDir);
    await execFileAsync('git', ['config', 'user.email', 'test@test.com'], {
      cwd: tempDir,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test'], {
      cwd: tempDir,
    });
    // Create initial commit on master
    await writeFile(join(tempDir, 'init.txt'), 'init', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: tempDir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: tempDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('is a no-op when already on the expected branch', async () => {
    await detectAndRecoverOrphanBranch(tempDir, 'master', silentLogger);

    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: tempDir },
    );
    expect(stdout.trim()).toBe('master');
  });

  it('recovers to expected branch when on an orphan', async () => {
    const logger = pino({ level: 'silent' });
    const warnSpy = vi.spyOn(logger, 'warn');
    const infoSpy = vi.spyOn(logger, 'info');

    // Simulate orphan state: create an orphan branch and add a commit
    await execFileAsync(
      'git',
      ['checkout', '--orphan', '__squash_orphan_123'],
      { cwd: tempDir },
    );
    await writeFile(join(tempDir, 'orphan.txt'), 'orphan content', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: tempDir });
    await execFileAsync('git', ['commit', '-m', 'orphan commit'], {
      cwd: tempDir,
    });

    // Get the orphan HEAD hash
    const { stdout: orphanHead } = await execFileAsync(
      'git',
      ['rev-parse', 'HEAD'],
      { cwd: tempDir },
    );

    await detectAndRecoverOrphanBranch(tempDir, 'master', logger);

    // Should now be on master
    const { stdout: branch } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: tempDir },
    );
    expect(branch.trim()).toBe('master');

    // Master should point to the orphan HEAD (the latest work)
    const { stdout: masterHead } = await execFileAsync(
      'git',
      ['rev-parse', 'HEAD'],
      { cwd: tempDir },
    );
    expect(masterHead.trim()).toBe(orphanHead.trim());

    // Should have logged warning and info
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        currentBranch: '__squash_orphan_123',
        expectedBranch: 'master',
      }),
      expect.stringContaining('unexpected branch'),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveredFrom: '__squash_orphan_123',
        expectedBranch: 'master',
      }),
      expect.stringContaining('recovery complete'),
    );
  });

  it('does NOT delete orphan branches', async () => {
    // Create orphan branch
    await execFileAsync(
      'git',
      ['checkout', '--orphan', '__squash_orphan_456'],
      { cwd: tempDir },
    );
    await writeFile(join(tempDir, 'orphan2.txt'), 'content', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: tempDir });
    await execFileAsync('git', ['commit', '-m', 'orphan'], { cwd: tempDir });

    await detectAndRecoverOrphanBranch(tempDir, 'master', silentLogger);

    // Orphan branch should still exist
    const { stdout: branches } = await execFileAsync(
      'git',
      ['branch', '--list'],
      { cwd: tempDir },
    );
    expect(branches).toContain('__squash_orphan_456');
  });

  it('is a no-op for non-git directories', async () => {
    const nonGitDir = await mkdtemp(join(tmpdir(), 'vcs-nongit-'));
    // Should not throw
    await expect(
      detectAndRecoverOrphanBranch(nonGitDir, 'master', silentLogger),
    ).resolves.toBeUndefined();
    await rm(nonGitDir, { recursive: true, force: true });
  });
});
