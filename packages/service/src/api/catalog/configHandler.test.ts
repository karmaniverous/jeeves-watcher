/**
 * @module api/catalog/configHandler.test
 * `createCatalogConfigSource` returns the merged document on success and
 * adds a `code` to any error result that doesn't already carry one.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import type { IssuesManager } from '../../issues';
import type { ValuesManager } from '../../values';
import { createCatalogConfigSource } from './configHandler';

vi.mock('../mergedDocument', () => ({
  buildMergedDocument: vi.fn(),
  resolveReferences: vi.fn((doc: unknown) => doc),
}));

import { buildMergedDocument } from '../mergedDocument';

const mockedBuild = buildMergedDocument as unknown as ReturnType<typeof vi.fn>;

function deps() {
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

describe('createCatalogConfigSource', () => {
  it('returns the full merged document for no path', async () => {
    const doc = { description: 'test', inferenceRules: [] };
    mockedBuild.mockReturnValue(doc);

    const source = createCatalogConfigSource(deps());
    const result = await source({});

    expect(result).toEqual({ status: 200, body: doc });
  });

  it('returns JSONPath results', async () => {
    mockedBuild.mockReturnValue({
      inferenceRules: [{ name: 'r1' }, { name: 'r2' }],
    });

    const source = createCatalogConfigSource(deps());
    const result = await source({ path: '$.inferenceRules[*].name' });

    expect(result).toEqual({
      status: 200,
      body: { result: ['r1', 'r2'], count: 2 },
    });
  });

  it('adds a code to an invalid JSONPath 400', async () => {
    mockedBuild.mockReturnValue({ inferenceRules: [] });

    const source = createCatalogConfigSource(deps());
    const result = await source({ path: '$[?(@.x ==' });

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: 'invalid_request' });
  });

  it('returns an empty result set for a path that matches nothing', async () => {
    mockedBuild.mockReturnValue({ inferenceRules: [] });

    const source = createCatalogConfigSource(deps());
    const result = await source({ path: '$.nonexistent' });

    expect(result).toEqual({ status: 200, body: { result: [], count: 0 } });
  });

  it('lets an unexpected failure propagate to the server error handler', async () => {
    const failure = new Error('build failed: /secret/path');
    mockedBuild.mockImplementation(() => {
      throw failure;
    });

    const source = createCatalogConfigSource(deps());

    await expect(source({ path: '$.x' })).rejects.toBe(failure);
  });
});
