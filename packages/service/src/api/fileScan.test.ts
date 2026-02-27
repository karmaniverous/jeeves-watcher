import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { globBase } from './fileScan';

describe('globBase', () => {
  it('returns resolved path for non-glob pattern', () => {
    expect(globBase('src/foo/bar.ts')).toBe(resolve('src/foo/bar.ts'));
  });

  it('returns parent directory when glob is mid-segment', () => {
    const result = globBase('src/foo/*.ts');
    expect(result).toBe(resolve('src/foo'));
  });

  it('handles glob at start of path', () => {
    const result = globBase('**/*.ts');
    expect(result).toBe(resolve('.'));
  });

  it('handles question mark glob', () => {
    const result = globBase('src/fo?/bar.ts');
    expect(result).toBe(resolve('src'));
  });

  it('handles bracket glob', () => {
    const result = globBase('src/[abc]/bar.ts');
    expect(result).toBe(resolve('src'));
  });

  it('handles trailing slash before glob', () => {
    const result = globBase('docs/**');
    expect(result).toBe(resolve('docs'));
  });
});
