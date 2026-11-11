/**
 * @module api/catalog/vcsExcludeHandler.errors.test
 * POST /vcs/exclude error answers (D102): 503 `WATCHER_NOT_AVAILABLE` with `Retry-After: 30` and nothing written when RootGitLock stays busy past the wait (shortened here), and a masked 500 when git fails. Real git.
 */

import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { SERVER_ERROR_MESSAGE } from '@karmaniverous/jeeves/fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  makeVcsApiCoordinator,
  makeVcsApiRoot,
  serveVcsCatalog,
} from '../../test/vcsHandlers';
import type { VcsCoordinator } from '../../vcs/VcsCoordinator';

let root: string;
let coordinator: VcsCoordinator;
let app: FastifyInstance;
const excludeFile = () => join(root, '.git', 'info', 'exclude');

beforeEach(async () => {
  root = await makeVcsApiRoot();
  await writeFile(excludeFile(), '', 'utf8');
  coordinator = makeVcsApiCoordinator(root);
  app = await serveVcsCatalog(coordinator, { lockWaitMs: 50 });
});

afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

const exclude = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/vcs/exclude', payload });

describe('POST /vcs/exclude errors', { timeout: 20_000 }, () => {
  it('answers 503 with Retry-After: 30 when the lock stays busy, writing nothing', async () => {
    const lock = coordinator.getManager(root)?.lock;
    if (!lock) throw new Error('no manager');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = lock.run('commit', () => gate);

    const res = await exclude({ glob: root + '/hello.txt' });

    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('30');
    expect(res.json()).toEqual({
      statusCode: 503,
      code: 'WATCHER_NOT_AVAILABLE',
      error: 'Service Unavailable',
      message: 'Version control is busy on this root; retry after 30 s.',
    });
    expect(await readFile(excludeFile(), 'utf8')).toBe('');
    release();
    await held;
  });

  it('answers a masked 500 when git fails', async () => {
    await rename(join(root, '.git', 'HEAD'), join(root, '.git', 'HEAD.bak'));

    const res = await exclude({ glob: root + '/hello.txt' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: SERVER_ERROR_MESSAGE,
    });
  });
});
