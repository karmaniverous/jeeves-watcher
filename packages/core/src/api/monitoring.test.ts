/**
 * @module api/monitoring.test
 * Tests for the GET /status and GET /issues response schemas.
 */

import { describe, expect, it } from 'vitest';

import {
  issueRecordSchema,
  issuesResponseSchema,
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
