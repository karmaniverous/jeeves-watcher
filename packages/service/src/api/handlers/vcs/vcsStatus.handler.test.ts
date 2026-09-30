/**
 * @module api/handlers/vcs/vcsStatus.handler.test
 * Basic GET /vcs/status handler behavior: reports root info for an
 * enabled coordinator with one tracked commit, and enabled:false with no
 * roots when the coordinator has none. Edge cases (empty repo, remote
 * URL discovery, live breaker state) live in vcsStatus.test.ts.
 */

import { rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../../../config/types';
import {
  makeVcsApiCoordinator,
  makeVcsApiRoot,
  mockReply,
  silentLogger,
} from '../../../test/vcsHandlers';
import { VcsCoordinator } from '../../../vcs/VcsCoordinator';
import { createVcsStatusHandler } from './vcsStatus';

describe('GET /vcs/status', () => {
  let rootA: string;
  let coordinator: VcsCoordinator;

  beforeEach(async () => {
    rootA = await makeVcsApiRoot();
    coordinator = makeVcsApiCoordinator(rootA);
  });

  afterEach(async () => {
    await rm(rootA, { recursive: true, force: true });
  });

  it('returns status with root info', async () => {
    const handler = createVcsStatusHandler({
      coordinator,
      logger: silentLogger,
    });

    const request = { query: {} } as never;
    const reply = mockReply();
    await handler(request, reply as never);

    const body = reply.body as {
      enabled: boolean;
      roots: Array<{
        path: string;
        tracked: number;
        lastCommit: {
          hash: string;
          message: string;
          timestamp: string;
        } | null;
        remoteUrl: string | null;
        lastPush: string | null;
        pushErrors: Array<{ timestamp: string; message: string }>;
        breaker: {
          consecutiveFailures: number;
          tripped: boolean;
          trippedAt: string | null;
          lastError: string | null;
          pendingCount: number;
        } | null;
      }>;
    };
    expect(body.enabled).toBe(true);
    expect(body.roots).toHaveLength(1);
    expect(body.roots[0].path).toBe(rootA);
    expect(body.roots[0].tracked).toBeGreaterThan(0);
    expect(body.roots[0].lastCommit).toBeDefined();
    expect(body.roots[0].lastCommit!.message).toBe('initial commit');
    expect(body.roots[0].remoteUrl).toBeNull();
    expect(body.roots[0].lastPush).toBeNull();
    expect(body.roots[0].pushErrors).toEqual([]);
    // #249: per-root circuit breaker state is exposed.
    expect(body.roots[0].breaker).toEqual({
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
    const emptyCoordinator = new VcsCoordinator(emptyConfig, silentLogger);

    const handler = createVcsStatusHandler({
      coordinator: emptyCoordinator,
      logger: silentLogger,
    });

    const request = { query: {} } as never;
    const reply = mockReply();
    await handler(request, reply as never);

    const body = reply.body as { enabled: boolean; roots: unknown[] };
    expect(body.enabled).toBe(false);
    expect(body.roots).toHaveLength(0);
  });
});
