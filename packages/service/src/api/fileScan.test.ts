import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { normalizeSlashes } from '../util/normalizeSlashes';
import {
  getWatchRootBases,
  getWatchedFiles,
  globBase,
  listFilesFromGlobs,
  listFilesFromWatchRoots,
} from './fileScan';

describe('globBase', () => {
  it('returns resolved path for non-glob pattern', () => {
    expect(globBase('src/foo/bar.ts')).toBe(resolve('src/foo/bar.ts'));
  });

  it('returns parent directory when glob is mid-segment', () => {
    const result = globBase('src/foo/*.ts');
    expect(result).toBe(resolve('src/foo'));
  });

  it('handles glob at start of path', () => {
    const result = globBase('**/*.ts');
    expect(result).toBe(resolve('.'));
  });

  it('handles question mark glob', () => {
    const result = globBase('src/fo?/bar.ts');
    expect(result).toBe(resolve('src'));
  });

  it('handles bracket glob', () => {
    const result = globBase('src/[abc]/bar.ts');
    expect(result).toBe(resolve('src'));
  });

  it('handles trailing slash before glob', () => {
    const result = globBase('docs/**');
    expect(result).toBe(resolve('docs'));
  });
});

describe('getWatchedFiles', () => {
  it('flattens chokidar watched object to file paths', () => {
    const watched = {
      '/project/src': ['index.ts', 'utils.ts'],
      '/project/docs': ['readme.md'],
      '/project': ['package.json'],
    };

    const files = getWatchedFiles(watched);

    expect(files).toHaveLength(4);
    expect(files).toContain(resolve('/project/src/index.ts'));
    expect(files).toContain(resolve('/project/src/utils.ts'));
    expect(files).toContain(resolve('/project/docs/readme.md'));
    expect(files).toContain(resolve('/project/package.json'));
  });

  it('returns empty array for empty watched object', () => {
    const files = getWatchedFiles({});
    expect(files).toHaveLength(0);
  });

  it('handles nested directories', () => {
    const watched = {
      '/a/b/c': ['deep.ts'],
      '/a': ['shallow.ts'],
    };

    const files = getWatchedFiles(watched);

    expect(files).toHaveLength(2);
    expect(files).toContain(resolve('/a/b/c/deep.ts'));
    expect(files).toContain(resolve('/a/shallow.ts'));
  });
});

describe('listFilesFromGlobs', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'fileScan-globs-'));
    // Create a nested file structure:
    // testDir/
    //   src/
    //     index.ts
    //     utils.ts
    //   docs/
    //     readme.md
    //   dist/
    //     bundle.js
    //   notes.txt
    mkdirSync(join(testDir, 'src'), { recursive: true });
    mkdirSync(join(testDir, 'docs'), { recursive: true });
    mkdirSync(join(testDir, 'dist'), { recursive: true });
    writeFileSync(join(testDir, 'src', 'index.ts'), 'export {}');
    writeFileSync(join(testDir, 'src', 'utils.ts'), 'export {}');
    writeFileSync(join(testDir, 'docs', 'readme.md'), '# README');
    writeFileSync(join(testDir, 'dist', 'bundle.js'), 'var a=1;');
    writeFileSync(join(testDir, 'notes.txt'), 'notes');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('matches correct files with glob pattern', async () => {
    const pattern = normalizeSlashes(join(testDir, '**/*.ts'));
    const files = await listFilesFromGlobs([pattern]);

    const basenames = files.map((f) => f.replace(/\\/g, '/'));
    expect(basenames).toHaveLength(2);
    expect(basenames.some((f) => f.endsWith('index.ts'))).toBe(true);
    expect(basenames.some((f) => f.endsWith('utils.ts'))).toBe(true);
  });

  it('respects ignored patterns', async () => {
    const pattern = normalizeSlashes(join(testDir, '**/*'));
    const ignored = [normalizeSlashes(join(testDir, 'dist/**'))];
    const files = await listFilesFromGlobs([pattern], ignored);

    const normalized = files.map((f) => normalizeSlashes(f));
    expect(normalized.some((f) => f.includes('/dist/'))).toBe(false);
    expect(normalized.length).toBeGreaterThanOrEqual(4);
  });

  it('respects isGitignored callback', async () => {
    const pattern = normalizeSlashes(join(testDir, '**/*'));
    const isGitignored = (filePath: string) => filePath.endsWith('.txt');
    const files = await listFilesFromGlobs([pattern], [], isGitignored);

    const normalized = files.map((f) => normalizeSlashes(f));
    expect(normalized.some((f) => f.endsWith('.txt'))).toBe(false);
    expect(normalized.length).toBeGreaterThanOrEqual(4);
  });
});

