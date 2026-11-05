import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROCESSING_LIMITS,
  resolveProcessingLimits,
} from './processingLimits';

describe('resolveProcessingLimits', () => {
  it('fills every default when processing is absent', () => {
    expect(resolveProcessingLimits({})).toEqual({
      maxFileBytes: 64 * 2 ** 20,
      maxChunksPerFile: 5000,
      maxTextBytes: 8 * 2 ** 20,
    });
    expect(DEFAULT_PROCESSING_LIMITS).toEqual(resolveProcessingLimits({}));
  });

  it('parses configured byte sizes and keeps the chunk count', () => {
    expect(
      resolveProcessingLimits({
        processing: {
          maxFileBytes: '2k',
          maxChunksPerFile: 7,
          maxTextBytes: 300,
        },
      }),
    ).toEqual({ maxFileBytes: 2048, maxChunksPerFile: 7, maxTextBytes: 300 });
  });

  it('defaults each key on its own', () => {
    expect(
      resolveProcessingLimits({ processing: { maxChunksPerFile: 3 } }),
    ).toEqual({
      maxFileBytes: 64 * 2 ** 20,
      maxChunksPerFile: 3,
      maxTextBytes: 8 * 2 ** 20,
    });
  });
});
