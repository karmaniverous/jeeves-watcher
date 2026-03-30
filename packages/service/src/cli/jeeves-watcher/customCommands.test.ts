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

function getFirstRequestBody(): string {
  const calls = mockFetch.mock.calls as unknown[][];
  const firstCall = calls.at(0);
  if (!firstCall) return '';

  const init = firstCall[1];
  if (typeof init !== 'object' || init === null || !('body' in init)) return '';

  const body = (init as { body?: unknown }).body;
  return typeof body === 'string' ? body : '';
}

describe('search command', () => {
  it('sends query and limit to API', async () => {
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

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:1936/search',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify(mockResults, null, 2),
    );
  });

  it('uses default limit of 10', async () => {
    const cli = makeCli();
    mockJsonResponse([]);

    await cli.parseAsync(['node', 'test', 'search', 'query']);

    expect(mockFetch).toHaveBeenCalled();
    const body = getFirstRequestBody();
    expect(body).toContain('"limit":10');
  });

  it('handles API error', async () => {
    const cli = makeCli();
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    await cli.parseAsync(['node', 'test', 'search', 'query']);

    expect(consoleErrorSpy).toHaveBeenCalledWith('ECONNREFUSED');
  });
});

describe('scan command', () => {
  it('calls POST /scan with correct payload', async () => {
    const cli = makeCli();
    mockJsonResponse([]);

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

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/scan'),
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('reindex command', () => {
  it('calls POST /reindex with default scope', async () => {
    const cli = makeCli();
    mockJsonResponse({ status: 'started' });

    await cli.parseAsync(['node', 'test', 'reindex']);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:1936/reindex',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = getFirstRequestBody();
    expect(body).toContain('"scope":"rules"');
  });

  it('validates scope parameter', async () => {
    const cli = makeCli();

    await cli.parseAsync(['node', 'test', 'reindex', '--scope', 'invalid']);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Invalid scope "invalid". Must be one of: issues, full, rules, path, prune',
    );
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

    expect(mockFetch).toHaveBeenCalled();
    const body = getFirstRequestBody();
    expect(body).toContain('/some/file.md');
  });
});

describe('rebuild-metadata command', () => {
  it('calls POST /rebuild-metadata', async () => {
    const cli = makeCli();
    mockJsonResponse({ status: 'ok' });

    await cli.parseAsync(['node', 'test', 'rebuild-metadata']);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:1936/rebuild-metadata',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('issues command', () => {
  it('calls GET /issues', async () => {
    const cli = makeCli();
    mockJsonResponse({ count: 0, issues: {} });

    await cli.parseAsync(['node', 'test', 'issues']);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:1936/issues',
      undefined,
    );
  });
});

describe('enrich command', () => {
  it('sends path and metadata to API', async () => {
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

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:1936/metadata',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects when no metadata provided', async () => {
    const cli = makeCli();

    await cli.parseAsync(['node', 'test', 'enrich', '/some/file.md']);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'No metadata provided. Use --key or --json.',
    );
  });
});
