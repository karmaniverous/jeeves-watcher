/**
 * @module api/sourceDiscovery.test
 * discoverIssueSources: references take their stored rule when indexed, otherwise the latest rule recorded on their issue (first notification failed, no points); references with neither are counted but not targeted; file keys are ignored; a failed lookup is unresolved (reported, not thrown). discoverIndexedSources pages through chunk-0 source points (projection source/source_rule), dedupes and skips points without a rule. countBySourceName groups by name.
 */

import { describe, expect, it, vi } from 'vitest';

import type { IssueRecord } from '../issues/types';
import {
  countBySourceName,
  discoverIndexedSources,
  discoverIssueSources,
} from './sourceDiscovery';

const issue = (rule?: string): IssueRecord => ({
  type: 'source_unavailable',
  message: 'down',
  timestamp: 0,
  ...(rule ? { rule } : {}),
});

describe('discoverIssueSources', () => {
  it('uses the stored rule, else the recorded one', async () => {
    const stored: Record<string, string> = { 'app://indexed': 'stored-rule' };
    const ops = {
      storedRule: vi.fn((ref: string) => Promise.resolve(stored[ref] ?? null)),
    };

    const found = await discoverIssueSources(
      {
        'app://indexed': [issue('recorded-rule')],
        'app://never-indexed': [issue(), issue('first'), issue('latest')],
        'app://unknown': [issue()],
        '/docs/a.md': [issue('file-rule')],
      },
      ops,
      4,
    );

    expect(found.total).toBe(3);
    expect(found.targets).toEqual(
      expect.arrayContaining([
        { ref: 'app://indexed', rule: 'stored-rule' },
        { ref: 'app://never-indexed', rule: 'latest' },
      ]),
    );
    expect(found.targets).toHaveLength(2);
    expect(ops.storedRule).not.toHaveBeenCalledWith('/docs/a.md');
    expect(found.unresolved).toEqual([]);
  });

  it('reports a failed lookup as unresolved and resolves the rest', async () => {
    const boom = new Error('not available');
    const ops = {
      storedRule: vi.fn((ref: string) =>
        ref === 'app://broken' ? Promise.reject(boom) : Promise.resolve('r'),
      ),
    };
    const onLookupError = vi.fn();

    const found = await discoverIssueSources(
      {
        'app://broken': [issue('recorded-rule')],
        'app://fine': [issue()],
      },
      ops,
      2,
      onLookupError,
    );

    expect(found).toEqual({
      total: 2,
      targets: [{ ref: 'app://fine', rule: 'r' }],
      unresolved: ['app://broken'],
    });
    expect(onLookupError).toHaveBeenCalledExactlyOnceWith('app://broken', boom);
  });
});

describe('discoverIndexedSources', () => {
  it('pages through chunk-0 source points, deduped, rule required, file points skipped', async () => {
    const page = (payloads: Record<string, unknown>[], next?: number) => ({
      points: payloads.map((payload, i) => ({ id: String(i), payload })),
      nextCursor: next,
    });
    const scrollPage = vi
      .fn()
      .mockResolvedValueOnce(
        page(
          [
            { source: 'app://1', source_rule: 'r' },
            { source: 'app://2' },
            { source: '' },
            { source: 'legacy://4', source_rule: 'r', file_path: 'a.md' },
          ],
          7,
        ),
      )
      .mockResolvedValueOnce(
        page([
          { source: 'app://1', source_rule: 'r' },
          { source: 'other://3', source_rule: 's' },
        ]),
      );

    const found = await discoverIndexedSources({ scrollPage });

    expect(found).toEqual({
      total: 3,
      targets: [
        { ref: 'app://1', rule: 'r' },
        { ref: 'other://3', rule: 's' },
      ],
    });
    expect(scrollPage).toHaveBeenCalledTimes(2);
    const [filter, , firstCursor, fields] = scrollPage.mock.calls[0] as [
      unknown,
      number,
      unknown,
      string[],
    ];
    expect(filter).toEqual({
      must: [
        { key: 'chunk_index', match: { value: 0 } },
        { is_empty: { key: 'file_path' } },
      ],
      must_not: [{ is_empty: { key: 'source' } }],
    });
    expect(firstCursor).toBeUndefined();
    expect(fields).toEqual(['source', 'source_rule', 'file_path']);
    expect(scrollPage.mock.calls[1][2]).toBe(7);
  });
});

describe('countBySourceName', () => {
  it('counts targets per source name', () => {
    expect(
      countBySourceName([
        { ref: 'app://1', rule: 'r' },
        { ref: 'app://2', rule: 'r' },
        { ref: 'other://x/y', rule: 'r' },
      ]),
    ).toEqual({ app: 2, other: 1 });
  });
});
