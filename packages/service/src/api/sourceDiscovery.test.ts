/**
 * @module api/sourceDiscovery.test
 * discoverIssueSources: references take their stored rule when indexed, otherwise the latest rule recorded on their issue (first notification failed, no points); references with neither are counted but not targeted; file keys are ignored.
 */

import { describe, expect, it, vi } from 'vitest';

import type { IssueRecord } from '../issues/types';
import { discoverIssueSources } from './sourceDiscovery';

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
  });
});
