/**
 * @module api/handlers/vcs/vcsHistory.handler.test
 * GET /vcs/history handler behavior: returns commit history for a glob,
 * respects the limit parameter, validates required parameters, 404s for
 * a glob outside any root, and filters by date range.
 */

import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { execFileAsync } from '../../../test/git';
import {
  makeVcsApiCoordinator,
  makeVcsApiRoot,
  mockReply,
  silentLogger,
} from '../../../test/vcsHandlers';
import type { VcsCoordinator } from '../../../vcs/VcsCoordinator';
import { createVcsHistoryHandler } from './vcsHistory';

describe('GET /vcs/history', () => {
  let rootA: string;
  let coordinator: VcsCoordinator;

  beforeEach(async () => {
    rootA = await makeVcsApiRoot();
    coordinator = makeVcsApiCoordinator(rootA);
  });

  afterEach(async () => {
    await rm(rootA, { recursive: true, force: true });
  });

  it('returns commit history for a glob', async () => {
    // Add a second commit
    await writeFile(join(rootA, 'hello.txt'), 'updated', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: rootA });
    await execFileAsync('git', ['commit', '-m', 'update hello'], {
      cwd: rootA,
    });

    const handler = createVcsHistoryHandler({
      coordinator,
      logger: silentLogger,
    });

    const request = {
      query: { glob: rootA + '/hello.txt' },
    } as never;
    const reply = mockReply();
    await handler(request, reply as never);

    const body = reply.body as Array<{
      commit: string;
      message: string;
      timestamp: string;
      files: string[];
    }>;
    expect(body).toHaveLength(2);
    expect(body[0].message).toBe('update hello');
    expect(body[1].message).toBe('initial commit');
  });

  it('respects limit parameter', async () => {
    // Add more commits
    for (let i = 0; i < 3; i++) {
      await writeFile(join(rootA, 'hello.txt'), `v${String(i)}`, 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: rootA });
      await execFileAsync('git', ['commit', '-m', `commit ${String(i)}`], {
        cwd: rootA,
      });
    }

    const handler = createVcsHistoryHandler({
      coordinator,
      logger: silentLogger,
    });

    const request = {
      query: { glob: rootA + '/hello.txt', limit: '2' },
    } as never;
    const reply = mockReply();
    await handler(request, reply as never);

    const body = reply.body as unknown[];
    expect(body).toHaveLength(2);
  });

  it('returns 400 for missing glob', async () => {
    const handler = createVcsHistoryHandler({
      coordinator,
      logger: silentLogger,
    });

    const request = { query: {} } as never;
    const reply = mockReply();
    await handler(request, reply as never);

    expect(reply.statusCode).toBe(400);
  });

  it('returns 404 for glob outside any root', async () => {
    const handler = createVcsHistoryHandler({
      coordinator,
      logger: silentLogger,
    });

    const request = {
      query: { glob: '/nonexistent/path/*.txt' },
    } as never;
    const reply = mockReply();
    await handler(request, reply as never);

    expect(reply.statusCode).toBe(404);
  });

  it('filters by date range', async () => {
    // Use a future date so "since" excludes all commits
    const handler = createVcsHistoryHandler({
      coordinator,
      logger: silentLogger,
    });

    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const request = {
      query: { glob: rootA + '/hello.txt', since: futureDate },
    } as never;
    const reply = mockReply();
    await handler(request, reply as never);

    const body = reply.body as unknown[];
    expect(body).toHaveLength(0);
  });
});
