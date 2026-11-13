/**
 * @module plugin/distSmoke.test
 * Smoke test of the built plugin (`dist/index.js`, as OpenClaw loads it): it imports watcher-core and the SDK rather than bundling them (D205), registers the 18 tools in their 0.17.0 order (under their D77 names), then the four D206 read tools, with watcher-core and the SDK resolved from `node_modules`, keeps `watcher_search` and `watcher_scan` `direct-only`, and a catalog-built tool sends the bearer key through the SDK. Runs after `npm run build`; in CI (which builds before testing) a missing `dist` fails. A `dist` older than the plugin's source or its build config (`package.json`, `rollup.config.ts`, `tsconfig.json` and the root `tsconfig.json` it extends), or a missing or out-of-date watcher-core or SDK build, is skipped with a rebuild message instead of tested (spec D201); in CI it fails.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { PluginApi, ToolDescriptor } from '@karmaniverous/jeeves';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isOlderThanInputs } from './test/distFreshness.js';
import { renamedTool } from './test/toolRenames.js';

const DIST = new URL('../dist/index.js', import.meta.url);
const built = existsSync(fileURLToPath(DIST));

/** What `dist/index.js` is built from: this package's source only (D205). */
const INPUTS = [fileURLToPath(new URL('./', import.meta.url))];
/**
 * The workspace builds it imports at run time (watcher-core and the SDK,
 * linked into `node_modules`): each must exist and be newer than its source.
 */
const LINKED = ['core', 'sdk'].map((pkg) => ({
  dist: fileURLToPath(new URL(`../../${pkg}/dist/index.js`, import.meta.url)),
  src: fileURLToPath(new URL(`../../${pkg}/src/`, import.meta.url)),
}));
/** Build configuration: a newer manifest, rollup config or tsconfig (package or root) also makes `dist` stale. */
const CONFIG_FILES = [
  '../package.json',
  '../rollup.config.ts',
  '../tsconfig.json',
  '../../../tsconfig.json',
].map((path) => fileURLToPath(new URL(path, import.meta.url)));
const STALE =
  'dist (or a watcher-core or SDK build) is missing or older than its src or build config; run npm run build';
const stale =
  built &&
  (isOlderThanInputs(fileURLToPath(DIST), INPUTS) ||
    CONFIG_FILES.some(
      (file) => statSync(file).mtimeMs > statSync(DIST).mtimeMs,
    ) ||
    LINKED.some(
      ({ dist, src }) => !existsSync(dist) || isOlderThanInputs(dist, [src]),
    ));
if (stale) console.warn(`distSmoke: ${STALE}`);

const baselineNames = (
  JSON.parse(
    readFileSync(
      new URL('./test/baseline-0.17.0/tools.json', import.meta.url),
      'utf8',
    ),
  ) as { name: string }[]
).map((t) => renamedTool(t.name));

/** The four read tools D206 adds after the 0.17.0 set. */
const D206_TOOLS = [
  'watcher_list_facets',
  'watcher_count_facets',
  'watcher_render',
  'watcher_match_config',
];

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

  it.runIf(Boolean(process.env.CI))('is not stale in CI', () => {
    expect(stale).toBe(false);
  });

  // Skipped, with the rebuild message above, when dist is stale.
  describe.runIf(built && !stale)('dist/index.js', () => {
    it('imports watcher-core and the SDK, bundling neither (D205)', () => {
      const code = readFileSync(DIST, 'utf8');
      const imported = [...code.matchAll(/^import .* from '([^']+)';$/gm)].map(
        ([, from]) => from,
      );
      expect(imported).toEqual(
        expect.arrayContaining([
          '@karmaniverous/jeeves-watcher-core',
          '@karmaniverous/jeeves-watcher-sdk',
        ]),
      );
      expect(code).not.toMatch(/class WatcherError|WATCHER_CATALOG =/);
    });

    it('registers the 18 tools in their 0.17.0 order, renamed (D77), then the D206 four', async () => {
      const tools = await registerDist({});
      expect([...tools.keys()]).toEqual([...baselineNames, ...D206_TOOLS]);
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
