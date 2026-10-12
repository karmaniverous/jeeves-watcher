/**
 * @module api/documentOps.test
 * Tests for the POST /render and POST /metadata schemas (exactly one of path or source).
 */

import { describe, expect, it } from 'vitest';

import {
  metadataRequestSchema,
  metadataResponseSchema,
  renderRequestSchema,
  renderResponseSchema,
} from './documentOps';

describe('renderRequestSchema', () => {
  it.each([
    ['a path', { path: 'j:/domains/a.md' }],
    ['a source', { source: 'cg://chat/thread/1' }],
  ])('accepts %s', (_label, body) => {
    expect(renderRequestSchema.parse(body)).toEqual(body);
  });

  it.each([
    ['neither', {}],
    ['both', { path: 'a.md', source: 'cg://1' }],
    ['empty path', { path: '' }],
    ['non-string path', { path: 42 }],
    ['malformed source', { source: 'cg:1' }],
  ])('rejects %s', (_label, body) => {
    expect(renderRequestSchema.safeParse(body).success).toBe(false);
  });

  it('names the exactly-one rule in the issue', () => {
    const result = renderRequestSchema.safeParse({});
    expect(result.error?.issues[0]?.message).toBe(
      'Exactly one of path or source is required',
    );
  });

  it('validates a response', () => {
    expect(
      renderResponseSchema.safeParse({
        renderAs: 'md',
        content: '# x',
        rules: [],
        metadata: {},
      }).success,
    ).toBe(true);
  });
});

describe('metadataRequestSchema', () => {
  it.each([
    ['a path', { path: 'a.md', metadata: { title: 'x' } }],
    ['a source', { source: 'cg://1', metadata: {} }],
  ])('accepts %s', (_label, body) => {
    expect(metadataRequestSchema.parse(body)).toEqual(body);
  });

  it.each([
    ['missing metadata', { path: 'a.md' }],
    ['array metadata', { path: 'a.md', metadata: [] }],
    ['no target', { metadata: {} }],
    ['both targets', { path: 'a.md', source: 'cg://1', metadata: {} }],
  ])('rejects %s', (_label, body) => {
    expect(metadataRequestSchema.safeParse(body).success).toBe(false);
  });

  it('validates a response', () => {
    expect(
      metadataResponseSchema.safeParse({ ok: true, matched_rules: ['r'] })
        .success,
    ).toBe(true);
    expect(
      metadataResponseSchema.safeParse({ ok: false, matched_rules: [] })
        .success,
    ).toBe(false);
  });
});
