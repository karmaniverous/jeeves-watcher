import type { FastifyReply, FastifyRequest } from 'fastify';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import type { IssuesManager } from '../../issues';
import type { ValuesManager } from '../../values';
import type { ConfigQueryRouteDeps } from './configQuery';
import { createConfigQueryHandler } from './configQuery';

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

function createDeps(): ConfigQueryRouteDeps {
  return {
    getConfig: () => ({ inferenceRules: [] }) as unknown as JeevesWatcherConfig,
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

function mockReply() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockImplementation((d: unknown) => d),
  };
}

describe('createConfigQueryHandler (globals resolve)', () => {
  it('returns resolved document with schema references expanded', async () => {
    const deps = createDeps();
    const doc = {
      schemas: { base: { properties: {} } },
      inferenceRules: [{ name: 'r1', schema: ['base'] }],
    };
    mockedBuild.mockReturnValue(doc);

    const handler = createConfigQueryHandler(deps);
    const result = await handler(
      mockRequest({ path: '$.schemas' }),
      mockReply() as unknown as FastifyReply,
    );

    expect(result).toEqual({
      result: [{ base: { properties: {} } }],
      count: 1,
    });
  });
});
