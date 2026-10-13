/**
 * @module api/publicConfig.test
 * publicConfig keeps only allow-listed keys that are present and drops everything else (secrets included).
 */

import { describe, expect, it } from 'vitest';

import { publicConfig } from './publicConfig';

describe('publicConfig', () => {
  it('keeps present allow-listed keys and drops the rest', () => {
    expect(
      publicConfig({
        watch: { paths: ['a'] },
        inferenceRules: [],
        api: { apiKey: 'k' },
        sources: { app: {} },
        embedding: { apiKey: 'e' },
      }),
    ).toEqual({ watch: { paths: ['a'] }, inferenceRules: [] });
  });
});
