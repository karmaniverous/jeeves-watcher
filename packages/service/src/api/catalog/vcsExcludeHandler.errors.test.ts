/**
 * @module api/catalog/vcsExcludeHandler.errors.test
 * POST /vcs/exclude error answers (D102): 503 `not_available` with `Retry-After: 30` and nothing written when RootGitLock stays busy past the wait (shortened here), and 500 `internal_error` when git fails. Real git.
 */

import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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

describe('POST /vcs/exclude errors', () => {
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
      code: 'not_available',
      error: 'Not available',
      message: 'Version control is busy on this root; retry after 30 s',
    });
    expect(await readFile(excludeFile(), 'utf8')).toBe('');
    release();
    await held;
  });

  it('answers 500 when git fails', async () => {
    await rename(join(root, '.git', 'HEAD'), join(root, '.git', 'HEAD.bak'));

    const res = await exclude({ glob: root + '/hello.txt' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: 'internal_error' });
  });
});
