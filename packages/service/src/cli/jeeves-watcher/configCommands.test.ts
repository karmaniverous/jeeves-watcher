/**
 * @module cli/jeeves-watcher/configCommands.test
 * Tests that core's `config` and `config apply` CLI commands, re-wired by the watcher, send the bearer key, keep their requests and output, and report 401 without the key.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServiceCli } from '@karmaniverous/jeeves';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watcherDescriptor } from '../../descriptor';
import { API_KEY_ENV_VAR, unauthorizedMessage } from './apiClient';

const KEY = 'config-cmd-secret';
const BASE = 'http://127.0.0.1:1936';

type FetchArgs = [string, RequestInit | undefined];
const fetchMock = vi.fn<(...args: FetchArgs) => Promise<unknown>>();

let dir: string;

/** Respond to every request with `status` and a JSON body. */
function respond(status: number, data: unknown = {}): void {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
  });
}

/** Run the real service CLI; return stdout and stderr. */
async function runCli(args: string[]): Promise<{ out: string; err: string }> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const cli = createServiceCli(watcherDescriptor).exitOverride();
  await cli.parseAsync(['node', 'jeeves-watcher', ...args]);
  const text = (spy: typeof log) =>
    spy.mock.calls.flat().map(String).join('\n');
  return { out: text(log), err: text(err) };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  dir = mkdtempSync(join(tmpdir(), 'jw-config-cmd-'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  process.exitCode = undefined;
});

describe('config (query)', () => {
  it('sends the --api-key value as a bearer header', async () => {
    respond(200, { result: [1], count: 1 });
    const { out } = await runCli(['config', '$.api', '--api-key', KEY]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/config?path=${encodeURIComponent('$.api')}`,
      { headers: { Authorization: ['Bearer', KEY].join(' ') } },
    );
    expect(JSON.parse(out)).toEqual({ result: [1], count: 1 });
  });

  it('sends the same request as before when no key is set', async () => {
    respond(200);
    await runCli(['config', '-p', '2000']);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:2000/config',
      undefined,
    );
  });

  it('reports 401 with guidance and exit code 1', async () => {
    respond(401, { error: 'Unauthorized' });
    const { err } = await runCli(['config']);
    expect(err).toBe(`Config query failed: ${unauthorizedMessage(false)}`);
    expect(process.exitCode).toBe(1);
  });
});

describe('config apply', () => {
  it('posts the file patch with the env key', async () => {
    vi.stubEnv(API_KEY_ENV_VAR, KEY);
    const file = join(dir, 'patch.json');
    writeFileSync(file, '{"search":{"limit":5}}');
    respond(200, { applied: true });
    const { out } = await runCli([
      'config',
      'apply',
      '--file',
      file,
      '--replace',
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/config/apply`);
    expect(init?.headers).toMatchObject({
      Authorization: ['Bearer', KEY].join(' '),
    });
    expect(JSON.parse(init?.body as string)).toEqual({
      patch: { search: { limit: 5 } },
      replace: true,
    });
    expect(JSON.parse(out)).toEqual({ applied: true });
  });

  it('reports a rejected key without printing it', async () => {
    const file = join(dir, 'patch.json');
    writeFileSync(file, '{}');
    respond(401, { error: 'Unauthorized' });
    const { out, err } = await runCli([
      'config',
      'apply',
      '--file',
      file,
      '--api-key',
      KEY,
    ]);
    expect(err).toBe(`Config apply failed: ${unauthorizedMessage(true)}`);
    expect(`${out}${err}`).not.toContain(KEY);
    expect(process.exitCode).toBe(1);
  });

  it.each([
    [
      'a missing file',
      undefined,
      /^Config apply failed: cannot read patch file .+ \(ENOENT\)$/,
    ],
    [
      'invalid JSON',
      '{nope',
      /^Config apply failed: patch is not valid JSON \(.+\)$/,
    ],
    [
      'a non-object',
      '[1]',
      /^Config apply failed: patch must be a JSON object$/,
    ],
  ])(
    'reports %s cleanly with exit code 1',
    async (_label, content, message) => {
      const file = join(dir, 'patch.json');
      if (content !== undefined) writeFileSync(file, content);
      const { err } = await runCli(['config', 'apply', '--file', file]);
      expect(err).toMatch(message);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    },
  );
});
