/**
 * @module api/catalogRoutes.test
 * The catalog routes end to end, over the wire app: a request-validation failure in each input slot is jeeves's `400 FST_ERR_VALIDATION` naming that slot; every JSON response the server sends equals what the handler returned (response validation changes nothing), one test per wire scenario; and the typed catalog client round-trips every entry over real HTTP with the bearer key.
 */

import { createCatalogClient } from '@karmaniverous/jeeves/catalog';
import { WATCHER_CATALOG } from '@karmaniverous/jeeves-watcher-core';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  clearCaptured,
  inScope,
  resultsFor,
} from '../test/wire/handlerCapture';
import { WIRE_SCENARIOS } from '../test/wire/scenarios';
import { startWireApp, VCS_FILES, type WireApp } from '../test/wire/wireApp';
import { injectScenario } from '../test/wire/wireRun';
import { WIRE_KEY } from '../test/wire/wireStubs';
import type * as CatalogModule from './catalog';
import type * as FileScanModule from './fileScan';

// The wire fixture's watch glob is relative (`**/*.md`), so the prune dry
// run's file listing would walk the working directory (the whole package,
// node_modules included). The wire format does not depend on that listing
// (prunePlan and reindexPrune tests cover it): list no files.
vi.mock('./fileScan', async (importOriginal) => ({
  ...(await importOriginal<typeof FileScanModule>()),
  listFilesFromGlobs: () => Promise.resolve([]),
}));
vi.mock('./catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof CatalogModule>();
  // The same module instance the tests read from.
  const { captureHandlers } = await import('../test/wire/handlerCapture');
  return {
    ...actual,
    createCatalogHandlers: (
      ...args: Parameters<typeof actual.createCatalogHandlers>
    ) => captureHandlers(actual.createCatalogHandlers(...args)),
  };
});

let wire: WireApp;

beforeAll(async () => {
  wire = await startWireApp();
}, 30_000);

afterAll(async () => {
  await wire.close();
});

// Every test reads only the handler results its own requests caused.
beforeEach(() => {
  clearCaptured();
});

describe('request validation', () => {
  it.each([
    ['query', 'GET', '/vcs/show?path=a.md', undefined, ['commit']],
    ['body', 'POST', '/render', {}, ['path']],
    ['body', 'POST', '/render', { source: 'not a ref' }, ['source']],
    ['body', 'POST', '/render', { path: 'a.md', source: 'app://1' }, []],
    ['body', 'POST', '/search', undefined, []],
    ['body', 'POST', '/search', { query: '' }, ['query']],
    ['body', 'POST', '/search', { query: 'q', limit: 'ten' }, ['limit']],
    ['body', 'POST', '/scan', { limit: 5 }, ['filter']],
    ['body', 'POST', '/scan', { filter: {}, limit: 0 }, ['limit']],
    ['body', 'POST', '/scan', { filter: {}, fields: 'file_path' }, ['fields']],
    ['body', 'POST', '/config/apply', { patch: 'nope' }, ['patch']],
  ] as const)(
    'rejects a bad %s on %s %s %j with 400 FST_ERR_VALIDATION',
    async (slot, method, url, payload, issuePath) => {
      const { value: res, results } = await inScope(() =>
        wire.app.inject({
          method,
          url,
          headers: { authorization: `Bearer ${WIRE_KEY}` },
          ...(payload === undefined ? {} : { payload }),
        }),
      );

      expect(res.statusCode).toBe(400);
      const body = res.json<{
        statusCode: number;
        code: string;
        error: string;
        message: string;
      }>();
      expect(body).toMatchObject({
        statusCode: 400,
        code: 'FST_ERR_VALIDATION',
        error: 'Bad Request',
      });
      // Fastify names the slot (`querystring` for the query) and the path.
      const named = slot === 'query' ? 'querystring' : slot;
      const where = [named, ...issuePath.map(String)].join('/');
      expect(body.message.startsWith(where)).toBe(true);
      expect(results).toEqual([]);
    },
  );
});

