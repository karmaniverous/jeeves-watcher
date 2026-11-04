/**
 * @module vcs/trackedCheck.test
 * The batch tracked check (D175): chunking by count and bytes, literal matching, and 1,200 long paths in three calls.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commitAll, git, makeTempRepo } from '../test/vcsRepo';
import type * as RunGitModule from './runGit';
import { runGit } from './runGit';
import {
  chunkPaths,
  listTracked,
  TRACKED_CHECK_MAX_BYTES,
  TRACKED_CHECK_MAX_PATHS,
} from './trackedCheck';

vi.mock('./runGit', async (importOriginal) => {
  const actual = await importOriginal<typeof RunGitModule>();
  return { ...actual, runGit: vi.fn(actual.runGit) };
});

let repo: string;

beforeEach(async () => {
  repo = await makeTempRepo('tracked-check-');
  vi.mocked(runGit).mockClear();
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('chunkPaths', () => {
  it('splits at 500 paths', () => {
    const paths = Array.from({ length: 1001 }, (_, i) => `p${String(i)}`);

    expect(chunkPaths(paths).map((c) => c.length)).toEqual([500, 500, 1]);
    expect(TRACKED_CHECK_MAX_PATHS).toBe(500);
  });

  it('splits at 24 KiB of path bytes, counting UTF-8 bytes', () => {
    const name = '\u00e9'.repeat(500); // 1,000 bytes
    const chunks = chunkPaths(Array.from({ length: 30 }, () => name));

    expect(TRACKED_CHECK_MAX_BYTES).toBe(24 * 1024);
    expect(chunks.map((c) => c.length)).toEqual([24, 6]);
  });

  it('keeps a single over-long path as its own chunk', () => {
    expect(chunkPaths(['x'.repeat(30_000), 'y'])).toEqual([
      ['x'.repeat(30_000)],
      ['y'],
    ]);
    expect(chunkPaths([])).toEqual([]);
  });
});

describe('listTracked', () => {
  it('reads paths literally: a[1].md never matches a1.md', async () => {
    await writeFile(join(repo, 'a1.md'), 'x');
    await commitAll(repo, 'seed');

    expect(await listTracked(repo, ['a[1].md', 'a1.md', '*.md'])).toEqual([
      'a1.md',
    ]);
  });

  it('checks 1,200 paths of 280 characters each in chunks under the command-line limit', async () => {
    const dir = 'd'.repeat(120);
    await mkdir(join(repo, dir));
    const names = Array.from(
      { length: 1200 },
      (_, i) => `${dir}/${String(i).padStart(4, '0')}${'f'.repeat(155)}`,
    );
    expect(names[0]).toHaveLength(280);
    // Commit half of them.
    const tracked = names.filter((_, i) => i % 2 === 0);
    for (const name of tracked) await writeFile(join(repo, name), 'x');
    await git(repo, '-c', 'core.longpaths=true', 'add', '-A');
    await git(repo, '-c', 'core.longpaths=true', 'commit', '-q', '-m', 'seed');
    vi.mocked(runGit).mockClear();

    const listed = await listTracked(repo, names);

    expect(listed).toEqual(tracked);
    const lsCalls = vi
      .mocked(runGit)
      .mock.calls.filter(([, args]) => args.includes('ls-files'));
    // 1,200 x 280 bytes = 336,000 bytes: the 24 KiB limit (87 paths per
    // chunk) drives the count here, not the 500-path limit.
    expect(lsCalls.length).toBe(14);
    for (const [, args] of lsCalls) {
      expect(args.slice(0, 5)).toEqual([
        '--literal-pathspecs',
        'ls-files',
        '-z',
        '-c',
        '--',
      ]);
      expect(args.join(' ').length).toBeLessThan(32_767);
    }
  }, 60_000);

  it('uses the given environment (a private index)', async () => {
    await writeFile(join(repo, 'a.md'), 'x');
    await commitAll(repo, 'seed');
    const index = join(repo, '.git', 'other.index');
    await git(repo, 'read-tree', '--empty', `--index-output=${index}`);

    expect(
      await listTracked(repo, ['a.md'], {
        env: { ...process.env, GIT_INDEX_FILE: index },
      }),
    ).toEqual([]);
  });
});
