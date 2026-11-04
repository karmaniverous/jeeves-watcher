/**
 * @module vcs/excludeFile.test
 * `.git/info/exclude` editing (D54): idempotent append with newline handling, creation of a missing `.git/info`, removal that keeps the other lines (LF and CRLF), and the no-file cases. Temp directories; no git.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { normalizeSlashes } from '../util/normalizeSlashes';
import {
  addExcludeLine,
  excludeFilePath,
  removeExcludeLine,
} from './excludeFile';

let root: string;
const file = () => join(root, '.git', 'info', 'exclude');
const read = () => readFile(file(), 'utf8');
const seed = async (text: string) => {
  await mkdir(join(root, '.git', 'info'), { recursive: true });
  await writeFile(file(), text, 'utf8');
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'exclude-file-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('excludeFilePath', () => {
  it('is the root .git/info/exclude with forward slashes', () => {
    expect(excludeFilePath(root)).toBe(
      normalizeSlashes(join(root, '.git', 'info', 'exclude')),
    );
  });
});

describe('addExcludeLine', () => {
  it.each([
    ['a missing file (and .git/info)', undefined, '/a.log\n'],
    ['an empty file', '', '/a.log\n'],
    ['a file ending in a newline', '# c\n', '# c\n/a.log\n'],
    ['a file without a final newline', '# c', '# c\n/a.log\n'],
  ])('appends to %s', async (_name, before, after) => {
    if (before !== undefined) await seed(before);

    expect(await addExcludeLine(root, '/a.log')).toBe(true);
    expect(await read()).toBe(after);
  });

  it('leaves the file alone when a line already holds the pattern', async () => {
    await seed('# c\r\n  /a.log  \r\n');

    expect(await addExcludeLine(root, '/a.log')).toBe(false);
    expect(await read()).toBe('# c\r\n  /a.log  \r\n');
  });

  it('rethrows a read failure other than a missing file', async () => {
    await mkdir(file(), { recursive: true });

    await expect(addExcludeLine(root, '/a.log')).rejects.toMatchObject({
      code: 'EISDIR',
    });
  });
});

describe('removeExcludeLine', () => {
  it('removes every line holding the pattern and keeps the rest (CRLF read)', async () => {
    await seed('# c\r\n/a.log\r\n/b.log\r\n /a.log\r\n');

    expect(await removeExcludeLine(root, '/a.log')).toBe(true);
    expect(await read()).toBe('# c\n/b.log\n');
  });

  it('answers false when no line holds it', async () => {
    await seed('/b.log\n');

    expect(await removeExcludeLine(root, '/a.log')).toBe(false);
    expect(await read()).toBe('/b.log\n');
  });

  it('answers false when the file does not exist', async () => {
    expect(await removeExcludeLine(root, '/a.log')).toBe(false);
  });
});
