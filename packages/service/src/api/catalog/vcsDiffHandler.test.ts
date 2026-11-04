/**
 * @module api/catalog/vcsDiffHandler.test
 * GET /vcs/diff over the catalog route: a diff between a commit and HEAD,
 * a diff between two specific commits, the catalog's 400 for a missing
 * parameter, 404 not_found for a glob outside every VCS root, and an empty
 * diff for an unknown commit.
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

describe('GET /vcs/diff', () => {
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

  const diff = (query: Record<string, string>) =>
    app.inject({ method: 'GET', url: '/vcs/diff', query });

  const head = async () =>
    (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: rootA })
    ).stdout.trim();

  const commitHello = async (content: string) => {
    await writeFile(join(rootA, 'hello.txt'), content, 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: rootA });
    await execFileAsync('git', ['commit', '-m', content], { cwd: rootA });
  };

  it('returns diff between a commit and HEAD as text/plain', async () => {
    const first = await head();
    await commitHello('changed content');

    const res = await diff({ glob: rootA + '/hello.txt', commit: first });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.body).toContain('hello world');
    expect(res.body).toContain('changed content');
  });

  it('returns diff between two specific commits', async () => {
    const first = await head();
    await commitHello('v2');
    const second = await head();
    await commitHello('v3');

    const res = await diff({
      glob: rootA + '/hello.txt',
      commit: first,
      commitEnd: second,
    });

    expect(res.body).toContain('hello world');
    expect(res.body).toContain('v2');
    expect(res.body).not.toContain('v3');
  });

  it('diffs the whole root when the glob is the root itself', async () => {
    const first = await head();
    await commitHello('changed content');

    const res = await diff({ glob: rootA, commit: first });

    expect(res.body).toContain('changed content');
  });

  it('returns non-ASCII paths unescaped (#252)', async () => {
    const first = await head();
    await writeFile(join(rootA, 'café.md'), 'x', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: rootA });
    await execFileAsync('git', ['commit', '-m', 'accent'], { cwd: rootA });

    const res = await diff({ glob: rootA, commit: first });

    expect(res.body).toContain('diff --git a/café.md b/café.md');
    expect(res.body).not.toContain('\\303');
  });

  it('answers an empty diff when nothing changed', async () => {
    const res = await diff({ glob: rootA + '/hello.txt', commit: 'HEAD' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
  });

  it('answers the catalog 400 for a missing commit', async () => {
    const res = await diff({ glob: rootA + '/hello.txt' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'invalid_request' });
  });

  it('returns 404 not_found for a glob outside every VCS root', async () => {
    const res = await diff({ glob: '/nonexistent/**', commit: 'HEAD' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'not_found' });
  });

  it('skips a root whose commit is unknown and answers an empty diff', async () => {
    const res = await diff({
      glob: rootA + '/hello.txt',
      commit: 'no-such-commit',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
  });
});
