/**
 * @module test/facetsDeps
 * Test helpers for the `GET /search/facets` lister and handler: a minimal config with inline-schema rules, a stub values manager, and lister dependencies. No I/O.
 */

import { vi } from 'vitest';

import type { FacetsDeps } from '../api/catalog/facetsHandler';
import type { JeevesWatcherConfig } from '../config/types';
import type { ValuesManager } from '../values';

/**
 * Create a minimal config with inference rules that have inline schemas.
 * Uses inline schema objects to avoid file I/O in tests.
 */
export function makeConfig(
  rules: JeevesWatcherConfig['inferenceRules'] = [],
): JeevesWatcherConfig {
  return {
    inferenceRules: rules,
    schemas: {},
    watch: { paths: [], ignored: [] },
    vectorStore: {
      collectionName: 'test',
      url: 'http://localhost:6333',
      dimensions: 768,
    },
    embedding: { provider: 'openai', model: 'text-embedding-3-small' },
    stateDir: '/tmp/state',
  } as unknown as JeevesWatcherConfig;
}

/** A values manager whose `getAll` returns `data`. */
export function makeValuesManager(
  data: Record<string, Record<string, unknown[]>> = {},
): ValuesManager {
  return { getAll: vi.fn().mockReturnValue(data) } as unknown as ValuesManager;
}

/** Facets lister dependencies with an empty config, overridable. */
export function makeDeps(overrides: Partial<FacetsDeps> = {}): FacetsDeps {
  return {
    getConfig: () => makeConfig(),
    valuesManager: makeValuesManager(),
    configDir: '/tmp',
    ...overrides,
  };
}
