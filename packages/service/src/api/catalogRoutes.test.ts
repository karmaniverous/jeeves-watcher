/**
 * @module api/catalogRoutes.test
 * The catalog routes end to end, over the wire app: a request-validation failure in each input slot is a `400 invalid_request` naming that slot; every JSON response the server sends equals what the handler returned (response validation changes nothing); and the typed catalog client round-trips every entry over real HTTP with the bearer key.
 */

import { createCatalogClient } from '@karmaniverous/jeeves/catalog';
import { WATCHER_CATALOG } from '@karmaniverous/jeeves-watcher-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { injectScenario, WIRE_SCENARIOS } from '../test/wire/scenarios';
import {
  startWireApp,
  VCS_FILES,
  WIRE_KEY,
  type WireApp,
} from '../test/wire/wireApp';
import type * as CatalogModule from './catalog';

/** What a catalog handler resolves to, as far as these tests look. */
interface RecordedResult {
  status: number;
  body: unknown;
}

/** A catalog handler, as far as these tests call it. */
type AnyHandler = (...call: unknown[]) => Promise<RecordedResult>;

/** Every handler result, in call order (reset per scenario). */
const results = vi.hoisted(
  () => [] as Array<{ entry: string; result: RecordedResult }>,
);

vi.mock('./catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof CatalogModule>();
  return {
    ...actual,
    createCatalogHandlers: (
      ...args: Parameters<typeof actual.createCatalogHandlers>
    ) =>
      Object.fromEntries(
        Object.entries(actual.createCatalogHandlers(...args)).map(
          ([entry, handler]) => [
            entry,
            async (...call: unknown[]) => {
              const result = await (handler as AnyHandler)(...call);
              results.push({ entry, result });
              return result;
            },
          ],
        ),
      ),
  };
});

let wire: WireApp;

beforeAll(async () => {
  wire = await startWireApp();
}, 30_000);

afterAll(async () => {
  await wire.close();
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
    'rejects a bad %s on %s %s %j with 400 invalid_request',
    async (slot, method, url, payload, issuePath) => {
      results.length = 0;
      const res = await wire.app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${WIRE_KEY}` },
        ...(payload === undefined ? {} : { payload }),
      });

      expect(res.statusCode).toBe(400);
      const body = res.json<{
        code: string;
        error: string;
        details: Array<{ slot: string; path: unknown[]; message: string }>;
      }>();
      expect(body.code).toBe('invalid_request');
      expect(body.details.length).toBeGreaterThan(0);
      expect(body.details.every((d) => d.slot === slot)).toBe(true);
      expect(body.error).toBe(body.details[0].message);
      expect(body.details[0].path).toEqual(issuePath);
      expect(results).toEqual([]);
    },
  );
});

describe('serialised response equals the handler result', () => {
  it('holds for every scenario that reaches a JSON handler', async () => {
    let checked = 0;
    for (const scenario of WIRE_SCENARIOS) {
      results.length = 0;
      const res = await injectScenario(wire, scenario);
      if (results.length === 0) continue;
      expect([scenario.name, results.length]).toEqual([scenario.name, 1]);
      const [{ result }] = results;
      expect([scenario.name, res.statusCode]).toEqual([
        scenario.name,
        result.status,
      ]);
      // HEAD replies carry no body; raw file content (vcs/show, whatever its
      // content type) is compared byte for byte by the wire test.
      const isJson = /json/.test(String(res.headers['content-type']));
      const raw = typeof result.body === 'string';
      if (!isJson || raw || scenario.method === 'HEAD') continue;
      expect([scenario.name, res.json<unknown>()]).toEqual([
        scenario.name,
        JSON.parse(JSON.stringify(result.body)) as unknown,
      ]);
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(20);
    // Replays every wire scenario through the real server in one test.
  }, 30_000);
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
    results.length = 0;
    const hits = await client().search({ query: 'hello' });
    const page = await client().scan({ filter: {}, limit: 1 });
    const rendered = await client().render({ path: 'docs/a.md' });

    expect(hits.length).toBeGreaterThan(0);
    expect(page).toMatchObject({ cursor: 'next' });
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
    const text = await client().vcsShow({
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
