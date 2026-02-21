/**
 * @module util/normalizeError.test
 *
 * Tests for error normalization utility.
 */

import { describe, expect, it } from 'vitest';

import { normalizeError } from './normalizeError';

describe('normalizeError', () => {
  it('returns Error instances as-is', () => {
    const err = new Error('test');
    expect(normalizeError(err)).toBe(err);
  });

  it('wraps string values in Error', () => {
    const result = normalizeError('boom');
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('boom');
  });

  it('wraps plain objects with message property', () => {
    const result = normalizeError({ message: 'oops', code: 42 });
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('oops');
    expect(result.cause).toEqual({ message: 'oops', code: 42 });
  });

  it('wraps non-object values', () => {
    const result = normalizeError(42);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('42');
  });

  it('produces Error with stack for pino serialization', () => {
    const result = normalizeError('no stack originally');
    expect(result.stack).toBeDefined();
    expect(result.stack).toContain('normalizeError');
  });
});
