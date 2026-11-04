/**
 * @module vcs/maxFileBytes.test
 * `vcs.maxFileBytes` resolution (D67, D80): per-root override, root-level value, default, byte-size strings, and a live-config getter that picks up a reload without a restart; plus `health.vcs` aggregation.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { VCS_DEFAULTS } from '@karmaniverous/jeeves-watcher-core';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { git, makeTempRepo } from '../test/vcsRepo';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { resolveMaxFileBytes } from './maxFileBytes';
import { VcsCoordinator } from './VcsCoordinator';

const logger = pino({ level: 'silent' });

/** A minimal config with one VCS root. */
function configFor(
  root: string,
  vcs: Record<string, unknown> = {},
  entryVcs?: Record<string, unknown>,
): JeevesWatcherConfig {
  const glob = `${normalizeSlashes(root)}/**/*`;
  return {
    watch: {
      paths: [entryVcs ? { path: glob, vcs: entryVcs } : glob],
      ignored: [],
    },
    vcs: { enabled: true, ...vcs },
  } as unknown as JeevesWatcherConfig;
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('resolveMaxFileBytes', () => {
  it('defaults to 100 MB', async () => {
    const root = await mkdtemp(join(tmpdir(), 'max-bytes-'));
    dirs.push(root);

    expect(resolveMaxFileBytes(configFor(root), root)).toBe(
      VCS_DEFAULTS.maxFileBytes,
    );
    expect(VCS_DEFAULTS.maxFileBytes).toBe(100_000_000);
  });

  it('reads the root-level value and lets a per-root value win', async () => {
    const root = await mkdtemp(join(tmpdir(), 'max-bytes-'));
    dirs.push(root);

    expect(
      resolveMaxFileBytes(configFor(root, { maxFileBytes: '1k' }), root),
    ).toBe(1024);
    expect(
      resolveMaxFileBytes(
        configFor(root, { maxFileBytes: '1k' }, { maxFileBytes: 0 }),
        root,
      ),
    ).toBe(0);
  });
});

describe('VcsCoordinator live settings and health', () => {
  it('applies a reloaded maxFileBytes at the next staging, without a restart', async () => {
    const root = await makeTempRepo('max-bytes-live-');
    dirs.push(root);
    let config = configFor(root, {
      maxFileBytes: 0,
      commitThrottleMs: 60_000,
      maxBatchSize: 1000,
      staleLockThresholdMs: 60_000,
      maxConsecutiveFailures: 5,
      circuitBreakerCooldownMs: 300_000,
      branch: 'master',
      commitMessage: { enabled: false },
    });
    const coordinator = new VcsCoordinator(config, logger, () => config);
    await coordinator.start();
    await coordinator.onInitialScanComplete();

    const file = join(root, 'big.bin');
    await writeFile(file, 'x'.repeat(2048));
    config = configFor(root, { ...config.vcs, maxFileBytes: '1k' });
    coordinator.onFileChange(file, 'add');
    await coordinator.stop();

    expect(await git(root, 'ls-files')).toBe('');
    expect(coordinator.getHealth()).toEqual({
      roots: 1,
      pending: 0,
      trippedRoots: 0,
      oldestTrippedAt: null,
    });
  });
});
