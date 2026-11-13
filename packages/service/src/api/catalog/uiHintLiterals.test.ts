/**
 * @module api/catalog/uiHintLiterals.test
 * The hint vocabulary has one definition, watcher-core's `uiHints.ts` (spec D206 (2)): no non-test source of the service, the SDK or the plugin holds a hint-set literal (an array literal of two or more hint names) or the `dropdown` or `multiselect` literal. I/O: reads the packages' sources.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UI_HINTS } from '@karmaniverous/jeeves-watcher-core';
import { describe, expect, it } from 'vitest';

const PACKAGES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const SOURCE_ROOTS = ['service/src', 'sdk/src', 'openclaw/src'];

/** Every non-test, non-generated TypeScript source under a root. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' ? [] : sources(path);
    return /\.ts$/.test(entry.name) &&
      !/\.(test|generated)\.ts$/.test(entry.name)
      ? [path]
      : [];
  });
}

/** A quoted hint name, its quote captured as group `group`. */
const hint = (group: number) =>
  `(['"])(?:${UI_HINTS.join('|')})\\${String(group)}`;
/** An array literal holding two hint names in a row. */
const HINT_SET = new RegExp(`\\[\\s*${hint(1)}\\s*,\\s*${hint(2)}`);
/** The two hint names no other identifier shares. */
const UNIQUE_HINT = /(['"])(?:dropdown|multiselect)\1/;

/** Offending lines of one file. */
function offences(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => HINT_SET.test(line) || UNIQUE_HINT.test(line))
    .map((line) => `${relative(PACKAGES, file)}: ${line.trim()}`);
}

describe('uiHint vocabulary', () => {
  it('finds the sources to check', () => {
    for (const root of SOURCE_ROOTS) {
      expect(sources(join(PACKAGES, root)).length).toBeGreaterThan(5);
    }
  });

  it('detects a duplicated hint set', () => {
    expect(HINT_SET.test(`const S = new Set(['number', 'date']);`)).toBe(true);
    expect(HINT_SET.test(`const S = ["tags","select"];`)).toBe(true);
    expect(UNIQUE_HINT.test(`uiHint: 'dropdown',`)).toBe(true);
    expect(HINT_SET.test(`const S = ['number', 'other'];`)).toBe(false);
  });

  it('has no hint-set literal outside watcher-core', () => {
    const found = SOURCE_ROOTS.flatMap((root) =>
      sources(join(PACKAGES, root)).flatMap(offences),
    );
    expect(found).toEqual([]);
  });
});
