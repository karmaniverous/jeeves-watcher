/**
 * @module vcs/untrack.test
 * The shared untrack helper and its crash marker (D147, D163, D164, D178): a private-index commit removes what HEAD holds, the real index loses the union, unrelated staged entries survive, races rebuild once, and a crash on either side of `update-ref` is finished or discarded. Real git against temp repos.
 */

import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { commitAll, git, makeTempRepo } from '../test/vcsRepo';
import { listTracked } from './trackedCheck';
import { untrackPaths, type UntrackRequest } from './untrack';
import {
  privateIndexPath,
  recoverUntrackPending,
  untrackMarkerPath,
} from './untrackPending';

const logger = pino({ level: 'silent' });
let repo: string;

/** A request untracking explicit paths. */
function request(
  paths: string[],
  extra: Partial<UntrackRequest> = {},
): UntrackRequest {
  return {
    select: (env) => listTracked(repo, paths, { env }),
    message: () => 'untrack test',
    ...extra,
  };
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** git output, trimmed. */
async function g(...args: string[]): Promise<string> {
  return (await git(repo, ...args)).trim();
}

async function lsFiles(): Promise<string[]> {
  return (await g('ls-files')).split('\n').filter(Boolean).sort();
}

beforeEach(async () => {
  repo = await makeTempRepo('untrack-');
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('untrackPaths', () => {
  it('commits the removal of HEAD paths, keeps the files and unrelated staged entries', async () => {
    await writeFile(join(repo, 'big.bin'), 'x');
    await writeFile(join(repo, 'keep.md'), 'k');
    await writeFile(join(repo, 'other.md'), 'o');
    await commitAll(repo, 'seed');
    await writeFile(join(repo, 'other.md'), 'staged edit');
    await g('add', 'other.md');
    const before = await g('rev-parse', 'HEAD');

    const result = await untrackPaths(repo, request(['big.bin']));

    expect(result.untracked).toEqual(['big.bin']);
    expect(await g('rev-parse', 'HEAD~1')).toBe(before);
    expect(result.commit).toBe(await g('rev-parse', 'HEAD'));
    expect(await g('log', '-1', '--format=%s')).toBe('untrack test');
    expect(await g('ls-tree', '--name-only', 'HEAD')).not.toContain('big.bin');
    expect(await lsFiles()).toEqual(['keep.md', 'other.md']);
    expect(await g('diff', '--cached', '--name-only')).toBe('other.md');
    expect(await readFile(join(repo, 'big.bin'), 'utf8')).toBe('x');
    expect(await g('reflog', '-1', '--format=%gs')).toBe(
      'jeeves-watcher untrack',
    );
    expect(await exists(untrackMarkerPath(repo))).toBe(false);
    expect(await exists(privateIndexPath(repo))).toBe(false);
  });

  it('only removes from the real index when HEAD is unborn', async () => {
    await writeFile(join(repo, 'a.md'), 'a');
    await g('add', 'a.md');

    const result = await untrackPaths(repo, request(['a.md']));

    expect(result).toEqual({ commit: undefined, untracked: ['a.md'] });
    expect(await lsFiles()).toEqual([]);
  });

  it('removes a staged-only path without a commit when HEAD lacks it', async () => {
    await writeFile(join(repo, 'seed.md'), 's');
    await commitAll(repo, 'seed');
    const head = await g('rev-parse', 'HEAD');
    await writeFile(join(repo, 'staged.md'), 's');
    await g('add', 'staged.md');

    const result = await untrackPaths(repo, request(['staged.md']));

    expect(result.commit).toBeUndefined();
    expect(await g('rev-parse', 'HEAD')).toBe(head);
    expect(await lsFiles()).toEqual(['seed.md']);
  });

  it('rebuilds once on a foreign commit that moves HEAD, then succeeds', async () => {
    await writeFile(join(repo, 'big.bin'), 'x');
    await commitAll(repo, 'seed');
    let raced = false;

    const result = await untrackPaths(
      repo,
      request(['big.bin'], {
        hooks: {
          beforeUpdateRef: async () => {
            if (raced) return;
            raced = true;
            await g('commit', '--allow-empty', '-q', '-m', 'foreign');
          },
        },
      }),
    );

    expect(await g('log', '--format=%s', '-2')).toBe('untrack test\nforeign');
    expect(result.commit).toBe(await g('rev-parse', 'HEAD'));
  });

  it('throws when HEAD moves twice', async () => {
    await writeFile(join(repo, 'big.bin'), 'x');
    await commitAll(repo, 'seed');

    await expect(
      untrackPaths(
        repo,
        request(['big.bin'], {
          hooks: {
            beforeUpdateRef: async () => {
              await g('commit', '--allow-empty', '-q', '-m', 'foreign');
            },
          },
        }),
      ),
    ).rejects.toThrow();
    expect(await lsFiles()).toEqual(['big.bin']);
    expect(await exists(untrackMarkerPath(repo))).toBe(false);
  });
});

describe('untrackPaths beforeWrite (D103, D164)', () => {
  it('gets the union of the HEAD and real-index lists once, before any write', async () => {
    await writeFile(join(repo, 'a.bin'), 'a');
    await writeFile(join(repo, 'b.bin'), 'b');
    await commitAll(repo, 'seed');
    await writeFile(join(repo, 'new.bin'), 'n');
    await g('add', 'new.bin');
    const counts: number[] = [];

    const result = await untrackPaths(
      repo,
      request(['a.bin', 'b.bin', 'new.bin'], {
        beforeWrite: (count) => {
          counts.push(count);
          return Promise.resolve();
        },
      }),
    );

    expect(counts).toEqual([3]);
    expect(result.untracked.sort()).toEqual(['a.bin', 'b.bin', 'new.bin']);
  });

  it('counts only the real index when HEAD is unborn', async () => {
    await writeFile(join(repo, 'a.bin'), 'a');
    await g('add', 'a.bin');
    const counts: number[] = [];

    await untrackPaths(
      repo,
      request(['a.bin'], {
        beforeWrite: (count) => {
          counts.push(count);
          return Promise.resolve();
        },
      }),
    );

    expect(counts).toEqual([1]);
  });

  it('writes nothing when it throws', async () => {
    await writeFile(join(repo, 'a.bin'), 'a');
    await commitAll(repo, 'seed');
    const head = await g('rev-parse', 'HEAD');

    await expect(
      untrackPaths(
        repo,
        request(['a.bin'], {
          beforeWrite: () => Promise.reject(new Error('refused')),
        }),
      ),
    ).rejects.toThrow('refused');

    expect(await g('rev-parse', 'HEAD')).toBe(head);
    expect(await lsFiles()).toEqual(['a.bin']);
    expect(await exists(untrackMarkerPath(repo))).toBe(false);
    expect(await exists(privateIndexPath(repo))).toBe(false);
  });
});

describe('recoverUntrackPending (D178)', () => {
  it('finishes an untrack that crashed between update-ref and the index removal', async () => {
    await writeFile(join(repo, 'big.bin'), 'x');
    await commitAll(repo, 'seed');
    await expect(
      untrackPaths(
        repo,
        request(['big.bin'], {
          hooks: { afterUpdateRef: () => Promise.reject(new Error('crash')) },
        }),
      ),
    ).rejects.toThrow('crash');
    expect(await lsFiles()).toEqual(['big.bin']);
    expect(await exists(untrackMarkerPath(repo))).toBe(true);

    expect(await recoverUntrackPending(repo, logger)).toBe('finished');
    expect(await lsFiles()).toEqual([]);
    expect(await exists(untrackMarkerPath(repo))).toBe(false);
  });

  it('discards a marker whose commit never landed, removing its pattern line', async () => {
    await writeFile(join(repo, 'big.bin'), 'x');
    await commitAll(repo, 'seed');
    const head = await g('rev-parse', 'HEAD');
    const exclude = join(repo, '.git', 'info', 'exclude');
    await writeFile(exclude, '# keep\n*.bin\n');
    await expect(
      untrackPaths(
        repo,
        request(['big.bin'], {
          pattern: '*.bin',
          hooks: { beforeUpdateRef: () => Promise.reject(new Error('crash')) },
        }),
      ),
    ).rejects.toThrow('crash');

    expect(await recoverUntrackPending(repo, logger)).toBe('discarded');
    expect(await g('rev-parse', 'HEAD')).toBe(head);
    expect(await lsFiles()).toEqual(['big.bin']);
    expect(await readFile(exclude, 'utf8')).toBe('# keep\n');
  });

  it('deletes a leftover private index and an unreadable marker', async () => {
    await writeFile(privateIndexPath(repo), 'junk');
    await writeFile(untrackMarkerPath(repo), '{not json');

    expect(await recoverUntrackPending(repo, logger)).toBe('discarded');
    expect(await exists(privateIndexPath(repo))).toBe(false);
    expect(await exists(untrackMarkerPath(repo))).toBe(false);
    expect(await recoverUntrackPending(repo, logger)).toBe('none');
  });
});
