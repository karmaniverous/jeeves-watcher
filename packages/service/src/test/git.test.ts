/**
 * @module test/git.test
 * Tests for the hermetic git test environment.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { execFileAsync, hermeticGitEnv, TEST_GIT_TIMEOUT_MS } from './git';

describe('hermeticGitEnv', () => {
  it('drops inherited GIT_* variables and disables prompts', () => {
    const base = {
      PATH: '/bin',
      GIT_DIR: '/elsewhere/.git',
      GIT_ASKPASS: '/editor/askpass.sh',
      git_config_count: '1',
      SSH_ASKPASS: '/usr/bin/ssh-askpass',
      GCM_INTERACTIVE: 'always',
    };
    const env = hermeticGitEnv(base);
    expect(env).toMatchObject({
      PATH: '/bin',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      GIT_ASKPASS: '',
      SSH_ASKPASS: '',
    });
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.git_config_count).toBeUndefined();
    expect(env.XDG_CONFIG_HOME).toBeTypeOf('string');
    expect(base.GIT_ASKPASS).toBe('/editor/askpass.sh');
  });
});

describe('test process environment (setup file)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'git-hermetic-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('is hermetic', () => {
    expect(process.env).toMatchObject(hermeticGitEnv(process.env));
  });

  it('makes git read no system or global config', async () => {
    // Outside any repository, the only config left would be system/global
    // (e.g. Git for Windows' credential.helper=manager).
    const { stdout } = await execFileAsync(
      'git',
      ['config', '--list', '--show-origin'],
      { cwd: dir },
    );
    expect(stdout.trim()).toBe('');
  });
});

describe('execFileAsync', () => {
  it('kills a stuck child after the default timeout', async () => {
    const start = Date.now();
    await expect(
      execFileAsync(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']),
    ).rejects.toMatchObject({ killed: true });
    expect(Date.now() - start).toBeLessThan(TEST_GIT_TIMEOUT_MS + 2_000);
  }, 10_000);
});
