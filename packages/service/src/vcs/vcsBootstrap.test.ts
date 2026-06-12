/**
 * @module vcs/vcsBootstrap.test
 * Tests for bootstrap utilities: checkGitAvailable, initRepo, ensureGitignore.
 */

import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { execFileAsync } from './gitExec';
import {
  checkGitAvailable,
  configureRepoIdentity,
  ensureGitignore,
  initRepo,
} from './vcsBootstrap';

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
