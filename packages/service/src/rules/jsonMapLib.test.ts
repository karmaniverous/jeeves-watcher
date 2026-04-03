import {
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createJsonMapLib } from './jsonMapLib';

describe('fetchSiblings', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'jsonMapLib-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const simpleExtract = (filePath: string): string | undefined => {
    try {
      return readFileSync(filePath, 'utf-8');
    } catch {
      return undefined;
    }
  };

  it('returns empty array when no extractText callback is provided', () => {
    const lib = createJsonMapLib();
    const result = lib.fetchSiblings('/some/path/file.json');
    expect(result).toEqual([]);
  });

  it('returns correct before/after window with default options', () => {
    // Create 7 .json files: a.json through g.json
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      writeFileSync(join(tempDir, `${name}.json`), `content-${name}`);
    }

    const lib = createJsonMapLib(undefined, undefined, simpleExtract);
    // d.json is at index 3; before=3 → a,b,c; after=1 → e
    const result = lib.fetchSiblings(join(tempDir, 'd.json'));
    expect(result).toEqual([
      'content-a',
      'content-b',
      'content-c',
      'content-e',
    ]);
  });

  it('respects custom before/after counts', () => {
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      writeFileSync(join(tempDir, `${name}.json`), `content-${name}`);
    }

    const lib = createJsonMapLib(undefined, undefined, simpleExtract);
    const result = lib.fetchSiblings(join(tempDir, 'd.json'), {
      before: 1,
      after: 2,
    });
    expect(result).toEqual(['content-c', 'content-e', 'content-f']);
  });

  it('handles before=0 and after=0', () => {
    for (const name of ['a', 'b', 'c']) {
      writeFileSync(join(tempDir, `${name}.json`), `content-${name}`);
    }

    const lib = createJsonMapLib(undefined, undefined, simpleExtract);
    const result = lib.fetchSiblings(join(tempDir, 'b.json'), {
      before: 0,
      after: 0,
    });
    expect(result).toEqual([]);
  });

  it('clamps window when near start of list', () => {
    for (const name of ['a', 'b', 'c']) {
      writeFileSync(join(tempDir, `${name}.json`), `content-${name}`);
    }

    const lib = createJsonMapLib(undefined, undefined, simpleExtract);
    // a.json is at index 0; before=3 but only 0 files before it
    const result = lib.fetchSiblings(join(tempDir, 'a.json'));
    expect(result).toEqual(['content-b']);
  });

  it('clamps window when near end of list', () => {
    for (const name of ['a', 'b', 'c']) {
      writeFileSync(join(tempDir, `${name}.json`), `content-${name}`);
    }

    const lib = createJsonMapLib(undefined, undefined, simpleExtract);
    // c.json is at index 2; after=1 but no files after it
    const result = lib.fetchSiblings(join(tempDir, 'c.json'));
    expect(result).toEqual(['content-a', 'content-b']);
  });

  it('filters to same extension only', () => {
    writeFileSync(join(tempDir, 'a.json'), 'json-a');
    writeFileSync(join(tempDir, 'b.json'), 'json-b');
    writeFileSync(join(tempDir, 'c.json'), 'json-c');
    writeFileSync(join(tempDir, 'x.txt'), 'txt-x');
    writeFileSync(join(tempDir, 'y.md'), 'md-y');

    const lib = createJsonMapLib(undefined, undefined, simpleExtract);
    const result = lib.fetchSiblings(join(tempDir, 'b.json'));
    expect(result).toEqual(['json-a', 'json-c']);
  });

  it('sorts by name by default', () => {
    for (const name of ['c', 'a', 'b']) {
      writeFileSync(join(tempDir, `${name}.json`), `content-${name}`);
    }

    const lib = createJsonMapLib(undefined, undefined, simpleExtract);
    const result = lib.fetchSiblings(join(tempDir, 'b.json'), {
      before: 10,
      after: 10,
    });
    // Sorted alphabetically: a, b, c. b is current → before=[a], after=[c]
    expect(result).toEqual(['content-a', 'content-c']);
  });

  it('sorts by mtime when specified', () => {
    // Create files with staggered mtimes
    const now = Date.now();
    writeFileSync(join(tempDir, 'first.json'), 'content-first');
    utimesSync(
      join(tempDir, 'first.json'),
      new Date(now - 3000),
      new Date(now - 3000),
    );

    writeFileSync(join(tempDir, 'second.json'), 'content-second');
    utimesSync(
      join(tempDir, 'second.json'),
      new Date(now - 2000),
      new Date(now - 2000),
    );

    writeFileSync(join(tempDir, 'third.json'), 'content-third');
    utimesSync(
      join(tempDir, 'third.json'),
      new Date(now - 1000),
      new Date(now - 1000),
    );

    const lib = createJsonMapLib(undefined, undefined, simpleExtract);
    const result = lib.fetchSiblings(join(tempDir, 'second.json'), {
      before: 10,
      after: 10,
      sort: 'mtime',
    });
    // mtime order: first, second, third. second is current → before=[first], after=[third]
    expect(result).toEqual(['content-first', 'content-third']);
  });

  it('returns empty array for missing directory', () => {
    const lib = createJsonMapLib(undefined, undefined, simpleExtract);
    const result = lib.fetchSiblings('/nonexistent/dir/file.json');
    expect(result).toEqual([]);
  });

  it('returns empty array when file is not found in directory listing', () => {
    writeFileSync(join(tempDir, 'a.json'), 'content-a');

    const lib = createJsonMapLib(undefined, undefined, simpleExtract);
    const result = lib.fetchSiblings(join(tempDir, 'missing.json'));
    expect(result).toEqual([]);
  });

  it('silently skips files that fail extraction', () => {
    writeFileSync(join(tempDir, 'a.json'), 'content-a');
    writeFileSync(join(tempDir, 'b.json'), 'content-b');
    writeFileSync(join(tempDir, 'c.json'), 'content-c');

    const failingExtract = (filePath: string): string | undefined => {
      // Fail on a.json (which would be a sibling)
      if (filePath.includes('a.json')) return undefined;
      const name = filePath.split(/[\\/]/).pop() ?? '';
      return `extracted-${name}`;
    };

    const lib = createJsonMapLib(undefined, undefined, failingExtract);
    const result = lib.fetchSiblings(join(tempDir, 'b.json'), {
      before: 10,
      after: 10,
    });
    // a.json extraction returns undefined (skipped), c.json succeeds
    expect(result).toEqual(['extracted-c.json']);
  });

  it('silently skips files where extractText throws', () => {
    writeFileSync(join(tempDir, 'a.json'), 'content-a');
    writeFileSync(join(tempDir, 'b.json'), 'content-b');
    writeFileSync(join(tempDir, 'c.json'), 'content-c');

    const throwingExtract = (filePath: string): string | undefined => {
      if (filePath.includes('a.json')) throw new Error('extraction failed');
      const name = filePath.split(/[\\/]/).pop() ?? '';
      return `extracted-${name}`;
    };

    const lib = createJsonMapLib(undefined, undefined, throwingExtract);
    const result = lib.fetchSiblings(join(tempDir, 'b.json'), {
      before: 10,
      after: 10,
    });
    expect(result).toEqual(['extracted-c.json']);
  });

  it('does not include the current file in results', () => {
    writeFileSync(join(tempDir, 'only.json'), 'content-only');

    const lib = createJsonMapLib(undefined, undefined, simpleExtract);
    const result = lib.fetchSiblings(join(tempDir, 'only.json'));
    expect(result).toEqual([]);
  });
});
