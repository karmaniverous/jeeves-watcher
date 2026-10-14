/**
 * @module config/sourceKeyWarnings.test
 * Unit tests for unknown `sources.<name>` key detection on raw configs.
 */

import { describe, expect, it } from 'vitest';

import { findUnknownSourceKeys } from './sourceKeyWarnings';

describe('findUnknownSourceKeys', () => {
  it('warns once per unknown key, with its config path', () => {
    const warnings = findUnknownSourceKeys({
      sources: {
        app: {
          url: 'http://x/{id}',
          batchUrl: 'http://x/batch',
          timeoutMs: 5,
        },
        other: { url: 'http://y/{id}', retries: 3 },
      },
    });
    expect(warnings).toEqual([
      {
        path: 'sources.app.batchUrl',
        message: expect.stringContaining('"batchUrl" is ignored') as unknown,
      },
      {
        path: 'sources.other.retries',
        message: expect.stringContaining('"retries"') as unknown,
      },
    ]);
  });

  it('accepts every supported key', () => {
    expect(
      findUnknownSourceKeys({
        sources: {
          app: {
            url: 'http://x/{id}',
            headers: { A: 'b' },
            timeoutMs: 1,
            concurrency: 1,
          },
        },
      }),
    ).toEqual([]);
  });

  it.each([
    ['no config', undefined],
    ['no sources', {}],
    ['a non-object sources', { sources: [] }],
    ['a non-object source entry', { sources: { app: 'x' } }],
  ])('returns nothing for %s', (_label, raw) => {
    expect(findUnknownSourceKeys(raw)).toEqual([]);
  });
});
