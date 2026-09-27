/**
 * Tests for how git network calls carry and protect an access token (#245).
 *
 * The behavioural tests run real git against a local HTTP server that records
 * the Authorization header and always answers 401, and against a local bare
 * repository. The vitest setup file makes git ignore system and global
 * config and disables every prompt path (see `test/git`), so the machine's
 * real git config is never read or touched. Network calls run from outside
 * the temp dir, with a kill timeout below the suite's test timeout.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { execFileAsync } from '../test/git';
import {
  buildAuthHeader,
  buildAuthHeaderConfig,
  buildGitNetworkEnv,
  execGitNetwork,
  gitPushNonInteractive,
  redactSecret,
  sanitizeGitError,
} from './gitNetwork';

const TOKEN = 'ghp_T0k/en@sp:ec+ial%20&=?#~';
const TOKEN_FORMS = [
  TOKEN,
  encodeURIComponent(TOKEN),
  Buffer.from(TOKEN).toString('base64'),
  Buffer.from(`x-access-token:${TOKEN}`).toString('base64'),
];

function expectNoToken(text: string): void {
  for (const form of TOKEN_FORMS) expect(text).not.toContain(form);
}

describe('buildGitNetworkEnv config entries', () => {
  it('passes entries via GIT_CONFIG_* after existing ones', () => {
    const env = buildGitNetworkEnv(
      {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'a.b',
        GIT_CONFIG_VALUE_0: 'c',
      },
      [['http.extraHeader', 'X: y']],
    );
    expect(env).toMatchObject({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'a.b',
      GIT_CONFIG_VALUE_0: 'c',
      GIT_CONFIG_KEY_1: 'http.extraHeader',
      GIT_CONFIG_VALUE_1: 'X: y',
    });
  });

  it('starts at zero when there is no valid existing count', () => {
    const env = buildGitNetworkEnv({ GIT_CONFIG_COUNT: 'junk' }, [
      ['k.v', '1'],
    ]);
    expect(env).toMatchObject({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'k.v',
      GIT_CONFIG_VALUE_0: '1',
    });
  });
});

describe('buildAuthHeaderConfig', () => {
  it('scopes a Basic x-access-token header to the remote URL', () => {
    const url = 'https://github.com/o/r.git';
    const basic = Buffer.from(`x-access-token:${TOKEN}`).toString('base64');
    expect(buildAuthHeader(TOKEN)).toBe(`Authorization: Basic ${basic}`);
    expect(buildAuthHeaderConfig(url, TOKEN)).toEqual([
      `http.${url}.extraHeader`,
      buildAuthHeader(TOKEN),
    ]);
  });
});

describe('redactSecret', () => {
  it('removes every encoding of the secret', () => {
    const text = `a ${TOKEN_FORMS.join(' b ')} ${buildAuthHeader(TOKEN)} z`;
    const out = redactSecret(text, TOKEN);
    expectNoToken(out);
    expect(out).toContain('***');
    expect(out.startsWith('a ')).toBe(true);
  });

  it('is a no-op without a secret', () => {
    expect(redactSecret('text', undefined)).toBe('text');
    expect(redactSecret('text', '')).toBe('text');
  });
});

describe('sanitizeGitError', () => {
  it('redacts message, stack, and string fields and drops the cause', () => {
    const url = `https://${encodeURIComponent(TOKEN)}@h/r.git`;
    const raw = Object.assign(new Error(`Command failed: git push ${url}`), {
      cmd: `git push ${url}`,
      stderr: `fatal: ${TOKEN}`,
      stdout: buildAuthHeader(TOKEN),
      code: 128,
      cause: new Error(TOKEN),
    });
    const clean = sanitizeGitError(raw, TOKEN) as Error &
      Record<string, unknown>;
    expect(clean).not.toBe(raw);
    expect(clean.code).toBe(128);
    expect(clean.cause).toBeUndefined();
    expect(clean.cmd).toBe('git push https://***@h/r.git');
    for (const value of [
      clean.message,
      clean.stack ?? '',
      clean.cmd,
      clean.stderr,
      clean.stdout,
    ]) {
      expectNoToken(String(value));
    }
  });

  it('wraps non-Error values', () => {
    const clean = sanitizeGitError(`bad ${TOKEN}`, TOKEN);
    expect(clean).toBeInstanceOf(Error);
    expect(clean.message).toBe('bad ***');
  });
});

/** Kill timeout for git network children; below the suite timeout. */
const GIT_TIMEOUT_MS = 10_000;

describe('token transport against real git', { timeout: 20_000 }, () => {
  /** Working directory for git network children (never the temp dir). */
  const cwd = tmpdir();
  let dir: string;
  let server: Server;
  let httpUrl: string;
  const seenAuth: Array<string | undefined> = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'git-auth-'));

    server = createServer((req, res) => {
      seenAuth.push(req.headers.authorization);
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="test"' });
      res.end('denied');
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    httpUrl = `http://127.0.0.1:${String(port)}/repo.git`;
  });

  afterAll(async () => {
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

  it('sends the header, and git never echoes it (even unsanitized)', async () => {
    seenAuth.length = 0;
    const error = (await execGitNetwork(['ls-remote', httpUrl], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      clearCredentialHelpers: true,
      config: [buildAuthHeaderConfig(httpUrl, TOKEN)],
      // No secret: prove the raw git error is already clean.
    }).then(
      () => undefined,
      (e: unknown) => e,
    )) as Error & { cmd?: string; stderr?: string };

    expect(seenAuth).toContain(buildAuthHeader(TOKEN).slice(15));
    expect(error).toBeInstanceOf(Error);
    expect(error.stderr).toBeTypeOf('string');
    for (const text of [
      error.message,
      error.stack ?? '',
      error.cmd ?? '',
      error.stderr ?? '',
    ]) {
      expectNoToken(text);
    }
  });

  it('does not send the header to other URLs', async () => {
    seenAuth.length = 0;
    await expect(
      execGitNetwork(['ls-remote', httpUrl], {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        clearCredentialHelpers: true,
        config: [buildAuthHeaderConfig('https://other.invalid/r.git', TOKEN)],
      }),
    ).rejects.toThrow();
    expect(seenAuth.length).toBeGreaterThan(0);
    expect(seenAuth.every((auth) => auth === undefined)).toBe(true);
  });

  it('still pushes to a local bare repo with no token', async () => {
    const work = join(dir, 'work');
    const bare = join(dir, 'bare.git');
    await execFileAsync('git', ['init', '--bare', bare]);
    await execFileAsync('git', ['init', work]);
    for (const [key, value] of [
      ['user.email', 'test@test.com'],
      ['user.name', 'Test'],
    ]) {
      await execFileAsync('git', ['config', key, value], { cwd: work });
    }
    await writeFile(join(work, 'f.txt'), 'x', 'utf8');
    await execFileAsync('git', ['add', 'f.txt'], { cwd: work });
    await execFileAsync('git', ['commit', '-m', 'c'], { cwd: work });
    const { stdout: head } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: work,
    });
    const { stdout: branch } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: work },
    );

    await gitPushNonInteractive({
      cwd: work,
      remoteUrl: bare.replace(/\\/g, '/'),
      timeout: GIT_TIMEOUT_MS,
    });

    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', `refs/heads/${branch.trim()}`],
      { cwd: bare },
    );
    expect(stdout.trim()).toBe(head.trim());
  });
});
