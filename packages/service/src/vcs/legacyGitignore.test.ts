/**
 * @module vcs/legacyGitignore.test
 * Undoing a 0.20.0 locality `.gitignore` exclude (D3, D81): the split 0.20.0 used, removal that keeps other lines, and 0.20.0's 404 texts for a missing file or line. Temp dirs; no git.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { normalizeSlashes } from '../util/normalizeSlashes';
import {
  LegacyPatternNotFoundError,
  removeLegacyGitignoreLine,
  splitGlobForLocality,
} from './legacyGitignore';

describe('splitGlobForLocality', () => {
  it.each([
    ['*.log', '.', '*.log'],
    ['debug.log', '.', 'debug.log'],
    ['sub/debug.log', 'sub', 'debug.log'],
    ['sub/dir/*.log', 'sub/dir', '*.log'],
    ['tmp/**/x/*.md', 'tmp', '**/x/*.md'],
    ['a/b[1]/c.md', 'a', 'b[1]/c.md'],
  ])('%s -> %s + %s', (glob, dir, pattern) => {
    expect(splitGlobForLocality(glob)).toEqual({ dir, pattern });
  });
});

describe('removeLegacyGitignoreLine', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'legacy-gitignore-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('removes the line from the locality .gitignore and keeps the rest', async () => {
    await mkdir(join(root, 'sub'));
    await writeFile(join(root, 'sub', '.gitignore'), '*.tmp\n*.log\n', 'utf8');

    const file = await removeLegacyGitignoreLine(root, 'sub/*.log');

    expect(file).toBe(normalizeSlashes(join(root, 'sub', '.gitignore')));
    expect(await readFile(file, 'utf8')).toBe('*.tmp\n');
  });

  it.each([
    [
      'no .gitignore',
      undefined,
      'No .gitignore found at the expected location',
    ],
    ['no matching line', '*.tmp\n', 'Pattern not found in .gitignore'],
  ])('throws 0.20.0 text with %s', async (_name, content, message) => {
    if (content !== undefined) {
      await writeFile(join(root, '.gitignore'), content, 'utf8');
    }

    const error = await removeLegacyGitignoreLine(root, '*.log').catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(LegacyPatternNotFoundError);
    expect(error).toMatchObject({ message });
  });
});
