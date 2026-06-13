/**
 * @module vcs/resolveWatchRoot.test
 * Tests for watch root resolution utility.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { resolveWatchRoot, resolveWatchRootsForGlob } from './resolveWatchRoot';
import { VcsCoordinator } from './VcsCoordinator';

const silentLogger = pino({ level: 'silent' });

describe('resolveWatchRoot', () => {
  let rootA: string;
  let rootB: string;

  beforeEach(async () => {
    rootA = normalizeSlashes(await mkdtemp(join(tmpdir(), 'vcs-resolve-a-')));
    rootB = normalizeSlashes(await mkdtemp(join(tmpdir(), 'vcs-resolve-b-')));
  });

  afterEach(async () => {
    await rm(rootA, { recursive: true, force: true });
    await rm(rootB, { recursive: true, force: true });
  });

  function makeCoordinator(roots: string[]): VcsCoordinator {
    const config = {
      vcs: { enabled: true, commitThrottleMs: 5000, maxBatchSize: 1000 },
      watch: { paths: roots, ignored: [] },
    } as unknown as JeevesWatcherConfig;
    return new VcsCoordinator(config, silentLogger);
  }

  it('resolves a path to its single watch root', () => {
    const coordinator = makeCoordinator([rootA, rootB]);
    const filePath = rootA + '/subdir/file.txt';
    const result = resolveWatchRoot(coordinator, filePath);

    expect(result).toBeDefined();
    expect(result!.root).toBe(normalizeSlashes(rootA));
    expect(result!.relativePath).toBe('subdir/file.txt');
  });

  it('returns undefined for paths outside any root', () => {
    const coordinator = makeCoordinator([rootA]);
    const result = resolveWatchRoot(coordinator, '/nonexistent/path/file.txt');
    expect(result).toBeUndefined();
  });

  it('resolves to the correct root when multiple roots exist', () => {
    const coordinator = makeCoordinator([rootA, rootB]);
    const filePath = rootB + '/doc.md';
    const result = resolveWatchRoot(coordinator, filePath);

    expect(result).toBeDefined();
    expect(result!.root).toBe(normalizeSlashes(rootB));
    expect(result!.relativePath).toBe('doc.md');
  });

  it('resolves root path itself', () => {
    const coordinator = makeCoordinator([rootA]);
    const result = resolveWatchRoot(coordinator, rootA);

    expect(result).toBeDefined();
    expect(result!.root).toBe(normalizeSlashes(rootA));
    expect(result!.relativePath).toBe('');
  });
});

describe('resolveWatchRootsForGlob', () => {
  let rootA: string;
  let rootB: string;

  beforeEach(async () => {
    rootA = normalizeSlashes(await mkdtemp(join(tmpdir(), 'vcs-glob-a-')));
    rootB = normalizeSlashes(await mkdtemp(join(tmpdir(), 'vcs-glob-b-')));
  });

  afterEach(async () => {
    await rm(rootA, { recursive: true, force: true });
    await rm(rootB, { recursive: true, force: true });
  });

  function makeCoordinator(roots: string[]): VcsCoordinator {
    const config = {
      vcs: { enabled: true, commitThrottleMs: 5000, maxBatchSize: 1000 },
      watch: { paths: roots, ignored: [] },
    } as unknown as JeevesWatcherConfig;
    return new VcsCoordinator(config, silentLogger);
  }

  it('resolves a glob under a single root', () => {
    const coordinator = makeCoordinator([rootA, rootB]);
    const glob = rootA + '/**/*.txt';
    const results = resolveWatchRootsForGlob(coordinator, glob);

    expect(results).toHaveLength(1);
    expect(results[0].root).toBe(normalizeSlashes(rootA));
    expect(results[0].relativePath).toBe('**/*.txt');
  });

  it('returns empty for globs outside any root', () => {
    const coordinator = makeCoordinator([rootA]);
    const results = resolveWatchRootsForGlob(
      coordinator,
      '/nonexistent/**/*.txt',
    );
    expect(results).toHaveLength(0);
  });
});