describe('listFilesFromWatchRoots', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'fileScan-roots-'));
    mkdirSync(join(testDir, 'src'), { recursive: true });
    mkdirSync(join(testDir, 'docs'), { recursive: true });
    mkdirSync(join(testDir, 'dist'), { recursive: true });
    mkdirSync(join(testDir, '.meta'), { recursive: true });
    writeFileSync(join(testDir, 'src', 'index.ts'), 'export {}');
    writeFileSync(join(testDir, 'docs', 'readme.md'), '# README');
    writeFileSync(join(testDir, 'dist', 'bundle.js'), 'var a=1;');
    writeFileSync(join(testDir, '.meta', 'meta.json'), '{}');
    writeFileSync(join(testDir, 'notes.txt'), 'notes');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns files matching both watch scope AND caller globs (intersection)', async () => {
    const watchPatterns = [normalizeSlashes(join(testDir, '**/*'))];
    const callerGlobs = [normalizeSlashes(join(testDir, '**/.meta/**'))];
    const files = await listFilesFromWatchRoots(watchPatterns, [], callerGlobs);

    expect(files).toHaveLength(1);
    expect(normalizeSlashes(files[0])).toContain('.meta/meta.json');
  });

  it('excludes files matching only watch scope but not caller globs', async () => {
    const watchPatterns = [normalizeSlashes(join(testDir, '**/*'))];
    const callerGlobs = [normalizeSlashes(join(testDir, '**/*.md'))];
    const files = await listFilesFromWatchRoots(watchPatterns, [], callerGlobs);

    const normalized = files.map((f) => normalizeSlashes(f));
    expect(normalized.every((f) => f.endsWith('.md'))).toBe(true);
    expect(normalized).toHaveLength(1);
  });

  it('respects ignored patterns', async () => {
    const watchPatterns = [normalizeSlashes(join(testDir, '**/*'))];
    const callerGlobs = [normalizeSlashes(join(testDir, '**/*'))];
    const ignored = [normalizeSlashes(join(testDir, 'dist/**'))];
    const files = await listFilesFromWatchRoots(
      watchPatterns,
      ignored,
      callerGlobs,
    );

    const normalized = files.map((f) => normalizeSlashes(f));
    expect(normalized.some((f) => f.includes('/dist/'))).toBe(false);
  });

  it('respects isGitignored callback', async () => {
    const watchPatterns = [normalizeSlashes(join(testDir, '**/*'))];
    const callerGlobs = [normalizeSlashes(join(testDir, '**/*'))];
    const isGitignored = (filePath: string) => filePath.endsWith('.txt');
    const files = await listFilesFromWatchRoots(
      watchPatterns,
      [],
      callerGlobs,
      isGitignored,
    );

    const normalized = files.map((f) => normalizeSlashes(f));
    expect(normalized.some((f) => f.endsWith('.txt'))).toBe(false);
  });
});

describe('getWatchRootBases', () => {
  it('returns deduplicated base directories', () => {
    const bases = getWatchRootBases(['src/**/*.ts', 'src/**/*.md', 'docs/**']);
    const resolved = bases.map((b) => normalizeSlashes(b));
    // src/** and src/** should deduplicate to one 'src' base
    const srcBases = resolved.filter((b) => b.endsWith('/src'));
    expect(srcBases).toHaveLength(1);
    // docs should be present
    expect(resolved.some((b) => b.endsWith('/docs'))).toBe(true);
    // total should be 2
    expect(bases).toHaveLength(2);
  });
});
