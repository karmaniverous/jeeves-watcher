/**
 * @module api/catalog/vcsExcludeHandler.untrack.test
 * POST /vcs/exclude untracking (D71, D103, D116, D163, D164, D168, D174, D178): matching tracked files leave HEAD and the index in one commit (files stay on disk), an unrelated staged entry survives, a staged edit or a failed batch's staged-only file is untracked and counted, an unborn HEAD makes no commit, folder patterns reach nested files, brackets need escaping, and more than 100 files need `confirm`. Real git.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  makeVcsApiCoordinator,
  makeVcsApiRoot,
  serveVcsCatalog,
} from '../../test/vcsHandlers';
import { git } from '../../test/vcsRepo';

let root: string;
let app: FastifyInstance;

const g = async (...args: string[]) => (await git(root, ...args)).trim();
const lines = (text: string) => text.split('\n').filter(Boolean).sort();
const tracked = async () => lines(await g('ls-files'));
const inHead = async () =>
  lines(await g('ls-tree', '-r', '--name-only', 'HEAD'));

async function put(files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), content, 'utf8');
  }
}

async function seed(files: Record<string, string>): Promise<void> {
  await put(files);
  await g('add', '-A');
  await g('commit', '-q', '-m', 'seed');
}

const exclude = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/vcs/exclude', payload });

beforeEach(async () => {
  root = await makeVcsApiRoot();
  app = await serveVcsCatalog(makeVcsApiCoordinator(root));
});

afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

describe('POST /vcs/exclude untracking', { timeout: 20_000 }, () => {
  it('untracks matching files in one commit, keeping them on disk and an unrelated staged entry', async () => {
    await seed({ 'a.log': 'a', 'sub/b.log': 'b', 'keep.md': 'k' });
    await put({ 'keep.md': 'staged edit' });
    await g('add', 'keep.md');
    const before = await g('rev-parse', 'HEAD');

    const res = await exclude({ glob: root + '/**/*.log' });

    expect(res.json()).toMatchObject({ action: 'added', untracked: 2 });
    expect(await g('rev-parse', 'HEAD~1')).toBe(before);
    expect(await g('log', '-1', '--format=%s')).toBe(
      'Untrack 2 files matching /**/*.log',
    );
    expect(await inHead()).toEqual(['hello.txt', 'keep.md']);
    expect(await tracked()).toEqual(['hello.txt', 'keep.md']);
    expect(await g('diff', '--cached', '--name-only')).toBe('keep.md');
    expect(await readFile(join(root, 'sub', 'b.log'), 'utf8')).toBe('b');
    expect(await g('check-ignore', 'sub/b.log')).toBe('sub/b.log');
  });

  it('leaves a clean status after the call (the untracking is committed)', async () => {
    await seed({ 'a.log': 'a' });

    await exclude({ glob: root + '/a.log' });

    expect(await g('status', '--porcelain', '--untracked-files=no')).toBe('');
    expect(await g('log', '-1', '--format=%s')).toBe(
      'Untrack 1 files matching /a.log',
    );
  });

  it('untracks a file with an uncommitted staged edit and does not let a later add re-stage it (D163)', async () => {
    await seed({ 'x.tmp': 'v1', 'y.tmp': 'y' });
    await put({ 'x.tmp': 'v2' });
    await g('add', 'x.tmp');
    await put({ 'x.tmp': 'v3' });

    const res = await exclude({ glob: root + '/*.tmp' });

    expect(res.json()).toMatchObject({ untracked: 2 });
    expect(await tracked()).toEqual(['hello.txt']);
    expect(await readFile(join(root, 'x.tmp'), 'utf8')).toBe('v3');
    await g('add', '-A');
    expect(await tracked()).toEqual(['hello.txt']);
  });

  it('untracks and counts a file a failed batch staged but never committed (D164)', async () => {
    await seed({ 'old.tmp': 'o' });
    await put({ 'new.tmp': 'n' });
    await g('add', 'new.tmp');

    const res = await exclude({ glob: root + '/*.tmp' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ untracked: 2 });
    expect(await g('show', '--name-only', '--format=', 'HEAD')).toBe('old.tmp');
    expect(await tracked()).toEqual(['hello.txt']);
  });

  it('makes no commit when only a staged-only file matches', async () => {
    const head = await g('rev-parse', 'HEAD');
    await put({ 'new.tmp': 'n' });
    await g('add', 'new.tmp');

    const res = await exclude({ glob: root + '/*.tmp' });

    expect(res.json()).toMatchObject({ untracked: 1 });
    expect(await g('rev-parse', 'HEAD')).toBe(head);
    expect(await tracked()).toEqual(['hello.txt']);
  });

  it('changes nothing but the exclude file when nothing matches', async () => {
    const head = await g('rev-parse', 'HEAD');

    const res = await exclude({ glob: root + '/*.none' });

    expect(res.json()).toMatchObject({ untracked: 0 });
    expect(await g('rev-parse', 'HEAD')).toBe(head);
  });

  it('untracks a staged file on an unborn HEAD without a commit (D178)', async () => {
    await rm(join(root, '.git'), { recursive: true, force: true });
    await g('init', '-q');
    await put({ 'a.tmp': 'a' });
    await g('add', 'a.tmp');
    await app.close();
    app = await serveVcsCatalog(makeVcsApiCoordinator(root));

    const res = await exclude({ glob: root + '/a.tmp' });

    expect(res.json()).toMatchObject({ untracked: 1 });
    expect(await g('ls-files')).toBe('');
    await expect(g('rev-parse', '--verify', '-q', 'HEAD')).rejects.toThrow();
  });

  it.each(['docs', 'docs/', '/docs', '**/build/'])(
    'folder pattern %s untracks nested files (D174)',
    async (pattern) => {
      await seed({
        'docs/a.md': 'a',
        'docs/sub/b.md': 'b',
        'build/p.js': 'p',
        'x/build/o.js': 'o',
      });
      const folder = pattern.includes('build') ? 'build' : 'docs';

      const res = await exclude({ glob: `${root}/${pattern}` });

      expect(res.json()).toMatchObject({ untracked: 2 });
      expect((await tracked()).some((p) => p.includes(`${folder}/`))).toBe(
        false,
      );
    },
  );

  it('untracks with a trailing-space glob and finds the line again for remove', async () => {
    await seed({ 'a.log': 'a' });

    const added = await exclude({ glob: root + '/a.log ' });
    expect(added.json()).toMatchObject({ untracked: 1 });
    expect(await tracked()).toEqual(['hello.txt']);
    await exclude({ glob: root + '/a.log ' });
    expect(
      await readFile(join(root, '.git', 'info', 'exclude'), 'utf8'),
    ).toMatch(/^\/a\.log$/m);
    expect(
      (await readFile(join(root, '.git', 'info', 'exclude'), 'utf8')).match(
        /\/a\.log/g,
      ),
    ).toHaveLength(1);

    const removed = await exclude({ glob: root + '/a.log ', remove: true });
    expect(removed.statusCode).toBe(200);
  });
  it('treats brackets as a class unless escaped (D168)', async () => {
    await seed({ 'Report [draft].docx': 'r', 'Report d.docx': 'd' });

    const plain = await exclude({ glob: root + '/Report [draft].docx' });
    expect(plain.json()).toMatchObject({ untracked: 1 });
    expect(await tracked()).toContain('Report [draft].docx');

    const escaped = await exclude({ glob: root + '/Report \\[draft\\].docx' });
    expect(escaped.json()).toMatchObject({ untracked: 1 });
    expect(await tracked()).toEqual(['hello.txt']);
  });

  it('untracks only a[1].md for an escaped pattern; a1.md stays (D116)', async () => {
    await seed({ 'a[1].md': 'x', 'a1.md': 'y' });

    const res = await exclude({ glob: root + '/a\\[1\\].md' });

    expect(res.json()).toMatchObject({ untracked: 1 });
    expect(await tracked()).toEqual(['a1.md', 'hello.txt']);
  });

  it('untracks exactly 100 files without confirm (D103)', async () => {
    await seed(
      Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [`bulk/f${String(i)}.dat`, 'x']),
      ),
    );

    const res = await exclude({ glob: root + '/bulk/*.dat' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ untracked: 100 });
  }, 30_000);

  it('needs confirm past 100 files: 409 writes nothing, confirm untracks (D103)', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 101 }, (_, i) => [`bulk/f${String(i)}.dat`, 'x']),
    );
    await seed(files);
    const head = await g('rev-parse', 'HEAD');
    const excludeFile = join(root, '.git', 'info', 'exclude');
    const before = await readFile(excludeFile, 'utf8');

    const refused = await exclude({ glob: root + '/bulk/*.dat' });

    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({
      code: 'confirm_required',
      error:
        'Excluding /bulk/*.dat would untrack 101 files; repeat with confirm: true',
      untracked: 101,
    });
    expect(await g('rev-parse', 'HEAD')).toBe(head);
    expect(await readFile(excludeFile, 'utf8')).toBe(before);
    expect(await tracked()).toHaveLength(102);

    const confirmed = await exclude({
      glob: root + '/bulk/*.dat',
      confirm: true,
    });

    expect(confirmed.json()).toMatchObject({ untracked: 101 });
    expect(await tracked()).toEqual(['hello.txt']);
  }, 30_000);
});
