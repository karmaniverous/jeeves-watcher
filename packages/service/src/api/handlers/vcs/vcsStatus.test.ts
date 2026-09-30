/**
 * @module api/handlers/vcs/vcsStatus.test
 * GET /vcs/status edge cases against real repos: empty history, remote URL
 * read from git, and live circuit breaker state after a failed commit.
 */

import { rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../../../config/types';
import {
  breakCommits,
  commitAll,
  git,
  makeTempRepo,
} from '../../../test/vcsRepo';
import { normalizeSlashes } from '../../../util/normalizeSlashes';
import { VcsCoordinator } from '../../../vcs/VcsCoordinator';
import type { VcsBreakerState } from '../../../vcs/VcsManager';
import { createVcsStatusHandler } from './vcsStatus';

const silentLogger = pino({ level: 'silent' });

interface StatusBody {
  enabled: boolean;
  roots: {
    path: string;
    tracked: number;
    lastCommit: { hash: string; message: string; timestamp: string } | null;
    remoteUrl: string | null;
    breaker: VcsBreakerState | null;
  }[];
}

async function getStatus(coordinator: VcsCoordinator): Promise<StatusBody> {
  const handler = createVcsStatusHandler({ coordinator, logger: silentLogger });
  let body: unknown;
  const reply = {
    status: () => reply,
    send: (data: unknown) => {
      body = data;
      return reply;
    },
  };
  await handler({ query: {} } as never, reply as never);
  return body as StatusBody;
}

function coordinatorFor(root: string): VcsCoordinator {
  const config = {
    vcs: {
      enabled: true,
      commitThrottleMs: 60000,
      maxBatchSize: 1000,
      maxConsecutiveFailures: 5,
      circuitBreakerCooldownMs: 300000,
      staleLockThresholdMs: 600000,
    },
    watch: { paths: [root], ignored: [] },
  } as unknown as JeevesWatcherConfig;
  return new VcsCoordinator(config, silentLogger);
}

describe('GET /vcs/status', () => {
  let root: string;

  beforeEach(async () => {
    root = normalizeSlashes(resolve(await makeTempRepo('vcs-status-')));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reports zero commits and no last commit for an empty repo', async () => {
    const [status] = (await getStatus(coordinatorFor(root))).roots;

    expect(status.tracked).toBe(0);
    expect(status.lastCommit).toBeNull();
    expect(status.remoteUrl).toBeNull();
  });

  it('reads the origin URL from git when the manager has none configured', async () => {
    await git(root, 'remote', 'add', 'origin', 'https://example.com/r.git');

    const [status] = (await getStatus(coordinatorFor(root))).roots;

    expect(status.remoteUrl).toBe('https://example.com/r.git');
  });

  it('reports the commit count and the latest commit, even with | in its subject', async () => {
    await writeFile(join(root, 'a.txt'), 'x', 'utf8');
    await commitAll(root, 'first');
    await writeFile(join(root, 'b.txt'), 'x', 'utf8');
    await commitAll(root, 'watcher: batch | 2 files | docs');

    const [status] = (await getStatus(coordinatorFor(root))).roots;

    expect(status.tracked).toBe(2);
    expect(status.lastCommit?.message).toBe('watcher: batch | 2 files | docs');
    expect(status.lastCommit?.hash).toBe(
      (await git(root, 'rev-parse', 'HEAD')).trim(),
    );
    expect(Date.parse(status.lastCommit?.timestamp ?? '')).not.toBeNaN();
  });

  it('exposes live breaker state after a failed commit', async () => {
    await breakCommits(root);
    const coordinator = coordinatorFor(root);
    await coordinator.start();
    await coordinator.onInitialScanComplete();
    const file = join(root, 'x.txt');
    await writeFile(file, 'x', 'utf8');
    coordinator.onFileChange(file, 'add');
    await coordinator.getManager(root)?.flush();

    const [status] = (await getStatus(coordinator)).roots;
    await coordinator.stop();

    expect(status.breaker).toMatchObject({
      consecutiveFailures: 1,
      tripped: false,
      pendingCount: 1,
    });
    expect(status.breaker?.lastError).toMatch(/gpg|sign/i);
  });
});
