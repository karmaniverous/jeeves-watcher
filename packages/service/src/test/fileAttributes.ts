/**
 * @module test/fileAttributes
 * File attributes fixture for the rules engine suites (rules/rules.*.test.ts): `docs/readme.md` with overrides. Pure.
 */

import type { FileAttributes } from '../rules';

/**
 * File attributes for `docs/readme.md` (1 KiB, modified 2026-01-01).
 *
 * @param overrides - Attribute overrides (replace whole top-level keys).
 * @returns The attributes.
 */
export function makeAttributes(
  overrides: Partial<FileAttributes> = {},
): FileAttributes {
  return {
    file: {
      path: 'docs/readme.md',
      directory: 'docs',
      filename: 'readme.md',
      extension: '.md',
      sizeBytes: 1024,
      modified: '2026-01-01T00:00:00.000Z',
    },
    ...overrides,
  };
}
