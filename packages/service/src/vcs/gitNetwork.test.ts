/**
 * Tests for non-interactive git network execution.
 *
 * The behavioural tests run real git against a local HTTP server that always
 * answers 401, with a credential helper configured at system level (via an
 * isolated GIT_CONFIG_SYSTEM file) that records every invocation. No network,
 * and the machine's real git config is never read or touched.
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

describe('execGitNetwork', () => {
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
    const systemConfig = join(dir, 'gitconfig');
    await writeFile(
      systemConfig,
      `[credential]\n\thelper = !node ${helper.replace(/\\/g, '/')}\n`,
      'utf8',
    );
    const globalConfig = join(dir, 'global-gitconfig');
    await writeFile(globalConfig, '', 'utf8');
    vi.stubEnv('GIT_CONFIG_SYSTEM', systemConfig);
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
    await rm(dir, { recursive: true, force: true });
  });

  it('passes the helper reset args and non-interactive env to git', async () => {
    const spy = vi.mocked(execFileAsync);
    spy.mockClear();
    await expect(
      execGitNetwork(['ls-remote', url], {
        cwd: dir,
        timeout: 10_000,
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
    expect(options.cwd).toBe(dir);
    expect(options.timeout).toBe(10_000);
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
        cwd: dir,
        timeout: 10_000,
        clearCredentialHelpers: true,
      }),
    ).rejects.toThrow();
    expect(existsSync(marker)).toBe(false);
  });

  it('keeps configured helpers when not clearing them', async () => {
    await rm(marker, { force: true });
    await expect(
      execGitNetwork(['ls-remote', url], {
        cwd: dir,
        timeout: 10_000,
        clearCredentialHelpers: false,
      }),
    ).rejects.toThrow();
    expect(existsSync(marker)).toBe(true);
  });

  it('control: plain git does invoke the configured helper', async () => {
    await rm(marker, { force: true });
    await expect(
      execFileAsync('git', ['ls-remote', url], {
        cwd: dir,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        timeout: 10_000,
      }),
    ).rejects.toThrow();
    expect(existsSync(marker)).toBe(true);
  });
});

describe('gitPushNonInteractive', () => {
  const lastArgs = (): string[] =>
    (
      vi.mocked(execFileAsync).mock.calls.at(-1) as unknown as [
        string,
        string[],
      ]
    )[1];

  beforeEach(() => {
    vi.mocked(execFileAsync).mockClear();
    vi.mocked(execFileAsync).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
    });
  });

  it('clears helpers and encodes the token when one is injected', async () => {
    await gitPushNonInteractive({
      cwd: '.',
      remoteUrl: 'https://example.invalid/repo.git',
      accessToken: 'tok/en@special',
      force: true,
      timeout: 1,
    });
    expect(lastArgs()).toEqual([
      ...buildGitNetworkArgs(true),
      'push',
      '--force',
      'https://tok%2Fen%40special@example.invalid/repo.git',
      'HEAD',
    ]);
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
  });
});
