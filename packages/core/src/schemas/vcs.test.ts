/**
 * @module schemas/vcs.test
 * Tests for VCS config schema validation and watch path normalization.
 */

import { describe, expect, it } from 'vitest';

import {
  extractWatchPathStrings,
  normalizeWatchPaths,
  vcsConfigSchema,
  watchPathEntrySchema,
} from './vcs';

describe('vcsConfigSchema', () => {
  it('applies defaults for all fields', () => {
    const result = vcsConfigSchema.parse({});
    expect(result.enabled).toBe(false);
    expect(result.commitDebounceMs).toBe(30000);
    expect(result.maxBatchSize).toBe(1000);
  });

  it('applies commitMessage defaults', () => {
    const result = vcsConfigSchema.parse({ commitMessage: {} });
    expect(result.commitMessage!.enabled).toBe(true);
    expect(result.commitMessage!.provider).toBe('anthropic');
    expect(result.commitMessage!.model).toBe('claude-haiku-4-0');
    expect(result.commitMessage!.apiKey).toBeUndefined();
  });

  it('applies retention defaults', () => {
    const result = vcsConfigSchema.parse({ retention: {} });
    expect(result.retention!.maxAgeDays).toBe(30);
    expect(result.retention!.maxVersions).toBe(100);
    expect(result.retention!.squashCron).toBe('0 0 * * *');
  });

  it('accepts full custom config', () => {
    const result = vcsConfigSchema.safeParse({
      enabled: true,
      commitDebounceMs: 5000,
      maxBatchSize: 500,
      commitMessage: {
        enabled: false,
        provider: 'openai',
        model: 'gpt-4',
        apiKey: '${MY_API_KEY}',
      },
      retention: {
        maxAgeDays: 7,
        maxVersions: 50,
        squashCron: '0 6 * * 0',
      },
      defaultAccessToken: '${GIT_TOKEN}',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid commitDebounceMs', () => {
    const result = vcsConfigSchema.safeParse({ commitDebounceMs: 500 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid maxBatchSize', () => {
    const result = vcsConfigSchema.safeParse({ maxBatchSize: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid retention maxAgeDays', () => {
    const result = vcsConfigSchema.safeParse({
      retention: { maxAgeDays: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('all fields are optional at top level', () => {
    const result = vcsConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe('watchPathEntrySchema', () => {
  it('accepts a plain string', () => {
    const result = watchPathEntrySchema.safeParse('**/*.md');
    expect(result.success).toBe(true);
    expect(result.data).toBe('**/*.md');
  });

  it('accepts an object with path only', () => {
    const result = watchPathEntrySchema.safeParse({ path: '/docs' });
    expect(result.success).toBe(true);
  });

  it('accepts an object with path and vcs overrides', () => {
    const result = watchPathEntrySchema.safeParse({
      path: '/docs',
      vcs: {
        enabled: true,
        remote: 'https://github.com/org/repo.git',
        accessToken: '${GIT_TOKEN}',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects object without path', () => {
    const result = watchPathEntrySchema.safeParse({ vcs: { enabled: true } });
    expect(result.success).toBe(false);
  });
});

describe('normalizeWatchPaths', () => {
  it('normalizes string-only array', () => {
    const result = normalizeWatchPaths(['**/*.md', '**/*.txt']);
    expect(result).toEqual([{ path: '**/*.md' }, { path: '**/*.txt' }]);
  });

  it('normalizes object-only array', () => {
    const result = normalizeWatchPaths([
      { path: '/docs', vcs: { enabled: true } },
    ]);
    expect(result).toEqual([{ path: '/docs', vcs: { enabled: true } }]);
  });

  it('normalizes mixed array', () => {
    const result = normalizeWatchPaths([
      '**/*.md',
      { path: '/docs', vcs: { remote: 'https://example.com/repo.git' } },
    ]);
    expect(result).toEqual([
      { path: '**/*.md' },
      { path: '/docs', vcs: { remote: 'https://example.com/repo.git' } },
    ]);
  });
});

describe('extractWatchPathStrings', () => {
  it('extracts strings from string-only array', () => {
    expect(extractWatchPathStrings(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('extracts strings from mixed array', () => {
    expect(
      extractWatchPathStrings([
        'a',
        { path: 'b', vcs: { enabled: true } },
        'c',
      ]),
    ).toEqual(['a', 'b', 'c']);
  });

  it('extracts strings from object-only array', () => {
    expect(extractWatchPathStrings([{ path: 'x' }, { path: 'y' }])).toEqual([
      'x',
      'y',
    ]);
  });
});
