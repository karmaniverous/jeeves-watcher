/**
 * @module api/reindexPathFiles.test
 * collectPathFiles on a real temp tree: files and directories (expanded to watched files, deduped) resolve; unwatched or gitignored targets are 403 path_not_watched, missing ones 404 not_found (RequestError).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import type { GitignoreFilter } from '../gitignore';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { collectPathFiles } from './reindexPathFiles';
import { RequestError } from './requestError';

let root: string;
let config: JeevesWatcherConfig;

beforeAll(async () => {
  root = normalizeSlashes(await mkdtemp(join(tmpdir(), 'jw-path-files-')));
  await mkdir(`${root}/docs/sub`, { recursive: true });
  await writeFile(`${root}/docs/a.md`, 'a');
  await writeFile(`${root}/docs/sub/b.md`, 'b');
  await writeFile(`${root}/other.md`, 'x');
  config = {
    watch: { paths: [`${root}/docs/**`], ignored: [] },
  } as unknown as JeevesWatcherConfig;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const norm = (files: string[]) => files.map(normalizeSlashes).sort();

describe('collectPathFiles', () => {
  it('resolves a file and expands a directory, deduped', async () => {
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
    expect(error).toBeInstanceOf(RequestError);
    expect(error).toMatchObject({ status: 403, code: 'path_not_watched' });
  });

  it('rejects a gitignored path with 403 path_not_watched', async () => {
    const gitignore = { isIgnored: () => true } as unknown as GitignoreFilter;
    const error = await failure(
      collectPathFiles([`${root}/docs/a.md`], config, gitignore),
    );
    expect(error).toBeInstanceOf(RequestError);
    expect(error).toMatchObject({ status: 403, code: 'path_not_watched' });
  });

  it('rejects a missing path with 404 not_found', async () => {
    const error = await failure(
      collectPathFiles([`${root}/docs/missing.md`], config, undefined),
    );
    expect(error).toBeInstanceOf(RequestError);
    expect(error).toMatchObject({ status: 404, code: 'not_found' });
  });
});
