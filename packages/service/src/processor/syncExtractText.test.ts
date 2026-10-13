/**
 * @module processor/syncExtractText.test
 * syncExtractText: JSON files go through the JSON text derivation (BOM stripped), other files are returned raw, unreadable or invalid files yield undefined. Uses a temp dir.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { extractJsonText } from '../extractors';
import { syncExtractText } from './syncExtractText';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'jeeves-watcher-sync-extract-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function file(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, 'utf-8');
  return path;
}

describe('syncExtractText', () => {
  it('derives text from JSON (BOM stripped, case-insensitive extension)', () => {
    const json = { title: 'Hello', body: 'World' };
    const path = file('a.JSON', `\uFEFF${JSON.stringify(json)}`);
    expect(syncExtractText(path)).toBe(extractJsonText(json));
  });

  it('returns other formats raw', () => {
    const path = file('b.md', '# Title\n\nbody');
    expect(syncExtractText(path)).toBe('# Title\n\nbody');
  });

  it('returns undefined for a missing file', () => {
    expect(syncExtractText(join(dir, 'missing.md'))).toBeUndefined();
  });

  it('returns undefined for invalid JSON', () => {
    expect(syncExtractText(file('c.json', '{ nope'))).toBeUndefined();
  });
});
