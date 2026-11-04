/**
 * @module vcs/VcsManager.lifecycle.test
 * VcsManager lifecycle: startup maintenance runs under RootGitLock and a failing step never stops startup; batch commits queue behind other holders of the lock (D81).
 */

import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  commitCount,
  makeFastVcsConfig as makeConfig,
  makeTempRepo,
} from '../test/vcsRepo';
import * as untrackPending from './untrackPending';
import { VcsManager } from './VcsManager';

const silentLogger = pino({ level: 'silent' });

describe('VcsManager instance', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempRepo('vcs-instance-');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('continues startup when a maintenance step throws', async () => {
    const logger = pino({ level: 'silent' });
    const warnSpy = vi.spyOn(logger, 'warn');
    vi.spyOn(untrackPending, 'recoverUntrackPending').mockRejectedValueOnce(
      new Error('boom'),
    );

    const manager = new VcsManager(tempDir, makeConfig(), logger);
    await manager.start();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ root: tempDir }),
      'untrack.pending recovery failed',
    );
    manager.endBaseline();
    const filePath = join(tempDir, 'after-startup.txt');
    await writeFile(filePath, 'content', 'utf8');
    manager.fileChanged(filePath);
    await manager.flush();
    await manager.stop();

    expect(await commitCount(tempDir)).toBe(1);
  });

  it('queues a batch commit behind another holder of the lock (D81)', async () => {
    const manager = new VcsManager(tempDir, makeConfig(), silentLogger);
    await manager.start();
    manager.endBaseline();
    let releaseHolder!: () => void;
    const holder = manager.lock.run(
      'squash',
      () =>
        new Promise<void>((resolve) => {
          releaseHolder = resolve;
        }),
    );

    const filePath = join(tempDir, 'queued.txt');
    await writeFile(filePath, 'content', 'utf8');
    manager.fileChanged(filePath);
    const flushed = manager.flush();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await commitCount(tempDir)).toBe(0);
    expect(manager.breakerState.pendingCount).toBe(1);

    releaseHolder();
    await holder;
    await flushed;
    await manager.stop();
    expect(await commitCount(tempDir)).toBe(1);
  });
});
