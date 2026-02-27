import { describe, expect, it, vi } from 'vitest';

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

  it('resolves template variables', async () => {
    const rules: InferenceRule[] = [
      {
        name: 'template-vars',
        description: 'Resolve template variables',
        match: { type: 'object' },
        schema: [
          {
            properties: {
              source: { type: 'string', set: '{{file.path}}' },
              dir: { type: 'string', set: '{{file.directory}}' },
            },
          },
        ],
      },
    ];
    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes());
    expect(result.metadata).toEqual({
      source: 'docs/readme.md',
      dir: 'docs',
    });
  });

  it('later rules override earlier ones', async () => {
    const rules: InferenceRule[] = [
      {
        name: 'first-rule',
        description: 'First rule',
        match: { type: 'object' },
        schema: [
          {
            properties: {
              priority: { type: 'string', set: 'low' },
              source: { type: 'string', set: 'first' },
            },
          },
        ],
      },
      {
        name: 'second-rule',
        description: 'Second rule overrides priority',
        match: { type: 'object' },
        schema: [
          {
            properties: {
              priority: { type: 'string', set: 'high' },
            },
          },
        ],
      },
    ];
    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes());
    expect(result.metadata).toEqual({ priority: 'high', source: 'first' });
  });

  it('applies inline JsonMap to extract path segment', async () => {
    const rules: InferenceRule[] = [
      {
        name: 'inline-map',
        description: 'Apply inline JsonMap',
        match: { type: 'object' },
        schema: [],
        map: {
          project: {
            $: [
              { method: '$.lib.split', params: ['$.input.file.path', '/'] },
              { method: '$.lib.slice', params: ['$[0]', 0, 1] },
              { method: '$.lib.join', params: ['$[0]', ''] },
            ],
          },
        },
      },
    ];
    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes());
    expect(result.metadata).toEqual({ project: 'docs' });
  });

  it('applies named JsonMap via string reference', async () => {
    const namedMaps = {
      extractDirectory: {
        dir: {
          $: [
            { method: '$.lib.split', params: ['$.input.file.path', '/'] },
            { method: '$.lib.slice', params: ['$[0]', 0, 1] },
            { method: '$.lib.join', params: ['$[0]', ''] },
          ],
        },
      },
    };

    const rules: InferenceRule[] = [
      {
        name: 'named-map-ref',
        description: 'Apply named JsonMap',
        match: { type: 'object' },
        schema: [],
        map: 'extractDirectory',
      },
    ];

    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes(), { namedMaps });
    expect(result.metadata).toEqual({ dir: 'docs' });
  });

  it('merges set and map outputs with map overriding set', async () => {
    const rules: InferenceRule[] = [
      {
        name: 'set-map-merge',
        description: 'Merge schema and map outputs',
        match: { type: 'object' },
        schema: [
          {
            properties: {
              field: { type: 'string', set: 'from-set' },
              other: { type: 'string', set: 'value' },
            },
          },
        ],
        map: {
          field: {
            $: [
              { method: '$.lib.split', params: ['$.input.file.filename', '.'] },
              { method: '$.lib.slice', params: ['$[0]', 0, 1] },
              { method: '$.lib.join', params: ['$[0]', ''] },
            ],
          },
        },
      },
    ];

    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes());
    expect(result.metadata).toEqual({ field: 'readme', other: 'value' });
  });

  it('warns and skips when named map reference is not found', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* no-op */
    });

    const rules: InferenceRule[] = [
      {
        name: 'missing-map-ref',
        description: 'Handle missing map ref',
        match: { type: 'object' },
        schema: [
          {
            properties: {
              fallback: { type: 'string', set: 'value' },
            },
          },
        ],
        map: 'nonexistent',
      },
    ];

    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes());

    expect(result.metadata).toEqual({ fallback: 'value' });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Map reference "nonexistent" not found in named maps. Skipping map transformation.',
    );

    consoleWarnSpy.mockRestore();
  });

  it('applies multiple matching rules in order (all applied, later overrides)', async () => {
    const rules: InferenceRule[] = [
      {
        name: 'multi-first',
        description: 'First matching rule',
        match: { type: 'object' },
        schema: [
          {
            properties: {
              a: { type: 'integer', set: '1' },
              shared: { type: 'string', set: 'first' },
            },
          },
        ],
      },
      {
        name: 'multi-second',
        description: 'Second matching rule',
        match: { type: 'object' },
        schema: [
          {
            properties: {
              b: { type: 'integer', set: '2' },
              shared: { type: 'string', set: 'second' },
            },
          },
        ],
      },
    ];

    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes());

    expect(result.metadata).toEqual({ a: 1, b: 2, shared: 'second' });
  });

  it('treats missing template variables as empty string', async () => {
    const rules: InferenceRule[] = [
      {
        name: 'missing-vars',
        description: 'Handle missing template variables',
        match: { type: 'object' },
        schema: [
          {
            properties: {
              title: { type: 'string', set: '{{frontmatter.title}}' },
              path: { type: 'string', set: '{{file.path}}' },
            },
          },
        ],
      },
    ];

    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes());

    expect(result.metadata).toEqual({ title: '', path: 'docs/readme.md' });
  });

  it('warns and skips when JsonMap transform throws', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* no-op */
    });

    const rules: InferenceRule[] = [
      {
        name: 'map-throws',
        description: 'Handle JsonMap errors',
        match: { type: 'object' },
        schema: [
          {
            properties: {
              ok: { type: 'boolean', set: 'true' },
            },
          },
        ],
        map: {
          willFail: {
            $: [
              // Force a runtime error: $.input.file is an object, not a string.
              { method: '$.lib.split', params: ['$.input.file', '/'] },
            ],
          },
        },
      },
    ];

    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes());

    expect(result.metadata).toEqual({ ok: true });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('JsonMap transformation failed:'),
    );

    consoleWarnSpy.mockRestore();
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
