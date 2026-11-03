/**
 * @module api/catalog/index.test
 * `createCatalogHandlers` builds one handler per catalog entry name, each
 * callable and behaviourally wired to its dependencies; the gated `/vcs/*`
 * entries get the not-found stubs while VCS is off and their real handlers
 * while it is on.
 */

import { WATCHER_CATALOG } from '@karmaniverous/jeeves-watcher-core';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { watcherDescriptor } from '../../descriptor';
import { clearCache } from '../responseCache';
import {
  createCatalogHandlers,
  type CreateCatalogHandlersOptions,
} from './index';
import { notFoundBody } from './notFoundBody';

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
  vcs?: CreateCatalogHandlersOptions['vcs'],
) {
  const logger = pino({ level: 'silent' });
  const unused = {} as never;
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
    configMatch: unused,
    configValidate: unused,
    searchFacets: unused,
    walk: unused,
    issues: { issuesManager: { getAll: () => ({}) } },
    metadata: unused,
    reindex: unused,
    documents: unused,
    documentsDelete: unused,
    pointsDelete: unused,
    rebuildMetadata: unused,
    rulesReapply: unused,
    rules: unused,
    ...(vcs ? { vcs } : {}),
    cacheTtlMs,
  });
}

describe('createCatalogHandlers', () => {
  it('builds a handler for every catalog entry name', () => {
    const handlers = buildHandlers();
    const names = WATCHER_CATALOG.entries.map((entry) => entry.name);

    for (const name of names) {
      expect(typeof handlers[name]).toBe('function');
    }
    expect(Object.keys(handlers).sort()).toEqual([...names].sort());
  });

  it('wires status, config, render, search, scan and issues handlers', async () => {
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

    const issues = await handlers.issues(input, {} as never);
    expect(issues).toEqual({ status: 200, body: { count: 0, issues: {} } });
  });

  it('answers every gated entry with the not-found body while VCS is off', async () => {
    const handlers = buildHandlers();
    const request = (url: string) => ({ method: 'GET', url }) as never;
    const input = { params: {}, query: {}, body: {} } as never;

    for (const name of [
      'vcsStatus',
      'vcsHistory',
      'vcsShow',
      'vcsDiff',
      'vcsCheckExclusion',
      'vcsRevert',
      'vcsExclude',
    ] as const) {
      const result = await handlers[name](input, request(`/x?${name}`));
      expect(result).toEqual({
        status: 404,
        body: notFoundBody('GET', `/x?${name}`),
      });
    }
  });

  it('wires the real /vcs/* handlers while VCS is on', async () => {
    const coordinator = { getRoots: () => [], getManager: () => undefined };
    const handlers = buildHandlers(undefined, undefined, 0, {
      coordinator: coordinator as never,
      logger: pino({ level: 'silent' }),
    });

    const status = await handlers.vcsStatus(
      { params: {}, query: {}, body: {} },
      {} as never,
    );

    expect(status).toEqual({
      status: 200,
      body: { enabled: false, roots: [] },
    });
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
