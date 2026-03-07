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
  executeReindex: vi.fn().mockResolvedValue({
    filesProcessed: 5,
    durationMs: 100,
    errors: 0,
  }),
}));

import type { Mock } from 'vitest';

import { executeReindex } from '../executeReindex';

const mockedExecuteReindex = executeReindex as Mock;

type ConfigReindexRequest = FastifyRequest<{
  Body: { scope?: 'issues' | 'full' };
}>;

interface MockReply {
  status: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

function createDeps() {
  return {
    config: {
      watch: { paths: ['**/*.md'] },
      embedding: { provider: 'mock', model: 'test', dimensions: 3 },
      vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
    } as unknown as JeevesWatcherConfig,
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
  it('returns started status with default issues scope', async () => {
    const deps = createDeps();
    const handler = createConfigReindexHandler(deps);
    const reply = mockReply();
    await handler(mockRequest({}), reply as unknown as FastifyReply);

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({
      status: 'started',
      scope: 'issues',
    });
  });

  it('passes full scope when requested', async () => {
    const deps = createDeps();
    const handler = createConfigReindexHandler(deps);
    const reply = mockReply();
    await handler(
      mockRequest({ scope: 'full' }),
      reply as unknown as FastifyReply,
    );

    expect(reply.send).toHaveBeenCalledWith({
      status: 'started',
      scope: 'full',
    });
    expect(mockedExecuteReindex).toHaveBeenCalledWith(
      expect.objectContaining({ config: deps.config }),
      'full',
    );
  });

  it('passes valuesManager and issuesManager to executeReindex', async () => {
    const deps = createDeps();
    const handler = createConfigReindexHandler(deps);
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
    );
  });
});
