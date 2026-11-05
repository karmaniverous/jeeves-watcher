/**
 * @module app/watcherFactory.test
 * `watchConfigChanged`: which watch keys rebuild the watcher on a config reload (D100), compared by effective value; `reconcileIntervalMs` never does (D111).
 */

import { describe, expect, it } from 'vitest';

import { makeWatchConfig } from '../test/watchConfig';
import { watchConfigChanged } from './watcherFactory';

describe('watchConfigChanged', () => {
  it('returns false when watch config is identical', () => {
    const cfg = makeWatchConfig();
    expect(watchConfigChanged(cfg, cfg)).toBe(false);
  });

  it('returns true when paths change', () => {
    const old = makeWatchConfig({ paths: ['**/*.md'] });
    const next = makeWatchConfig({ paths: ['**/*.ts'] });
    expect(watchConfigChanged(old, next)).toBe(true);
  });

  it('returns true when ignored changes', () => {
    const old = makeWatchConfig({ ignored: ['node_modules'] });
    const next = makeWatchConfig({ ignored: ['dist'] });
    expect(watchConfigChanged(old, next)).toBe(true);
  });

  it('returns true when respectGitignore changes', () => {
    const old = makeWatchConfig({ respectGitignore: true });
    const next = makeWatchConfig({ respectGitignore: false });
    expect(watchConfigChanged(old, next)).toBe(true);
  });

  it('returns true when moveDetection changes', () => {
    const old = makeWatchConfig({
      moveDetection: { enabled: false },
    } as never);
    const next = makeWatchConfig({
      moveDetection: { enabled: true },
    } as never);
    expect(watchConfigChanged(old, next)).toBe(true);
  });

  it.each([
    ['usePolling', true],
    ['pollIntervalMs', 250],
    ['stabilityThresholdMs', 0],
  ] as const)('returns true when %s changes (D100)', (key, value) => {
    const old = makeWatchConfig();
    const next = makeWatchConfig({ [key]: value });
    expect(watchConfigChanged(old, next)).toBe(true);
  });

  it('compares effective values: a default spelled out is no change', () => {
    const old = makeWatchConfig();
    const next = makeWatchConfig({
      usePolling: false,
      pollIntervalMs: 1000,
      stabilityThresholdMs: 500,
    });
    expect(watchConfigChanged(old, next)).toBe(false);
  });

  it('ignores reconcileIntervalMs (applied without a rebuild, D111)', () => {
    const old = makeWatchConfig();
    const next = makeWatchConfig({ reconcileIntervalMs: 60_000 });
    expect(watchConfigChanged(old, next)).toBe(false);
  });
});
