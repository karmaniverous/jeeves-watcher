/**
 * @module api/handlers/vcs/vcsShow.handler.test
 * GET /vcs/show handler behavior: returns file content at a specific
 * commit, 404s for a nonexistent file at that commit or a path outside
 * any root, and 400s for missing parameters.
 */

import { rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { execFileAsync } from '../../../test/git';
import {
  makeVcsApiCoordinator,
  makeVcsApiRoot,
  mockReply,
  silentLogger,
} from '../../../test/vcsHandlers';
import type { VcsCoordinator } from '../../../vcs/VcsCoordinator';
import { createVcsShowHandler } from './vcsShow';

describe('GET /vcs/show', () => {
  let rootA: string;
  let coordinator: VcsCoordinator;

  beforeEach(async () => {
    rootA = await makeVcsApiRoot();
    coordinator = makeVcsApiCoordinator(rootA);
  });

  afterEach(async () => {
    await rm(rootA, { recursive: true, force: true });
  });

  it('returns file content at a specific commit', async () => {
    // Get the commit hash
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: rootA,
    });
    const commitHash = stdout.trim();

    const handler = createVcsShowHandler({
      coordinator,
      logger: silentLogger,
    });

    const request = {
      query: { path: rootA + '/hello.txt', commit: commitHash },
    } as never;
    const reply = mockReply();
    await handler(request, reply as never);

    expect(reply.body).toBe('hello world');
    expect(reply.headers['content-type']).toBe('text/plain');
  });

  it('returns 404 for nonexistent file at commit', async () => {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: rootA,
    });

    const handler = createVcsShowHandler({
      coordinator,
      logger: silentLogger,
    });

    const request = {
      query: {
        path: rootA + '/nonexistent.txt',
        commit: stdout.trim(),
      },
    } as never;
    const reply = mockReply();
    await handler(request, reply as never);

    expect(reply.statusCode).toBe(404);
  });

  it('returns 400 for missing parameters', async () => {
    const handler = createVcsShowHandler({
      coordinator,
      logger: silentLogger,
    });

    const request = { query: {} } as never;
    const reply = mockReply();
    await handler(request, reply as never);

    expect(reply.statusCode).toBe(400);
  });

  it('returns 404 for path outside any root', async () => {
    const handler = createVcsShowHandler({
      coordinator,
      logger: silentLogger,
    });

    const request = {
      query: { path: '/nonexistent/file.txt', commit: 'HEAD' },
    } as never;
    const reply = mockReply();
    await handler(request, reply as never);

    expect(reply.statusCode).toBe(404);
  });
});
