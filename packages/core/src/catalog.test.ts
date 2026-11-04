import type { CatalogEntry } from '@karmaniverous/jeeves/catalog';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import { vcsShowQuerySchema, watcherHealthSchema } from './api/index.js';
import { VCS_DISABLED_NOTE, WATCHER_CATALOG } from './catalog.js';

/**
 * Every entry's method and path, by its verb-first name (D77, Design 14).
 * The paths are the 0.20.0 paths: renames never change a route.
 */
const ROUTES = {
  status: ['GET', '/status'],
  config: ['GET', '/config'],
  configApply: ['POST', '/config/apply'],
  getConfigSchema: ['GET', '/config/schema'],
  matchConfig: ['POST', '/config/match'],
  validateConfig: ['POST', '/config/validate'],
  search: ['POST', '/search'],
  scan: ['POST', '/scan'],
  listFacets: ['GET', '/search/facets'],
  render: ['POST', '/render'],
  walk: ['POST', '/walk'],
  listIssues: ['GET', '/issues'],
  getVcsStatus: ['GET', '/vcs/status'],
  listVcsHistory: ['GET', '/vcs/history'],
  showVcsFile: ['GET', '/vcs/show'],
  diffVcs: ['GET', '/vcs/diff'],
  checkVcsExclusion: ['GET', '/vcs/check-exclusion'],
  setMetadata: ['POST', '/metadata'],
  reindex: ['POST', '/reindex'],
  notifyDocuments: ['POST', '/documents'],
  registerRules: ['POST', '/rules/register'],
  reapplyRules: ['POST', '/rules/reapply'],
  rebuildMetadata: ['POST', '/rebuild-metadata'],
  deleteDocuments: ['POST', '/documents/delete'],
  deletePoints: ['POST', '/points/delete'],
  unregisterRules: ['DELETE', '/rules/unregister'],
  unregisterRulesBySource: ['DELETE', '/rules/unregister/:source'],
  revertVcs: ['POST', '/vcs/revert'],
  excludeVcsPath: ['POST', '/vcs/exclude'],
} as const;

/** `kind` per entry (spec Design 3). */
const KINDS = {
  read: [
    'status',
    'config',
    'getConfigSchema',
    'matchConfig',
    'validateConfig',
    'search',
    'scan',
    'listFacets',
    'render',
    'walk',
    'listIssues',
    'getVcsStatus',
    'listVcsHistory',
    'showVcsFile',
    'diffVcs',
    'checkVcsExclusion',
  ],
  write: [
    'configApply',
    'setMetadata',
    'reindex',
    'notifyDocuments',
    'registerRules',
    'reapplyRules',
    'rebuildMetadata',
  ],
  destructive: [
    'deleteDocuments',
    'deletePoints',
    'unregisterRules',
    'unregisterRulesBySource',
    'revertVcs',
    'excludeVcsPath',
  ],
} as const;

const TEXT_PLAIN = new Set(['showVcsFile', 'diffVcs']);

describe('WATCHER_CATALOG', () => {
  it('holds the 29 operations under their verb-first names, on the 0.20.0 methods and paths', () => {
    expect(
      Object.fromEntries(
        WATCHER_CATALOG.entries.map((e) => [e.name, [e.method, e.path]]),
      ),
    ).toEqual(ROUTES);
    expect(WATCHER_CATALOG.entries).toHaveLength(29);
  });

  it('leaves only status unauthenticated; every other entry takes the bearer key', () => {
    const bearer = { schemes: [{ in: 'bearer' }] };
    expect(
      Object.fromEntries(WATCHER_CATALOG.entries.map((e) => [e.name, e.auth])),
    ).toEqual(
      Object.fromEntries(
        Object.keys(ROUTES).map((name) => [
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

  it('declares showVcsFile and diffVcs as text/plain and every other entry as JSON', () => {
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
    const body = WATCHER_CATALOG.byName('deleteDocuments').body;
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

  it('ends the description of every /vcs/ entry, and only those, with the VCS-off note', () => {
    const noted = WATCHER_CATALOG.entries
      .filter((e) => e.description.endsWith(` ${VCS_DISABLED_NOTE}`))
      .map((e) => e.name);
    const vcs = WATCHER_CATALOG.entries
      .filter((e) => e.path.startsWith('/vcs/'))
      .map((e) => e.name);
    expect(vcs).toHaveLength(7);
    expect(noted).toEqual(vcs);
  });

  it('keeps the extra text of showVcsFile and diffVcs before the VCS-off note', () => {
    expect(WATCHER_CATALOG.byName('diffVcs').description).toBe(
      `Show what changed between two versions, or between a version and current. The reply is a unified diff. ${VCS_DISABLED_NOTE}`,
    );
  });

  it('takes since and until on the listVcsHistory query', () => {
    const query = WATCHER_CATALOG.byName('listVcsHistory').query;
    expect(
      query.parse({ glob: '*.md', since: '2024-01-01', until: '2024-12-31' }),
    ).toEqual({ glob: '*.md', since: '2024-01-01', until: '2024-12-31' });
  });

  it('keeps literal entry names', () => {
    expect(WATCHER_CATALOG.byName('showVcsFile').name).toBe('showVcsFile');
    expectTypeOf(
      WATCHER_CATALOG.byName('showVcsFile').name,
    ).toEqualTypeOf<'showVcsFile'>();
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
