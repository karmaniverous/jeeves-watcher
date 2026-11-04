/**
 * @module api/catalog/vcsStatusHandler.test
 * GET /vcs/status over the catalog route (strict response validation):
 * root info for an enabled coordinator with one tracked commit, and
 * enabled:false with no roots when the coordinator has none. Edge cases
 * (empty repo, remote URL discovery, live breaker state) live in
 * vcsStatusHandler.unit.test.ts.
 */

import { rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import {
  makeVcsApiCoordinator,
  makeVcsApiRoot,
  serveVcsCatalog,
  silentLogger,
} from '../../test/vcsHandlers';
import { VcsCoordinator } from '../../vcs/VcsCoordinator';

interface StatusBody {
  enabled: boolean;
  roots: Array<{
    path: string;
    tracked: number;
    lastCommit: { hash: string; message: string; timestamp: string } | null;
    remoteUrl: string | null;
    lastPush: string | null;
    pushErrors: unknown[];
    breaker: unknown;
  }>;
}

async function getStatus(coordinator: VcsCoordinator) {
  const app = await serveVcsCatalog(coordinator);
  try {
    return await app.inject({ method: 'GET', url: '/vcs/status' });
  } finally {
    await app.close();
  }
}

describe('GET /vcs/status', () => {
  let rootA: string;

  beforeEach(async () => {
    rootA = await makeVcsApiRoot();
  });

  afterEach(async () => {
    await rm(rootA, { recursive: true, force: true });
  });

  it('returns status with root info', async () => {
    const res = await getStatus(makeVcsApiCoordinator(rootA));

    expect(res.statusCode).toBe(200);
    const body = res.json<StatusBody>();
    expect(body.enabled).toBe(true);
    expect(body.roots).toHaveLength(1);
    const [root] = body.roots;
    expect(root.path).toBe(rootA);
    expect(root.tracked).toBe(1);
    expect(root.lastCommit?.message).toBe('initial commit');
    expect(root.remoteUrl).toBeNull();
    expect(root.lastPush).toBeNull();
    expect(root.pushErrors).toEqual([]);
    // #249: per-root circuit breaker state is exposed.
    expect(root.breaker).toEqual({
      consecutiveFailures: 0,
      tripped: false,
      trippedAt: null,
      lastError: null,
      pendingCount: 0,
    });
  });

  it('returns enabled:false when no VCS roots exist', async () => {
    const emptyConfig = {
      vcs: { enabled: false, commitThrottleMs: 5000, maxBatchSize: 1000 },
      watch: { paths: [], ignored: [] },
    } as unknown as JeevesWatcherConfig;

    const res = await getStatus(new VcsCoordinator(emptyConfig, silentLogger));

    expect(res.json()).toEqual({ enabled: false, roots: [] });
  });
});
