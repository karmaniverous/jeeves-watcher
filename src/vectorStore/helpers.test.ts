/**
 * @module vectorStore/helpers.test
 * Tests for vector store helper utilities.
 */

import { describe, expect, it } from 'vitest';

import { inferPayloadType } from './helpers';

describe('inferPayloadType', () => {
  it('should return "keyword" for null', () => {
    expect(inferPayloadType(null)).toBe('keyword');
  });

  it('should return "keyword" for undefined', () => {
    expect(inferPayloadType(undefined)).toBe('keyword');
  });

  it('should return "integer" for integer numbers', () => {
    expect(inferPayloadType(42)).toBe('integer');
    expect(inferPayloadType(0)).toBe('integer');
    expect(inferPayloadType(-100)).toBe('integer');
  });

  it('should return "float" for non-integer numbers', () => {
    expect(inferPayloadType(3.14)).toBe('float');
    expect(inferPayloadType(0.5)).toBe('float');
    expect(inferPayloadType(-2.7)).toBe('float');
  });

  it('should return "bool" for booleans', () => {
    expect(inferPayloadType(true)).toBe('bool');
    expect(inferPayloadType(false)).toBe('bool');
  });

  it('should return "keyword[]" for arrays', () => {
    expect(inferPayloadType([])).toBe('keyword[]');
    expect(inferPayloadType([1, 2, 3])).toBe('keyword[]');
    expect(inferPayloadType(['a', 'b'])).toBe('keyword[]');
  });

  it('should return "keyword" for short strings (≤256 chars)', () => {
    expect(inferPayloadType('short')).toBe('keyword');
    expect(inferPayloadType('a'.repeat(256))).toBe('keyword');
  });

  it('should return "text" for long strings (>256 chars)', () => {
    expect(inferPayloadType('a'.repeat(257))).toBe('text');
    expect(inferPayloadType('a'.repeat(1000))).toBe('text');
  });

  it('should return "keyword" for objects', () => {
    expect(inferPayloadType({})).toBe('keyword');
    expect(inferPayloadType({ foo: 'bar' })).toBe('keyword');
  });

  it('should return "keyword" for functions', () => {
    expect(inferPayloadType(() => {})).toBe('keyword');
  });

  it('should return "keyword" for symbols', () => {
    expect(inferPayloadType(Symbol('test'))).toBe('keyword');
  });
});
