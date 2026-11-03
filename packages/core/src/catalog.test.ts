import type { CatalogEntry } from '@karmaniverous/jeeves/catalog';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import { vcsShowQuerySchema, watcherHealthSchema } from './api/index.js';
import { WATCHER_CATALOG } from './catalog.js';
import { getEndpoint, WATCHER_ENDPOINTS } from './endpoints.js';

/** `kind` per entry (spec Design 3, under the 0.20.0 names). */
const KINDS = {
  read: [
    'status',
    'config',
    'configSchema',
    'configMatch',
    'configValidate',
    'search',
    'scan',
    'searchFacets',
    'render',
    'walk',
    'issues',
    'vcsStatus',
    'vcsHistory',
    'vcsShow',
    'vcsDiff',
    'vcsCheckExclusion',
  ],
  write: [
    'configApply',
    'metadata',
    'reindex',
    'documents',
    'rulesRegister',
    'rulesReapply',
    'rebuildMetadata',
  ],
  destructive: [
    'documentsDelete',
    'pointsDelete',
    'rulesUnregister',
    'rulesUnregisterBySource',
    'vcsRevert',
    'vcsExclude',
  ],
} as const;

const TEXT_PLAIN = new Set(['vcsShow', 'vcsDiff']);

const entry = (name: string) => {
  const found = WATCHER_CATALOG.entries.find((e) => e.name === name);
  if (!found) throw new Error(`no entry ${name}`);
  return found;
};

describe('WATCHER_CATALOG', () => {
  it('has one entry per WATCHER_ENDPOINTS endpoint (29)', () => {
    expect(WATCHER_CATALOG.entries.map((e) => e.name).sort()).toEqual(
      WATCHER_ENDPOINTS.map((e) => e.name).sort(),
    );
    expect(WATCHER_CATALOG.entries).toHaveLength(29);
  });

  it.each(WATCHER_ENDPOINTS.map((e) => e.name))(
    '%s agrees with WATCHER_ENDPOINTS on method and path (D23)',
    (name) => {
      const endpoint = getEndpoint(name);
      expect({ method: entry(name).method, path: entry(name).path }).toEqual({
        method: endpoint.method,
        path: endpoint.path,
      });
    },
  );

  it('leaves only status unauthenticated; every other entry takes the bearer key', () => {
    const bearer = { schemes: [{ in: 'bearer' }] };
    expect(
      Object.fromEntries(WATCHER_CATALOG.entries.map((e) => [e.name, e.auth])),
    ).toEqual(
      Object.fromEntries(
        WATCHER_ENDPOINTS.map(({ name }) => [
          name,
          name === 'status' ? 'none' : bearer,
        ]),
      ),
    );
  });

  it('gives every entry its Design 3 kind', () => {
    const expected = Object.fromEntries(
      Object.entries(KINDS).flatMap(([kind, names]) =>
        names.map((name) => [name, kind]),
      ),
    );
    expect(
      Object.fromEntries(WATCHER_CATALOG.entries.map((e) => [e.name, e.kind])),
    ).toEqual(expected);
  });

  it('declares vcsShow and vcsDiff as text/plain and every other entry as JSON', () => {
    const entries = WATCHER_CATALOG.entries as readonly CatalogEntry[];
    expect(
      Object.fromEntries(entries.map((e) => [e.name, e.contentType])),
    ).toEqual(
      Object.fromEntries(
        entries.map((e) => [
          e.name,
          TEXT_PLAIN.has(e.name) ? 'text/plain' : undefined,
        ]),
      ),
    );
  });

  // `response` is required by the CatalogEntry type, so only inputs are checked.
  it('gives every entry a request schema for each input it takes', () => {
    const entries = WATCHER_CATALOG.entries as readonly CatalogEntry[];
    const missing = entries.flatMap((e) => [
      ...(e.method === 'POST' && e.body === undefined
        ? [`${e.name}.body`]
        : []),
      ...(e.path.includes(':') && e.params === undefined
        ? [`${e.name}.params`]
        : []),
    ]);
    expect(missing).toEqual([]);
  });

  it('accepts exactly one deleteDocuments selector', () => {
    const body = WATCHER_CATALOG.byName('documentsDelete').body;
    const filter = { must: [{ key: 'a', match: { value: 1 } }] };
    expect(body.safeParse({ sources: ['app://d/1'] }).success).toBe(true);
    expect(body.safeParse({ filter }).success).toBe(true);
    expect(body.safeParse({}).success).toBe(false);
    expect(body.safeParse({ sources: ['app://d/1'], filter }).success).toBe(
      false,
    );
  });
  it('types the status health with watcherHealthSchema', () => {
    const status = WATCHER_CATALOG.byName('status');
    const parsed = status.response.parse({
      name: 'watcher',
      version: '1.0.0',
      uptime: 1,
      status: 'healthy',
      health: { collection: { name: 'c', pointCount: 1, dimensions: 3 } },
    });
    expect(parsed.health.collection?.pointCount).toBe(1);
  });

  it('describes the search and scan request fields', () => {
    for (const name of ['search', 'scan'] as const) {
      const shape = WATCHER_CATALOG.byName(name).body.shape;
      for (const [key, field] of Object.entries(shape)) {
        expect((field as z.ZodType).description, `${name}.${key}`).toBeTruthy();
      }
    }
  });

  it('keeps literal entry names', () => {
    expect(WATCHER_CATALOG.byName('vcsShow').name).toBe('vcsShow');
    expectTypeOf(
      WATCHER_CATALOG.byName('vcsShow').name,
    ).toEqualTypeOf<'vcsShow'>();
  });
});

describe('watcherHealthSchema', () => {
  it('accepts the healthy shape', () => {
    expect(
      watcherHealthSchema.parse({
        collection: { name: 'c', pointCount: 0, dimensions: 3 },
        reindex: {
          active: true,
          scope: 'full',
          filesProcessed: 1,
          totalFiles: 2,
        },
        initialScan: { active: false, filesMatched: 3, durationMs: 4 },
      }),
    ).toMatchObject({ reindex: { active: true } });
  });

  it('accepts the degraded shape and keeps unknown keys', () => {
    expect(watcherHealthSchema.parse({ error: 'down', extra: 1 })).toEqual({
      error: 'down',
      extra: 1,
    });
  });

  it('rejects a malformed collection', () => {
    expect(
      watcherHealthSchema.safeParse({ collection: { name: 'c' } }).success,
    ).toBe(false);
  });
});

describe('vcsShowQuerySchema', () => {
  it('requires non-empty path and commit', () => {
    expect(
      vcsShowQuerySchema.safeParse({ path: 'a', commit: 'b' }).success,
    ).toBe(true);
    expect(
      vcsShowQuerySchema.safeParse({ path: '', commit: 'b' }).success,
    ).toBe(false);
    expect(vcsShowQuerySchema.safeParse({ path: 'a' }).success).toBe(false);
  });

  it('names the missing parameter', () => {
    const missing = vcsShowQuerySchema.safeParse({ commit: 'b' });
    expect(missing.error?.issues[0]?.message).toBe(
      'Missing required query parameter: path',
    );
    const empty = vcsShowQuerySchema.safeParse({ path: 'a', commit: '' });
    expect(empty.error?.issues[0]?.message).toBe(
      'Missing required query parameter: commit',
    );
  });
});
