/**
 * @module cli/jeeves-watcher/apiClient.test
 * Unit tests for the CLI API client: key resolution order, bearer header presence/absence, 401 guidance, and that the key never reaches output.
 */

import { Command } from '@commander-js/extra-typings';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  API_KEY_ENV_VAR,
  createApiClient,
  resolveApiKey,
  unauthorizedMessage,
} from './apiClient';
import { registerCustomCommands } from './customCommands';

const KEY = 'unit-test-secret-key';
const BASE = 'http://127.0.0.1:1936';

type FetchArgs = [string, RequestInit | undefined];

const fetchMock = vi.fn<(...args: FetchArgs) => Promise<unknown>>();

/** Respond to every request with `status` and a JSON body. */
function respond(status: number, data: unknown = {}): void {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
  });
}

/** The `Authorization` header of the first request, if any. */
function sentAuthorization(): string | undefined {
  const init = fetchMock.mock.calls[0]?.[1];
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return headers.Authorization;
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

describe('createApiClient', () => {
  it('sends Authorization: Bearer <key> on GET and POST when a key is set', async () => {
    respond(200);
    const client = createApiClient({ baseUrl: BASE, apiKey: KEY });
    await client.get('/issues');
    await client.post('/search', { query: 'q' });
    for (const [, init] of fetchMock.mock.calls) {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    }
    const postHeaders = fetchMock.mock.calls[1][1]?.headers;
    expect(postHeaders).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('sends no Authorization header when no key is set', async () => {
    respond(200);
    const client = createApiClient({ baseUrl: BASE });
    await client.get('/issues');
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/issues`, undefined);
    await client.post('/search', {});
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('explains how to supply the key on 401 without one', async () => {
    respond(401, { error: 'Unauthorized' });
    await expect(createApiClient({ baseUrl: BASE }).get('/x')).rejects.toThrow(
      unauthorizedMessage(false),
    );
    expect(unauthorizedMessage(false)).toContain('--api-key');
    expect(unauthorizedMessage(false)).toContain(API_KEY_ENV_VAR);
  });

  it('reports a rejected key on 401 without echoing it', async () => {
    respond(401, { error: 'Unauthorized' });
    const error = await createApiClient({ baseUrl: BASE, apiKey: KEY })
      .get('/x')
      .catch((err: unknown) => err as Error);
    expect((error as Error).message).toBe(unauthorizedMessage(true));
    expect((error as Error).message).not.toContain(KEY);
  });

  it('maps other non-OK statuses to HTTP <status>: <body>', async () => {
    respond(500, { error: 'boom' });
    await expect(createApiClient({ baseUrl: BASE }).get('/x')).rejects.toThrow(
      'HTTP 500: {"error":"boom"}',
    );
  });
});

describe('CLI commands', () => {
  /** Run a CLI command; return everything written to stdout and stderr. */
  async function runCli(args: string[]): Promise<string> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cli = new Command().exitOverride();
    registerCustomCommands(cli);
    await cli.parseAsync(['node', 'test', ...args]);
    return [...log.mock.calls, ...err.mock.calls].flat().map(String).join('\n');
  }

  it('sends the --api-key flag as a bearer header', async () => {
    respond(200, { count: 0 });
    await runCli(['issues', '--api-key', KEY]);
    expect(sentAuthorization()).toBe(`Bearer ${KEY}`);
  });

  it('falls back to JEEVES_WATCHER_API_KEY', async () => {
    vi.stubEnv(API_KEY_ENV_VAR, KEY);
    respond(200, []);
    await runCli(['search', 'q']);
    expect(sentAuthorization()).toBe(`Bearer ${KEY}`);
  });

  it('sends every request of a multi-request command with the key', async () => {
    respond(200, { result: [undefined], count: 0 });
    await runCli(['helpers', '--api-key', KEY]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
    }
  });

  it('prints 401 guidance, sets exit code 1 and never prints the key', async () => {
    respond(401, { error: 'Unauthorized' });
    const output = await runCli(['scan', '--api-key', KEY]);
    expect(output).toContain(unauthorizedMessage(true));
    expect(output).not.toContain(KEY);
    expect(process.exitCode).toBe(1);
  });

  it('keeps the key out of --help output', async () => {
    vi.stubEnv(API_KEY_ENV_VAR, KEY);
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    await runCli(['issues', '--help']).catch(() => undefined);
    const help = write.mock.calls.map((call) => String(call[0])).join('');
    expect(help).toContain('--api-key');
    expect(help).not.toContain(KEY);
  });
});
