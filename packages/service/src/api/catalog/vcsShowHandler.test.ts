/**
 * @module api/catalog/vcsShowHandler.test
 * `createCatalogVcsShowHandler`: file content at a commit, 404s for an
 * unknown root or missing file, and today's exact not-found body when VCS
 * is disabled (D28).
 */

import { rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { execFileAsync } from '../../test/git';
import { makeVcsApiCoordinator, makeVcsApiRoot } from '../../test/vcsHandlers';
import type { VcsCoordinator } from '../../vcs/VcsCoordinator';
import { createCatalogVcsShowHandler } from './vcsShowHandler';

function input(query: Record<string, string>) {
  return { params: {}, query, body: {} } as never;
}

function request(method: string, url: string) {
  return { method, url } as never;
}

describe('createCatalogVcsShowHandler', () => {
  let rootA: string;
  let coordinator: VcsCoordinator;

  beforeEach(async () => {
    rootA = await makeVcsApiRoot();
    coordinator = makeVcsApiCoordinator(rootA);
  });

  afterEach(async () => {
    await rm(rootA, { recursive: true, force: true });
  });

  it('returns file content with its content-type', async () => {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: rootA,
    });
    const handler = createCatalogVcsShowHandler({ coordinator });

    const result = await handler(
      input({ path: rootA + '/hello.txt', commit: stdout.trim() }),
      request('GET', '/vcs/show'),
    );

    expect(result).toEqual({
      status: 200,
      body: 'hello world',
      headers: { 'content-type': 'text/plain' },
    });
  });

  it('returns 404 not_found for a nonexistent file at the commit', async () => {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: rootA,
    });
    const handler = createCatalogVcsShowHandler({ coordinator });

    const result = await handler(
      input({ path: rootA + '/nonexistent.txt', commit: stdout.trim() }),
      request('GET', '/vcs/show'),
    );

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({
      code: 'not_found',
      error: 'File not found at the specified commit',
    });
  });

  it('returns 404 not_found for a path outside any root', async () => {
    const handler = createCatalogVcsShowHandler({ coordinator });

    const result = await handler(
      input({ path: '/nonexistent/file.txt', commit: 'HEAD' }),
      request('GET', '/vcs/show'),
    );

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({
      code: 'not_found',
      error: 'Path does not match any VCS-enabled watch root',
    });
  });

  it('answers with the exact Fastify not-found body when VCS is disabled', async () => {
    const handler = createCatalogVcsShowHandler({});

    const result = await handler(
      input({ path: rootA + '/hello.txt', commit: 'HEAD' }),
      request('GET', '/vcs/show?path=x&commit=HEAD'),
    );

    expect(result).toEqual({
      status: 404,
      body: {
        code: 'not_found',
        error: 'Not Found',
        message: 'Route GET:/vcs/show?path=x&commit=HEAD not found',
      },
    });
  });
});
