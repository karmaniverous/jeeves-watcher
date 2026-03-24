import type { FastifyReply, FastifyRequest } from 'fastify';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import type { IssuesManager } from '../../issues';
import type { DocumentProcessor } from '../../processor';
import type { ValuesManager } from '../../values';
import { ReindexTracker } from '../ReindexTracker';
import type { ConfigReindexRouteDeps } from './configReindex';
import { createConfigReindexHandler } from './configReindex';

// Mock executeReindex to avoid actual file processing
vi.mock('../executeReindex', () => ({
  VALID_REINDEX_SCOPES: ['issues', 'full', 'rules', 'path', 'prune'],
  executeReindex: vi.fn().mockResolvedValue({
    filesProcessed: 5,
    durationMs: 100,
    errors: 0,
    plan: { total: 5, toProcess: 5, toDelete: 0, byRoot: {} },
  }),
}));

import type { Mock } from 'vitest';

import { executeReindex } from '../executeReindex';

const mockedExecuteReindex = executeReindex as Mock;

type ConfigReindexRequest = FastifyRequest<{
  Body: {
    scope?: 'issues' | 'full';
    path?: string | string[];
    dryRun?: boolean;
  };
}>;

type ConfigReindexHandler = (
  request: ConfigReindexRequest,
  reply: FastifyReply,
) => Promise<unknown>;

interface MockReply {
  status: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

function createDeps() {
  return {
    getConfig: () =>
      ({
        watch: { paths: ['**/*.md'] },
        embedding: { provider: 'mock', model: 'test', dimensions: 3 },
        vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
      }) as unknown as JeevesWatcherConfig,
    processor: {} as unknown as DocumentProcessor,
    logger: pino({ level: 'silent' }),
    reindexTracker: new ReindexTracker(),
    valuesManager: {
      clearAll: vi.fn(),
      getAll: vi.fn().mockReturnValue({}),
    } as unknown as ValuesManager,
    issuesManager: {
      getAll: vi.fn().mockReturnValue({}),
    } as unknown as IssuesManager,
  } satisfies ConfigReindexRouteDeps;
}

function mockRequest(body: Record<string, unknown> = {}): ConfigReindexRequest {
  return { body } as unknown as ConfigReindexRequest;
}

function mockReply(): MockReply {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockImplementation((d: unknown) => d),
  };
}

describe('createConfigReindexHandler', () => {
  it('returns started status with default issues scope and plan', async () => {
    const deps = createDeps();
    const handler = createConfigReindexHandler(
      deps,
    ) as unknown as ConfigReindexHandler;
    const reply = mockReply();
    await handler(mockRequest({}), reply as unknown as FastifyReply);

    expect(reply.status).toHaveBeenCalledWith(200);

    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'started',
        scope: 'issues',
      }),
    );

    const sent = reply.send.mock.calls[0]?.[0] as unknown as {
      plan?: unknown;
    };
    expect(sent.plan).toBeDefined();
  });

  it('passes full scope when requested', async () => {
    const deps = createDeps();
    const handler = createConfigReindexHandler(
      deps,
    ) as unknown as ConfigReindexHandler;
    const reply = mockReply();
    await handler(
      mockRequest({ scope: 'full' }),
      reply as unknown as FastifyReply,
    );

    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'started',
        scope: 'full',
      }),
    );

    const sent = reply.send.mock.calls[0]?.[0] as unknown as {
      plan?: unknown;
    };
    expect(sent.plan).toBeDefined();
    // Called twice: once for dry-run plan, once for actual execution
    expect(mockedExecuteReindex).toHaveBeenCalledWith(
      expect.objectContaining({ config: deps.getConfig() }),
      'full',
      undefined,
      true, // dry-run for plan
    );
    expect(mockedExecuteReindex).toHaveBeenCalledWith(
      expect.objectContaining({ config: deps.getConfig() }),
      'full',
      undefined,
      false, // actual execution
    );
  });

  it('passes valuesManager and issuesManager to executeReindex', async () => {
    const deps = createDeps();
    const handler = createConfigReindexHandler(
      deps,
    ) as unknown as ConfigReindexHandler;
    const reply = mockReply();
    await handler(
      mockRequest({ scope: 'full' }),
      reply as unknown as FastifyReply,
    );

    expect(mockedExecuteReindex).toHaveBeenCalledWith(
      expect.objectContaining({
        valuesManager: deps.valuesManager,
        issuesManager: deps.issuesManager,
      }),
      'full',
      undefined,
      expect.any(Boolean),
    );
  });

  it('returns dry_run status when dryRun is true', async () => {
    const deps = createDeps();
    const handler = createConfigReindexHandler(
      deps,
    ) as unknown as ConfigReindexHandler;
    const reply = mockReply();
    await handler(
      mockRequest({ scope: 'full', dryRun: true }),
      reply as unknown as FastifyReply,
    );

    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'dry_run',
        scope: 'full',
      }),
    );

    const sent = reply.send.mock.calls[0]?.[0] as unknown as {
      plan?: unknown;
    };
    expect(sent.plan).toBeDefined();
  });
});
