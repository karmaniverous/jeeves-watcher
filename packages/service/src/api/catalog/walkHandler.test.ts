/**
 * @module api/catalog/walkHandler.test
 * POST /walk over the catalog route: filters watched files by the caller's globs, reads the current watcher from its getter, the catalog's 400 for missing or empty globs, and 503s while the initial scan runs or without a watcher.
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerCatalogEntries } from '../../test/catalogRoutes';
import { type CatalogWalkDeps, createCatalogWalkHandler } from './walkHandler';

interface WalkBody {
  paths: string[];
  matchedCount: number;
  scannedRoots: string[];
}

/** Serve the route with `deps`; returns a function posting a body. */
async function serve(deps: CatalogWalkDeps) {
  const app = Fastify({ logger: false });
  await registerCatalogEntries(app, { walk: createCatalogWalkHandler(deps) });
  return async (payload: object) => {
    const res = await app.inject({ method: 'POST', url: '/walk', payload });
    return { status: res.statusCode, body: res.json<WalkBody>() };
  };
}

describe('POST /walk', () => {
  const mockWatcher = {
    getWatchedFiles: vi.fn(),
    isReady: true,
  };

  beforeEach(() => {
    mockWatcher.getWatchedFiles.mockReset();
    mockWatcher.isReady = true;
  });

  const makeDeps = (): CatalogWalkDeps => ({
    getWatchPaths: () => ['c:/data/**/*.md', 'c:/config/**/*.json'],
    getFileSystemWatcher: () => mockWatcher as never,
    logger: {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    } as never,
  });

  it('filters watched files by caller globs', async () => {
    mockWatcher.getWatchedFiles.mockReturnValue([
      'c:/data/foo/.meta/meta.json',
      'c:/data/bar/readme.md',
      'c:/data/baz/.meta/meta.json',
    ]);
    const walk = await serve(makeDeps());

    const { status, body } = await walk({ globs: ['**/.meta/meta.json'] });

    expect(status).toBe(200);
    // Sorted by path (D83), whatever order the inventory holds them in.
    expect(body.paths).toEqual([
      'c:/data/baz/.meta/meta.json',
      'c:/data/foo/.meta/meta.json',
    ]);
    expect(body.matchedCount).toBe(2);
    expect(Array.isArray(body.scannedRoots)).toBe(true);
  });

  it('sorts by code unit, keeping equal paths', async () => {
    mockWatcher.getWatchedFiles.mockReturnValue([
      'c:/data/b.md',
      'c:/data/B.md',
      'c:/data/a.md',
      'c:/data/b.md',
    ]);
    const walk = await serve(makeDeps());

    const { body } = await walk({ globs: ['**/*.md'] });

    expect(body.paths).toEqual([
      'c:/data/B.md',
      'c:/data/a.md',
      'c:/data/b.md',
      'c:/data/b.md',
    ]);
  });

  it('uses the current watcher instance from the getter (survives rebuild)', async () => {
    const oldWatcher = {
      getWatchedFiles: vi.fn().mockReturnValue([]),
      isReady: true,
    };
    const newWatcher = {
      getWatchedFiles: vi
        .fn()
        .mockReturnValue([
          'c:/data/foo/.meta/meta.json',
          'c:/data/baz/.meta/meta.json',
        ]),
      isReady: true,
    };
    const getFileSystemWatcher = vi
      .fn()
      .mockReturnValueOnce(oldWatcher)
      .mockReturnValue(newWatcher);
    const walk = await serve({
      ...makeDeps(),
      getFileSystemWatcher: getFileSystemWatcher as never,
    });
    const globs = { globs: ['**/.meta/meta.json'] };

    expect((await walk(globs)).body.matchedCount).toBe(0);
    expect((await walk(globs)).body.matchedCount).toBe(2);
  });

  it.each([
    ['missing globs', {}],
    ['empty globs', { globs: [] }],
  ])('answers the catalog 400 for %s', async (_label, payload) => {
    const walk = await serve(makeDeps());

    const { status, body } = await walk(payload);

    expect(status).toBe(400);
    expect(body).toMatchObject({ code: 'invalid_request' });
    expect(mockWatcher.getWatchedFiles).not.toHaveBeenCalled();
  });

  it('returns 503 scan_in_progress while the initial scan runs', async () => {
    mockWatcher.isReady = false;
    const walk = await serve(makeDeps());

    const { status, body } = await walk({ globs: ['**/*.md'] });

    expect(status).toBe(503);
    expect(body).toMatchObject({
      code: 'scan_in_progress',
      error: 'Scan in progress',
    });
  });

  it('returns 503 not_available when the watcher is not available', async () => {
    const walk = await serve({
      getWatchPaths: () => ['c:/data/**/*.md'],
      logger: {
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
      } as never,
    });

    const { status, body } = await walk({ globs: ['**/*.md'] });

    expect(status).toBe(503);
    expect(body).toMatchObject({ code: 'not_available' });
  });
});
