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

  it('returns unchanged when delta is zero', () => {
    const input = '## Already H2\n### And H3';
    const out = rebaseHeadings(input, 1); // min=2, target=2, delta=0
    expect(out).toBe(input);
  });

  it('caps heading level at H6', () => {
    const input = '##### H5\n###### H6';
    const out = rebaseHeadings(input, 5); // min=5, target=6, delta=1 => H5->H6, H6->H6 (capped)
    expect(out).toContain('###### H5');
    expect(out).toContain('###### H6');
  });

  it('preserves non-heading content', () => {
    const input = '# Title\nSome paragraph\n- list item';
    const out = rebaseHeadings(input, 2);
    expect(out).toContain('Some paragraph');
    expect(out).toContain('- list item');
  });
});
