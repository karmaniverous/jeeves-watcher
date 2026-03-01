/**
 * @module commands/commands-basic.test
 *
 * Tests for basic CLI commands (status, search, reindex).
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

import { registerReindexCommand } from './reindex';
import { registerSearchCommand } from './search';
import { registerStatusCommand } from './status';

// Mock console methods
let consoleLogSpy: MockInstance;
let consoleErrorSpy: MockInstance;
let processExitSpy: MockInstance;

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  processExitSpy = vi
    .spyOn(process, 'exit')
    .mockImplementation(() => undefined as never);
  mockFetch.mockClear();
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  processExitSpy.mockRestore();
});

describe('status command', () => {
  it('calls API and formats JSON output', async () => {
    const { Command } = await import('@commander-js/extra-typings');
    const cli = new Command();
    registerStatusCommand(cli);

    const mockResponse = { status: 'running', uptime: 1234 };
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    await cli.parseAsync(['node', 'test', 'status']);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:1936/status',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify(mockResponse, null, 2),
    );
  });

  it('handles non-JSON response', async () => {
    const { Command } = await import('@commander-js/extra-typings');
    const cli = new Command();
    registerStatusCommand(cli);

    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('plain text response'),
    });

    await cli.parseAsync(['node', 'test', 'status']);

    expect(consoleLogSpy).toHaveBeenCalledWith('plain text response');
  });

  it('handles API connection failure', async () => {
    const { Command } = await import('@commander-js/extra-typings');
    const cli = new Command();
    registerStatusCommand(cli);

    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    await cli.parseAsync(['node', 'test', 'status']);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Could not connect to jeeves-watcher. Is it running?',
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('accepts custom host and port', async () => {
    const { Command } = await import('@commander-js/extra-typings');
    const cli = new Command();
    registerStatusCommand(cli);

    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('{}'),
    });

    await cli.parseAsync([
      'node',
      'test',
      'status',
      '--host',
      'localhost',
      '--port',
      '8080',
    ]);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/status',
      expect.any(Object),
    );
  });
});

describe('search command', () => {
  it('sends query and limit to API', async () => {
    const { Command } = await import('@commander-js/extra-typings');
    const cli = new Command();
    registerSearchCommand(cli);

    const mockResults = [{ id: '1', score: 0.95 }];
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockResults)),
    });

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
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ query: 'test query', limit: 5 }),
      }),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify(mockResults, null, 2),
    );
  });

  it('uses default limit of 10', async () => {
    const { Command } = await import('@commander-js/extra-typings');
    const cli = new Command();
    registerSearchCommand(cli);

    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('[]'),
    });

    await cli.parseAsync(['node', 'test', 'search', 'query']);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ query: 'query', limit: 10 }),
      }),
    );
  });

  it('handles API error', async () => {
    const { Command } = await import('@commander-js/extra-typings');
    const cli = new Command();
    registerSearchCommand(cli);

    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal server error'),
    });

    await cli.parseAsync(['node', 'test', 'search', 'query']);

    expect(consoleErrorSpy).toHaveBeenCalledWith('Internal server error');
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});

describe('reindex command', () => {
  it('calls POST /reindex', async () => {
    const { Command } = await import('@commander-js/extra-typings');
    const cli = new Command();
    registerReindexCommand(cli);

    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('Reindex started'),
    });

    await cli.parseAsync(['node', 'test', 'reindex']);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:1936/reindex',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('Reindex started');
  });

  it('handles API error', async () => {
    const { Command } = await import('@commander-js/extra-typings');
    const cli = new Command();
    registerReindexCommand(cli);

    mockFetch.mockRejectedValue(new Error('Network error'));

    await cli.parseAsync(['node', 'test', 'reindex']);

    expect(consoleErrorSpy).toHaveBeenCalledWith('Network error');
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
