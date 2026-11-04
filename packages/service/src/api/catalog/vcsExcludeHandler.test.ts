/**
 * @module api/catalog/vcsExcludeHandler.test
 * POST /vcs/exclude over the catalog route (Design 5, D54, D81): adds a root-anchored pattern to `.git/info/exclude` (idempotent; never a `.gitignore`, so search is unaffected), removes it (or a 0.20.0 locality `.gitignore` line, with 0.20.0's 404 texts), and answers 400 (refused pattern, outside an explicit root), 404 (no root) and the catalog's 400 (missing glob, non-boolean `remove`/`confirm`). Real git.
 */

import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  makeVcsApiCoordinator,
  makeVcsApiRoot,
  serveVcsCatalog,
} from '../../test/vcsHandlers';

describe('POST /vcs/exclude', { timeout: 20_000 }, () => {
  let rootA: string;
  let app: FastifyInstance;
  const excludeFile = () => join(rootA, '.git', 'info', 'exclude');
  const readExclude = () => readFile(excludeFile(), 'utf8');

  beforeEach(async () => {
    rootA = await makeVcsApiRoot();
    await writeFile(excludeFile(), '# git default\n', 'utf8');
    app = await serveVcsCatalog(makeVcsApiCoordinator(rootA));
  });

  afterEach(async () => {
    await app.close();
    await rm(rootA, { recursive: true, force: true });
  });

  const exclude = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/vcs/exclude', payload });

  it('appends the root-anchored pattern to .git/info/exclude', async () => {
    const res = await exclude({ glob: rootA + '/sub/*.log' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      file: rootA + '/.git/info/exclude',
      action: 'added',
      untracked: 0,
    });
    expect(await readExclude()).toBe('# git default\n/sub/*.log\n');
  });

  it('does not duplicate a pattern already present', async () => {
    await exclude({ glob: rootA + '/*.log' });
    const res = await exclude({ glob: rootA + '/*.log' });

    expect(res.json()).toMatchObject({ action: 'added', untracked: 0 });
    expect(await readExclude()).toBe('# git default\n/*.log\n');
  });

  it('takes a glob relative to an explicit root', async () => {
    const res = await exclude({ glob: '*.log', root: rootA });

    expect(res.json()).toMatchObject({ action: 'added' });
    expect(await readExclude()).toContain('/*.log\n');
  });

  it('removes the anchored line from .git/info/exclude', async () => {
    await exclude({ glob: rootA + '/*.log' });

    const res = await exclude({ glob: rootA + '/*.log', remove: true });

    expect(res.json()).toEqual({
      ok: true,
      file: rootA + '/.git/info/exclude',
      action: 'removed',
      untracked: 0,
    });
    expect(await readExclude()).toBe('# git default\n');
  });

  it('removes a 0.20.0 locality .gitignore line when .git/info/exclude lacks it', async () => {
    await writeFile(join(rootA, '.gitignore'), '*.log\n*.tmp\n', 'utf8');

    const res = await exclude({ glob: rootA + '/*.log', remove: true });

    expect(res.json()).toEqual({
      ok: true,
      file: rootA + '/.gitignore',
      action: 'removed',
      untracked: 0,
    });
    expect(await readFile(join(rootA, '.gitignore'), 'utf8')).toBe('*.tmp\n');
  });

  it.each([
    [undefined, 'No .gitignore found at the expected location'],
    ['*.tmp\n', 'Pattern not found in .gitignore'],
  ])(
    'answers 0.20.0 404 texts for a pattern to remove that is nowhere (.gitignore %j)',
    async (gitignore, error) => {
      if (gitignore !== undefined) {
        await writeFile(join(rootA, '.gitignore'), gitignore, 'utf8');
      }

      const res = await exclude({ glob: rootA + '/*.log', remove: true });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ code: 'not_found', error });
    },
  );

  it('answers 400 for a refused pattern and writes nothing', async () => {
    const res = await exclude({ glob: rootA + '/**' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      code: 'invalid_request',
      error: 'The glob matches the whole root',
    });
    expect(await readExclude()).toBe('# git default\n');
  });

  it('answers 400 for a glob outside an explicit root', async () => {
    const res = await exclude({ glob: '/elsewhere/*.log', root: rootA });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 'invalid_request',
      error: 'The glob resolves outside the root',
    });
  });

  it.each([
    [
      { glob: '/nonexistent/root/*.log' },
      'Glob does not match any VCS-enabled watch root',
    ],
    [
      { glob: '*.log', root: '/nonexistent/root' },
      'Root is not a VCS-enabled watch root',
    ],
  ])('answers 404 for %j', async (payload, error) => {
    const res = await exclude(payload);

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'not_found', error });
  });

  it.each([
    [{}],
    [{ glob: '*.log', remove: 'false' }],
    [{ glob: '*.log', confirm: 'true' }],
  ])('answers the catalog 400 for %j', async (payload) => {
    const res = await exclude(payload);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'invalid_request' });
  });
});
