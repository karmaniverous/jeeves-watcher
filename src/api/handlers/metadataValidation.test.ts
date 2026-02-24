import { describe, expect, it } from 'vitest';

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
});
