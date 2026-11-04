import { describe, expect, it } from 'vitest';

import { issueTypeSchema } from '../api/monitoring.js';
import { PROCESSING_DEFAULTS } from '../defaults.js';
import { parseByteSize } from './byteSize.js';
import { processingConfigSchema } from './processing.js';
import { embeddingConfigSchema } from './services.js';

describe('processingConfigSchema', () => {
  it('accepts byte sizes as numbers or suffixed strings and a chunk count', () => {
    const parsed = processingConfigSchema.parse({
      maxFileBytes: '64m',
      maxChunksPerFile: 5000,
      maxTextBytes: 1024,
    });
    expect(parsed).toEqual({
      maxFileBytes: '64m',
      maxChunksPerFile: 5000,
      maxTextBytes: 1024,
    });
  });

  it('accepts an empty object (every key defaults)', () => {
    expect(processingConfigSchema.parse({})).toEqual({});
  });

  it.each([
    [{ maxChunksPerFile: 0 }],
    [{ maxChunksPerFile: 1.5 }],
    [{ maxFileBytes: '64x' }],
    [{ maxTextBytes: -1 }],
  ])('rejects %j', (value) => {
    expect(processingConfigSchema.safeParse(value).success).toBe(false);
  });

  it('defaults are 64 MiB, 5000 chunks and 8 MiB', () => {
    expect(parseByteSize(PROCESSING_DEFAULTS.maxFileBytes)).toBe(64 * 2 ** 20);
    expect(PROCESSING_DEFAULTS.maxChunksPerFile).toBe(5000);
    expect(parseByteSize(PROCESSING_DEFAULTS.maxTextBytes)).toBe(8 * 2 ** 20);
  });
});

describe('embedding.alertUrl', () => {
  it('accepts a URL and rejects a non-URL', () => {
    expect(
      embeddingConfigSchema.parse({ alertUrl: 'https://alerts.internal/x' })
        .alertUrl,
    ).toBe('https://alerts.internal/x');
    expect(
      embeddingConfigSchema.safeParse({ alertUrl: 'not a url' }).success,
    ).toBe(false);
  });
});

describe('issue type too_large', () => {
  it('is a canonical issue code', () => {
    expect(issueTypeSchema.parse('too_large')).toBe('too_large');
  });
});
