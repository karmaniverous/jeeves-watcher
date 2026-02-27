/**
 * @module templates/helpers.test
 * Tests for built-in Handlebars helpers.
 */

import { describe, expect, it } from 'vitest';

import { createHandlebarsInstance } from './engine';

describe('toUnix helper', () => {
  const hbs = createHandlebarsInstance();

  it('converts ISO string to unix seconds', () => {
    const template = hbs.compile('{{toUnix date}}', { noEscape: true });
    const result = template({ date: '2024-01-01T00:00:00.000Z' });
    expect(result).toBe('1704067200');
  });

  it('converts epoch ms number to unix seconds', () => {
    const template = hbs.compile('{{toUnix date}}', { noEscape: true });
    const result = template({ date: 1704067200000 });
    expect(result).toBe('1704067200');
  });

  it('returns empty string for null', () => {
    const template = hbs.compile('{{toUnix date}}', { noEscape: true });
    const result = template({ date: null });
    expect(result).toBe('');
  });

  it('returns empty string for undefined', () => {
    const template = hbs.compile('{{toUnix date}}', { noEscape: true });
    const result = template({});
    expect(result).toBe('');
  });

  it('returns empty string for invalid date', () => {
    const template = hbs.compile('{{toUnix date}}', { noEscape: true });
    const result = template({ date: 'not-a-date' });
    expect(result).toBe('');
  });
});

describe('toUnixMs helper', () => {
  const hbs = createHandlebarsInstance();

  it('converts ISO string to unix milliseconds', () => {
    const template = hbs.compile('{{toUnixMs date}}', { noEscape: true });
    const result = template({ date: '2024-01-01T00:00:00.000Z' });
    expect(result).toBe('1704067200000');
  });

  it('converts epoch ms number to unix milliseconds', () => {
    const template = hbs.compile('{{toUnixMs date}}', { noEscape: true });
    const result = template({ date: 1704067200000 });
    expect(result).toBe('1704067200000');
  });

  it('returns empty string for null', () => {
    const template = hbs.compile('{{toUnixMs date}}', { noEscape: true });
    const result = template({ date: null });
    expect(result).toBe('');
  });

  it('returns empty string for invalid date', () => {
    const template = hbs.compile('{{toUnixMs date}}', { noEscape: true });
    const result = template({ date: 'not-a-date' });
    expect(result).toBe('');
  });
});
