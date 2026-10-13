/**
 * @module cli/jeeves-watcher/customCommands.test
 * Tests for the search, enrich and scan custom CLI commands registered via the descriptor (fetch mocked).
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
