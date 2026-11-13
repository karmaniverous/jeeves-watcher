import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ENUM_UI_HINT,
  ENUMERATED_UI_HINTS,
  isEnumeratedUiHint,
  isRangeUiHint,
  isUiHint,
  OTHER_UI_HINTS,
  RANGE_UI_HINTS,
  UI_HINTS,
} from './uiHints';

describe('uiHints', () => {
  it('holds the nine hints of D206 (2), each in exactly one group', () => {
    expect([...ENUMERATED_UI_HINTS]).toEqual([
      'dropdown',
      'tags',
      'select',
      'multiselect',
    ]);
    expect([...RANGE_UI_HINTS]).toEqual(['number', 'date', 'range']);
    expect([...OTHER_UI_HINTS]).toEqual(['text', 'check']);
    expect([...UI_HINTS]).toEqual([
      ...ENUMERATED_UI_HINTS,
      ...RANGE_UI_HINTS,
      ...OTHER_UI_HINTS,
    ]);
    expect(new Set(UI_HINTS).size).toBe(UI_HINTS.length);
  });

  it('defaults an enum without a hint to dropdown, an enumerated hint', () => {
    expect(DEFAULT_ENUM_UI_HINT).toBe('dropdown');
    expect(isEnumeratedUiHint(DEFAULT_ENUM_UI_HINT)).toBe(true);
  });

  it.each(UI_HINTS.map((h) => [h]))('knows %s', (hint) => {
    expect(isUiHint(hint)).toBe(true);
    expect(isEnumeratedUiHint(hint)).toBe(
      (ENUMERATED_UI_HINTS as readonly string[]).includes(hint),
    );
    expect(isRangeUiHint(hint)).toBe(
      (RANGE_UI_HINTS as readonly string[]).includes(hint),
    );
  });

  it.each([['selct'], ['Dropdown'], [''], ['datetime']])(
    'does not know %j',
    (hint) => {
      expect(isUiHint(hint)).toBe(false);
      expect(isEnumeratedUiHint(hint)).toBe(false);
      expect(isRangeUiHint(hint)).toBe(false);
    },
  );
});
