/**
 * @module api/handlers/facets.test
 * Tests for GET /search/facets route handler.
 */

import { describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import type { ValuesManager } from '../../values';
import { createFacetsHandler, type FacetsHandlerDeps } from './facets';

/**
 * Create a minimal config with inference rules that have inline schemas.
 * Uses inline schema objects to avoid file I/O in tests.
 */
function makeConfig(
  rules: JeevesWatcherConfig['inferenceRules'] = [],
): JeevesWatcherConfig {
  return {
    inferenceRules: rules,
    schemas: {},
    watch: { paths: [], ignored: [] },
    vectorStore: {
      collectionName: 'test',
      url: 'http://localhost:6333',
      dimensions: 768,
    },
    embedding: { provider: 'openai', model: 'text-embedding-3-small' },
    metadataDir: '/tmp/meta',
    stateDir: '/tmp/state',
  } as unknown as JeevesWatcherConfig;
}

function makeValuesManager(
  data: Record<string, Record<string, unknown[]>> = {},
): ValuesManager {
  return { getAll: vi.fn().mockReturnValue(data) } as unknown as ValuesManager;
}

function makeDeps(
  overrides: Partial<FacetsHandlerDeps> = {},
): FacetsHandlerDeps {
  return {
    config: makeConfig(),
    valuesManager: makeValuesManager(),
    configDir: '/tmp',
    ...overrides,
  };
}

describe('GET /search/facets handler', () => {
  it('returns empty facets when no rules have schemas', () => {
    const handler = createFacetsHandler(makeDeps());
    const result = handler();
    expect(result).toEqual({ facets: [] });
  });

  it('extracts facets from rules with uiHint properties', () => {
    const config = makeConfig([
      {
        name: 'slack-message',
        description: 'Slack messages',
        match: {},
        schema: [
          {
            properties: {
              channel: {
                type: 'string',
                uiHint: 'dropdown',
                set: '{{file.directory}}',
              },
              content: { type: 'string', set: '{{json.text}}' },
            },
          },
        ],
      },
    ]);
    const values = makeValuesManager({
      'slack-message': { channel: ['general', 'random'] },
    });

    const handler = createFacetsHandler(
      makeDeps({ config, valuesManager: values }),
    );
    const result = handler();

    expect(result.facets).toHaveLength(1);
    expect(result.facets[0]).toEqual({
      field: 'channel',
      type: 'string',
      uiHint: 'dropdown',
      values: ['general', 'random'],
      rules: ['slack-message'],
    });
  });

  it('uses enum values when declared instead of live values', () => {
    const config = makeConfig([
      {
        name: 'jira-issue',
        description: 'Jira issues',
        match: {},
        schema: [
          {
            properties: {
              priority: {
                type: 'string',
                uiHint: 'dropdown',
                enum: ['Critical', 'High', 'Medium', 'Low'],
              },
            },
          },
        ],
      },
    ]);
    const values = makeValuesManager({
      'jira-issue': { priority: ['High', 'Low'] },
    });

    const handler = createFacetsHandler(
      makeDeps({ config, valuesManager: values }),
    );
    const result = handler();

    expect(result.facets[0].values).toEqual([
      'Critical',
      'High',
      'Medium',
      'Low',
    ]);
  });

  it('deduplicates fields across multiple rules', () => {
    const config = makeConfig([
      {
        name: 'rule-a',
        description: 'A',
        match: {},
        schema: [
          {
            properties: {
              domain: { type: 'string', uiHint: 'dropdown' },
            },
          },
        ],
      },
      {
        name: 'rule-b',
        description: 'B',
        match: {},
        schema: [
          {
            properties: {
              domain: { type: 'string', uiHint: 'tags' },
            },
          },
        ],
      },
    ]);
    const values = makeValuesManager({
      'rule-a': { domain: ['slack'] },
      'rule-b': { domain: ['email'] },
    });

    const handler = createFacetsHandler(
      makeDeps({ config, valuesManager: values }),
    );
    const result = handler();

    expect(result.facets).toHaveLength(1);
    expect(result.facets[0].rules).toEqual(['rule-a', 'rule-b']);
    // uiHint from later rule wins
    expect(result.facets[0].uiHint).toBe('tags');
    // Values merged from both rules
    expect(result.facets[0].values).toEqual(
      expect.arrayContaining(['slack', 'email']),
    );
  });

  it('handles empty values gracefully', () => {
    const config = makeConfig([
      {
        name: 'new-rule',
        description: 'New',
        match: {},
        schema: [
          {
            properties: {
              category: { type: 'string', uiHint: 'dropdown' },
            },
          },
        ],
      },
    ]);
    const handler = createFacetsHandler(makeDeps({ config }));
    const result = handler();

    expect(result.facets[0].values).toEqual([]);
  });

  it('skips properties without uiHint or enum', () => {
    const config = makeConfig([
      {
        name: 'rule',
        description: 'R',
        match: {},
        schema: [
          {
            properties: {
              hidden: { type: 'string', set: '{{file.path}}' },
              visible: { type: 'string', uiHint: 'dropdown' },
            },
          },
        ],
      },
    ]);
    const handler = createFacetsHandler(makeDeps({ config }));
    const result = handler();

    expect(result.facets).toHaveLength(1);
    expect(result.facets[0].field).toBe('visible');
  });
});
