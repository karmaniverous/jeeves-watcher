/**
 * @module api/catalog/vcsExcludeHandler.test
 * POST /vcs/exclude over the catalog route: adds/removes a pattern in
 * .gitignore, places .gitignore at the deepest common directory, avoids
 * duplicate entries, the catalog's 400 for a missing glob, and 404s for an
 * invalid root or a pattern that isn't there to remove.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  makeVcsApiCoordinator,
  makeVcsApiRoot,
  serveVcsCatalog,
} from '../../test/vcsHandlers';

describe('POST /vcs/exclude', () => {
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

  const exclude = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/vcs/exclude', payload });

  it('adds pattern to .gitignore at the root', async () => {
    const res = await exclude({ glob: rootA + '/*.log' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      gitignorePath: rootA + '/.gitignore',
      action: 'added',
    });
    const content = await readFile(join(rootA, '.gitignore'), 'utf8');
    expect(content).toBe('*.log\n');
  });

  it('removes pattern from .gitignore', async () => {
    await writeFile(join(rootA, '.gitignore'), '*.log\n*.tmp\n', 'utf8');

    const res = await exclude({ glob: rootA + '/*.log', remove: true });

    expect(res.json()).toMatchObject({ ok: true, action: 'removed' });
    const content = await readFile(join(rootA, '.gitignore'), 'utf8');
    expect(content).not.toContain('*.log');
    expect(content).toContain('*.tmp');
  });

  it('returns 404 when the pattern to remove is absent', async () => {
    await writeFile(join(rootA, '.gitignore'), '*.tmp\n', 'utf8');

    const res = await exclude({ glob: rootA + '/*.log', remove: true });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'not_found' });
  });

  it('places .gitignore at deepest common directory (locality)', async () => {
    await mkdir(join(rootA, 'sub', 'dir'), { recursive: true });

    const res = await exclude({ glob: rootA + '/sub/dir/*.log' });

    const body = res.json<{ ok: boolean; gitignorePath: string }>();
    expect(body.ok).toBe(true);
    expect(body.gitignorePath).toContain('sub/dir/.gitignore');
    const content = await readFile(
      join(rootA, 'sub', 'dir', '.gitignore'),
      'utf8',
    );
    expect(content).toContain('*.log');
  });

  it('answers the catalog 400 for a missing glob', async () => {
    const res = await exclude({});

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'invalid_request' });
  });

  it('returns 404 for invalid root', async () => {
    const res = await exclude({ glob: '*.log', root: '/nonexistent/root' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'not_found' });
  });

  it('does not duplicate existing pattern', async () => {
    await writeFile(join(rootA, '.gitignore'), '*.log\n', 'utf8');

    const res = await exclude({ glob: rootA + '/*.log' });

    expect(res.json()).toMatchObject({ ok: true, action: 'added' });
    const content = await readFile(join(rootA, '.gitignore'), 'utf8');
    expect(content).toBe('*.log\n');
  });
});
