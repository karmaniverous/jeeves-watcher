/**
 * @module rules/rules.match.test
 * Rules engine matching: glob patterns on file paths (case-insensitive, dotfiles), frontmatter properties, invalid match schemas rejected at compile time, and match-only rules.
 */

import { describe, expect, it } from 'vitest';

import type { InferenceRule } from '../config/types';
import { makeAttributes } from '../test/fileAttributes';
import { applyRules, compileRules } from './index';

describe('rules engine: matching', () => {
  it('matches glob patterns on file path', async () => {
    const rules: InferenceRule[] = [
      {
        name: 'docs-glob',
        description: 'Match documentation files',
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
        schema: [
          {
            properties: { category: { type: 'string', set: 'documentation' } },
          },
        ],
      },
    ];
    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes());
    expect(result.metadata).toEqual({ category: 'documentation' });
  });

  it('does not match when glob does not match', async () => {
    const rules: InferenceRule[] = [
      {
        name: 'src-glob',
        description: 'Match source files',
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
        schema: [
          { properties: { category: { type: 'string', set: 'source' } } },
        ],
      },
    ];
    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes());
    expect(result.metadata).toEqual({});
  });

  it('matches glob patterns case-insensitively (Windows drive letters)', async () => {
    const rules: InferenceRule[] = [
      {
        name: 'case-glob',
        description: 'Match with different drive-letter casing',
        match: {
          properties: {
            file: {
              properties: {
                path: { glob: 'C:/docs/**/*.md' },
              },
            },
          },
        },
        schema: [{ properties: { matched: { type: 'string', set: 'yes' } } }],
      },
    ];
    const compiled = compileRules(rules);
    const attrs = makeAttributes({
      file: {
        path: 'c:/docs/readme.md',
        directory: 'c:/docs',
        filename: 'readme.md',
        extension: '.md',
        sizeBytes: 1024,
        modified: '2026-01-01T00:00:00.000Z',
      },
    });
    const result = await applyRules(compiled, attrs);
    expect(result.metadata).toEqual({ matched: 'yes' });
  });

  it('matches glob patterns with dot files', async () => {
    const rules: InferenceRule[] = [
      {
        name: 'dot-glob',
        description: 'Match dotfiles',
        match: {
          properties: {
            file: {
              properties: {
                path: { glob: 'c:/config/**' },
              },
            },
          },
        },
        schema: [{ properties: { matched: { type: 'string', set: 'yes' } } }],
      },
    ];
    const compiled = compileRules(rules);
    const attrs = makeAttributes({
      file: {
        path: 'c:/config/.hidden/test.json',
        directory: 'c:/config/.hidden',
        filename: 'test.json',
        extension: '.json',
        sizeBytes: 512,
        modified: '2026-01-01T00:00:00.000Z',
      },
    });
    const result = await applyRules(compiled, attrs);
    expect(result.metadata).toEqual({ matched: 'yes' });
  });

  it('matches frontmatter properties', async () => {
    const rules: InferenceRule[] = [
      {
        name: 'frontmatter-tags',
        description: 'Match API docs by tags',
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
        schema: [
          { properties: { docType: { type: 'string', set: 'api-reference' } } },
        ],
      },
    ];
    const compiled = compileRules(rules);
    const attrs = makeAttributes({ frontmatter: { tags: ['api', 'v2'] } });
    const result = await applyRules(compiled, attrs);
    expect(result.metadata).toEqual({ docType: 'api-reference' });
  });

  it('rejects invalid JSON Schema definitions in match', () => {
    const rules: InferenceRule[] = [
      {
        name: 'invalid-schema',
        description: 'Test invalid schema',
        // Ajv should throw on invalid `type`.
        match: { type: 'not-a-real-json-schema-type' },
        schema: [
          {
            properties: {
              a: { type: 'integer', set: '1' },
            },
          },
        ],
      },
    ];

    expect(() => compileRules(rules)).toThrow();
  });

  it('supports rules with only match (empty set, no map)', async () => {
    const rules: InferenceRule[] = [
      {
        name: 'empty-set',
        description: 'Rule with empty schema',
        match: { type: 'object' },
        schema: [],
      },
    ];

    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes());
    expect(result.metadata).toEqual({});
  });
});
