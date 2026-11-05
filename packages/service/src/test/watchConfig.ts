/**
 * @module test/watchConfig
 * Test fixture: a minimal `JeevesWatcherConfig` with `watch` overrides.
 */

import type { JeevesWatcherConfig } from '../config/types';

/**
 * A minimal config for watch-config tests.
 *
 * @param overrides - `watch` keys to set.
 * @returns The config.
 */
export function makeWatchConfig(
  overrides: Partial<JeevesWatcherConfig['watch']> = {},
): JeevesWatcherConfig {
  return {
    watch: { paths: ['**/*.md'], respectGitignore: false, ...overrides },
    embedding: { provider: 'mock', model: 'test' },
    vectorStore: { url: 'http://localhost', collectionName: 'test' },
  } as unknown as JeevesWatcherConfig;
}
