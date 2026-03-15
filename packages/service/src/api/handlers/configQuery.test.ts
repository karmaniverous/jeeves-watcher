import type { FastifyReply, FastifyRequest } from 'fastify';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import type { IssuesManager } from '../../issues';
import type { ValuesManager } from '../../values';
import type { ConfigQueryRouteDeps } from './configQuery';
import { createConfigQueryHandler } from './configQuery';

// Mock mergedDocument to control the document shape
vi.mock('../mergedDocument', () => ({
  buildMergedDocument: vi.fn(),
  resolveReferences: vi.fn((doc: unknown) => doc),
}));

import type { Mock } from 'vitest';

import { buildMergedDocument } from '../mergedDocument';

const mockedBuild = buildMergedDocument as Mock;

type ConfigQueryRequest = FastifyRequest<{
  Querystring: { path?: string };
}>;

interface MockReply {
  status: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

function createDeps(
  configOverrides: Partial<JeevesWatcherConfig> = {},
): ConfigQueryRouteDeps {
  return {
    config: {
      inferenceRules: [],
      ...configOverrides,
    } as unknown as JeevesWatcherConfig,
    valuesManager: {
      getAll: vi.fn().mockReturnValue({}),
      getForRule: vi.fn().mockReturnValue({}),
    } as unknown as ValuesManager,
    issuesManager: {
      getAll: vi.fn().mockReturnValue({}),
    } as unknown as IssuesManager,
    logger: pino({ level: 'silent' }),
  };
}

function mockRequest(query: Record<string, unknown>): ConfigQueryRequest {
  return { query } as unknown as ConfigQueryRequest;
}

function mockReply(): MockReply {
  const reply: Partial<MockReply> = {};
  reply.status = vi.fn().mockReturnValue(reply);
  reply.send = vi.fn().mockImplementation((data: unknown) => data);
  return reply as MockReply;
}

describe('createConfigQueryHandler', () => {
  it('returns results for a valid JSONPath', async () => {
    const deps = createDeps();
    mockedBuild.mockReturnValue({
      description: 'test',
      inferenceRules: [{ name: 'r1' }, { name: 'r2' }],
    });

    const handler = createConfigQueryHandler(deps);
    const result = await handler(
      mockRequest({ path: '$.inferenceRules[*].name' }),
      mockReply() as unknown as FastifyReply,
    );

    expect(result).toEqual({ result: ['r1', 'r2'], count: 2 });
  });

  it('returns full document when no path provided', async () => {
    const deps = createDeps();
    const doc = {
      description: 'test',
      inferenceRules: [{ name: 'r1' }],
    };
    mockedBuild.mockReturnValue(doc);

    const handler = createConfigQueryHandler(deps);
    const result = await handler(
      mockRequest({}),
      mockReply() as unknown as FastifyReply,
    );

    expect(result).toEqual(doc);
  });

  it('returns error when query processing throws', async () => {
    const deps = createDeps();
    mockedBuild.mockImplementation(() => {
      throw new Error('build failed');
    });

    const handler = createConfigQueryHandler(deps);
    const reply = mockReply();
    await handler(
      mockRequest({ path: '$.anything' }),
      reply as unknown as FastifyReply,
    );

    expect(reply.status).toHaveBeenCalledWith(400);
  });

  it('returns empty result set', async () => {
    const deps = createDeps();
    mockedBuild.mockReturnValue({ inferenceRules: [] });

    const handler = createConfigQueryHandler(deps);
    const result = await handler(
      mockRequest({ path: '$.nonexistent' }),
      mockReply() as unknown as FastifyReply,
    );

    expect(result).toEqual({ result: [], count: 0 });
  });
});
