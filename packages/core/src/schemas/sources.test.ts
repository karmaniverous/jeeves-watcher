/**
 * @module schemas/sources.test
 * Tests for source config, source reference and source document schemas.
 */

import { describe, expect, it } from 'vitest';

import {
  sourceConfigSchema,
  sourceDocumentSchema,
  sourceReferenceSchema,
  sourcesConfigSchema,
} from './sources';

describe('sourceConfigSchema', () => {
  it('applies timeout and concurrency defaults', () => {
    const parsed = sourceConfigSchema.parse({
      url: 'http://127.0.0.1:8099/{id}',
    });
    expect(parsed).toEqual({
      url: 'http://127.0.0.1:8099/{id}',
      timeoutMs: 10000,
      concurrency: 8,
    });
  });

  it('accepts headers and explicit settings', () => {
    const parsed = sourceConfigSchema.parse({
      url: '${BASE}/watcher/sources/{id}',
      headers: { Authorization: 'Bearer ${KEY}' },
      timeoutMs: 5000,
      concurrency: 2,
    });
    expect(parsed.headers).toEqual({ Authorization: 'Bearer ${KEY}' });
    expect(parsed.timeoutMs).toBe(5000);
    expect(parsed.concurrency).toBe(2);
  });

  it('rejects a url without {id}', () => {
    const result = sourceConfigSchema.safeParse({ url: 'http://x/y' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain('{id}');
  });

  it.each([
    ['timeoutMs', 0],
    ['timeoutMs', 1.5],
    ['concurrency', 0],
    ['concurrency', -1],
  ])('rejects %s = %s', (key, value) => {
    expect(
      sourceConfigSchema.safeParse({ url: 'http://x/{id}', [key]: value })
        .success,
    ).toBe(false);
  });

  it('rejects non-string header values', () => {
    expect(
      sourceConfigSchema.safeParse({
        url: 'http://x/{id}',
        headers: { 'X-N': 1 },
      }).success,
    ).toBe(false);
  });
});

describe('sourcesConfigSchema', () => {
  const source = { url: 'http://x/{id}' };

  it.each(['cg', 'cgtest', 'my-source', 'a1', `a${'b'.repeat(31)}`])(
    'accepts source name %s',
    (name) => {
      expect(sourcesConfigSchema.safeParse({ [name]: source }).success).toBe(
        true,
      );
    },
  );

  it.each(['c', 'j', 'Cg', '1cg', '-cg', 'cg_x', `a${'b'.repeat(32)}`])(
    'rejects source name %s',
    (name) => {
      expect(sourcesConfigSchema.safeParse({ [name]: source }).success).toBe(
        false,
      );
    },
  );
});

describe('sourceReferenceSchema', () => {
  it.each(['cg://chat/thread/abc123', 'cgtest://sample-1', 'cg://A'])(
    'accepts %s',
    (ref) => {
      expect(sourceReferenceSchema.safeParse(ref).success).toBe(true);
    },
  );

  it.each([
    'cg:abc',
    'c://abc',
    'j://abc',
    'cg://',
    'cg://has space',
    'CG://abc',
    `cg://${'x'.repeat(513)}`,
  ])('rejects %s', (ref) => {
    expect(sourceReferenceSchema.safeParse(ref).success).toBe(false);
  });
});

describe('sourceDocumentSchema', () => {
  it('accepts any JSON object', () => {
    const doc = { userId: 'u', streaks: [{ msgs: [] }] };
    expect(sourceDocumentSchema.parse(doc)).toEqual(doc);
  });

  it.each([[[1, 2]], ['text'], [null], [42]])('rejects %j', (value) => {
    expect(sourceDocumentSchema.safeParse(value).success).toBe(false);
  });
});
