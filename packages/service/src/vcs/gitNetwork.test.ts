/**
 * Tests for non-interactive git network execution.
 *
 * The behavioural tests run real git against a local HTTP server that always
 * answers 401, with a credential helper configured in an isolated global
 * config file that records every invocation. No network. The vitest setup
 * file already makes git ignore the machine's system config (e.g. Git
 * Credential Manager) and disables every prompt path; see `test/git`.
 *
 * Git children run from a directory outside the temp dir, so a stray process
 * can never hold the temp dir open at cleanup, and their kill timeout is below
 * the suite's test timeout, so every awaited child has exited before cleanup.
 */

import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type * as GitExecModule from './gitExec';
import { execFileAsync } from './gitExec';
import {
  buildAuthHeader,
  buildGitNetworkArgs,
  buildGitNetworkEnv,
  execGitNetwork,
  gitPushNonInteractive,
} from './gitNetwork';

vi.mock('./gitExec', async (importOriginal) => {
  const actual = await importOriginal<typeof GitExecModule>();
  return { ...actual, execFileAsync: vi.fn(actual.execFileAsync) };
});

describe('buildGitNetworkEnv', () => {
  it('disables every interactive prompt path', () => {
    const env = buildGitNetworkEnv({});
    expect(env).toEqual({
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      GIT_ASKPASS: '',
      SSH_ASKPASS: '',
    });
  });

  it('preserves and overrides the base env without mutating it', () => {
    const base = { PATH: '/bin', GIT_ASKPASS: '/usr/bin/gui-askpass' };
    const env = buildGitNetworkEnv(base);
    expect(env.PATH).toBe('/bin');
    expect(env.GIT_ASKPASS).toBe('');
    expect(base.GIT_ASKPASS).toBe('/usr/bin/gui-askpass');
  });
});

describe('buildGitNetworkArgs', () => {
  it('always disables core.askPass', () => {
    expect(buildGitNetworkArgs(false)).toEqual(['-c', 'core.askPass=']);
  });

  it('also resets the credential helper list when asked', () => {
    expect(buildGitNetworkArgs(true)).toEqual([
      '-c',
      'core.askPass=',
      '-c',
      'credential.helper=',
    ]);
  });
});

/** Kill timeout for git children; below {@link TEST_TIMEOUT_MS}. */
const GIT_TIMEOUT_MS = 10_000;
const TEST_TIMEOUT_MS = 20_000;

describe('execGitNetwork', { timeout: TEST_TIMEOUT_MS }, () => {
  /** Working directory for git children (never the temp dir). */
  const cwd = tmpdir();
  let dir: string;
  let marker: string;
  let server: Server;
  let url: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'git-network-'));
    marker = join(dir, 'helper-called');
    const helper = join(dir, 'helper.cjs');
    await writeFile(
      helper,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x');\n`,
      'utf8',
    );
    const globalConfig = join(dir, 'gitconfig');
    await writeFile(
      globalConfig,
      `[credential]\n\thelper = !node ${helper.replace(/\\/g, '/')}\n`,
      'utf8',
    );
    vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig);

    server = createServer((_req, res) => {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="test"' });
      res.end('denied');
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    url = `http://token@127.0.0.1:${String(port)}/repo.git`;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });

  it('passes the helper reset args and non-interactive env to git', async () => {
    const spy = vi.mocked(execFileAsync);
    spy.mockClear();
    await expect(
      execGitNetwork(['ls-remote', url], {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        clearCredentialHelpers: true,
      }),
    ).rejects.toThrow();

    expect(spy).toHaveBeenCalledTimes(1);
    const [file, args, options] = spy.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string; env: NodeJS.ProcessEnv; timeout: number },
    ];
    expect(file).toBe('git');
    expect(args).toEqual([...buildGitNetworkArgs(true), 'ls-remote', url]);
    expect(options.cwd).toBe(cwd);
    expect(options.timeout).toBe(GIT_TIMEOUT_MS);
    expect(options.env).toMatchObject({
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      GIT_ASKPASS: '',
      SSH_ASKPASS: '',
    });
  });

  it('never invokes a configured credential helper', async () => {
    await rm(marker, { force: true });
    await expect(
      execGitNetwork(['ls-remote', url], {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        clearCredentialHelpers: true,
      }),
    ).rejects.toThrow();
    expect(existsSync(marker)).toBe(false);
  });

  it('keeps configured helpers when not clearing them', async () => {
    await rm(marker, { force: true });
    await expect(
      execGitNetwork(['ls-remote', url], {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        clearCredentialHelpers: false,
      }),
    ).rejects.toThrow();
    expect(existsSync(marker)).toBe(true);
  });

  it('control: plain git does invoke the configured helper', async () => {
    await rm(marker, { force: true });
    await expect(
      execFileAsync('git', ['ls-remote', url], {
        cwd,
        // process.env is hermetic (setup file); prompts stay disabled, but
        // none of execGitNetwork's helper reset args are passed.
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
        },
        timeout: GIT_TIMEOUT_MS,
      }),
    ).rejects.toThrow();
    expect(existsSync(marker)).toBe(true);
  });
});

describe('gitPushNonInteractive', () => {
  const lastCall = () =>
    vi.mocked(execFileAsync).mock.calls.at(-1) as unknown as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ];
  const lastArgs = (): string[] => lastCall()[1];
  /** Config entries passed to git via GIT_CONFIG_* in the last call. */
  const lastConfig = (): Array<[string, string]> => {
    const { env } = lastCall()[2];
    const count = Number(env.GIT_CONFIG_COUNT ?? 0);
    const entries: Array<[string, string]> = [];
    for (let i = 0; i < count; i++) {
      entries.push([
        env[`GIT_CONFIG_KEY_${String(i)}`] ?? '',
        env[`GIT_CONFIG_VALUE_${String(i)}`] ?? '',
      ]);
    }
    return entries;
  };

  beforeEach(() => {
    vi.mocked(execFileAsync).mockClear();
    vi.mocked(execFileAsync).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
    });
  });

  it('clears helpers and sends the token as a header, never in argv', async () => {
    const remoteUrl = 'https://example.invalid/repo.git';
    await gitPushNonInteractive({
      cwd: '.',
      remoteUrl,
      accessToken: 'tok/en@special',
      force: true,
      timeout: 1,
    });
    expect(lastArgs()).toEqual([
      ...buildGitNetworkArgs(true),
      'push',
      '--force',
      remoteUrl,
      'HEAD',
    ]);
    expect(lastConfig()).toContainEqual([
      `http.${remoteUrl}.extraHeader`,
      buildAuthHeader('tok/en@special'),
    ]);
    expect(lastArgs().join(' ')).not.toContain('tok');
  });

  it('keeps helpers when there is no token', async () => {
    await gitPushNonInteractive({
      cwd: '.',
      remoteUrl: 'https://example.invalid/repo.git',
      timeout: 1,
    });
    expect(lastArgs()).toEqual([
      ...buildGitNetworkArgs(false),
      'push',
      'https://example.invalid/repo.git',
      'HEAD',
    ]);
    expect(lastConfig()).toEqual([]);
  });

  it('keeps helpers for non-https remotes even with a token', async () => {
    await gitPushNonInteractive({
      cwd: '.',
      remoteUrl: 'git@example.invalid:repo.git',
      accessToken: 'tok',
      timeout: 1,
    });
    expect(lastArgs()).toEqual([
      ...buildGitNetworkArgs(false),
      'push',
      'git@example.invalid:repo.git',
      'HEAD',
    ]);
    expect(lastConfig()).toEqual([]);
  });
});
