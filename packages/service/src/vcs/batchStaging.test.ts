/**
 * @module vcs/batchStaging.test
 * Batch planning and staging against real temp repos (D174, D175, D116, D135, D80): the tracked/new split, folder rules over tracked files, literal paths, missing paths, `check-ignore` filtering and the size cap.
 */

import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commitAll, git, makeTempRepo } from '../test/vcsRepo';
import { planStaging, stageBatch, type StagingOptions } from './batchStaging';
import { OverCapWarnings } from './OverCapWarnings';

let tempDir: string;
const logger = pino({ level: 'silent' });

const options = (over: Partial<StagingOptions> = {}): StagingOptions => ({
  maxFileBytes: 0,
  warnings: new OverCapWarnings(),
  ...over,
});

/** Write files (creating folders) under the temp repo. */
async function put(files: Record<string, string>): Promise<string[]> {
  const paths: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    const path = join(tempDir, name);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, content, 'utf8');
    paths.push(path);
  }
  return paths;
}

/** `git diff --cached --name-status`, sorted lines. */
async function stagedStatus(): Promise<string[]> {
  return (
    await git(tempDir, 'diff', '--cached', '--name-status', '--no-renames')
  )
    .split('\n')
    .filter((l) => l.length > 0)
    .sort();
}

beforeEach(async () => {
  tempDir = await makeTempRepo('batch-staging-');
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('planStaging', () => {
  it('splits tracked, new, missing-tracked and drops missing-untracked paths', async () => {
    const [kept, gone] = await put({ 'kept.txt': 'a', 'gone.txt': 'b' });
    await commitAll(tempDir, 'seed');
    await rm(gone);
    const [fresh] = await put({ 'fresh.txt': 'c' });
    const ghost = join(tempDir, 'ghost.txt');
    const underFile = join(kept, 'child.txt'); // ENOTDIR

    expect(
      await planStaging(
        [kept, gone, fresh, ghost, underFile],
        tempDir,
        logger,
        options(),
      ),
    ).toEqual({
      trackedPresent: ['kept.txt'],
      newPaths: ['fresh.txt'],
      missingTracked: ['gone.txt'],
      overCapTracked: [],
    });
  });

  it('propagates stat errors other than ENOENT/ENOTDIR instead of dropping the path', async () => {
    const denied = Object.assign(new Error('EACCES: permission denied'), {
      code: 'EACCES',
    });
    const statFn = vi.fn((p: string) =>
      p.endsWith('denied.txt') ? Promise.reject(denied) : stat(p),
    );
    const [ok] = await put({ 'ok.txt': 'x' });

    await expect(
      planStaging([ok, join(tempDir, 'denied.txt')], tempDir, logger, {
        ...options(),
        statFn,
      }),
    ).rejects.toBe(denied);
  });

  it('propagates a stat error that carries no errno code', async () => {
    const odd = new Error('unexpected failure');
    await expect(
      planStaging([join(tempDir, 'x.txt')], tempDir, logger, {
        ...options(),
        statFn: () => Promise.reject(odd),
      }),
    ).rejects.toBe(odd);
  });

  it('reads a1.md and a[1].md as different paths (D116)', async () => {
    const [bracket, plain] = await put({ 'a[1].md': 'x', 'a1.md': 'y' });
    await git(tempDir, 'add', '--', ':(literal)a1.md');
    await git(tempDir, 'commit', '-m', 'only a1');

    const plan = await planStaging(
      [bracket, plain],
      tempDir,
      logger,
      options(),
    );

    expect(plan.trackedPresent).toEqual(['a1.md']);
    expect(plan.newPaths).toEqual(['a[1].md']);
  });

  it('applies the size cap: tracked over-cap files are untracked, new ones dropped', async () => {
    const [big, small] = await put({ 'big.bin': 'x', 'small.txt': 'y' });
    await commitAll(tempDir, 'seed');
    await writeFile(big, 'x'.repeat(20), 'utf8');
    const [newBig] = await put({ 'new-big.bin': 'z'.repeat(20) });

    const plan = await planStaging(
      [big, small, newBig],
      tempDir,
      logger,
      options({ maxFileBytes: 10 }),
    );

    expect(plan).toEqual({
      trackedPresent: ['small.txt'],
      newPaths: [],
      missingTracked: [],
      overCapTracked: ['big.bin'],
    });
  });

  it('ignores the cap when maxFileBytes is 0', async () => {
    const [big] = await put({ 'big.bin': 'x'.repeat(50) });

    const plan = await planStaging([big], tempDir, logger, options());

    expect(plan.newPaths).toEqual(['big.bin']);
  });

  it('warns once per over-cap path, and again after it dropped under the cap (D168)', async () => {
    const [big] = await put({ 'big.bin': 'x'.repeat(20) });
    const warnLogger = pino({ level: 'silent' });
    const warn = vi.spyOn(warnLogger, 'warn');
    const shared = options({ maxFileBytes: 10 });

    await planStaging([big], tempDir, warnLogger, shared);
    await planStaging([big], tempDir, warnLogger, shared);
    expect(warn).toHaveBeenCalledTimes(1);

    await writeFile(big, 'small', 'utf8');
    await planStaging([big], tempDir, warnLogger, shared);
    await writeFile(big, 'x'.repeat(20), 'utf8');
    await planStaging([big], tempDir, warnLogger, shared);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('stageBatch', () => {
  it('stages additions and tracked deletions and drops vanished untracked paths', async () => {
    const [doomed] = await put({ 'doomed.txt': 'old content' });
    await commitAll(tempDir, 'seed');
    await rm(doomed);
    const [added] = await put({ 'added.txt': 'new content' });
    const debugLogger = pino({ level: 'silent' });
    const debugSpy = vi.spyOn(debugLogger, 'debug');

    await stageBatch(
      [added, doomed, join(tempDir, 'ghost.txt')],
      tempDir,
      debugLogger,
      options(),
    );

    expect(await stagedStatus()).toEqual(['A\tadded.txt', 'D\tdoomed.txt']);
    expect(debugSpy).toHaveBeenCalledWith(
      expect.objectContaining({ root: tempDir, count: 1 }),
      'Dropping missing or over-cap untracked paths from batch',
    );
  });

  it('stages nothing and succeeds when every path vanished untracked', async () => {
    await expect(
      stageBatch(
        [join(tempDir, 'a.txt'), join(tempDir, 'b.txt')],
        tempDir,
        logger,
        options(),
      ),
    ).resolves.toEqual([]);
    expect(await git(tempDir, 'diff', '--cached', '--name-only')).toBe('');
  });

  it.each([
    ['a .gitignore folder rule', '.gitignore', 'docs/\n'],
    ['a hand-written .git/info/exclude rule', '.git/info/exclude', '/docs\n'],
  ])(
    'stages tracked files under %s and drops new ones there (#279, D174)',
    async (_label, ruleFile, rule) => {
      const [a, b] = await put({ 'docs/a.md': '1', 'docs/sub/b.md': '1' });
      await commitAll(tempDir, 'seed');
      await writeFile(join(tempDir, ruleFile), rule, 'utf8');
      if (ruleFile === '.gitignore') await commitAll(tempDir, 'rule');
      await writeFile(a, '2', 'utf8');
      await writeFile(b, '2', 'utf8');
      const [fresh] = await put({ 'docs/new.md': 'n' });

      await stageBatch([a, b, fresh], tempDir, logger, options());

      expect(await stagedStatus()).toEqual([
        'M\tdocs/a.md',
        'M\tdocs/sub/b.md',
      ]);
    },
  );

  it('stages only a[1].md when a batch changes it beside a tracked a1.md (D116)', async () => {
    const [bracket] = await put({ 'a[1].md': '1', 'a1.md': '1' });
    await commitAll(tempDir, 'seed');
    await writeFile(bracket, '2', 'utf8');
    await writeFile(join(tempDir, 'a1.md'), '2', 'utf8');

    await stageBatch([bracket], tempDir, logger, options());

    expect(await stagedStatus()).toEqual(['M\ta[1].md']);
  });

  it('never stages b1.md for a missing b[1].md (D116)', async () => {
    await put({ 'b1.md': '1' });
    await commitAll(tempDir, 'seed');
    await writeFile(join(tempDir, 'b1.md'), '2', 'utf8');

    await stageBatch([join(tempDir, 'b[1].md')], tempDir, logger, options());

    expect(await stagedStatus()).toEqual([]);
  });

  it('stages b[1].md when /b1.md is excluded: check-ignore reads paths literally (D135)', async () => {
    await writeFile(
      join(tempDir, '.git', 'info', 'exclude'),
      '/b1.md\n',
      'utf8',
    );
    const [bracket] = await put({ 'b[1].md': 'x' });

    await stageBatch([bracket], tempDir, logger, options());

    expect(await stagedStatus()).toEqual(['A\tb[1].md']);
  });

  it('returns over-cap tracked paths without staging them', async () => {
    const [big] = await put({ 'big.bin': 'x' });
    await commitAll(tempDir, 'seed');
    await writeFile(big, 'x'.repeat(20), 'utf8');

    expect(
      await stageBatch([big], tempDir, logger, options({ maxFileBytes: 10 })),
    ).toEqual(['big.bin']);
    expect(await stagedStatus()).toEqual([]);
  });
});
