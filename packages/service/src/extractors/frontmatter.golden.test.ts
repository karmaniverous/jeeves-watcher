/**
 * @module extractors/frontmatter.golden.test
 * Golden comparison for #203 (spec D65, D97, D141, D158, D169, D180): js-yaml's `load` (0.20.0's front-matter parser) against {@link parseFrontmatter} on a committed sample of synthetic front-matter blocks, with LF and CRLF line breaks; nothing reaches stderr.
 */

import { readFileSync } from 'node:fs';

import { load as jsYamlLoad } from 'js-yaml';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { parseFrontmatter } from './frontmatter';

/** How the two parsers must compare on a block. */
type Expectation = 'same' | 'both-fail' | 'accepted-diff';

interface GoldenBlock {
  id: string;
  expect: Expectation;
  lines: string[];
}

const EXPECTATIONS = new Set<string>(['same', 'both-fail', 'accepted-diff']);

/**
 * The accepted differences (D169, D180, and the `%YAML` directive guard),
 * listed in the PR: js-yaml parses these blocks, `yaml` refuses them.
 */
const ACCEPTED_DIFFERENCES = [
  'tag-float-int',
  'tag-float-quoted-int',
  'tag-float-negative-int',
  'yaml-directive-1-1',
];

/** Read the golden sample: `=== <id> <expect>` starts each block. */
function readGolden(): GoldenBlock[] {
  const text = readFileSync(
    new URL('./__fixtures__/frontmatter-golden.txt', import.meta.url),
    'utf8',
  );
  const blocks: GoldenBlock[] = [];
  // Normalise: a Windows checkout may have converted the file to CRLF.
  for (const line of text.split(/\r?\n/)) {
    const header = /^=== (\S+) (\S+)$/.exec(line);
    if (header) {
      const [, id, expectation] = header;
      if (!EXPECTATIONS.has(expectation)) {
        throw new Error(`unknown expectation "${expectation}" for ${id}`);
      }
      blocks.push({ id, expect: expectation as Expectation, lines: [] });
    } else {
      blocks.at(-1)?.lines.push(line);
    }
  }
  // The file ends with a newline: drop the empty line it leaves.
  const last = blocks.at(-1);
  if (last?.lines.at(-1) === '') last.lines.pop();
  return blocks;
}

/**
 * The block as the extractor hands it over: the text between the fences.
 * With CRLF line breaks, the last line keeps its `\r` (the closing fence's
 * `\n` ends the block).
 */
function asExtracted(lines: string[], eol: '\n' | '\r\n'): string {
  const body = lines.join(eol);
  return eol === '\r\n' && lines.length > 0 ? `${body}\r` : body;
}

/** A parser outcome: the value, or that it threw. */
type Outcome = { ok: true; value: unknown } | { ok: false; error: string };

function outcome(parse: () => unknown): Outcome {
  try {
    return { ok: true, value: parse() };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

const golden = readGolden();
const stderrWrite = vi.spyOn(process.stderr, 'write');
const emitWarning = vi.spyOn(process, 'emitWarning');

beforeAll(() => {
  stderrWrite.mockClear();
  emitWarning.mockClear();
});

afterAll(() => {
  stderrWrite.mockRestore();
  emitWarning.mockRestore();
});

describe('front-matter golden sample (js-yaml vs yaml)', () => {
  it('has at least 100 blocks with unique ids', () => {
    expect(golden.length).toBeGreaterThanOrEqual(100);
    expect(new Set(golden.map(({ id }) => id)).size).toBe(golden.length);
  });

  it('lists exactly the accepted differences', () => {
    expect(
      golden.filter((b) => b.expect === 'accepted-diff').map(({ id }) => id),
    ).toEqual(ACCEPTED_DIFFERENCES);
  });

  describe.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
  ] as const)('%s line breaks', (_, eol) => {
    /** The golden blocks with one expectation, as `it.each` rows. */
    const rows = (expectation: Expectation) =>
      golden
        .filter((b) => b.expect === expectation)
        .map((b) => [b.id, asExtracted(b.lines, eol)] as const);

    it.each(rows('same'))('%s: same value', (__, src) => {
      const before = outcome(() => jsYamlLoad(src));
      expect(before.ok).toBe(true);
      expect(outcome(() => parseFrontmatter(src))).toStrictEqual(before);
    });

    it.each(rows('both-fail'))('%s: both refuse', (__, src) => {
      expect(outcome(() => jsYamlLoad(src)).ok).toBe(false);
      expect(outcome(() => parseFrontmatter(src)).ok).toBe(false);
    });

    it.each(rows('accepted-diff'))('%s: accepted difference', (__, src) => {
      expect(outcome(() => jsYamlLoad(src)).ok).toBe(true);
      expect(outcome(() => parseFrontmatter(src)).ok).toBe(false);
    });
  });

  it('wrote nothing to stderr and emitted no process warning', () => {
    expect(stderrWrite).not.toHaveBeenCalled();
    expect(emitWarning).not.toHaveBeenCalled();
  });
});
