/**
 * @module plugin/distSmoke.test
 * Smoke test of the built plugin (`dist/index.js`, as OpenClaw loads it): it registers the 18 tools in their 0.17.0 order from its bundled watcher-core and Zod, keeps `watcher_search` and `watcher_scan` `direct-only`, and a catalog-built tool sends the bearer key. Runs after `npm run build`; in CI (which builds before testing) a missing `dist` fails.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { PluginApi, ToolDescriptor } from '@karmaniverous/jeeves';
import { afterEach, describe, expect, it, vi } from 'vitest';

const DIST = new URL('../dist/index.js', import.meta.url);
const built = existsSync(fileURLToPath(DIST));

const baselineNames = (
  JSON.parse(
    readFileSync(
      new URL('./test/baseline-0.17.0/tools.json', import.meta.url),
      'utf8',
    ),
  ) as { name: string }[]
).map((t) => t.name);

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Register the built plugin against a capturing API. */
async function registerDist(
  pluginConfig: Record<string, unknown>,
): Promise<Map<string, ToolDescriptor>> {
  const { default: register } = (await import(DIST.href)) as {
    default: (api: PluginApi) => void;
  };
  const tools = new Map<string, ToolDescriptor>();
  register({
    pluginConfig,
    registerTool: (tool: ToolDescriptor) => {
      tools.set(tool.name, tool);
    },
    on: () => undefined,
    logger: { warn: () => undefined },
  });
  return tools;
}

describe('built plugin', () => {
  it.runIf(Boolean(process.env.CI))('exists in CI', () => {
    expect(built).toBe(true);
  });

  describe.runIf(built)('dist/index.js', () => {
    it('registers the 18 tools in their 0.17.0 order', async () => {
      const tools = await registerDist({});
      expect([...tools.keys()]).toEqual(baselineNames);
    });

    it('keeps watcher_search and watcher_scan direct-only', async () => {
      const tools = await registerDist({});
      const modes = [...tools.values()]
        .filter((t) => t.catalogMode)
        .map((t) => [t.name, t.catalogMode]);
      expect(modes).toEqual([
        ['watcher_search', 'direct-only'],
        ['watcher_scan', 'direct-only'],
      ]);
    });

    it('sends the bearer key from a catalog-built tool', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve([]),
        text: () => Promise.resolve('[]'),
      });
      vi.stubGlobal('fetch', fetchMock);
      const tools = await registerDist({
        apiUrl: 'http://127.0.0.1:1936',
        apiKey: 'dist-smoke-key',
      });

      const result = await tools
        .get('watcher_search')!
        .execute('1', { query: 'q' });

      expect(result.isError).toBeFalsy();
      const [url, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
      expect(String(url)).toBe('http://127.0.0.1:1936/search');
      expect(
        Object.entries(init.headers as Record<string, string>).find(
          ([name]) => name.toLowerCase() === 'authorization',
        )?.[1],
      ).toBe('Bearer dist-smoke-key');
    });
  });
});
