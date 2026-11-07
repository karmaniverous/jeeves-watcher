/**
 * @module test/testProjects.test
 * The vitest project split (`vitest.config.ts`) holds its rule: every test file that imports a real-git or Qdrant fixture, spawns git itself, or gates on `qdrantAvailable()` is in the `io` or `heavy` set, so none runs in the parallel `unit` project. Reads the test sources; no git, no Qdrant.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import picomatch from 'picomatch';
import { describe, expect, it } from 'vitest';

import { HEAVY_TESTS, IO_TESTS } from '../../vitest.config';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Fixture modules whose importers run real git or a real Qdrant. */
const IO_FIXTURES = [
  'src/test/git',
  'src/test/vcsRepo',
  'src/test/squashRepo',
  'src/test/harness/service',
  'src/test/wire/wireApp',
];

/**
 * A direct git spawn (`execFile('git', ...)`, `spawn('git', ...)` and kin),
 * or a suite gated on the harness Qdrant.
 */
const DIRECT_IO =
  /\b(?:execFile|execFileSync|spawn|spawnSync)\(\s*'git'|\bqdrantAvailable\(\)/;

const SELF = 'src/test/testProjects.test.ts';

const IMPORT_FROM = /from '(\.{1,2}\/[^']+)'/g;

/** Package-relative POSIX path of a source file. */
function toPackagePath(file: string): string {
  return relative(packageRoot, file).split(sep).join(posix.sep);
}

/**
 * Whether `source` (at package path `file`) uses a real-git or Qdrant
 * fixture, or spawns git itself.
 */
function usesIo(file: string, source: string): boolean {
  if (DIRECT_IO.test(source)) return true;
  for (const [, spec] of source.matchAll(IMPORT_FROM)) {
    const target = posix.join(posix.dirname(file), spec);
    if (IO_FIXTURES.includes(target.replace(/\.ts$/, ''))) return true;
  }
  return false;
}

async function testFiles(): Promise<string[]> {
  const entries = await readdir(join(packageRoot, 'src'), { recursive: true });
  return entries
    .filter((e) => e.endsWith('.test.ts'))
    .map((e) => toPackagePath(join(packageRoot, 'src', e)));
}

describe('vitest project split', () => {
  it('detects a fixture import, a git spawn, and neither', () => {
    expect(
      usesIo('src/vcs/x.test.ts', "import { a } from '../test/vcsRepo';"),
    ).toBe(true);
    expect(
      usesIo('src/test/x.test.ts', "import { a } from './harness/service';"),
    ).toBe(true);
    expect(
      usesIo('src/watcher/x.test.ts', "execFileSync(\n    'git', ['init']);"),
    ).toBe(true);
    expect(
      usesIo('src/test/x.test.ts', 'describe.skipIf(!qdrantAvailable())'),
    ).toBe(true);
    expect(
      usesIo(
        'src/api/x.test.ts',
        "import { mockReply } from '../test/vcsHandlers';",
      ),
    ).toBe(false);
  });

  it('puts every test file that runs real git or Qdrant in io or heavy', async () => {
    const isolated = picomatch([...IO_TESTS, ...HEAVY_TESTS]);
    const files = await testFiles();
    const misplaced: string[] = [];
    for (const file of files) {
      const source = await readFile(join(packageRoot, file), 'utf8');
      if (file !== SELF && usesIo(file, source) && !isolated(file)) {
        misplaced.push(file);
      }
    }
    expect(files.length).toBeGreaterThan(100);
    expect(misplaced).toEqual([]);
  });
});
