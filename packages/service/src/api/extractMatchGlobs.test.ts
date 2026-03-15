import { describe, expect, it } from 'vitest';

import { extractMatchGlobs } from './onRulesChanged';

describe('extractMatchGlobs', () => {
  it('returns globs from rules with match.properties.file.properties.path.glob', () => {
    const rules = [
      {
        match: {
          properties: {
            file: {
              properties: {
                path: { glob: '**/.meta/**' },
              },
            },
          },
        },
      },
    ];
    expect(extractMatchGlobs(rules)).toEqual(['**/.meta/**']);
  });

  it('returns empty array for rules without match globs', () => {
    const rules = [{ match: { properties: {} } }, { match: undefined }, {}];
    expect(extractMatchGlobs(rules)).toEqual([]);
  });

  it('handles mix of rules with and without globs', () => {
    const rules = [
      {
        match: {
          properties: {
            file: {
              properties: {
                path: { glob: '**/.meta/**' },
              },
            },
          },
        },
      },
      { match: { properties: {} } },
      {
        match: {
          properties: {
            file: {
              properties: {
                path: { glob: '**/docs/**' },
              },
            },
          },
        },
      },
      {},
    ];
    expect(extractMatchGlobs(rules)).toEqual(['**/.meta/**', '**/docs/**']);
  });

  it('handles empty array input', () => {
    expect(extractMatchGlobs([])).toEqual([]);
  });
});
