/**
 * @module rules/rules.map.test
 * Rules engine JsonMap transforms: inline and named maps, map output overriding set, and warnings that skip the map when a named map, a map file or the transform fails.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { InferenceRule } from '../config/types';
import { makeAttributes } from '../test/fileAttributes';
import { applyRules, compileRules } from './index';

describe('rules engine: JsonMap', () => {
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
      'Map reference "nonexistent" not found in named maps. Skipping the rule\'s map, render and template.',
    );

    consoleWarnSpy.mockRestore();
  });

  it('says the rest of the rule is skipped when a map file cannot be loaded', async () => {
    const warn = vi.fn();
    const compiled = compileRules([
      {
        name: 'missing-map-file',
        description: 'Missing map file',
        match: { type: 'object' },
        map: 'missing-map.json',
      },
    ]);
    await applyRules(compiled, makeAttributes(), {
      configDir: join(tmpdir(), 'no-such-config-dir'),
      logger: { warn },
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Failed to load map file "missing-map\.json": .+\. Skipping the rule's map, render and template\.$/,
      ),
    );
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
});
