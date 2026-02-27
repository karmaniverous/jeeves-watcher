import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PluginApi } from './helpers.js';
import { createMemoryTools } from './memoryTools.js';

// Mock fetch globally
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function makeApi(workspace: string): PluginApi {
  return {
    config: {
      agents: { defaults: { workspace } },
    },
    registerTool: () => {},
  };
}

function mockFetchOk(data: unknown = {}) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

describe('createMemoryTools', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'jw-test-'));
    fetchMock.mockReset();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('lazy init', () => {
    it('calls status, unregister, register on first memory_search', async () => {
      fetchMock.mockResolvedValue(mockFetchOk([]));

      const api = makeApi(tempDir);
      const { memorySearch } = createMemoryTools(api, 'http://localhost:3458');

      await memorySearch('id1', { query: 'test' });

      expect(fetchMock).toHaveBeenCalledTimes(5); // status, unregister, register, reapply, search
      expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3458/status');
      expect(fetchMock.mock.calls[1][0]).toBe(
        'http://localhost:3458/rules/unregister',
      );
      expect(fetchMock.mock.calls[2][0]).toBe(
        'http://localhost:3458/rules/register',
      );
      expect(fetchMock.mock.calls[3][0]).toBe(
        'http://localhost:3458/rules/reapply',
      );
      expect(fetchMock.mock.calls[4][0]).toBe('http://localhost:3458/search');
    });

    it('skips init on subsequent calls', async () => {
      fetchMock.mockResolvedValue(mockFetchOk([]));

      const api = makeApi(tempDir);
      const { memorySearch } = createMemoryTools(api, 'http://localhost:3458');

      await memorySearch('id1', { query: 'first' });
      fetchMock.mockClear();

      await memorySearch('id2', { query: 'second' });
      expect(fetchMock).toHaveBeenCalledTimes(2); // status check + search
    });

    it('retries init after failure', async () => {
      fetchMock.mockRejectedValueOnce(
        Object.assign(new Error('fetch failed'), {
          cause: { code: 'ECONNREFUSED' },
        }),
      );

      const api = makeApi(tempDir);
      const { memorySearch } = createMemoryTools(api, 'http://localhost:3458');

      // First call fails
      const result1 = await memorySearch('id1', { query: 'test' });
      expect(result1.isError).toBe(true);

      // Second call retries init
      fetchMock.mockResolvedValue(mockFetchOk([]));
      const result2 = await memorySearch('id2', { query: 'test' });
      expect(result2.isError).toBeUndefined();
    });

    it('registers rules with correct workspace paths', async () => {
      fetchMock.mockResolvedValue(mockFetchOk([]));

      const api = makeApi(tempDir);
      const { memorySearch } = createMemoryTools(api, 'http://localhost:3458');

      await memorySearch('id1', { query: 'test' });

      // Check the register call body
      const registerCall = fetchMock.mock.calls[2] as [
        string,
        { body: string },
      ];
      const body = JSON.parse(registerCall[1].body) as {
        source: string;
        rules: Array<{ name: string }>;
      };
      expect(body.source).toBe('jeeves-watcher-openclaw');
      expect(body.rules).toHaveLength(2);
      expect(body.rules[0].name).toBe('openclaw-memory-longterm');
      expect(body.rules[1].name).toBe('openclaw-memory-daily');
    });
  });

  describe('memory_search result mapping', () => {
    it('maps payload fields to expected format', async () => {
      const searchResults = [
        {
          id: 'p1',
          score: 0.95,
          payload: {
            file_path: '/ws/MEMORY.md',
            chunk_text: 'some content',
            line_start: 10,
            line_end: 20,
          },
        },
      ];
      // Status, unregister, register, reapply return ok; search returns results
      fetchMock
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk(searchResults));

      const api = makeApi(tempDir);
      const { memorySearch } = createMemoryTools(api, 'http://localhost:3458');

      const result = await memorySearch('id1', { query: 'test' });
      const parsed = JSON.parse(result.content[0].text) as Array<
        Record<string, unknown>
      >;

      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toEqual({
        path: '/ws/MEMORY.md',
        snippet: 'some content',
        score: 0.95,
        from: 10,
        to: 20,
      });
    });

    it('omits from/to when line offsets missing', async () => {
      const searchResults = [
        {
          id: 'p1',
          score: 0.8,
          payload: { file_path: '/ws/MEMORY.md', chunk_text: 'old point' },
        },
      ];
      fetchMock
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk(searchResults));

      const api = makeApi(tempDir);
      const { memorySearch } = createMemoryTools(api, 'http://localhost:3458');

      const result = await memorySearch('id1', { query: 'test' });
      const parsed = JSON.parse(result.content[0].text) as Array<
        Record<string, unknown>
      >;

      expect(parsed[0]).toEqual({
        path: '/ws/MEMORY.md',
        snippet: 'old point',
        score: 0.8,
      });
      expect(parsed[0]).not.toHaveProperty('from');
      expect(parsed[0]).not.toHaveProperty('to');
    });

    it('forwards maxResults as limit in search body', async () => {
      fetchMock
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk([]));

      const api = makeApi(tempDir);
      const { memorySearch } = createMemoryTools(api, 'http://localhost:3458');

      await memorySearch('id1', { query: 'test', maxResults: 3 });

      const searchCall = fetchMock.mock.calls[4] as [string, RequestInit];
      const body = JSON.parse(searchCall[1].body as string) as Record<
        string,
        unknown
      >;
      expect(body.limit).toBe(3);
    });

    it('filters by minScore', async () => {
      const searchResults = [
        {
          id: 'p1',
          score: 0.9,
          payload: { file_path: '/a.md', chunk_text: 'high' },
        },
        {
          id: 'p2',
          score: 0.3,
          payload: { file_path: '/b.md', chunk_text: 'low' },
        },
      ];
      fetchMock
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk(searchResults));

      const api = makeApi(tempDir);
      const { memorySearch } = createMemoryTools(api, 'http://localhost:3458');

      const result = await memorySearch('id1', {
        query: 'test',
        minScore: 0.5,
      });
      const parsed = JSON.parse(result.content[0].text) as unknown[];
      expect(parsed).toHaveLength(1);
    });
  });

  describe('memory_get', () => {
    it('reads MEMORY.md from workspace', async () => {
      const filePath = join(tempDir, 'MEMORY.md');
      await writeFile(filePath, 'Line 1\nLine 2\nLine 3\n');

      const api = makeApi(tempDir);
      const { memoryGet } = createMemoryTools(api, 'http://localhost:3458');

      const result = await memoryGet('id1', { path: filePath });
      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toContain('Line 1');
    });

    it('reads with from/lines range', async () => {
      const filePath = join(tempDir, 'MEMORY.md');
      await writeFile(filePath, 'Line 1\nLine 2\nLine 3\nLine 4\n');

      const api = makeApi(tempDir);
      const { memoryGet } = createMemoryTools(api, 'http://localhost:3458');

      const result = await memoryGet('id1', {
        path: filePath,
        from: 2,
        lines: 2,
      });
      const content = JSON.parse(result.content[0].text) as string;
      expect(content).toBe('Line 2\nLine 3');
    });

    it('reads memory subdirectory files', async () => {
      const { mkdir } = await import('node:fs/promises');
      const memDir = join(tempDir, 'memory');
      await mkdir(memDir, { recursive: true });
      const filePath = join(memDir, '2026-02-27.md');
      await writeFile(filePath, 'Daily notes');

      const api = makeApi(tempDir);
      const { memoryGet } = createMemoryTools(api, 'http://localhost:3458');

      const result = await memoryGet('id1', { path: filePath });
      expect(result.isError).toBeUndefined();
    });

    it('rejects paths outside workspace', async () => {
      const api = makeApi(tempDir);
      const { memoryGet } = createMemoryTools(api, 'http://localhost:3458');

      const result = await memoryGet('id1', {
        path: '/etc/passwd',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not within memory scope');
    });

    it('rejects non-md files in memory directory', async () => {
      const api = makeApi(tempDir);
      const { memoryGet } = createMemoryTools(api, 'http://localhost:3458');

      const result = await memoryGet('id1', {
        path: join(tempDir, 'memory', 'secret.txt'),
      });
      expect(result.isError).toBe(true);
    });

    it('rejects files outside memory/ subdirectory', async () => {
      const api = makeApi(tempDir);
      const { memoryGet } = createMemoryTools(api, 'http://localhost:3458');

      const result = await memoryGet('id1', {
        path: join(tempDir, 'other.md'),
      });
      expect(result.isError).toBe(true);
    });
  });
});
