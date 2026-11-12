/**
 * @module plugin/sdkCall.test
 * Tests for the SDK call path (D205): the client timeouts (5 s for `watcher_status`, 120 s otherwise, D137), the base URL as jeeves's toolset resolves it, a timeout and a non-SDK error read as in 0.19.0, and a malformed `apiUrl` (a listed difference: the SDK's option check answers it).
 */

import {
  DEFAULT_FETCH_TIMEOUT_MS,
  type PluginApi,
} from '@karmaniverous/jeeves';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCatalogTools, createCoreToolset } from './catalogTools.js';
import { DEFAULT_API_URL } from './constants.js';
import { resolveBaseUrl, STATUS_TIMEOUT_MS, toolError } from './sdkCall.js';
import { createWatcherComponent } from './watcherComponent.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const api = (pluginConfig: Record<string, unknown>): PluginApi => ({
  pluginConfig,
  registerTool: () => undefined,
});

const component = createWatcherComponent('0.0.0-test');

/** Answer every request with `body` as JSON; the mock records each URL. */
function stubFetch(body: unknown) {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('client timeouts', () => {
  it.each([
    [
      'watcher_status',
      {},
      {
        name: 'watcher',
        version: '1.0.0',
        uptime: 0,
        status: 'healthy',
        health: {
          collection: { name: 'c', pointCount: 0, dimensions: 3 },
          reindex: { active: false },
        },
      },
      STATUS_TIMEOUT_MS,
    ],
    ['watcher_search', { query: 'q' }, [], DEFAULT_FETCH_TIMEOUT_MS],
    ['watcher_config', {}, {}, DEFAULT_FETCH_TIMEOUT_MS],
  ])(
    '%s times out after its 0.19.0 timeout',
    async (name, params, body, ms) => {
      stubFetch(body);
      const timeout = vi.spyOn(AbortSignal, 'timeout');
      const tools = createCatalogTools(api({}), component);

      const result = await tools.get(name)!.execute('1', params);

      expect(result.isError).toBeFalsy();
      expect(timeout).toHaveBeenCalledWith(ms);
    },
  );

  it('keeps the status probe at 5 s', () => {
    expect(STATUS_TIMEOUT_MS).toBe(5_000);
  });
});

describe('resolveBaseUrl', () => {
  it.each([
    [{ apiUrl: 'http://host:1/' }, 'http://host:1'],
    [{ apiUrl: '  http://host:1//  ' }, 'http://host:1'],
    [{ apiUrl: '   ' }, DEFAULT_API_URL],
    [{}, DEFAULT_API_URL],
  ])('%j resolves to %s', (pluginConfig, url) => {
    expect(resolveBaseUrl(api(pluginConfig))).toBe(url);
  });

  it('falls back to the default for a blank JEEVES_WATCHER_URL', () => {
    vi.stubEnv('JEEVES_WATCHER_URL', '   ');
    expect(resolveBaseUrl(api({}))).toBe(DEFAULT_API_URL);
  });

  it('calls the resolved URL', async () => {
    const fetchMock = stubFetch([]);
    const tools = createCatalogTools(
      api({ apiUrl: 'http://host:1/' }),
      component,
    );

    await tools.get('watcher_search')!.execute('1', { query: 'q' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://host:1/search');
  });
});

describe('errors as 0.19.0 read them', () => {
  it('reads a timeout as 0.19.0 did', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.reject(
          new DOMException(
            'The operation was aborted due to timeout',
            'TimeoutError',
          ),
        ),
      ),
    );
    const old = createCoreToolset(api({}), component).find(
      (t) => t.name === 'watcher_search',
    )!;
    const sdk = createCatalogTools(api({}), component).get('watcher_search')!;

    const expected = await old.execute('1', { query: 'q' });
    const result = await sdk.execute('1', { query: 'q' });

    expect(expected.content[0]?.text).toBe(
      'Error: The operation was aborted due to timeout',
    );
    expect(result).toEqual(expected);
  });

  it('reads a non-SDK error as Error: <message>', () => {
    expect(toolError(new Error('boom'), DEFAULT_API_URL)).toEqual({
      content: [{ type: 'text', text: 'Error: boom' }],
      isError: true,
    });
  });

  it.each([
    ['localhost:1936', 'baseUrl must be an http(s) URL, got "localhost:1936"'],
    [
      'http://host:1/?x=1',
      'baseUrl must not contain a query string or fragment, got "http://host:1/?x=1"',
    ],
  ])(
    'reports apiUrl %s through the SDK option check (a listed difference)',
    async (apiUrl, message) => {
      const fetchMock = stubFetch([]);
      const tools = createCatalogTools(api({ apiUrl }), component);

      const result = await tools
        .get('watcher_search')!
        .execute('1', { query: 'q' });

      expect(result).toEqual({
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
