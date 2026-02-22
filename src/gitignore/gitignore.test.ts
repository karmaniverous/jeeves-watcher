import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GitignoreFilter } from './index';

describe('GitignoreFilter', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `gitignore-test-${String(Date.now())}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  function makeRepo(dir: string): void {
    mkdirSync(join(dir, '.git'), { recursive: true });
  }

  function writeGitignore(dir: string, content: string): void {
    writeFileSync(join(dir, '.gitignore'), content, 'utf8');
  }

  describe('basic pattern matching', () => {
    it('should ignore files matching gitignore patterns', () => {
      makeRepo(testDir);
      writeGitignore(testDir, 'node_modules\ndist\n*.log\n');

      const filter = new GitignoreFilter([testDir]);

      expect(filter.isIgnored(join(testDir, 'node_modules', 'foo.js'))).toBe(
        true,
      );
      expect(filter.isIgnored(join(testDir, 'dist', 'bundle.js'))).toBe(true);
      expect(filter.isIgnored(join(testDir, 'error.log'))).toBe(true);
      expect(filter.isIgnored(join(testDir, 'src', 'index.ts'))).toBe(false);
    });
  });

  describe('nested gitignore scoping', () => {
    it('should apply nested gitignore only to its subtree', () => {
      makeRepo(testDir);
      writeGitignore(testDir, '*.log\n');

      const subDir = join(testDir, 'packages', 'sub');
      mkdirSync(subDir, { recursive: true });
      writeGitignore(subDir, '*.tmp\n');

      const filter = new GitignoreFilter([testDir]);

      // Root gitignore applies everywhere
      expect(filter.isIgnored(join(testDir, 'error.log'))).toBe(true);
      expect(filter.isIgnored(join(subDir, 'error.log'))).toBe(true);

      // Nested gitignore only applies in subtree
      expect(filter.isIgnored(join(subDir, 'cache.tmp'))).toBe(true);
      expect(filter.isIgnored(join(testDir, 'cache.tmp'))).toBe(false);
    });
  });

  describe('negation patterns', () => {
    it('should handle negation patterns', () => {
      makeRepo(testDir);
      writeGitignore(testDir, '*.log\n!important.log\n');

      const filter = new GitignoreFilter([testDir]);

      expect(filter.isIgnored(join(testDir, 'error.log'))).toBe(true);
      expect(filter.isIgnored(join(testDir, 'important.log'))).toBe(false);
    });
  });

  describe('non-repo directories', () => {
    it('should not filter files outside git repos', () => {
      // No .git directory — not a repo
      writeFileSync(join(testDir, 'file.txt'), 'hello', 'utf8');
      writeGitignore(testDir, '*.txt\n');

      const filter = new GitignoreFilter([testDir]);

      expect(filter.isIgnored(join(testDir, 'file.txt'))).toBe(false);
    });
  });

  describe('invalidation', () => {
    it('should re-parse gitignore on invalidation', () => {
      makeRepo(testDir);
      writeGitignore(testDir, '*.log\n');

      const filter = new GitignoreFilter([testDir]);
      expect(filter.isIgnored(join(testDir, 'error.log'))).toBe(true);
      expect(filter.isIgnored(join(testDir, 'error.tmp'))).toBe(false);

      // Update gitignore
      writeGitignore(testDir, '*.tmp\n');
      filter.invalidate(join(testDir, '.gitignore'));

      expect(filter.isIgnored(join(testDir, 'error.log'))).toBe(false);
      expect(filter.isIgnored(join(testDir, 'error.tmp'))).toBe(true);
    });

    it('should handle new gitignore file via invalidation', () => {
      makeRepo(testDir);
      const subDir = join(testDir, 'sub');
      mkdirSync(subDir, { recursive: true });

      const filter = new GitignoreFilter([testDir]);
      expect(filter.isIgnored(join(subDir, 'test.tmp'))).toBe(false);

      // Add new nested gitignore
      writeGitignore(subDir, '*.tmp\n');
      filter.invalidate(join(subDir, '.gitignore'));

      expect(filter.isIgnored(join(subDir, 'test.tmp'))).toBe(true);
    });
  });
});
