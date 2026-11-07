/**
 * @module schemas/services.test
 * The embedding rate-limit default: EMBEDDING_DEFAULTS holds it (4000 items per minute) and the schema describes the same value.
 */

import { describe, expect, it } from 'vitest';

import { EMBEDDING_DEFAULTS } from '../defaults';
import { embeddingConfigSchema } from './services';

describe('embedding.rateLimitPerMinute default', () => {
  it('is 4000 items per minute', () => {
    expect(EMBEDDING_DEFAULTS.rateLimitPerMinute).toBe(4000);
  });

  it('is the default the schema describes', () => {
    expect(embeddingConfigSchema.shape.rateLimitPerMinute.description).toMatch(
      / Default: 4000\.$/,
    );
  });

  it('leaves an unset value unset (the loader applies the default)', () => {
    const parsed = embeddingConfigSchema.parse({});
    expect(parsed.rateLimitPerMinute).toBeUndefined();
  });
});
