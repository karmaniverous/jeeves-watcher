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
  resolveReferences: vi.fn(),
}));

import type { Mock } from 'vitest';

import { buildMergedDocument, resolveReferences } from '../mergedDocument';

const mockedBuild = buildMergedDocument as Mock;
const mockedResolve = resolveReferences as Mock;

type ConfigQueryRequest = FastifyRequest<{
  Body: { path: string; resolve?: ('files' | 'globals')[] };
}>;

function createDeps(): ConfigQueryRouteDeps {
  return {
    config: { inferenceRules: [] } as unknown as JeevesWatcherConfig,
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

function mockRequest(body: Record<string, unknown>): ConfigQueryRequest {
  return { body } as unknown as ConfigQueryRequest;
}

function mockReply() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockImplementation((d: unknown) => d),
  };
}

describe('createConfigQueryHandler (globals resolve)', () => {
  it('passes globals resolve through to resolveReferences', async () => {
    const deps = createDeps();
    const doc = { schemas: { base: { properties: {} } } };
    mockedBuild.mockReturnValue(doc);
    mockedResolve.mockReturnValue(doc);

    const handler = createConfigQueryHandler(deps);
    await handler(
      mockRequest({ path: '$.schemas', resolve: ['globals'] }),
      mockReply() as unknown as FastifyReply,
    );

    expect(mockedResolve).toHaveBeenCalledWith(doc, ['globals']);
  });
});
