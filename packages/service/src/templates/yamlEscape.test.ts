/**
 * @module templates/yamlEscape.test
 * Tests for YAML escaping helpers.
 */

import { describe, expect, it } from 'vitest';

import { yamlValue } from './yamlEscape';

describe('yamlValue', () => {
  it('returns empty string for null/undefined', () => {
    expect(yamlValue(null)).toBe('');
    expect(yamlValue(undefined)).toBe('');
  });

  it('does not quote simple strings', () => {
    expect(yamlValue('hello')).toBe('hello');
  });

  it('quotes strings with colon or newline', () => {
    expect(yamlValue('a: b')).toBe('"a: b"');
    expect(yamlValue('a\nb')).toBe('"a\\nb"');
  });

  it('renders arrays as flow sequences', () => {
    expect(yamlValue(['a', 'b'])).toBe('[a, b]');
  });

  it('renders objects as nested mappings', () => {
    const out = yamlValue({ a: 'b', nested: { c: 'd' } });
    expect(out).toContain('a: b');
    expect(out).toContain('nested:');
    expect(out).toContain('  c: d');
  });

  it('converts numbers and booleans to strings', () => {
    expect(yamlValue(42)).toBe('42');
    expect(yamlValue(true)).toBe('true');
    expect(yamlValue(false)).toBe('false');
  });

  it('renders empty arrays and objects', () => {
    expect(yamlValue([])).toBe('[]');
    expect(yamlValue({})).toBe('{}');
  });

  it('quotes date-like strings to prevent YAML date coercion', () => {
    const out = yamlValue('2024-01-15');
    expect(out).toBe('"2024-01-15"');
  });

  it('quotes strings with leading special characters', () => {
    expect(yamlValue('*bold')).toBe('"*bold"');
    expect(yamlValue('&anchor')).toBe('"&anchor"');
    expect(yamlValue('!tag')).toBe('"!tag"');
  });

  it('quotes empty strings', () => {
    expect(yamlValue('')).toBe('""');
  });
});
