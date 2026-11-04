/**
 * @module api/catalog/vcsCheckExclusionHandler.test
 * GET /vcs/check-exclusion over the catalog route (D82): excluded:false for
 * tracked files, the root itself and paths a negated rule re-includes;
 * excluded:true with the matching rule, the ignore file it came from and its
 * line for ignored files (a VCS-only rule names `.git/info/exclude`); 500
 * when git fails otherwise; the catalog's 400 for a missing path, and 404
 * for a path outside any root. Real git.
 */

import { rename, rm, writeFile } from 'node:fs/promises';
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
      line: 1,
    });
  });

  it('names .git/info/exclude and the line for a VCS-only rule', async () => {
    await writeFile(
      join(rootA, '.git', 'info', 'exclude'),
      '# comment\n/*.tmp\n',
      'utf8',
    );

    const res = await check({ path: rootA + '/scratch.tmp' });

    expect(res.json()).toEqual({
      excluded: true,
      rule: '/*.tmp',
      source: '.git/info/exclude',
      line: 2,
    });
  });

  it('answers excluded:false for a path a negated rule re-includes', async () => {
    await writeFile(
      join(rootA, '.git', 'info', 'exclude'),
      '/*.tmp\n!/keep.tmp\n',
      'utf8',
    );

    const res = await check({ path: rootA + '/keep.tmp' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ excluded: false });
  });

  it('answers excluded:false for the root itself', async () => {
    const res = await check({ path: rootA });

    expect(res.json()).toEqual({ excluded: false });
  });

  it('answers 500 when git fails for another reason than "not ignored"', async () => {
    await rename(join(rootA, '.git'), join(rootA, 'not-git'));

    const res = await check({ path: rootA + '/hello.txt' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: 'internal_error' });
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
