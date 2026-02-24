import { describe, expect, it, vi } from 'vitest';

import {
  buildMergedDocument,
  resolveReferences,
  type BuildMergedDocumentOptions,
} from './mergedDocument';

function createOptions(
  overrides: Partial<BuildMergedDocumentOptions> = {},
): BuildMergedDocumentOptions {
  return {
    config: {
      watch: { paths: ['**/*.md'] },
      embedding: { provider: 'mock', model: 'test', dimensions: 3 },
      vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
      inferenceRules: [
        { name: 'rule1', match: {}, set: { domain: 'docs' } },
      ],
    } as any,
    valuesManager: {
      getAll: vi.fn().mockReturnValue({ rule1: { domain: ['docs'] } }),
      getForRule: vi.fn().mockReturnValue({ domain: ['docs'] }),
    } as any,
    issuesManager: {
      getAll: vi.fn().mockReturnValue({ '/bad.txt': { error: 'fail' } }),
    } as any,
    ...overrides,
  };
}

describe('buildMergedDocument', () => {
  it('returns correct shape with all sections', () => {
    const doc = buildMergedDocument(createOptions());

    expect(doc).toHaveProperty('description');
    expect(doc).toHaveProperty('search');
    expect(doc).toHaveProperty('inferenceRules');
    expect(doc).toHaveProperty('mapHelpers');
    expect(doc).toHaveProperty('templateHelpers');
    expect(doc).toHaveProperty('maps');
    expect(doc).toHaveProperty('templates');
    expect(doc).toHaveProperty('slots');
    expect(doc).toHaveProperty('issues');
    expect(doc).toHaveProperty('schemas');
  });

  it('inference rules include per-rule values', () => {
    const doc = buildMergedDocument(createOptions());
    const rules = doc['inferenceRules'] as any[];
    expect(rules[0]).toMatchObject({
      name: 'rule1',
      values: { domain: ['docs'] },
    });
  });

  it('issues come from issuesManager', () => {
    const doc = buildMergedDocument(createOptions());
    expect(doc['issues']).toEqual({ '/bad.txt': { error: 'fail' } });
  });

  it('missing valuesManager/issuesManager fields return empty', () => {
    const doc = buildMergedDocument(
      createOptions({
        valuesManager: {
          getAll: vi.fn().mockReturnValue({}),
          getForRule: vi.fn().mockReturnValue({}),
        } as any,
        issuesManager: { getAll: vi.fn().mockReturnValue({}) } as any,
      }),
    );
    expect(doc['issues']).toEqual({});
  });

  it('helper introspection is injected correctly', () => {
    const doc = buildMergedDocument(
      createOptions({
        config: {
          watch: { paths: ['**/*.md'] },
          embedding: { provider: 'mock', model: 'test', dimensions: 3 },
          vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
          mapHelpers: {
            myLib: { path: '/helpers/my.js', description: 'My lib' },
          },
        } as any,
        helperIntrospection: {
          mapHelpers: {
            myLib: { exports: { myFn: 'function' } },
          },
        },
      }),
    );

    const mapHelpers = doc['mapHelpers'] as Record<string, any>;
    expect(mapHelpers['myLib']).toMatchObject({
      path: '/helpers/my.js',
      exports: { myFn: 'function' },
    });
  });
});

describe('resolveReferences', () => {
  it('returns doc unchanged when resolve does not include files', () => {
    const doc = { description: 'test', maps: { m: '/some/file.json' } };
    const result = resolveReferences(doc, ['globals']);
    expect(result).toEqual(doc);
  });

  it('resolves known positions only (maps, templates, inferenceRules[*].map)', () => {
    const doc = {
      description: 'test',
      inferenceRules: [
        { name: 'r1', map: '/nonexistent.json' },
        { name: 'r2', map: { inline: true } },
      ],
      maps: { myMap: '/nonexistent-map.json', inlineMap: { key: 'val' } },
      templates: { myTpl: '/nonexistent.hbs', inlineTpl: 'inline content' },
    };

    const result = resolveReferences(doc, ['files']);

    // Non-.json map references should not be resolved
    const rules = result['inferenceRules'] as any[];
    // /nonexistent.json fails to read, returns the path string
    expect(rules[0].map).toBe('/nonexistent.json');
    // Non-string map is left alone
    expect(rules[1].map).toEqual({ inline: true });
  });
});
