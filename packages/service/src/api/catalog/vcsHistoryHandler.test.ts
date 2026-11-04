/**
 * @module api/catalog/vcsHistoryHandler.test
 * GET /vcs/history over the catalog route: a bare array of commits for a
 * glob (newest first), the limit parameter, the catalog's 400 for a
 * missing glob, 404 for a glob outside any root, and the since/until date
 * range.
 */

import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { VcsHistoryResponse } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { execFileAsync } from '../../test/git';
import {
  makeVcsApiCoordinator,
  makeVcsApiRoot,
  serveVcsCatalog,
} from '../../test/vcsHandlers';

type HistoryEntry = VcsHistoryResponse[number];

describe('GET /vcs/history', () => {
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

  const history = (query: Record<string, string>) =>
    app.inject({ method: 'GET', url: '/vcs/history', query });

  const commitHello = async (content: string, message: string) => {
    await writeFile(join(rootA, 'hello.txt'), content, 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: rootA });
    await execFileAsync('git', ['commit', '-m', message], { cwd: rootA });
  };

  it('returns commit history for a glob, newest first', async () => {
    await commitHello('updated', 'update hello');

    const res = await history({ glob: rootA + '/hello.txt' });

    expect(res.statusCode).toBe(200);
    const body = res.json<HistoryEntry[]>();
    expect(body.map((e) => e.message)).toEqual([
      'update hello',
      'initial commit',
    ]);
    expect(body[0].files).toEqual(['hello.txt']);
    expect(body[0].commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('respects limit parameter', async () => {
    for (let i = 0; i < 3; i++) {
      await commitHello(`v${String(i)}`, `commit ${String(i)}`);
    }

    const res = await history({ glob: rootA + '/hello.txt', limit: '2' });

    expect(res.json<HistoryEntry[]>()).toHaveLength(2);
  });

  it('returns the newest 20 commits without a limit', async () => {
    for (let i = 0; i < 20; i++) {
      await commitHello(`v${String(i)}`, `commit ${String(i)}`);
    }

    const res = await history({ glob: rootA + '/hello.txt' });

    const body = res.json<HistoryEntry[]>();
    expect(body).toHaveLength(20);
    expect(body[0].message).toBe('commit 19');
  }, 60_000);

  it('answers the catalog 400 for a missing glob', async () => {
    const res = await history({});

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'invalid_request' });
  });

  it('returns 404 for glob outside any root', async () => {
    const res = await history({ glob: '/nonexistent/path/*.txt' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'not_found' });
  });

  it('filters by since', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();

    const res = await history({ glob: rootA + '/hello.txt', since: future });

    expect(res.json()).toEqual([]);
  });

  it('filters by until', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();

    const res = await history({ glob: rootA + '/hello.txt', until: past });

    expect(res.json()).toEqual([]);
  });
});
