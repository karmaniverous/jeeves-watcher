import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { globBase } from './fileScan';

describe('globBase', () => {
  it('returns resolved path when no glob chars present', () => {
    const result = globBase('src/foo/bar.ts');
    expect(result).toBe(resolve('src/foo/bar.ts'));
  });

  it('returns parent directory when glob is mid-segment', () => {
    const result = globBase('src/foo/*.ts');
    expect(result).toBe(resolve('src/foo'));
  });

  it('returns parent when glob starts at segment boundary', () => {
    const result = globBase('src/**/bar.ts');
    expect(result).toBe(resolve('src'));
  });

  it('handles trailing glob after slash', () => {
    const result = globBase('src/docs/**');
    expect(result).toBe(resolve('src/docs'));
  });

  it('handles glob at root', () => {
    const result = globBase('*.ts');
    expect(result).toBe(resolve('.'));
  });

  it('handles bracket expressions', () => {
    const result = globBase('src/[abc]/file.ts');
    expect(result).toBe(resolve('src'));
  });

  it('handles question mark glob', () => {
    const result = globBase('src/fo?/file.ts');
    expect(result).toBe(resolve('src'));
  });

  it('handles backslashes (Windows paths)', () => {
    // normalizeSlashes converts backslashes before glob detection
    const result = globBase('src\\foo\\*.ts');
    expect(result).toBe(resolve('src/foo'));
  });
});
