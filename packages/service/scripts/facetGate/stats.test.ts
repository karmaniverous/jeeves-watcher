/**
 * @module scripts/facetGate/stats.test
 * Pure helpers of the facet latency gate: nearest-rank summaries, P2's field selection, the three D104/D155 workloads, and option parsing.
 */

import { describe, expect, it } from 'vitest';

import {
  gateWorkloads,
  parseGateArgs,
  pickFacetFields,
  summarize,
} from './stats';

describe('summarize', () => {
  it('takes nearest-rank p50 and p95 and the max', () => {
    const samples = Array.from({ length: 60 }, (_, i) => 60 - i);
    expect(summarize(samples)).toEqual({ p50: 30, p95: 57, max: 60 });
  });

  it('rounds to 0.1 ms and handles one sample', () => {
    expect(summarize([12.345])).toEqual({ p50: 12.3, p95: 12.3, max: 12.3 });
  });

  it('refuses no samples', () => {
    expect(() => summarize([])).toThrow('no samples');
  });
});

describe('pickFacetFields', () => {
  it('takes the most common keys, skipping positions and hashes, with matched_rules always in', () => {
    const counts = new Map([
      ['chunk_index', 100],
      ['title', 90],
      ['silo', 80],
      ['content_hash', 70],
      ['author', 60],
    ]);
    expect(pickFacetFields(counts, 3)).toEqual([
      'matched_rules',
      'title',
      'silo',
    ]);
    expect(
      pickFacetFields(new Map([...counts, ['matched_rules', 50]]), 4),
    ).toEqual(['title', 'silo', 'author', 'matched_rules']);
  });
});

describe('gateWorkloads', () => {
  it('builds W1 (200 ms), W2 (500 ms) and W3 (200 ms) with 4 non-tenant fields', () => {
    const fields = ['title', 'silo', 'a', 'b', 'c', 'd'];
    const filter = { must: [{ key: 'silo', match: { value: 't' } }] };
    expect(gateWorkloads(fields, 'silo', 't', ['r1', 'r2'])).toEqual([
      {
        name: 'W1 4 fields, tenant filter',
        body: { filter, fields: ['title', 'a', 'b', 'c'] },
        p95Max: 200,
      },
      { name: 'W2 20 fields, unfiltered', body: { fields }, p95Max: 500 },
      {
        name: 'W3 4 fields, tenant filter + 2 rules',
        body: { filter, rules: ['r1', 'r2'], fields: ['title', 'a', 'b', 'c'] },
        p95Max: 200,
      },
    ]);
  });
});

describe('parseGateArgs', () => {
  it('applies defaults', () => {
    expect(parseGateArgs(['--source-collection', 'live'])).toEqual({
      sourceUrl: 'http://127.0.0.1:6333',
      sourceCollection: 'live',
      floor: 864_000,
      tenantField: 'silo',
      warmup: 5,
      runs: 60,
      out: undefined,
    });
  });

  it('reads every option', () => {
    expect(
      parseGateArgs([
        '--source-collection',
        'c',
        '--source-url',
        'http://q:6333',
        '--floor',
        '10',
        '--tenant-field',
        'org',
        '--warmup',
        '1',
        '--runs',
        '2',
        '--out',
        'r.json',
      ]),
    ).toEqual({
      sourceUrl: 'http://q:6333',
      sourceCollection: 'c',
      floor: 10,
      tenantField: 'org',
      warmup: 1,
      runs: 2,
      out: 'r.json',
    });
  });

  it.each([
    [[], '--source-collection is required'],
    [['--source-collection'], 'Expected --key value pairs'],
    [['source-collection', 'c'], 'Expected --key value pairs'],
    [
      ['--source-collection', 'c', '--runs', '0'],
      '--runs must be a positive integer',
    ],
    [
      ['--source-collection', 'c', '--floor', 'x'],
      '--floor must be a positive integer',
    ],
  ])('rejects %j', (argv, message) => {
    expect(() => parseGateArgs(argv)).toThrow(message);
  });
});
