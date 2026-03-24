import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import { validateMetadataPayload } from './metadataValidation';

describe('validateMetadataPayload', () => {
  const baseConfig: JeevesWatcherConfig = {
    watch: { paths: ['**/*.md'] },
    embedding: { provider: 'mock', model: 'test' },
    vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
  };

  it('accepts metadata when no rules match or no schema declared', () => {
    const config: JeevesWatcherConfig = {
      ...baseConfig,
      inferenceRules: [
        {
          name: 'never-match',
          description: 'Does not match',
          match: {
            type: 'object',
            properties: {
              file: {
                type: 'object',
                properties: {
                  path: { type: 'string', glob: 'nope/**/*.md' },
                },
              },
            },
          },
        },
      ],
    };

    const result = validateMetadataPayload(config, 'docs/readme.md', {
      any: 'thing',
    });

    expect(result.ok).toBe(true);
  });

  it('rejects type mismatches for declared properties', () => {
    const config: JeevesWatcherConfig = {
      ...baseConfig,
      inferenceRules: [
        {
          name: 'match-all',
          description: 'Matches all',
          match: { type: 'object' },
          schema: [
            {
              properties: {
                count: { type: 'integer', set: '1' },
              },
            },
          ],
        },
      ],
    };

    const result = validateMetadataPayload(config, 'docs/readme.md', {
      count: 'not-a-number',
    });

    expect(result.ok).toBe(false);
    const err = result as {
      ok: false;
      error: string;
      matchedRules: string[];
      details: Array<{
        property: string;
        expected: string;
        received: string;
        rule: string;
        message: string;
      }>;
    };
    expect(err.error).toBe('Validation failed');
    expect(err.details).toHaveLength(1);
    expect(err.details[0]).toMatchObject({
      property: 'count',
      expected: 'integer',
      received: 'string',
      rule: 'match-all',
    });
    expect(err.details[0].message).toContain('count');
    expect(err.matchedRules).toEqual(['match-all']);
  });

  it('allows unknown properties not present in merged schema', () => {
    const config: JeevesWatcherConfig = {
      ...baseConfig,
      inferenceRules: [
        {
          name: 'match-all',
          description: 'Matches all',
          match: { type: 'object' },
          schema: [
            {
              properties: {
                known: { type: 'string', set: 'x' },
              },
            },
          ],
        },
      ],
    };

    const result = validateMetadataPayload(config, 'docs/readme.md', {
      unknown: 123,
    });

    expect(result.ok).toBe(true);
  });

  describe('configDir schema file resolution (#116)', () => {
    let tempDir: string;
    let schemasDir: string;

    beforeAll(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'jw-test-'));
      schemasDir = join(tempDir, 'schemas');
      mkdirSync(schemasDir, { recursive: true });
      writeFileSync(
        join(schemasDir, 'content-fields.json'),
        JSON.stringify({
          type: 'object',
          properties: {
            title: { type: 'string', set: '{{file.stem}}' },
          },
        }),
      );
    });

    afterAll(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('resolves schema file references relative to configDir', () => {
      const config: JeevesWatcherConfig = {
        ...baseConfig,
        schemas: {
          'content-fields': 'schemas/content-fields.json',
        },
        inferenceRules: [
          {
            name: 'file-schema-rule',
            description: 'Uses file-based schema',
            match: { type: 'object' },
            schema: ['content-fields'],
          },
        ],
      };

      const result = validateMetadataPayload(
        config,
        'docs/readme.md',
        { title: 'Hello' },
        tempDir,
      );

      expect(result.ok).toBe(true);
      expect(result.matchedRules).toContain('file-schema-rule');
    });

    it('rejects type mismatch when schema is loaded from file', () => {
      const config: JeevesWatcherConfig = {
        ...baseConfig,
        schemas: {
          'content-fields': 'schemas/content-fields.json',
        },
        inferenceRules: [
          {
            name: 'file-schema-rule',
            description: 'Uses file-based schema',
            match: { type: 'object' },
            schema: ['content-fields'],
          },
        ],
      };

      const result = validateMetadataPayload(
        config,
        'docs/readme.md',
        { title: 42 },
        tempDir,
      );

      expect(result.ok).toBe(false);
    });
  });
});
