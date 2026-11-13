/**
 * @module api/catalog/uiHintDocs.test
 * The docs follow the one hint vocabulary (spec D206 (2)): the facets guide's hint table and the skill's filter mapping list exactly watcher-core's `UI_HINTS`, and each guide row's `listFacets` and `countFacets` columns agree with `isEnumeratedUiHint` and `isRangeUiHint`. I/O: reads the facets guide.
 */

import { readFileSync } from 'node:fs';

import {
  isEnumeratedUiHint,
  isRangeUiHint,
  UI_HINTS,
  WATCHER_SKILL,
} from '@karmaniverous/jeeves-watcher-core';
import { describe, expect, it } from 'vitest';

const GUIDE = readFileSync(
  new URL('../../../guides/facets.md', import.meta.url),
  'utf8',
);

/** The table rows between the `ui-hints` markers, as cells. */
function hintRows(markdown: string): string[][] {
  const start = markdown.indexOf('<!-- ui-hints:start -->');
  const end = markdown.indexOf('<!-- ui-hints:end -->');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return markdown
    .slice(start, end)
    .split(/\r?\n/)
    .filter((line) => /^\| `[a-z]+` \|/.test(line))
    .map((line) =>
      line
        .slice(1, -1)
        .split(' | ')
        .map((cell) => cell.trim()),
    );
}

/** The hint of a row: its first cell without the backticks. */
const hintOf = (row: string[]) => (row[0] ?? '').replace(/`/g, '');

describe('uiHint docs', () => {
  const guideRows = hintRows(GUIDE);
  const skillRows = hintRows(WATCHER_SKILL);

  it('the facets guide lists exactly UI_HINTS, in order', () => {
    expect(guideRows.map(hintOf)).toEqual([...UI_HINTS]);
  });

  it('the skill maps exactly UI_HINTS, in order, plus the absent-hint row', () => {
    expect(skillRows.map(hintOf)).toEqual([...UI_HINTS]);
    expect(WATCHER_SKILL).toContain('| _(absent)_ | Do not use in filters |');
  });

  it.each(UI_HINTS.map((hint) => [hint]))(
    'the guide row for %s agrees with the predicates',
    (hint) => {
      const row = guideRows.find((r) => hintOf(r) === hint) ?? [];
      const [, values, counts] = row;
      expect(values).toBe(
        isEnumeratedUiHint(hint)
          ? '`enum`, else recorded values'
          : '`enum`, else none',
      );
      expect(counts).toBe(
        isRangeUiHint(hint) ? '`{ min, max }`' : 'value counts',
      );
    },
  );
});
