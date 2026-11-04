/**
 * @module cli/jeeves-watcher/configCommands.test
 * Tests that core's `config` and `config apply` CLI commands, re-wired by the watcher, send the bearer key, keep their requests and output, and report 401 without the key.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { Command } from '@commander-js/extra-typings';
import { createServiceCli } from '@karmaniverous/jeeves';
import { API_KEY_ENV_VAR } from '@karmaniverous/jeeves-watcher-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watcherDescriptor } from '../../descriptor';
import { unauthorizedHint } from './cliClient';
import { authenticateConfigCommands } from './configCommands';

const KEY = 'config-cmd-secret';
const BASE = 'http://127.0.0.1:1936';

type FetchArgs = [string, RequestInit | undefined];
const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>();

let dir: string;

/** Respond to every request with `status` and a JSON body. */
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

/** The `authorization` header of the first request, if any. */
function sentAuthorization(): string | null {
  return new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get(
    'authorization',
  );
}

/** The URL of the first request. */
const sentUrl = (): string | undefined => fetchMock.mock.calls[0]?.[0];

/** A successful `POST /config/apply` body. */
const APPLIED = { applied: true, config: {} };

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
    expect(sentUrl()).toBe(
      `${BASE}/config?path=${encodeURIComponent('$.api')}`,
    );
    expect(sentAuthorization()).toBe(['Bearer', KEY].join(' '));
    expect(JSON.parse(out)).toEqual({ result: [1], count: 1 });
  });

  it('sends no authorization header when no key is set', async () => {
    respond(200);
    await runCli(['config', '-p', '2000']);
    expect(sentUrl()).toBe('http://127.0.0.1:2000/config');
    expect(sentAuthorization()).toBeNull();
  });

  it('reports 401 as <code>: <message> with the key hint, and exit code 1', async () => {
    respond(401, { error: 'Unauthorized', code: 'unauthorized' });
    const { err } = await runCli(['config']);
    expect(err).toBe(
      `Config query failed: unauthorized: Unauthorized\n${unauthorizedHint(false)}`,
    );
    expect(process.exitCode).toBe(1);
  });
});

describe('config apply', () => {
  const stdin = Object.getOwnPropertyDescriptor(process, 'stdin');

  /** Replace process.stdin with a stream of `text` for one test. */
  function feedStdin(text: string): void {
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: Readable.from(text ? [Buffer.from(text)] : []),
    });
  }

  afterEach(() => {
    if (stdin) Object.defineProperty(process, 'stdin', stdin);
  });

  it.each([
    ['a JSON patch', '{"a":1}', { a: 1 }],
    ['empty input', '', {}],
    ['whitespace only', ' \n', {}],
  ])('reads %s from stdin without --file', async (_label, text, patch) => {
    feedStdin(text);
    respond(200, APPLIED);
    await runCli(['config', 'apply']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/config/apply`);
    expect(JSON.parse(init?.body as string)).toEqual({ patch });
  });

  it('posts the file patch with the env key', async () => {
    vi.stubEnv(API_KEY_ENV_VAR, KEY);
    const file = join(dir, 'patch.json');
    writeFileSync(file, '{"search":{"limit":5}}');
    respond(200, APPLIED);
    const { out } = await runCli([
      'config',
      'apply',
      '--file',
      file,
      '--replace',
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/config/apply`);
    expect(sentAuthorization()).toBe(['Bearer', KEY].join(' '));
    expect(JSON.parse(init?.body as string)).toEqual({
      patch: { search: { limit: 5 } },
      replace: true,
    });
    expect(JSON.parse(out)).toEqual(APPLIED);
  });

  it('reports a rejected key without printing it', async () => {
    const file = join(dir, 'patch.json');
    writeFileSync(file, '{}');
    respond(401, { error: 'Unauthorized', code: 'unauthorized' });
    const { out, err } = await runCli([
      'config',
      'apply',
      '--file',
      file,
      '--api-key',
      KEY,
    ]);
    expect(err).toBe(
      `Config apply failed: unauthorized: Unauthorized\n${unauthorizedHint(true)}`,
    );
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

describe('authenticateConfigCommands guards', () => {
  it('leaves a program without a config command untouched', () => {
    const program = new Command();
    expect(() => {
      authenticateConfigCommands(program);
    }).not.toThrow();
    expect(program.commands).toHaveLength(0);
  });

  it('re-wires config even when it has no apply subcommand', () => {
    const program = new Command();
    const config = program.command('config');
    authenticateConfigCommands(program);
    expect(config.options.map((o) => o.long)).toEqual(['--api-key']);
    expect(config.commands).toHaveLength(0);
  });
});
