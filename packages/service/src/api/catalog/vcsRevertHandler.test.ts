/**
 * @module api/catalog/vcsRevertHandler.test
 * POST /vcs/revert over the catalog route: restores file content from a
 * past commit, skips/recreates deleted files depending on existingOnly, the
 * catalog's 400 for a missing parameter, and 404 for a glob outside any
 * root.
 */

import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { execFileAsync } from '../../test/git';
import {
  makeVcsApiCoordinator,
  makeVcsApiRoot,
  serveVcsCatalog,
} from '../../test/vcsHandlers';

interface RevertBody {
  restored: number;
  files: string[];
}

describe('POST /vcs/revert', () => {
  let rootA: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    rootA = await makeVcsApiRoot();
    app = await serveVcsCatalog(makeVcsApiCoordinator(rootA));
  });

  afterEach(async () => {
    await app.close();
    await rm(rootA, { recursive: true, force: true });
  });

  const revert = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/vcs/revert', payload });

  const git = (...args: string[]) => execFileAsync('git', args, { cwd: rootA });

  const head = async () => (await git('rev-parse', 'HEAD')).stdout.trim();

  /** Commit extra.txt, then delete it; returns the commit that had it. */
  const addThenDeleteExtra = async () => {
    await writeFile(join(rootA, 'extra.txt'), 'extra content', 'utf8');
    await git('add', '.');
    await git('commit', '-m', 'add extra');
    const withExtra = await head();
    await rm(join(rootA, 'extra.txt'));
    await git('add', '.');
    await git('commit', '-m', 'delete extra');
    return withExtra;
  };

  it('restores file content from a past commit', async () => {
    const initial = await head();
    await writeFile(join(rootA, 'hello.txt'), 'modified content', 'utf8');
    await git('add', '.');
    await git('commit', '-m', 'modify hello');

    const res = await revert({ glob: rootA + '/hello.txt', commit: initial });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      restored: 1,
      files: [rootA + '/hello.txt'],
    });
    expect(await readFile(join(rootA, 'hello.txt'), 'utf8')).toBe(
      'hello world',
    );
  });

  it('skips deleted files when existingOnly is true', async () => {
    const withExtra = await addThenDeleteExtra();

    const res = await revert({
      glob: rootA + '/',
      commit: withExtra,
      existingOnly: true,
    });

    const body = res.json<RevertBody>();
    expect(body.restored).toBe(1);
    expect(body.files[0]).toContain('hello.txt');
  });

  it('recreates deleted files when existingOnly is false', async () => {
    const withExtra = await addThenDeleteExtra();

    const res = await revert({ glob: rootA + '/', commit: withExtra });

    expect(res.json<RevertBody>().restored).toBe(2);
    expect(await readFile(join(rootA, 'extra.txt'), 'utf8')).toBe(
      'extra content',
    );
  });

  it('answers the catalog 400 for a missing commit', async () => {
    const res = await revert({ glob: rootA + '/hello.txt' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'FST_ERR_VALIDATION' });
  });

  it('returns 404 for glob outside any root', async () => {
    const res = await revert({
      glob: '/nonexistent/path/*.txt',
      commit: 'HEAD',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      statusCode: 404,
      code: 'WATCHER_NOT_FOUND',
      error: 'Not Found',
      message: 'No version-controlled watch root matches the path or glob.',
    });
  });
});
