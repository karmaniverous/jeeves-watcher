/**
 * @module schemas/byteSize.test
 * Byte-size settings (Design 10): binary-unit suffixes, plain numbers, rejection of malformed strings, and use in `vcs.maxFileBytes` and `logging.rotation.maxSize`.
 */

import { describe, expect, it } from 'vitest';

import { loggingConfigSchema } from './base.js';
import { byteSizeSchema, parseByteSize } from './byteSize.js';
import { vcsConfigSchema } from './vcs.js';

describe('parseByteSize', () => {
  it.each([
    [0, 0],
    [1024, 1024],
    ['512', 512],
    ['1k', 1024],
    ['1K', 1024],
    ['10m', 10 * 1024 * 1024],
    ['2g', 2 * 1024 ** 3],
    [' 1.5 k ', 1536],
  ])('reads %j as %d bytes', (value, bytes) => {
    expect(parseByteSize(value)).toBe(bytes);
  });

  it('throws on a malformed string', () => {
    expect(() => parseByteSize('ten megs')).toThrow('Invalid byte size');
  });
});

describe('byteSizeSchema', () => {
  it('accepts numbers and suffixed strings, rejects others', () => {
    expect(byteSizeSchema.safeParse(100).success).toBe(true);
    expect(byteSizeSchema.safeParse('10m').success).toBe(true);
    expect(byteSizeSchema.safeParse(-1).success).toBe(false);
    expect(byteSizeSchema.safeParse(1.5).success).toBe(false);
    expect(byteSizeSchema.safeParse('10mb').success).toBe(false);
  });

  it('types vcs.maxFileBytes and logging.rotation.maxSize', () => {
    expect(vcsConfigSchema.parse({ maxFileBytes: '1k' }).maxFileBytes).toBe(
      '1k',
    );
    expect(vcsConfigSchema.safeParse({ maxFileBytes: 'big' }).success).toBe(
      false,
    );
    expect(
      loggingConfigSchema.parse({ rotation: { maxSize: '1k', maxFiles: 2 } })
        .rotation,
    ).toEqual({ maxSize: '1k', maxFiles: 2 });
    expect(loggingConfigSchema.parse({ rotation: false }).rotation).toBe(false);
    expect(
      loggingConfigSchema.safeParse({ rotation: { frequency: 'weekly' } })
        .success,
    ).toBe(false);
  });
});
