/**
 * @module api/reindex.test
 * Tests for the POST /reindex request/response schemas.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_REINDEX_SOURCES_PER_REQUEST,
  reindexRequestSchema,
  reindexResponseSchema,
} from './reindex';

const refs = (n: number) =>
  Array.from({ length: n }, (_, i) => `app://${String(i)}`);

describe('reindexRequestSchema', () => {
  it.each([
    ['an empty body (defaults to issues)', {}],
    ['a full dry run', { scope: 'full', dryRun: true }],
    ['prune', { scope: 'prune' }],
    ['rules narrowed by path', { scope: 'rules', path: ['a/**'] }],
    ['path with one path', { scope: 'path', path: 'a.md' }],
    ['path with many paths', { scope: 'path', path: ['a.md', 'b.md'] }],
    ['path with a source', { scope: 'path', source: 'app://1' }],
    ['path with sources', { scope: 'path', source: ['app://1', 'app://2'] }],
    ['an ignored path on issues', { scope: 'issues', path: 'a.md' }],
  ])('accepts %s', (_label, body) => {
    expect(reindexRequestSchema.parse(body)).toEqual(body);
  });

  it.each([
    ['an unknown scope', { scope: 'everything' }],
    ['path scope without target', { scope: 'path' }],
    ['path scope with empty array', { scope: 'path', path: [] }],
    ['path scope with both', { scope: 'path', path: 'a', source: 'app://1' }],
    ['source outside path scope', { scope: 'full', source: 'app://1' }],
    ['a malformed source', { scope: 'path', source: 'not-a-ref' }],
    ['non-boolean dryRun', { dryRun: 'yes' }],
  ])('rejects %s', (_label, body) => {
    expect(reindexRequestSchema.safeParse(body).success).toBe(false);
  });

  it('caps the source list', () => {
    const max = MAX_REINDEX_SOURCES_PER_REQUEST;
    const ok = { scope: 'path', source: refs(max) };
    expect(reindexRequestSchema.safeParse(ok).success).toBe(true);
    const tooMany = reindexRequestSchema.safeParse({
      scope: 'path',
      source: refs(max + 1),
    });
    expect(tooMany.success).toBe(false);
  });

  it('lists valid scopes in the scope error', () => {
    const result = reindexRequestSchema.safeParse({ scope: 'x' });
    expect(result.error?.issues[0]?.message).toBe(
      'Scope must be one of: issues, full, rules, path, prune',
    );
  });
});

describe('reindexResponseSchema', () => {
  it('accepts started and dry-run bodies', () => {
    const plan = { total: 2, toProcess: 2, toDelete: 0, byRoot: { a: 2 } };
    expect(
      reindexResponseSchema.safeParse({ status: 'started', scope: 'prune' })
        .success,
    ).toBe(true);
    expect(
      reindexResponseSchema.safeParse({
        status: 'dry_run',
        scope: 'full',
        plan,
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(
      reindexResponseSchema.safeParse({ status: 'done', scope: 'full' })
        .success,
    ).toBe(false);
  });
});
