/**
 * @module processor/resolvers/ruleOptions.test
 * Shared resolver helpers: every rule-context field reaches applyRules (extras override), enrichment merges over rule metadata (copy without enrichment), matched_rules is appended.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { EnrichmentStoreInterface } from '../../enrichment';
import {
  applyRuleOptions,
  metadataWithRules,
  withEnrichment,
} from './ruleOptions';
import type { RuleContext } from './types';

const logger = pino({ level: 'silent' });
const customMapLib = { up: (v: unknown) => String(v).toUpperCase() };
const ctx: RuleContext = {
  compiledRules: [],
  config: {
    maps: { m: {} },
    configDir: '/cfg',
    customMapLib,
    globalSchemas: { s: { type: 'object' } },
  },
  logger,
};

describe('applyRuleOptions', () => {
  it('maps every rule-context field to applyRules options', () => {
    expect(applyRuleOptions(ctx)).toEqual({
      namedMaps: { m: {} },
      logger,
      templateEngine: undefined,
      configDir: '/cfg',
      customMapLib,
      globalSchemas: { s: { type: 'object' } },
    });
  });

  it('adds extras and lets them override', () => {
    const extractText = () => 'x';
    const options = applyRuleOptions(ctx, { extractText, configDir: '/o' });
    expect(options.extractText).toBe(extractText);
    expect(options.configDir).toBe('/o');
  });
});

describe('withEnrichment', () => {
  const store = (data: Record<string, unknown> | null) =>
    ({ get: vi.fn(() => data) }) as unknown as EnrichmentStoreInterface;

  it('merges stored enrichment over rule metadata', () => {
    const merged = withEnrichment(store({ a: 2, tags: ['y'] }), 'k', {
      a: 1,
      b: 1,
      tags: ['x'],
    });
    expect(merged).toEqual({ a: 2, b: 1, tags: ['x', 'y'] });
  });

  it('returns a copy without enrichment', () => {
    const metadata = { a: 1 };
    const result = withEnrichment(store(null), 'k', metadata);
    expect(result).toEqual(metadata);
    expect(result).not.toBe(metadata);
    expect(withEnrichment(undefined, 'k', metadata)).not.toBe(metadata);
  });
});

describe('metadataWithRules', () => {
  it('appends matched_rules', () => {
    expect(metadataWithRules({ a: 1 }, ['r'])).toEqual({
      a: 1,
      matched_rules: ['r'],
    });
  });
});
