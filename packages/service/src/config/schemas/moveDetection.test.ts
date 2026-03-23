/**
 * @module config/schemas/moveDetection.test
 * Tests for moveDetection config schema.
 */

import { describe, expect, it } from 'vitest';

import { watchConfigSchema } from './base';

describe('watchConfigSchema.moveDetection', () => {
  it('accepts valid moveDetection config', () => {
    const result = watchConfigSchema.parse({
      paths: ['**/*.md'],
      moveDetection: { enabled: true, bufferMs: 3000 },
    });
    expect(result.moveDetection?.enabled).toBe(true);
    expect(result.moveDetection?.bufferMs).toBe(3000);
  });

  it('applies defaults when moveDetection is provided without values', () => {
    const result = watchConfigSchema.parse({
      paths: ['**/*.md'],
      moveDetection: {},
    });
    expect(result.moveDetection?.enabled).toBe(true);
    expect(result.moveDetection?.bufferMs).toBe(2000);
  });

  it('allows moveDetection to be omitted', () => {
    const result = watchConfigSchema.parse({
      paths: ['**/*.md'],
    });
    expect(result.moveDetection).toBeUndefined();
  });

  it('rejects bufferMs below minimum', () => {
    expect(() =>
      watchConfigSchema.parse({
        paths: ['**/*.md'],
        moveDetection: { bufferMs: 50 },
      }),
    ).toThrow();
  });
});
