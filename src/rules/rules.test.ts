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
    const result = await applyRules(compiled, makeAttributes());
    expect(result).toEqual({ category: 'documentation' });
  });

  it('does not match when glob does not match', async () => {
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
    const result = await applyRules(compiled, makeAttributes());
    expect(result).toEqual({});
  });

  it('matches frontmatter properties', async () => {
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
    const result = await applyRules(compiled, attrs);
    expect(result).toEqual({ docType: 'api-reference' });
  });

  it('resolves template variables', async () => {
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
    const result = await applyRules(compiled, makeAttributes());
    expect(result).toEqual({
      source: 'docs/readme.md',
      dir: 'docs',
    });
  });

  it('later rules override earlier ones', async () => {
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
    const result = await applyRules(compiled, makeAttributes());
    expect(result).toEqual({ priority: 'high', source: 'first' });
  });

  it('applies inline JsonMap to extract path segment', async () => {
    const rules: InferenceRule[] = [
      {
        match: { type: 'object' },
        set: {},
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
    expect(result).toEqual({ project: 'docs' });
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
        match: { type: 'object' },
        set: {},
        map: 'extractDirectory',
      },
    ];

    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes(), namedMaps);
    expect(result).toEqual({ dir: 'docs' });
  });

  it('merges set and map outputs with map overriding set', async () => {
    const rules: InferenceRule[] = [
      {
        match: { type: 'object' },
        set: { field: 'from-set', other: 'value' },
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
    expect(result).toEqual({ field: 'readme', other: 'value' });
  });

  it('warns and skips when named map reference is not found', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* no-op */
    });

    const rules: InferenceRule[] = [
      {
        match: { type: 'object' },
        set: { fallback: 'value' },
        map: 'nonexistent',
      },
    ];

    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes());

    expect(result).toEqual({ fallback: 'value' });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Map reference "nonexistent" not found in named maps. Skipping map transformation.',
    );

    consoleWarnSpy.mockRestore();
  });

  it('applies multiple matching rules in order (all applied, later overrides)', async () => {
    const rules: InferenceRule[] = [
      {
        match: { type: 'object' },
        set: { a: 1, shared: 'first' },
      },
      {
        match: { type: 'object' },
        set: { b: 2, shared: 'second' },
      },
    ];

    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes());

    expect(result).toEqual({ a: 1, b: 2, shared: 'second' });
  });

  it('treats missing template variables as empty string', async () => {
    const rules: InferenceRule[] = [
      {
        match: { type: 'object' },
        set: { title: '${frontmatter.title}', path: '${file.path}' },
      },
    ];

    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes());

    expect(result).toEqual({ title: '', path: 'docs/readme.md' });
  });

  it('warns and skips when JsonMap transform throws', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* no-op */
    });

    const rules: InferenceRule[] = [
      {
        match: { type: 'object' },
        set: { ok: true },
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

    expect(result).toEqual({ ok: true });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('JsonMap transformation failed:'),
    );

    consoleWarnSpy.mockRestore();
  });

  it('rejects invalid JSON Schema definitions in match', () => {
    const rules: InferenceRule[] = [
      {
        // Ajv should throw on invalid `type`.
        match: { type: 'not-a-real-json-schema-type' },
        set: { a: 1 },
      },
    ];

    expect(() => compileRules(rules)).toThrow();
  });

  it('supports rules with only match (empty set, no map)', async () => {
    const rules: InferenceRule[] = [
      {
        match: { type: 'object' },
        set: {},
      },
    ];

    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes());
    expect(result).toEqual({});
  });
});
