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
});
