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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as GitExecModule from './gitExec';
import { execFileAsync } from './gitExec';
import {
  buildGitNetworkEnv,
  execGitNetwork,
  GIT_NETWORK_ARGS,
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
      GIT_ASKPASS: 'echo',
      SSH_ASKPASS: 'echo',
    });
  });

  it('preserves and overrides the base env without mutating it', () => {
    const base = { PATH: '/bin', GIT_ASKPASS: '/usr/bin/gui-askpass' };
    const env = buildGitNetworkEnv(base);
    expect(env.PATH).toBe('/bin');
    expect(env.GIT_ASKPASS).toBe('echo');
    expect(base.GIT_ASKPASS).toBe('/usr/bin/gui-askpass');
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
      execGitNetwork(['ls-remote', url], { cwd: dir, timeout: 10_000 }),
    ).rejects.toThrow();

    expect(spy).toHaveBeenCalledTimes(1);
    const [file, args, options] = spy.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string; env: NodeJS.ProcessEnv; timeout: number },
    ];
    expect(file).toBe('git');
    expect(args).toEqual([...GIT_NETWORK_ARGS, 'ls-remote', url]);
    expect(GIT_NETWORK_ARGS).toEqual(['-c', 'credential.helper=']);
    expect(options.cwd).toBe(dir);
    expect(options.timeout).toBe(10_000);
    expect(options.env).toMatchObject({
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      GIT_ASKPASS: 'echo',
      SSH_ASKPASS: 'echo',
    });
  });

  it('never invokes a configured credential helper', async () => {
    await rm(marker, { force: true });
    await expect(
      execGitNetwork(['ls-remote', url], { cwd: dir, timeout: 10_000 }),
    ).rejects.toThrow();
    expect(existsSync(marker)).toBe(false);
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
