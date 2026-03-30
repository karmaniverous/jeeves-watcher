/**
 * @module cli/jeeves-watcher/customCommands.test
 * Tests for custom CLI commands registered via the descriptor.
 */

import { Command } from '@commander-js/extra-typings';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';

import { registerCustomCommands } from './customCommands';

let consoleLogSpy: MockInstance;
let consoleErrorSpy: MockInstance;

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  mockFetch.mockClear();
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

function makeCli(): Command {
  const cli = new Command().exitOverride();
  registerCustomCommands(cli);
  return cli;
}

function mockJsonResponse(data: unknown): void {
  mockFetch.mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
  });
}

function getFirstCallUrl(): string {
  const calls = mockFetch.mock.calls as unknown[][];
  const first = calls.at(0);
  if (!first) return '';
  const url = first[0];
  return typeof url === 'string' ? url : '';
}

function getFirstRequestBody(): string {
  const calls = mockFetch.mock.calls as unknown[][];
  const firstCall = calls.at(0);
  if (!firstCall) return '';
  const init = firstCall[1];
  if (typeof init !== 'object' || init === null || !('body' in init)) return '';
  const body = (init as { body?: unknown }).body;
  return typeof body === 'string' ? body : '';
}

// --- search ---

describe('search command', () => {
  it('sends query and limit to the correct endpoint', async () => {
    const cli = makeCli();
    const mockResults = [{ id: '1', score: 0.95 }];
    mockJsonResponse(mockResults);

    await cli.parseAsync([
      'node',
      'test',
      'search',
      'test query',
      '--limit',
      '5',
    ]);

    expect(getFirstCallUrl()).toBe('http://127.0.0.1:1936/search');
    const body = JSON.parse(getFirstRequestBody()) as Record<string, unknown>;
    expect(body).toEqual({ query: 'test query', limit: 5 });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify(mockResults, null, 2),
    );
  });

  it('uses default limit of 10', async () => {
    const cli = makeCli();
    mockJsonResponse([]);

    await cli.parseAsync(['node', 'test', 'search', 'query']);

    const body = JSON.parse(getFirstRequestBody()) as Record<string, unknown>;
    expect(body.limit).toBe(10);
  });

  it('respects custom host and port', async () => {
    const cli = makeCli();
    mockJsonResponse([]);

    await cli.parseAsync([
      'node',
      'test',
      'search',
      'q',
      '--host',
      'localhost',
      '--port',
      '9999',
    ]);

    expect(getFirstCallUrl()).toBe('http://localhost:9999/search');
  });

  it('reports API errors via stderr', async () => {
    const cli = makeCli();
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    await cli.parseAsync(['node', 'test', 'search', 'query']);

    expect(consoleErrorSpy).toHaveBeenCalledWith('ECONNREFUSED');
  });
});

// --- enrich ---

describe('enrich command', () => {
  it('sends JSON metadata to the correct endpoint', async () => {
    const cli = makeCli();
    mockJsonResponse({ success: true });

    await cli.parseAsync([
      'node',
      'test',
      'enrich',
      '/some/file.md',
      '--json',
      '{"tag":"test"}',
    ]);

    expect(getFirstCallUrl()).toBe('http://127.0.0.1:1936/metadata');
    const body = JSON.parse(getFirstRequestBody()) as Record<string, unknown>;
    expect(body).toEqual({
      path: '/some/file.md',
      metadata: { tag: 'test' },
    });
  });

  it('parses --key pairs into metadata', async () => {
    const cli = makeCli();
    mockJsonResponse({ success: true });

    await cli.parseAsync([
      'node',
      'test',
      'enrich',
      '/file.md',
      '--key',
      'domain=docs',
      '--key',
      'status=active',
    ]);

    const body = JSON.parse(getFirstRequestBody()) as {
      metadata: Record<string, string>;
    };
    expect(body.metadata).toEqual({ domain: 'docs', status: 'active' });
  });

  it('rejects when no metadata provided', async () => {
    const cli = makeCli();

    await cli.parseAsync(['node', 'test', 'enrich', '/some/file.md']);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'No metadata provided. Use --key or --json.',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON', async () => {
    const cli = makeCli();

    await cli.parseAsync([
      'node',
      'test',
      'enrich',
      '/file.md',
      '--json',
      '{bad}',
    ]);

    expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid JSON:', '{bad}');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// --- scan ---

describe('scan command', () => {
  it('sends filter, limit, and flags in request body', async () => {
    const cli = makeCli();
    mockJsonResponse({ points: [], count: 0 });

    await cli.parseAsync([
      'node',
      'test',
      'scan',
      '--filter',
      '{"domain":"test"}',
      '--limit',
      '50',
      '--count-only',
    ]);

    expect(getFirstCallUrl()).toContain('/scan');
    const body = JSON.parse(getFirstRequestBody()) as Record<string, unknown>;
    expect(body.filter).toEqual({ domain: 'test' });
    expect(body.limit).toBe(50);
    expect(body.countOnly).toBe(true);
  });

  it('splits comma-separated fields', async () => {
    const cli = makeCli();
    mockJsonResponse({ points: [] });

    await cli.parseAsync([
      'node',
      'test',
      'scan',
      '--fields',
      'file_path,domain',
    ]);

    const body = JSON.parse(getFirstRequestBody()) as Record<string, unknown>;
    expect(body.fields).toEqual(['file_path', 'domain']);
  });
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
