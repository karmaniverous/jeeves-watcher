/**
 * @module cli/jeeves-watcher/vcsCommands.test
 * Tests for the `vcs` command group (#213): each subcommand's method, path, query or body, its output (pretty JSON, or raw text for show and diff), and the timeout note of the state-changing ones (fetch mocked).
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';

import {
  getFirstCallUrl,
  getFirstRequestBody,
  makeCli,
  mockFetch,
  mockJsonResponse,
  mockTextResponse,
} from '../../test/cliCommands';

let consoleLogSpy: MockInstance;
let consoleErrorSpy: MockInstance;
let stdoutSpy: MockInstance;

global.fetch = mockFetch;

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  mockFetch.mockReset();
  process.exitCode = undefined;
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  stdoutSpy.mockRestore();
  process.exitCode = undefined;
});

const BASE = 'http://127.0.0.1:1936';
const run = (...args: string[]) =>
  makeCli().parseAsync(['node', 'test', 'vcs', ...args]);
const method = () =>
  (mockFetch.mock.calls[0]?.[1] as RequestInit | undefined)?.method;
const body = () => JSON.parse(getFirstRequestBody()) as unknown;
const printed = () => consoleLogSpy.mock.calls[0]?.[0] as string;

const STATUS = { enabled: true, roots: [] };
const HISTORY: unknown[] = [];
const REVERT = { restored: 1, files: ['/r/a.md'] };
const CHECK = { excluded: false };
const EXCLUDE = {
  ok: true,
  file: '/r/.gitignore',
  action: 'added',
  untracked: 0,
};

describe('vcs status', () => {
  it('GETs /vcs/status and prints the JSON', async () => {
    mockJsonResponse(STATUS);
    await run('status');
    expect(getFirstCallUrl()).toBe(`${BASE}/vcs/status`);
    expect(method()).toBe('GET');
    expect(printed()).toBe(JSON.stringify(STATUS, null, 2));
  });
});

describe('vcs history', () => {
  it('sends the glob and the --since/--until/--limit query fields', async () => {
    mockJsonResponse(HISTORY);
    await run(
      'history',
      '/r/**/*.md',
      '--since',
      '2026-01-01',
      '--until',
      '2026-02-01',
      '--limit',
      '5',
    );
    const url = new URL(getFirstCallUrl());
    expect(url.pathname).toBe('/vcs/history');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      glob: '/r/**/*.md',
      since: '2026-01-01',
      until: '2026-02-01',
      limit: '5',
    });
  });

  it('sends only the glob when no flags are given', async () => {
    mockJsonResponse(HISTORY);
    await run('history', '/r/a.md');
    expect(getFirstCallUrl()).toBe(`${BASE}/vcs/history?glob=%2Fr%2Fa.md`);
  });
});

describe('vcs show', () => {
  it('prints the raw file content', async () => {
    mockTextResponse('# old\n');
    await run('show', '/r/a.md', 'abc');
    const url = new URL(getFirstCallUrl());
    expect(url.pathname).toBe('/vcs/show');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      path: '/r/a.md',
      commit: 'abc',
    });
    expect(stdoutSpy).toHaveBeenCalledWith('# old\n');
  });
});

describe('vcs diff', () => {
  it('sends commit and --to as commitEnd, and prints the raw diff', async () => {
    mockTextResponse('--- a\n+++ b\n');
    await run('diff', '/r/a.md', 'abc', '--to', 'def');
    const url = new URL(getFirstCallUrl());
    expect(url.pathname).toBe('/vcs/diff');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      glob: '/r/a.md',
      commit: 'abc',
      commitEnd: 'def',
    });
    expect(stdoutSpy).toHaveBeenCalledWith('--- a\n+++ b\n');
  });
});

describe('vcs revert', () => {
  it('POSTs glob, commit and --existing-only', async () => {
    mockJsonResponse(REVERT);
    await run('revert', '/r/**', 'abc', '--existing-only');
    expect(getFirstCallUrl()).toBe(`${BASE}/vcs/revert`);
    expect(method()).toBe('POST');
    expect(body()).toEqual({
      glob: '/r/**',
      commit: 'abc',
      existingOnly: true,
    });
    expect(printed()).toBe(JSON.stringify(REVERT, null, 2));
  });

  it('omits existingOnly without the flag', async () => {
    mockJsonResponse(REVERT);
    await run('revert', '/r/**', 'abc');
    expect(body()).toEqual({ glob: '/r/**', commit: 'abc' });
  });
});

describe('vcs check', () => {
  it('GETs /vcs/check-exclusion with the path', async () => {
    mockJsonResponse(CHECK);
    await run('check', '/r/a.md');
    expect(getFirstCallUrl()).toBe(
      `${BASE}/vcs/check-exclusion?path=%2Fr%2Fa.md`,
    );
    expect(printed()).toBe(JSON.stringify(CHECK, null, 2));
  });
});

describe('vcs exclude', () => {
  it('POSTs the glob with --root, --remove and --confirm', async () => {
    mockJsonResponse(EXCLUDE);
    await run(
      'exclude',
      '/r/drafts/**',
      '--root',
      '/r',
      '--remove',
      '--confirm',
    );
    expect(getFirstCallUrl()).toBe(`${BASE}/vcs/exclude`);
    expect(body()).toEqual({
      glob: '/r/drafts/**',
      root: '/r',
      remove: true,
      confirm: true,
    });
  });

  it('sends only the glob without flags', async () => {
    mockJsonResponse(EXCLUDE);
    await run('exclude', '/r/drafts/**');
    expect(body()).toEqual({ glob: '/r/drafts/**' });
  });

  it('prints the server code and message of a 409, and exits 1', async () => {
    mockJsonResponse(
      {
        error: 'Confirmation required',
        code: 'confirm_required',
        message: '150 files would be untracked',
      },
      409,
    );
    await run('exclude', '/r/**');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'confirm_required: Confirmation required: 150 files would be untracked',
    );
    expect(process.exitCode).toBe(1);
  });
});

describe('timeouts of state-changing vcs commands (D119)', () => {
  const timeout = () => {
    mockFetch.mockImplementation(() =>
      Promise.reject(new DOMException('timed out', 'TimeoutError')),
    );
  };

  it('vcs exclude says the exclusion may still complete, and how to check', async () => {
    timeout();
    await run('exclude', '/r/drafts/**');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'timeout: excludeVcsPath timed out after 60000 ms\nThe operation may still complete on the server; check with `jeeves-watcher vcs check <path>` or `vcs status`.',
    );
    expect(process.exitCode).toBe(1);
  });

  it('vcs revert says the revert may still complete, and how to check', async () => {
    timeout();
    await run('revert', '/r/**', 'abc');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'timeout: revertVcs timed out after 60000 ms\nThe operation may still complete on the server; check with `jeeves-watcher vcs history <glob>`.',
    );
  });

  it('a read command reports the timeout alone', async () => {
    timeout();
    await run('status');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'timeout: getVcsStatus timed out after 60000 ms',
    );
  });
});
