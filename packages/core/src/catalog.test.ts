import type { CatalogEntry } from '@karmaniverous/jeeves/catalog';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import { vcsShowQuerySchema, watcherHealthSchema } from './api/index.js';
import { WATCHER_CATALOG } from './catalog.js';
import { getEndpoint } from './endpoints.js';

const SLICE = [
  'status',
  'config',
  'configApply',
  'render',
  'search',
  'scan',
  'vcsShow',
] as const;

const entry = (name: string) => {
  const found = WATCHER_CATALOG.entries.find((e) => e.name === name);
  if (!found) throw new Error(`no entry ${name}`);
  return found;
};

describe('WATCHER_CATALOG', () => {
  it('holds exactly the slice entries', () => {
    expect(WATCHER_CATALOG.entries.map((e) => e.name)).toEqual([...SLICE]);
  });

  it.each(SLICE)(
    '%s agrees with WATCHER_ENDPOINTS on method and path',
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
        SLICE.map((name) => [name, name === 'status' ? 'none' : bearer]),
      ),
    );
  });

  it('marks only configApply as a write', () => {
    for (const e of WATCHER_CATALOG.entries) {
      expect(e.kind).toBe(e.name === 'configApply' ? 'write' : 'read');
    }
  });

  it('declares vcsShow as text/plain and every other entry as JSON', () => {
    for (const e of WATCHER_CATALOG.entries as readonly CatalogEntry[]) {
      expect(e.contentType).toBe(
        e.name === 'vcsShow' ? 'text/plain' : undefined,
      );
    }
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
});
