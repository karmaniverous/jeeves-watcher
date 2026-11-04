/**
 * @module api/catalog/sourceTargets.test
 * Fastify inject tests (catalog routes) for source targets on POST /metadata (stored designated rule, schema validation, 404/503) and POST /reindex scope path (stored rules enqueued, dry run plan, skips unindexed, 400 without source support).
 */

import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { withoutSourceSupport } from '../../app/sources';
import type { JeevesWatcherConfig } from '../../config/types';
import type {
  DocumentProcessorInterface,
  WatcherProcessor,
} from '../../processor';
import type { SourceOperationsInterface } from '../../processor/SourceOperations';
import { compileRules } from '../../rules';
import { registerCatalogEntries } from '../../test/catalogRoutes';
import { ReindexTracker } from '../ReindexTracker';
import { createCatalogMetadataHandler } from './metadataHandler';
import { createCatalogReindexHandler } from './reindexHandler';

const logger = pino({ level: 'silent' });

const config = {
  watch: { paths: ['**/*.md'] },
  inferenceRules: [
    {
      name: 'chat',
      description: 'Chat',
      match: { type: 'object', required: ['source'] },
      schema: [
        { type: 'object', properties: { priority: { type: 'integer' } } },
      ],
    },
  ],
} as unknown as JeevesWatcherConfig;

/** Stored designated rules by reference; absent = not indexed. */
const stored: Record<string, string> = {
  'app://chat/1': 'chat',
  'app://chat/2': 'chat',
  'ops://x/1': 'ops-rule',
  'app://virtual/1': 'virtual-rule',
};
/** The processor's merged rule set (here: the config rules). */
const compiled = compileRules(config.inferenceRules ?? []);
const ops = {
  compiledRule: vi.fn((name: string) =>
    compiled.find((c) => c.rule.name === name),
  ),
  storedRule: vi.fn((ref: string) => Promise.resolve(stored[ref] ?? null)),
  updateMetadata: vi.fn((_ref: string, m: Record<string, unknown>) =>
    Promise.resolve<Record<string, unknown> | null>(m),
  ),
};
const queue = {
  enqueue: vi.fn().mockReturnValue(true),
  processNow: vi.fn(),
};
const withOps = {
  processMetadataUpdate: vi.fn(),
  sourceOperations: () => ops as unknown as SourceOperationsInterface,
} as unknown as WatcherProcessor;
const withoutOps = withoutSourceSupport({
  processMetadataUpdate: vi.fn(),
} as unknown as DocumentProcessorInterface);

/** Source support (processor with source operations, notify queue). */
let app: FastifyInstance;
/** No source support: a file-only processor (`/metadata`) and no notify
 * queue (`/reindex`), served as `/metadata-plain` and `/reindex-plain`. */
let plain: FastifyInstance;

beforeAll(async () => {
  const getConfig = () => config;
  const reindexDeps = {
    getConfig,
    logger,
    reindexTracker: new ReindexTracker(),
  };
  app = Fastify({ logger: false });
  await registerCatalogEntries(app, {
    metadata: createCatalogMetadataHandler({
      processor: withOps,
      getConfig,
      logger,
    }),
    reindex: createCatalogReindexHandler({
      ...reindexDeps,
      processor: withOps,
      sourceQueue: queue,
    }),
  });
  plain = Fastify({ logger: false });
  await registerCatalogEntries(plain, {
    metadata: createCatalogMetadataHandler({
      processor: withoutOps,
      getConfig,
      logger,
    }),
    reindex: createCatalogReindexHandler({
      ...reindexDeps,
      processor: withOps,
    }),
  });
});

afterAll(async () => {
  await app.close();
  await plain.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function post(url: string, payload: object) {
  const target = url.endsWith('-plain') ? plain : app;
  const res = await target.inject({
    method: 'POST',
    url: url.replace(/-plain$/, ''),
    payload,
  });
  return { status: res.statusCode, body: res.json<Record<string, unknown>>() };
}

describe('POST /metadata { source }', () => {
  it('enriches an indexed document validated against its designated rule', async () => {
    const { status, body } = await post('/metadata', {
      source: 'app://chat/1',
      metadata: { priority: 2, note: 'x' },
    });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, matched_rules: ['chat'] });
    expect(ops.updateMetadata).toHaveBeenCalledWith('app://chat/1', {
      priority: 2,
      note: 'x',
    });
  });

  it('returns 400 when metadata violates the designated rule schema', async () => {
    const { status, body } = await post('/metadata', {
      source: 'app://chat/1',
      metadata: { priority: 'high' },
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({
      error: 'Validation failed',
      details: [{ property: 'priority', rule: 'chat' }],
    });
    expect(ops.updateMetadata).not.toHaveBeenCalled();
  });

  it('skips validation for a designated rule the processor no longer has', async () => {
    const { status, body } = await post('/metadata', {
      source: 'app://virtual/1',
      metadata: { priority: 'high' },
    });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, matched_rules: [] });
  });

  it('returns 404 for a document that is not indexed', async () => {
    const { status } = await post('/metadata', {
      source: 'app://chat/none',
      metadata: {},
    });
    expect(status).toBe(404);
    expect(ops.updateMetadata).not.toHaveBeenCalled();
  });

  it('returns 404 when the document disappears before the write', async () => {
    ops.updateMetadata.mockResolvedValueOnce(null);
    const { status } = await post('/metadata', {
      source: 'app://chat/1',
      metadata: {},
    });
    expect(status).toBe(404);
  });

  it('returns 503 when the processor has no source support', async () => {
    const { status } = await post('/metadata-plain', {
      source: 'app://chat/1',
      metadata: {},
    });
    expect(status).toBe(503);
  });
});

describe('POST /reindex { scope: path, source }', () => {
  it('enqueues indexed references with their stored rules', async () => {
    const { status, body } = await post('/reindex', {
      scope: 'path',
      source: ['app://chat/1', 'app://chat/2', 'ops://x/1', 'app://chat/none'],
    });
    expect(status).toBe(200);
    expect(body).toEqual({
      status: 'started',
      scope: 'path',
      plan: { total: 4, toProcess: 3, toDelete: 0, byRoot: { app: 2, ops: 1 } },
    });
    expect(queue.enqueue.mock.calls).toEqual([
      ['app://chat/1', 'chat'],
      ['app://chat/2', 'chat'],
      ['ops://x/1', 'ops-rule'],
    ]);
  });

  it('dedupes references and accepts a single string', async () => {
    const { body } = await post('/reindex', {
      scope: 'path',
      source: 'app://chat/1',
    });
    expect(body).toMatchObject({ plan: { total: 1, toProcess: 1 } });
  });

  it('computes the plan without enqueueing on a dry run', async () => {
    const { body } = await post('/reindex', {
      scope: 'path',
      source: ['app://chat/1', 'app://chat/1'],
      dryRun: true,
    });
    expect(body).toEqual({
      status: 'dry_run',
      scope: 'path',
      plan: { total: 1, toProcess: 1, toDelete: 0, byRoot: { app: 1 } },
    });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('returns 503 without a notify queue', async () => {
    const { status, body } = await post('/reindex-plain', {
      scope: 'path',
      source: ['app://chat/1'],
    });
    expect(status).toBe(503);
    expect(body).toMatchObject({ error: 'Not available' });
  });
});
