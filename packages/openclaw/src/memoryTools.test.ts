import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PluginApi } from './helpers.js';
import {
  createMemoryTools,
  PROP_KIND,
  PROP_SOURCE,
  RULE_DAILY,
  RULE_LONGTERM,
  SOURCE_MEMORY,
} from './memoryTools.js';

// Mock fetch globally
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function makeApi(
  workspace: string,
  schemas?: Record<string, unknown>,
): PluginApi {
  return {
    config: {
      agents: { defaults: { workspace } },
      plugins: schemas
        ? {
            entries: {
              'jeeves-watcher-openclaw': {
                config: { schemas },
              },
            },
          }
        : undefined,
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
      const { memorySearch } = createMemoryTools(api, 'http://localhost:1936');

      await memorySearch('id1', { query: 'test' });

      expect(fetchMock).toHaveBeenCalledTimes(5); // status, unregister, register, reapply, search
      expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:1936/status');
      expect(fetchMock.mock.calls[1][0]).toBe(
        'http://localhost:1936/rules/unregister',
      );
      expect(fetchMock.mock.calls[2][0]).toBe(
        'http://localhost:1936/rules/register',
      );
      expect(fetchMock.mock.calls[3][0]).toBe(
        'http://localhost:1936/rules/reapply',
      );
      expect(fetchMock.mock.calls[4][0]).toBe('http://localhost:1936/search');
    });

    it('skips init on subsequent calls', async () => {
      fetchMock.mockResolvedValue(mockFetchOk([]));

      const api = makeApi(tempDir);
      const { memorySearch } = createMemoryTools(api, 'http://localhost:1936');

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
      const { memorySearch } = createMemoryTools(api, 'http://localhost:1936');

      // First call fails
      const result1 = await memorySearch('id1', { query: 'test' });
      expect(result1.isError).toBe(true);

      // Second call retries init
      fetchMock.mockResolvedValue(mockFetchOk([]));
      const result2 = await memorySearch('id2', { query: 'test' });
      expect(result2.isError).toBeUndefined();
    });

    it('registers rules with private namespaced properties', async () => {
      fetchMock.mockResolvedValue(mockFetchOk([]));

      const api = makeApi(tempDir);
      const { memorySearch } = createMemoryTools(api, 'http://localhost:1936');

      await memorySearch('id1', { query: 'test' });

      // Check the register call body
      const registerCall = fetchMock.mock.calls[2] as [
        string,
        { body: string },
      ];
      const body = JSON.parse(registerCall[1].body) as {
        source: string;
        rules: Array<{
          name: string;
          schema: Array<Record<string, unknown>>;
        }>;
      };
      expect(body.source).toBe('jeeves-watcher-openclaw');
      expect(body.rules).toHaveLength(2);
      expect(body.rules[0].name).toBe(RULE_LONGTERM);
      expect(body.rules[1].name).toBe(RULE_DAILY);

      // Verify internal schema uses private properties, NOT domains/kind
      const longtermSchema = body.rules[0].schema[0] as {
        properties: Record<string, unknown>;
      };
      expect(longtermSchema.properties).toHaveProperty(PROP_SOURCE);
      expect(longtermSchema.properties).toHaveProperty(PROP_KIND);
      expect(longtermSchema.properties).not.toHaveProperty('domains');
      expect(longtermSchema.properties).not.toHaveProperty('kind');
    });

    it('composes user schemas from plugin config', async () => {
      fetchMock.mockResolvedValue(mockFetchOk([]));

      const userSchema = {
        type: 'object',
        properties: {
          domains: {
            type: 'array',
            items: { type: 'string' },
            set: ['memory'],
          },
        },
      };
      const api = makeApi(tempDir, {
        [RULE_LONGTERM]: userSchema,
        [RULE_DAILY]: [userSchema],
      });
      const { memorySearch } = createMemoryTools(api, 'http://localhost:1936');

      await memorySearch('id1', { query: 'test' });

      const registerCall = fetchMock.mock.calls[2] as [
        string,
        { body: string },
      ];
      const body = JSON.parse(registerCall[1].body) as {
        rules: Array<{ schema: unknown[] }>;
      };

      // Longterm: internal schema + 1 user schema = 2 entries
      expect(body.rules[0].schema).toHaveLength(2);
      // Daily: internal schema + 1 user schema (from array) = 2 entries
      expect(body.rules[1].schema).toHaveLength(2);
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
      const { memorySearch } = createMemoryTools(api, 'http://localhost:1936');

      const result = await memorySearch('id1', { query: 'test' });
      const parsed = JSON.parse(result.content[0].text) as {
        provider: string;
        results: Array<Record<string, unknown>>;
      };

      expect(parsed.provider).toBe('jeeves-watcher');
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0]).toEqual({
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
      const { memorySearch } = createMemoryTools(api, 'http://localhost:1936');

      const result = await memorySearch('id1', { query: 'test' });
      const parsed = JSON.parse(result.content[0].text) as {
        provider: string;
        results: Array<Record<string, unknown>>;
      };

      expect(parsed.provider).toBe('jeeves-watcher');
      expect(parsed.results[0]).toEqual({
        path: '/ws/MEMORY.md',
        snippet: 'old point',
        score: 0.8,
      });
      expect(parsed.results[0]).not.toHaveProperty('from');
      expect(parsed.results[0]).not.toHaveProperty('to');
    });

    it('filters on private source property, not domains', async () => {
      fetchMock
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk([]));

      const api = makeApi(tempDir);
      const { memorySearch } = createMemoryTools(api, 'http://localhost:1936');

      await memorySearch('id1', { query: 'test' });

      const searchCall = fetchMock.mock.calls[4] as [string, RequestInit];
      const body = JSON.parse(searchCall[1].body as string) as {
        filter: { must: Array<{ key: string; match: { value: string } }> };
      };
      expect(body.filter.must[0].key).toBe(PROP_SOURCE);
      expect(body.filter.must[0].match.value).toBe(SOURCE_MEMORY);
    });

    it('forwards maxResults as limit in search body', async () => {
      fetchMock
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk())
        .mockResolvedValueOnce(mockFetchOk([]));

      const api = makeApi(tempDir);
      const { memorySearch } = createMemoryTools(api, 'http://localhost:1936');

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
      const { memorySearch } = createMemoryTools(api, 'http://localhost:1936');

      const result = await memorySearch('id1', {
        query: 'test',
        minScore: 0.5,
      });
      const parsed = JSON.parse(result.content[0].text) as {
        provider: string;
        results: unknown[];
      };
      expect(parsed.provider).toBe('jeeves-watcher');
      expect(parsed.results).toHaveLength(1);
    });
  });

  describe('memory_get', () => {
    it('reads MEMORY.md from workspace', async () => {
      const filePath = join(tempDir, 'MEMORY.md');
      await writeFile(filePath, 'Line 1\nLine 2\nLine 3\n');

      const api = makeApi(tempDir);
      const { memoryGet } = createMemoryTools(api, 'http://localhost:1936');

      const result = await memoryGet('id1', { path: filePath });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text) as {
        provider: string;
        content: string;
      };
      expect(parsed.provider).toBe('jeeves-watcher');
      expect(parsed.content).toContain('Line 1');
    });

    it('reads with from/lines range', async () => {
      const filePath = join(tempDir, 'MEMORY.md');
      await writeFile(filePath, 'Line 1\nLine 2\nLine 3\nLine 4\n');

      const api = makeApi(tempDir);
      const { memoryGet } = createMemoryTools(api, 'http://localhost:1936');

      const result = await memoryGet('id1', {
        path: filePath,
        from: 2,
        lines: 2,
      });
      const parsed = JSON.parse(result.content[0].text) as {
        provider: string;
        content: string;
      };
      expect(parsed.provider).toBe('jeeves-watcher');
      expect(parsed.content).toBe('Line 2\nLine 3');
    });

    it('reads memory subdirectory files', async () => {
      const { mkdir } = await import('node:fs/promises');
      const memDir = join(tempDir, 'memory');
      await mkdir(memDir, { recursive: true });
      const filePath = join(memDir, '2026-02-27.md');
      await writeFile(filePath, 'Daily notes');

      const api = makeApi(tempDir);
      const { memoryGet } = createMemoryTools(api, 'http://localhost:1936');

      const result = await memoryGet('id1', { path: filePath });
      expect(result.isError).toBeUndefined();
    });

    it('rejects paths outside workspace', async () => {
      const api = makeApi(tempDir);
      const { memoryGet } = createMemoryTools(api, 'http://localhost:1936');

      const result = await memoryGet('id1', {
        path: '/etc/passwd',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not within memory scope');
    });

    it('rejects non-md files in memory directory', async () => {
      const api = makeApi(tempDir);
      const { memoryGet } = createMemoryTools(api, 'http://localhost:1936');

      const result = await memoryGet('id1', {
        path: join(tempDir, 'memory', 'secret.txt'),
      });
      expect(result.isError).toBe(true);
    });

    it('rejects files outside memory/ subdirectory', async () => {
      const api = makeApi(tempDir);
      const { memoryGet } = createMemoryTools(api, 'http://localhost:1936');

      const result = await memoryGet('id1', {
        path: join(tempDir, 'other.md'),
      });
      expect(result.isError).toBe(true);
    });
  });
});
