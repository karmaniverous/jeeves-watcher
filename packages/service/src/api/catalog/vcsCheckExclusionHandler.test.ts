/**
 * @module api/catalog/vcsCheckExclusionHandler.test
 * GET /vcs/check-exclusion over the catalog route: excluded:false for
 * tracked files, excluded:true with the matching rule and the ignore file it
 * came from for gitignored files, the catalog's 400 for a missing path, and
 * 404 for a path outside any root.
 */

import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { execFileAsync } from '../../test/git';
import {
  makeVcsApiCoordinator,
  makeVcsApiRoot,
  serveVcsCatalog,
} from '../../test/vcsHandlers';

describe('GET /vcs/check-exclusion', () => {
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

  const check = (query: Record<string, string>) =>
    app.inject({ method: 'GET', url: '/vcs/check-exclusion', query });

  it('returns excluded:false for tracked files', async () => {
    const res = await check({ path: rootA + '/hello.txt' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ excluded: false });
  });

  it('returns excluded:true with rule and source for gitignored files', async () => {
    await writeFile(join(rootA, '.gitignore'), '*.log\n', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: rootA });
    await execFileAsync('git', ['commit', '-m', 'add gitignore'], {
      cwd: rootA,
    });

    const res = await check({ path: rootA + '/debug.log' });

    expect(res.json()).toEqual({
      excluded: true,
      rule: '*.log',
      source: '.gitignore',
    });
  });

  it('answers the catalog 400 for a missing path', async () => {
    const res = await check({});

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'invalid_request' });
  });

  it('returns 404 for a path outside any root', async () => {
    const res = await check({ path: '/nonexistent/file.txt' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'not_found' });
  });
});
