/**
 * @module cli/jeeves-watcher/customCommands.admin.test
 * Tests for the reindex, rebuild-metadata, issues and helpers custom CLI commands registered via the descriptor (fetch mocked).
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
} from '../../test/cliCommands';

let consoleLogSpy: MockInstance;
let consoleErrorSpy: MockInstance;

global.fetch = mockFetch;

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  mockFetch.mockClear();
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

// --- reindex ---

describe('reindex command', () => {
  it('defaults to rules scope', async () => {
    const cli = makeCli();
    mockJsonResponse({ status: 'started' });

    await cli.parseAsync(['node', 'test', 'reindex']);

    const body = JSON.parse(getFirstRequestBody()) as Record<string, unknown>;
    expect(body.scope).toBe('rules');
  });

  it('rejects invalid scope', async () => {
    const cli = makeCli();

    await cli.parseAsync(['node', 'test', 'reindex', '--scope', 'invalid']);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Invalid scope "invalid". Must be one of: issues, full, rules, path, prune',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('passes path for path scope', async () => {
    const cli = makeCli();
    mockJsonResponse({ status: 'started' });

    await cli.parseAsync([
      'node',
      'test',
      'reindex',
      '--scope',
      'path',
      '--path',
      '/some/file.md',
    ]);

    const body = JSON.parse(getFirstRequestBody()) as Record<string, unknown>;
    expect(body.scope).toBe('path');
    expect(body.path).toBe('/some/file.md');
  });

  it('sends multiple paths as array', async () => {
    const cli = makeCli();
    mockJsonResponse({ status: 'started' });

    await cli.parseAsync([
      'node',
      'test',
      'reindex',
      '--scope',
      'path',
      '--path',
      '/a.md',
      '--path',
      '/b.md',
    ]);

    const body = JSON.parse(getFirstRequestBody()) as Record<string, unknown>;
    expect(body.path).toEqual(['/a.md', '/b.md']);
  });
});

// --- rebuild-metadata ---

describe('rebuild-metadata command', () => {
  it('calls POST /rebuild-metadata and prints response', async () => {
    const cli = makeCli();
    const response = { filesProcessed: 42 };
    mockJsonResponse(response);

    await cli.parseAsync(['node', 'test', 'rebuild-metadata']);

    expect(getFirstCallUrl()).toBe('http://127.0.0.1:1936/rebuild-metadata');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify(response, null, 2),
    );
  });
});

// --- issues ---

describe('issues command', () => {
  it('calls GET /issues and prints response', async () => {
    const cli = makeCli();
    const response = { count: 2, issues: { '/a.md': {}, '/b.md': {} } };
    mockJsonResponse(response);

    await cli.parseAsync(['node', 'test', 'issues']);

    expect(getFirstCallUrl()).toBe('http://127.0.0.1:1936/issues');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify(response, null, 2),
    );
  });
});

// --- helpers ---

describe('helpers command', () => {
  it('fetches and formats map and template helpers', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              result: [
                {
                  slack: {
                    description: 'Slack helpers',
                    exports: { slack_format: 'Format channel' },
                  },
                },
              ],
              count: 1,
            }),
          ),
        json: () =>
          Promise.resolve({
            result: [
              {
                slack: {
                  description: 'Slack helpers',
                  exports: { slack_format: 'Format channel' },
                },
              },
            ],
            count: 1,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ result: [{}], count: 0 })),
        json: () => Promise.resolve({ result: [{}], count: 0 }),
      });

    const cli = makeCli();
    await cli.parseAsync(['node', 'test', 'helpers']);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(consoleLogSpy).toHaveBeenCalled();
    const output = String(consoleLogSpy.mock.calls[0]?.[0] ?? '');
    expect(output).toContain('JsonMap lib functions');
    expect(output).toContain('slack_format');
  });

  it('prints message when no helpers are configured', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({ result: [undefined], count: 0 })),
      json: () => Promise.resolve({ result: [undefined], count: 0 }),
    });

    const cli = makeCli();
    await cli.parseAsync(['node', 'test', 'helpers']);

    expect(consoleLogSpy).toHaveBeenCalledWith('No helpers configured.');
  });
});
