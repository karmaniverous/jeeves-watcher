/**
 * @module templates/rebaseHeadings.test
 * Tests for heading rebasing.
 */

import { describe, expect, it } from 'vitest';

import { rebaseHeadings } from './rebaseHeadings';

describe('rebaseHeadings', () => {
  it('rebases minimum heading to baseHeading+1', () => {
    const input = ['# Title', '## Sub', 'text'].join('\n');
    const out = rebaseHeadings(input, 2); // section heading is H2 => content min becomes H3
    expect(out).toContain('### Title');
    expect(out).toContain('#### Sub');
  });

  it('does nothing when there are no headings', () => {
    expect(rebaseHeadings('hello', 2)).toBe('hello');
  });
});
