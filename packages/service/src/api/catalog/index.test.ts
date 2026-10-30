/**
 * @module api/catalog/index.test
 * `createCatalogHandlers` builds one handler per `WATCHER_CATALOG` entry
 * name, each callable and behaviourally wired to its dependencies.
 */

import { WATCHER_CATALOG } from '@karmaniverous/jeeves-watcher-core';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { watcherDescriptor } from '../../descriptor';
import { clearCache } from '../handlers/withCache';
import { createCatalogHandlers } from './index';

vi.mock('./renderSourceDocument', () => ({
  renderSourceDocument: vi.fn().mockResolvedValue({
    renderAs: 'md',
    content: 'src',
    rules: [],
    metadata: {},
  }),
}));

vi.mock('../mergedDocument', () => ({
  buildMergedDocument: vi.fn().mockReturnValue({ description: '' }),
  resolveReferences: vi.fn((doc: unknown) => doc),
}));

function buildHandlers(
  renderFile: () => Promise<unknown> = () =>
    Promise.resolve({
      renderAs: 'md',
      content: 'x',
      rules: [],
      metadata: {},
      transformed: true,
    }),
  storedRule: () => Promise<string | null> = () => Promise.resolve(null),
  cacheTtlMs = 0,
) {
  const logger = pino({ level: 'silent' });
  return createCatalogHandlers({
    status: {
      vectorStore: {
        getCollectionInfo: () =>
          Promise.resolve({ pointCount: 1, dimensions: 3 }),
      },
      getConfig: () => ({ vectorStore: { collectionName: 'c' } }),
      reindexTracker: { getStatus: () => ({ active: false }) } as never,
    },
    config: {
      getConfig: () => ({ inferenceRules: [] }) as never,
      valuesManager: {
        getAll: () => ({}),
        getForRule: () => ({}),
      } as never,
      issuesManager: { getAll: () => ({}) } as never,
    },
    configApply: {
      descriptor: watcherDescriptor,
      configPath: '',
      onConfigApply: () => Promise.resolve(),
      logger,
    },
    render: {
      processor: {
        renderFile,
        sourceOperations: () => ({
          storedRule,
          render: vi.fn(),
        }),
      } as never,
      getWatch: () => ({ paths: ['**/*.md'], ignored: [] }),
      logger,
    },
    search: {
      embeddingProvider: { embed: () => Promise.resolve([[0.1]]) } as never,
      vectorStore: {
        search: () => Promise.resolve([]),
        hybridSearch: () => Promise.resolve([]),
      } as never,
      logger,
    },
    scan: {
      vectorStore: {
        scrollPage: () =>
          Promise.resolve({ points: [], nextCursor: undefined }),
        count: () => Promise.resolve(0),
      } as never,
      logger,
    },
    vcsShow: {},
    cacheTtlMs,
  });
}

describe('createCatalogHandlers', () => {
  it('builds a handler for every WATCHER_CATALOG entry name', () => {
    const handlers = buildHandlers();
    const names = WATCHER_CATALOG.entries.map((entry) => entry.name);

    for (const name of names) {
      expect(typeof handlers[name]).toBe('function');
    }
    expect(Object.keys(handlers).sort()).toEqual([...names].sort());
  });

  it('wires status, config, render, search, scan and vcsShow handlers', async () => {
    const handlers = buildHandlers();
    const input = { params: {}, query: {}, body: {} } as never;

    const status = await handlers.status(input, {} as never);
    expect(status.status).toBe(200);

    const config = await handlers.config(input, {} as never);
    expect(config.status).toBe(200);

    const render = await handlers.render(
      { params: {}, query: {}, body: { path: 'a.md' } },
      {} as never,
    );
    expect(render.status).toBe(200);

    const search = await handlers.search(
      { params: {}, query: {}, body: { query: 'hi' } },
      {} as never,
    );
    expect(search.status).toBe(200);

    const scan = await handlers.scan(
      { params: {}, query: {}, body: { filter: {} } },
      {} as never,
    );
    expect(scan.status).toBe(200);

    const vcsShow = await handlers.vcsShow(
      { params: {}, query: { path: 'a', commit: 'b' }, body: {} },
      { method: 'GET', url: '/vcs/show' } as never,
    );
    expect(vcsShow.status).toBe(404); // no coordinator configured
  });
});

describe('render response caching', () => {
  const fileInput = { params: {}, query: {}, body: { path: 'a.md' } };
  const sourceInput = { params: {}, query: {}, body: { source: 'app://1' } };

  it('caches file renders', async () => {
    clearCache();
    const renderFile = vi.fn().mockResolvedValue({
      renderAs: 'md',
      content: 'x',
      rules: [],
      metadata: {},
      transformed: true,
    });
    const handlers = buildHandlers(renderFile, undefined, 60_000);

    await handlers.render(fileInput, {} as never);
    await handlers.render(fileInput, {} as never);

    expect(renderFile).toHaveBeenCalledTimes(1);
  });

  it('never caches a successful source render: every one runs live', async () => {
    clearCache();
    const { renderSourceDocument } = await import('./renderSourceDocument');
    vi.mocked(renderSourceDocument).mockClear();
    const handlers = buildHandlers(undefined, undefined, 60_000);

    const first = await handlers.render(sourceInput, {} as never);
    await handlers.render(sourceInput, {} as never);

    expect(first.status).toBe(200);
    expect(renderSourceDocument).toHaveBeenCalledTimes(2);
  });
});
