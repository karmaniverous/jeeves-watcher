/**
 * @module api/reindexPathFiles.test
 * collectPathFiles on a real temp tree: files and directories (expanded to watched files, deduped) resolve; unwatched or gitignored targets are `PathNotWatched` (403), missing ones (ENOENT, ENOTDIR) `PathNotFound` (404), neither-file-nor-directory `PathNotFileOrDirectory` (400); other stat errors propagate; a directory never expands into a sibling sharing its prefix.
 */

import type { Stats } from 'node:fs';
import type * as FsPromises from 'node:fs/promises';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import type { GitignoreFilter } from '../gitignore';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { PathNotFileOrDirectory, PathNotFound, PathNotWatched } from './errors';
import { collectPathFiles } from './reindexPathFiles';

/** Every class a bad reindex target throws. */
const TARGET_ERRORS = [PathNotWatched, PathNotFound, PathNotFileOrDirectory];

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof FsPromises>();
  return { ...original, stat: vi.fn(original.stat) };
});

let root: string;
let config: JeevesWatcherConfig;

beforeAll(async () => {
  root = normalizeSlashes(await mkdtemp(join(tmpdir(), 'jw-path-files-')));
  await mkdir(`${root}/docs/sub`, { recursive: true });
  await writeFile(`${root}/docs/a.md`, 'a');
  await writeFile(`${root}/docs/sub/b.md`, 'b');
  await mkdir(`${root}/docs2`, { recursive: true });
  await writeFile(`${root}/docs2/c.md`, 'c');
  await writeFile(`${root}/other.md`, 'x');
  config = {
    watch: { paths: [`${root}/docs/**`, `${root}/docs2/**`], ignored: [] },
  } as unknown as JeevesWatcherConfig;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const norm = (files: string[]) => files.map(normalizeSlashes).sort();

describe('collectPathFiles', () => {
  it('resolves a file and expands a directory, deduped, never into a sibling sharing its prefix', async () => {
    const files = await collectPathFiles(
      [`${root}/docs/a.md`, `${root}/docs`],
      config,
      undefined,
    );
    expect(norm(files)).toEqual([`${root}/docs/a.md`, `${root}/docs/sub/b.md`]);
  });

  /** The rejection of a promise (undefined when it resolves). */
  const failure = (promise: Promise<unknown>) =>
    promise.then(
      () => undefined,
      (e: unknown) => e,
    );

  it('rejects an unwatched path with 403 path_not_watched', async () => {
    const error = await failure(
      collectPathFiles([`${root}/other.md`], config, undefined),
    );
    expect(error).toBeInstanceOf(PathNotWatched);
    expect(error).toMatchObject({
      statusCode: 403,
      code: 'WATCHER_PATH_NOT_WATCHED',
      message: 'The path is outside the watched scope or is gitignored.',
    });
  });

  it('rejects a gitignored path with 403 path_not_watched', async () => {
    const gitignore = { isIgnored: () => true } as unknown as GitignoreFilter;
    const error = await failure(
      collectPathFiles([`${root}/docs/a.md`], config, gitignore),
    );
    expect(error).toBeInstanceOf(PathNotWatched);
    expect(error).toMatchObject({
      statusCode: 403,
      code: 'WATCHER_PATH_NOT_WATCHED',
      message: 'The path is outside the watched scope or is gitignored.',
    });
  });

  it('rejects a missing path with 404 WATCHER_NOT_FOUND', async () => {
    const error = await failure(
      collectPathFiles([`${root}/docs/missing.md`], config, undefined),
    );
    expect(error).toBeInstanceOf(PathNotFound);
    expect(error).toMatchObject({ statusCode: 404, code: 'WATCHER_NOT_FOUND' });
  });

  /** Make the next stat reject with an fs error code. */
  const statFails = (code: string) =>
    vi
      .mocked(stat)
      .mockRejectedValueOnce(Object.assign(new Error(code), { code }));

  it('answers ENOTDIR with 404 WATCHER_NOT_FOUND', async () => {
    statFails('ENOTDIR');
    const error = await failure(
      collectPathFiles([`${root}/docs/a.md`], config, undefined),
    );
    expect(error).toMatchObject({ statusCode: 404, code: 'WATCHER_NOT_FOUND' });
  });

  it('rethrows any other stat error unchanged', async () => {
    statFails('EACCES');
    const error = await failure(
      collectPathFiles([`${root}/docs/a.md`], config, undefined),
    );
    for (const cls of TARGET_ERRORS) expect(error).not.toBeInstanceOf(cls);
    expect(error).toMatchObject({ code: 'EACCES' });
  });

  it('rejects a target that is neither file nor directory with 400 WATCHER_INVALID_REQUEST', async () => {
    vi.mocked(stat).mockResolvedValueOnce({
      isFile: () => false,
      isDirectory: () => false,
    } as Stats);
    const error = await failure(
      collectPathFiles([`${root}/docs/a.md`], config, undefined),
    );
    expect(error).toBeInstanceOf(PathNotFileOrDirectory);
    expect(error).toMatchObject({
      statusCode: 400,
      code: 'WATCHER_INVALID_REQUEST',
    });
  });
});
