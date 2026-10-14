/**
 * @module packaging.test
 * Packaging contract of the SDK (0.20.0 release spec Verification Checklist): ESM only (no CommonJS entry) and a single runtime dependency, jeeves-watcher-core.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

interface PackageJson {
  type?: string;
  main?: string;
  exports: Record<string, Record<string, unknown>>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageJson;

describe('SDK packaging', () => {
  it('is ESM only', () => {
    expect(pkg.type).toBe('module');
    expect(pkg.main).toBeUndefined();
    expect(Object.keys(pkg.exports)).toEqual(['.']);
    expect(Object.keys(pkg.exports['.'])).toEqual(['import']);
  });

  it('depends at runtime on jeeves-watcher-core only', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([
      '@karmaniverous/jeeves-watcher-core',
    ]);
    expect(pkg.peerDependencies).toBeUndefined();
  });
});