describe('serialised response equals the handler result', () => {
  /** Scenarios whose JSON reply was compared with the handler result. */
  const checked: string[] = [];

  // One test per scenario: each has its own timeout and names itself when
  // slow. Scenarios that reach no handler, or answer without a JSON body,
  // have nothing to compare.
  it.each(WIRE_SCENARIOS.map((s) => [s.name, s] as const))(
    '%s',
    async (name, scenario) => {
      const { value: res, results } = await inScope(() =>
        injectScenario(wire, scenario),
      );
      if (results.length === 0) return;
      expect(results).toHaveLength(1);
      const [{ result }] = results;
      expect(res.statusCode).toBe(result.status);
      // HEAD replies carry no body; raw file content (vcs/show, whatever its
      // content type) is compared byte for byte by the wire test.
      const isJson = /json/.test(String(res.headers['content-type']));
      const raw = typeof result.body === 'string';
      if (!isJson || raw || scenario.method === 'HEAD') return;
      expect(res.json<unknown>()).toEqual(
        JSON.parse(JSON.stringify(result.body)) as unknown,
      );
      checked.push(name);
    },
  );

  // Runs after the scenario tests above (tests in a file run in order).
  it('compared at least 20 JSON replies', () => {
    expect(checked.length).toBeGreaterThanOrEqual(20);
  });
});

describe('catalog client round trip', () => {
  let baseUrl: string;

  beforeAll(async () => {
    await wire.reset();
    baseUrl = await wire.app.listen({ port: 0, host: '127.0.0.1' });
  });

  const client = () =>
    createCatalogClient(WATCHER_CATALOG, {
      baseUrl,
      auth: { bearer: WIRE_KEY },
    });

  it('reads status without the key and config with it', async () => {
    const status = await client().status();
    expect(status).toMatchObject({ name: 'watcher', version: '0.0.0-wire' });

    const config = await client().config({ path: '$.watch' });
    expect(config).toMatchObject({ count: 1 });
  });

  it('sends no key for status, even with one configured', async () => {
    const seen: (string | null)[] = [];
    const fetchSpy = vi.fn((...args: Parameters<typeof fetch>) => {
      seen.push(new Headers(args[1]?.headers).get('authorization'));
      return fetch(...args);
    });
    const spied = createCatalogClient(WATCHER_CATALOG, {
      baseUrl,
      auth: { bearer: WIRE_KEY },
      fetch: fetchSpy,
    });

    await spied.status();
    await spied.config({ path: '$.watch' });

    expect(seen).toEqual([null, `Bearer ${WIRE_KEY}`]);
  });
  it('searches, scans and renders, decoding exactly what the handler returned', async () => {
    const hits = await client().search({ query: 'hello' });
    const page = await client().scan({ filter: {}, limit: 1 });
    const rendered = await client().render({ path: 'docs/a.md' });

    expect(hits.length).toBeGreaterThan(0);
    expect(page).toMatchObject({ cursor: 'next' });
    // Real HTTP requests run outside any test scope.
    const results = resultsFor(undefined);
    expect(results.map(({ entry }) => entry)).toEqual([
      'search',
      'scan',
      'render',
    ]);
    expect([hits, page, rendered]).toEqual(
      results.map(
        ({ result }) => JSON.parse(JSON.stringify(result.body)) as unknown,
      ),
    );
  });

  it('shows a committed file as text', async () => {
    const [name, content] = Object.entries(VCS_FILES)[0];
    const text = await client().showVcsFile({
      path: `${wire.vcsRoot}/${name}`,
      commit: wire.commit,
    });
    expect(text).toBe(content);
  });

  it('applies an empty patch', async () => {
    const applied = await client().configApply({ patch: {} });
    expect(applied).toMatchObject({ applied: true });
  });

  it('surfaces a 401 when the key is wrong', async () => {
    const bad = createCatalogClient(WATCHER_CATALOG, {
      baseUrl,
      auth: { bearer: 'wrong' },
    });
    await expect(bad.config()).rejects.toMatchObject({ status: 401 });
  });
});
