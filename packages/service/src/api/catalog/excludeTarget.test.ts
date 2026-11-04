/**
 * @module api/catalog/excludeTarget.test
 * Resolving a `POST /vcs/exclude` body (D81, D103, D140, D168): backslash escapes vs separators, the exact whole-root rule, syntax refusals, root from the glob (404 when none) or explicit (404 unknown root, 400 outside), and the anchored pattern. Temp dirs as roots; no git.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeVcsApiCoordinator } from '../../test/vcsHandlers';
import { normalizeSlashes } from '../../util/normalizeSlashes';
import type { VcsCoordinator } from '../../vcs/VcsCoordinator';
import {
  matchesWholeRoot,
  resolveExcludeTarget,
  toForwardSlashes,
} from './excludeTarget';

let root: string;
let coordinator: VcsCoordinator;

beforeAll(async () => {
  root = normalizeSlashes(
    resolve(await mkdtemp(join(tmpdir(), 'exclude-target-'))),
  );
  coordinator = makeVcsApiCoordinator(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** The body with `{root}` in its glob replaced by the temp root. */
const fill = (body: { glob: string; root?: string }) => ({
  ...body,
  glob: body.glob.split('{root}').join(root),
});

/** Resolve and keep the plain fields. */
const target = (body: { glob: string; root?: string }) => {
  const { manager, relativeGlob, pattern } = resolveExcludeTarget(
    coordinator,
    fill(body),
  );
  return { root: manager.rootPath, relativeGlob, pattern };
};

/** The RequestError a body is refused with. */
const refusal = (body: { glob: string; root?: string }) => {
  try {
    resolveExcludeTarget(coordinator, fill(body));
  } catch (error) {
    return error as { status: number; code: string; message: string };
  }
  throw new Error('not refused');
};

describe('toForwardSlashes', () => {
  it.each([
    ['C:\\data\\sub\\*.log', 'C:/data/sub/*.log'],
    ['/r/Report \\[draft\\].docx', '/r/Report \\[draft\\].docx'],
    ['C:\\r\\a\\b', 'C:/r/a/b'],
    ['C:\\r\\x\\', 'C:/r/x/'],
  ])('%s -> %s', (glob, expected) => {
    expect(toForwardSlashes(glob)).toBe(expected);
  });
});

describe('matchesWholeRoot (D140)', () => {
  it.each(['', '.', '*', '**', '/', '/**', '**/*', '*/**', '**//*', './**'])(
    'refuses %j',
    (pattern) => {
      expect(matchesWholeRoot(pattern)).toBe(true);
    },
  );

  it.each(['docs/*', '**/*.tmp', '*.log', 'a/**', '**/build/'])(
    'accepts %j',
    (pattern) => {
      expect(matchesWholeRoot(pattern)).toBe(false);
    },
  );
});

describe('resolveExcludeTarget', () => {
  it('finds the root from an absolute glob and anchors the pattern', () => {
    expect(target({ glob: `{root}/sub/*.log` })).toEqual({
      root,
      relativeGlob: 'sub/*.log',
      pattern: '/sub/*.log',
    });
  });

  it('accepts Windows separators and keeps bracket escapes (D168)', () => {
    expect(
      target({ glob: `${root.replace(/\//g, '\\')}\\Report \\[draft\\].docx` }),
    ).toMatchObject({ pattern: '/Report \\[draft\\].docx' });
  });

  it('collapses repeated slashes and dot segments', () => {
    expect(target({ glob: `{root}//a/./b//*.md` })).toMatchObject({
      pattern: '/a/b/*.md',
    });
  });

  it('takes a glob relative to an explicit root, or an absolute one under it', () => {
    expect(target({ glob: 'docs/', root })).toMatchObject({
      root,
      relativeGlob: 'docs/',
      pattern: '/docs/',
    });
    expect(target({ glob: `{root}/x.md`, root })).toMatchObject({
      pattern: '/x.md',
    });
  });

  it.each(['*', '**', '**/*', '*/**', '/', '/**'])(
    'refuses the whole-root pattern %j with 400, with or without root (D140)',
    (glob) => {
      for (const body of [{ glob }, { glob, root }]) {
        expect(refusal(body)).toMatchObject({
          status: 400,
          message: 'The glob matches the whole root',
        });
      }
    },
  );

  it('drops trailing spaces, as git does when it reads the exclude file', () => {
    expect(target({ glob: '{root}/a.log  ' })).toMatchObject({
      pattern: '/a.log',
    });
    expect(refusal({ glob: '   ', root })).toMatchObject({
      status: 400,
      message: 'The glob matches the whole root',
    });
  });

  it('reads a leading-slash glob with root as a filesystem path: /docs outside the root is 400', () => {
    expect(refusal({ glob: '/docs', root })).toMatchObject({
      status: 400,
      message: 'The glob resolves outside the root',
    });
  });

  it('treats an empty root as no root, as 0.20.0 did', () => {
    expect(target({ glob: `{root}/a.md`, root: '' })).toMatchObject({
      pattern: '/a.md',
    });
  });

  it.each([
    [
      'a newline',
      `{root}/a\nb`,
      'The glob must be a single pattern (no newline)',
    ],
    [
      'a carriage return',
      `{root}/a\rb`,
      'The glob must be a single pattern (no newline)',
    ],
    ['braces', `{root}/*.{md,txt}`, 'Braces are not gitignore syntax'],
    ['a leading !', '!keep.md', 'The glob must not start with ! or #'],
    ['a leading #', '#x', 'The glob must not start with ! or #'],
    [
      'a pattern part starting with !',
      `{root}/!keep.md`,
      'The glob must not start with ! or #',
    ],
    [
      'a pattern part starting with #',
      `{root}/#x`,
      'The glob must not start with ! or #',
    ],
    ['the root itself', '{root}', 'The glob matches the whole root'],
    ['**', `{root}/**`, 'The glob matches the whole root'],
    ['**/*', `{root}/**/*`, 'The glob matches the whole root'],
  ])('refuses %s with 400', (_name, glob, message) => {
    expect(
      refusal({ glob, root: glob.startsWith('{root}') ? undefined : root }),
    ).toMatchObject({
      status: 400,
      code: 'invalid_request',
      message,
    });
  });

  it.each([
    ['an absolute glob under another path', '/elsewhere/a.md'],
    ['a relative glob climbing out', '../a.md'],
    ['a relative glob that is the parent', '..'],
  ])('refuses %s outside an explicit root with 400', (_name, glob) => {
    expect(refusal({ glob, root })).toMatchObject({
      status: 400,
      message: 'The glob resolves outside the root',
    });
  });

  it('answers 404 for an explicit root that is not a VCS root', () => {
    expect(refusal({ glob: 'a.md', root: '/elsewhere' })).toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'Root is not a VCS-enabled watch root',
    });
  });

  it.each([
    ['under no root', '/elsewhere/*.log'],
    ['relative, without a root', '*.log'],
    ['a sibling sharing the prefix', `{root}*/a.md`],
  ])('answers 404 for a glob %s', (_name, glob) => {
    expect(refusal({ glob })).toMatchObject({
      status: 404,
      message: 'Glob does not match any VCS-enabled watch root',
    });
  });
});
