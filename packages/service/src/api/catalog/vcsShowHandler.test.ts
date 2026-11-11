/**
 * @module api/catalog/vcsShowHandler.test
 * `createCatalogVcsShowHandler`: file content at a commit, and 404s for an
 * unknown root or missing file. VCS off is the feature gate's
 * (`api/featureGates.test`).
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

  it('throws 404 WATCHER_NOT_FOUND for a nonexistent file at the commit', async () => {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: rootA,
    });
    const handler = createCatalogVcsShowHandler({ coordinator });

    await expect(
      handler(
        input({ path: rootA + '/nonexistent.txt', commit: stdout.trim() }),
        request('GET', '/vcs/show'),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'WATCHER_NOT_FOUND',
      message: 'The file does not exist at that commit.',
    });
  });

  it('throws 404 WATCHER_NOT_FOUND for a path outside any root', async () => {
    const handler = createCatalogVcsShowHandler({ coordinator });

    await expect(
      handler(
        input({ path: '/nonexistent/file.txt', commit: 'HEAD' }),
        request('GET', '/vcs/show'),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'WATCHER_NOT_FOUND',
      message: 'No version-controlled watch root matches the path or glob.',
    });
  });
});
