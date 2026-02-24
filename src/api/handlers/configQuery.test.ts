/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { ConfigQueryRouteDeps } from './configQuery';
import { createConfigQueryHandler } from './configQuery';

// Mock mergedDocument to control the document shape
vi.mock('../mergedDocument', () => ({
  buildMergedDocument: vi.fn(),
  resolveReferences: vi.fn(),
}));

import type { Mock } from 'vitest';

import { buildMergedDocument, resolveReferences } from '../mergedDocument';

const mockedBuild = buildMergedDocument as Mock;
const mockedResolve = resolveReferences as Mock;

function createDeps(
  configOverrides: Record<string, unknown> = {},
): ConfigQueryRouteDeps {
  return {
    config: { inferenceRules: [], ...configOverrides } as any,
    valuesManager: {
      getAll: vi.fn().mockReturnValue({}),
      getForRule: vi.fn().mockReturnValue({}),
    } as any,
    issuesManager: { getAll: vi.fn().mockReturnValue({}) } as any,
    logger: pino({ level: 'silent' }),
  };
}

function mockRequest(body: Record<string, unknown>) {
  return { body } as any;
}

function mockReply() {
  const reply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockImplementation((data: unknown) => data),
  };
  return reply as any;
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
      mockReply(),
    );

    expect(result).toEqual({ result: ['r1', 'r2'], count: 2 });
  });

  it('returns error when query processing throws', async () => {
    const deps = createDeps();
    mockedBuild.mockImplementation(() => {
      throw new Error('build failed');
    });

    const handler = createConfigQueryHandler(deps);
    const reply = mockReply();
    await handler(mockRequest({ path: '$.anything' }), reply);

    expect(reply.status).toHaveBeenCalledWith(400);
  });

  it('resolves file references when resolve includes files', async () => {
    const deps = createDeps();
    const doc = { description: 'test' };
    const resolvedDoc = { description: 'resolved' };
    mockedBuild.mockReturnValue(doc);
    mockedResolve.mockReturnValue(resolvedDoc);

    const handler = createConfigQueryHandler(deps);
    await handler(
      mockRequest({ path: '$.description', resolve: ['files'] }),
      mockReply(),
    );

    expect(mockedResolve).toHaveBeenCalledWith(doc, ['files']);
  });

  it('returns empty result set', async () => {
    const deps = createDeps();
    mockedBuild.mockReturnValue({ inferenceRules: [] });

    const handler = createConfigQueryHandler(deps);
    const result = await handler(
      mockRequest({ path: '$.nonexistent' }),
      mockReply(),
    );

    expect(result).toEqual({ result: [], count: 0 });
  });
});
