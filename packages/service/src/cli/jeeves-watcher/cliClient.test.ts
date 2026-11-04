/**
 * @module cli/jeeves-watcher/cliClient.test
 * Unit tests for the CLI's SDK client: key resolution order, bearer header presence/absence, the 401 hint, error output (`<code>: <message>`, exit code 1), and that the key never reaches output (fetch mocked).
 */

import { Command } from '@commander-js/extra-typings';
import { API_KEY_ENV_VAR } from '@karmaniverous/jeeves-watcher-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { describeError } from './apiOptions';
import {
  CLI_KEY_SOURCES,
  CLI_TIMEOUT_MS,
  resolveApiKey,
  unauthorizedHint,
} from './cliClient';
import { registerCustomCommands } from './customCommands';

const SECRET = 'unit-test-secret-key';

const fetchMock =
  vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

/** Answer every request with `status` and a JSON body. */
function respond(status: number, data: unknown = {}): void {
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

/** The `authorization` header of request `index`, if any. */
function sentAuthorization(index = 0): string | null {
  return new Headers(fetchMock.mock.calls[index]?.[1]?.headers).get(
    'authorization',
  );
}

/** Run a CLI command; return everything written to stdout and stderr. */
async function runCli(args: string[]): Promise<string> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const cli = new Command().exitOverride();
  registerCustomCommands(cli);
  await cli.parseAsync(['node', 'test', ...args]);
  return [...log.mock.calls, ...err.mock.calls].flat().map(String).join('\n');
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('resolveApiKey', () => {
  it.each([
    ['flag wins over env', 'flag-key', 'env-key', 'flag-key'],
    ['env when no flag', undefined, 'env-key', 'env-key'],
    ['env when the flag is blank', '  ', 'env-key', 'env-key'],
    ['undefined when neither is set', undefined, undefined, undefined],
    ['undefined when env is empty', undefined, '', undefined],
  ])('%s', (_name, flag, env, expected) => {
    expect(resolveApiKey(flag, { [API_KEY_ENV_VAR]: env })).toBe(expected);
  });
});

describe('unauthorizedHint', () => {
  it('tells how to supply a missing key', () => {
    expect(unauthorizedHint(false)).toBe(
      `The watcher API requires an API key. Provide it via ${CLI_KEY_SOURCES}.`,
    );
    expect(CLI_KEY_SOURCES).toContain('--api-key');
    expect(CLI_KEY_SOURCES).toContain(API_KEY_ENV_VAR);
  });

  it('tells to check a rejected key', () => {
    expect(unauthorizedHint(true)).toBe(
      `The watcher API rejected the API key. Check ${CLI_KEY_SOURCES} against the service's api.apiKey.`,
    );
  });
});

describe('describeError', () => {
  it('passes a non-SDK error message through', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('plain')).toBe('plain');
  });
});

describe('CLI commands', () => {
  it('waits 60 s per request (D119)', () => {
    expect(CLI_TIMEOUT_MS).toBe(60_000);
  });

  it('sends the --api-key value as a bearer header', async () => {
    respond(200, { count: 0, issues: {} });
    await runCli(['issues', '--api-key', SECRET]);
    expect(sentAuthorization()).toBe(`Bearer ${SECRET}`);
  });

  it('falls back to JEEVES_WATCHER_API_KEY', async () => {
    vi.stubEnv(API_KEY_ENV_VAR, SECRET);
    respond(200, []);
    await runCli(['search', 'q']);
    expect(sentAuthorization()).toBe(`Bearer ${SECRET}`);
  });

  it('sends no authorization header without a key', async () => {
    respond(200, []);
    await runCli(['search', 'q']);
    expect(sentAuthorization()).toBeNull();
  });

  it('sends every request of a multi-request command with the key', async () => {
    respond(200, { result: [] });
    await runCli(['helpers', '--api-key', SECRET]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect([sentAuthorization(0), sentAuthorization(1)]).toEqual([
      `Bearer ${SECRET}`,
      `Bearer ${SECRET}`,
    ]);
  });

  it('prints <code>: <message> and the rejected-key hint on 401, exits 1, never prints the key', async () => {
    respond(401, { error: 'Unauthorized', code: 'unauthorized' });
    const output = await runCli(['scan', '--api-key', SECRET]);
    expect(output).toBe(
      `unauthorized: Unauthorized\n${unauthorizedHint(true)}`,
    );
    expect(output).not.toContain(SECRET);
    expect(process.exitCode).toBe(1);
  });

  it('prints the missing-key hint on 401 without a key', async () => {
    respond(401, { error: 'Unauthorized', code: 'unauthorized' });
    const output = await runCli(['issues']);
    expect(output).toBe(
      `unauthorized: Unauthorized\n${unauthorizedHint(false)}`,
    );
  });

  it('prints a network failure as network_error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const output = await runCli(['issues']);
    expect(output).toBe(
      'network_error: listIssues request failed: fetch failed',
    );
    expect(process.exitCode).toBe(1);
  });

  it('keeps the key out of --help output', async () => {
    vi.stubEnv(API_KEY_ENV_VAR, SECRET);
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    await runCli(['issues', '--help']).catch(() => undefined);
    const help = write.mock.calls.map((call) => String(call[0])).join('');
    expect(help).toContain('--api-key');
    expect(help).not.toContain(SECRET);
  });
});
