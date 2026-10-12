/**
 * @module api/monitoring.test
 * Tests for the GET /status and GET /issues response schemas.
 */

import { describe, expect, it } from 'vitest';

import {
  ISSUE_TYPES,
  issueRecordSchema,
  issuesResponseSchema,
  issueTypeSchema,
  statusResponseSchema,
} from './monitoring';

describe('statusResponseSchema', () => {
  it('accepts a status body', () => {
    expect(
      statusResponseSchema.safeParse({
        name: 'watcher',
        version: '0.20.0',
        uptime: 12,
        status: 'healthy',
        health: { reindex: { active: false } },
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(
      statusResponseSchema.safeParse({
        name: 'watcher',
        version: '1',
        uptime: 1,
        status: 'fine',
        health: {},
      }).success,
    ).toBe(false);
  });
});

describe('issuesResponseSchema', () => {
  const issue = {
    type: 'interpolation_error',
    rule: 'r',
    message: 'bad template',
    timestamp: 1,
  };

  it('accepts issues keyed by document', () => {
    expect(
      issuesResponseSchema.safeParse({ count: 1, issues: { 'a.md': [issue] } })
        .success,
    ).toBe(true);
  });

  it('rejects an unknown issue type', () => {
    expect(
      issueRecordSchema.safeParse({ ...issue, type: 'nope' }).success,
    ).toBe(false);
  });

  it('rejects a negative count', () => {
    expect(
      issuesResponseSchema.safeParse({ count: -1, issues: {} }).success,
    ).toBe(false);
  });
});

describe('issueTypeSchema', () => {
  it('accepts exactly the canonical codes (Decision 16.4)', () => {
    expect(issueTypeSchema.options).toEqual([
      'type_collision',
      'interpolation_error',
      'extraction_error',
      'embedding_error',
      'upsert_error',
      'match_failed',
      'rule_missing',
      'no_content',
      'source_unavailable',
      'unsupported_content_type',
    ]);
    expect(issueTypeSchema.options).toEqual([...ISSUE_TYPES]);
  });

  it.each(ISSUE_TYPES)('accepts an issue record of type %s', (type) => {
    expect(
      issueRecordSchema.safeParse({
        type,
        operation: 'Failed to process file',
        message: 'boom',
        timestamp: '2026-10-12T00:00:00Z',
      }).success,
    ).toBe(true);
  });

  it('parses a legacy (pre-0.20.0) issues.json unchanged', () => {
    const legacy = {
      'docs/a.md': [
        {
          type: 'type_collision',
          property: 'status',
          rules: ['r1', 'r2'],
          types: ['string', 'number'],
          message: 'conflicting types',
          timestamp: 1760000000,
        },
        {
          type: 'interpolation_error',
          property: 'title',
          rule: 'r3',
          message: 'missing variable',
          timestamp: 1760000001,
        },
      ],
    };
    const parsed = issuesResponseSchema.parse({ count: 1, issues: legacy });
    expect(parsed.issues).toEqual(legacy);
  });

  it('rejects a record without a message', () => {
    expect(
      issueRecordSchema.safeParse({ type: 'upsert_error', timestamp: 1 })
        .success,
    ).toBe(false);
  });
});
