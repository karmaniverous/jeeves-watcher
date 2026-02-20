import { describe, expect, it } from 'vitest';

import type { InferenceRule } from '../config/types';
import type { FileAttributes } from './index';
import { applyRules, compileRules } from './index';

function makeAttributes(
  overrides: Partial<FileAttributes> = {},
): FileAttributes {
  return {
    file: {
      path: 'docs/readme.md',
      directory: 'docs',
      filename: 'readme.md',
      extension: '.md',
      sizeBytes: 1024,
      modified: '2026-01-01T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('rules engine', () => {
  it('matches glob patterns on file path', () => {
    const rules: InferenceRule[] = [
      {
        match: {
          type: 'object',
          properties: {
            file: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  glob: 'docs/**/*.md',
                },
              },
            },
          },
        },
        set: { category: 'documentation' },
      },
    ];
    const compiled = compileRules(rules);
    const result = applyRules(compiled, makeAttributes());
    expect(result).toEqual({ category: 'documentation' });
  });

  it('does not match when glob does not match', () => {
    const rules: InferenceRule[] = [
      {
        match: {
          type: 'object',
          properties: {
            file: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  glob: 'src/**/*.ts',
                },
              },
            },
          },
        },
        set: { category: 'source' },
      },
    ];
    const compiled = compileRules(rules);
    const result = applyRules(compiled, makeAttributes());
    expect(result).toEqual({});
  });

  it('matches frontmatter properties', () => {
    const rules: InferenceRule[] = [
      {
        match: {
          type: 'object',
          properties: {
            frontmatter: {
              type: 'object',
              properties: {
                tags: {
                  type: 'array',
                  contains: { const: 'api' },
                },
              },
              required: ['tags'],
            },
          },
          required: ['frontmatter'],
        },
        set: { docType: 'api-reference' },
      },
    ];
    const compiled = compileRules(rules);
    const attrs = makeAttributes({ frontmatter: { tags: ['api', 'v2'] } });
    const result = applyRules(compiled, attrs);
    expect(result).toEqual({ docType: 'api-reference' });
  });

  it('resolves template variables', () => {
    const rules: InferenceRule[] = [
      {
        match: { type: 'object' },
        set: {
          source: '${file.path}',
          dir: '${file.directory}',
        },
      },
    ];
    const compiled = compileRules(rules);
    const result = applyRules(compiled, makeAttributes());
    expect(result).toEqual({
      source: 'docs/readme.md',
      dir: 'docs',
    });
  });

  it('later rules override earlier ones', () => {
    const rules: InferenceRule[] = [
      {
        match: { type: 'object' },
        set: { priority: 'low', source: 'first' },
      },
      {
        match: { type: 'object' },
        set: { priority: 'high' },
      },
    ];
    const compiled = compileRules(rules);
    const result = applyRules(compiled, makeAttributes());
    expect(result).toEqual({ priority: 'high', source: 'first' });
  });
});
