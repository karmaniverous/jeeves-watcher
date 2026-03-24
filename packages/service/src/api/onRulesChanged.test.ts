import { describe, expect, it, vi } from 'vitest';

import { VirtualRuleStore } from '../rules/virtualRules';
import { createApiServer } from './index';

// Mock executeReindex
vi.mock('./executeReindex', async (importOriginal) => ({
  ...(await importOriginal()),
  executeReindex: vi.fn().mockResolvedValue({
    filesProcessed: 0,
    durationMs: 0,
    errors: 0,
  }),
}));

// Mock buildTemplateEngineAndCustomMapLib
vi.mock('../app/initialization', () => ({
  buildTemplateEngineAndCustomMapLib: vi.fn().mockResolvedValue({
    templateEngine: {},
    customMapLib: {},
  }),
}));

import { executeReindex } from './executeReindex';

const executeReindexMock = vi.mocked(executeReindex);

describe('onRulesChanged auto-reindex (Fix 21)', () => {
  function makeServer(virtualRuleStore: VirtualRuleStore) {
    return createApiServer({
      processor: {
        updateRules: vi.fn(),
      } as never,
      vectorStore: {} as never,
      embeddingProvider: {} as never,
      queue: {} as never,
      config: {
        watch: { paths: ['j:/domains/**/*.md'], ignored: [] },
        api: {},
        vectorStore: { collectionName: 'test' },
        inferenceRules: [],
      } as never,
      getConfig: () =>
        ({
          watch: { paths: ['j:/domains/**/*.md'], ignored: [] },
          api: {},
          vectorStore: { collectionName: 'test' },
          inferenceRules: [],
        }) as never,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis(),
      } as never,
      issuesManager: { getAll: vi.fn().mockReturnValue({}) } as never,
      valuesManager: {} as never,
      configPath: '/tmp/config.json',
      virtualRuleStore,
    });
  }

  it('triggers rules reindex with extracted globs after rule registration', async () => {
    const store = new VirtualRuleStore();
    const app = makeServer(store);
    await app.ready();

    executeReindexMock.mockClear();

    const rules = [
      {
        name: 'meta-rule',
        description: 'Match meta files',
        match: {
          type: 'object',
          properties: {
            file: {
              type: 'object',
              properties: {
                path: { type: 'string', glob: '**/.meta/**' },
              },
            },
          },
        },
        schema: [
          {
            type: 'object',
            properties: { domains: { type: 'string', set: 'meta' } },
          },
        ],
      },
    ];

    const response = await app.inject({
      method: 'POST',
      url: '/rules/register',
      payload: { source: 'test-plugin', rules },
    });

    expect(response.statusCode).toBe(200);

    // Allow async operations to settle
    await new Promise((r) => setTimeout(r, 50));

    // executeReindex should have been called with scope 'rules' and the extracted globs
    const reindexCalls = executeReindexMock.mock.calls.filter(
      (call) => call[1] === 'rules',
    );
    expect(reindexCalls.length).toBeGreaterThanOrEqual(1);

    expect(reindexCalls[0]).toBeDefined();
    expect(reindexCalls[0][2]).toEqual(['**/.meta/**']);
  });

  it('skips reindex when rules have no match globs', async () => {
    const store = new VirtualRuleStore();
    const app = makeServer(store);
    await app.ready();

    executeReindexMock.mockClear();

    const rules = [
      {
        name: 'no-glob-rule',
        description: 'Rule without match glob',
        match: { type: 'object' },
        schema: [
          {
            type: 'object',
            properties: { domains: { type: 'string', set: 'test' } },
          },
        ],
      },
    ];

    const response = await app.inject({
      method: 'POST',
      url: '/rules/register',
      payload: { source: 'test-plugin-2', rules },
    });

    expect(response.statusCode).toBe(200);

    await new Promise((r) => setTimeout(r, 50));

    // executeReindex should NOT have been called with scope 'rules'
    const reindexCalls = executeReindexMock.mock.calls.filter(
      (call) => call[1] === 'rules',
    );
    expect(reindexCalls).toHaveLength(0);
  });

  it('extracts globs from multiple rules', async () => {
    const store = new VirtualRuleStore();
    const app = makeServer(store);
    await app.ready();

    executeReindexMock.mockClear();

    const rules = [
      {
        name: 'rule-a',
        description: 'Match A',
        match: {
          type: 'object',
          properties: {
            file: {
              type: 'object',
              properties: {
                path: { type: 'string', glob: '**/.meta/**' },
              },
            },
          },
        },
        schema: [{ type: 'object', properties: {} }],
      },
      {
        name: 'rule-b',
        description: 'Match B',
        match: {
          type: 'object',
          properties: {
            file: {
              type: 'object',
              properties: {
                path: { type: 'string', glob: '**/docs/**' },
              },
            },
          },
        },
        schema: [{ type: 'object', properties: {} }],
      },
      {
        name: 'rule-c-no-glob',
        description: 'No glob',
        match: { type: 'object' },
        schema: [{ type: 'object', properties: {} }],
      },
    ];

    const response = await app.inject({
      method: 'POST',
      url: '/rules/register',
      payload: { source: 'multi-plugin', rules },
    });

    expect(response.statusCode).toBe(200);

    await new Promise((r) => setTimeout(r, 50));

    const reindexCalls = executeReindexMock.mock.calls.filter(
      (call) => call[1] === 'rules',
    );
    expect(reindexCalls.length).toBeGreaterThanOrEqual(1);

    expect(reindexCalls[0]).toBeDefined();
    expect(reindexCalls[0][2]).toEqual(
      expect.arrayContaining(['**/.meta/**', '**/docs/**']),
    );
    expect(reindexCalls[0][2] as string[]).toHaveLength(2);
  });
});
