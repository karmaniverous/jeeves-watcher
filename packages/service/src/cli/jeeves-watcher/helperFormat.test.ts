/**
 * @module cli/jeeves-watcher/helperFormat.test
 * formatHelperSection: empty or missing data renders nothing; namespaces render their description and padded exports (with or without a description), or a no-exports marker.
 */

import { describe, expect, it } from 'vitest';

import { formatHelperSection } from './helperFormat';

describe('formatHelperSection', () => {
  it.each([[undefined], [{}]])('renders nothing for %j', (data) => {
    expect(formatHelperSection('Map helpers', data)).toBe('');
  });

  it('renders the description and padded exports', () => {
    expect(
      formatHelperSection('Map helpers', {
        text: {
          description: 'Text utilities',
          exports: { slugify: 'Make a slug', raw: '' },
        },
      }),
    ).toBe(
      [
        'Map helpers:',
        '  [text] Text utilities',
        `  ${'slugify'.padEnd(40)} - Make a slug`,
        `  ${'raw'.padEnd(40)}`,
      ].join('\n'),
    );
  });

  it('renders exports without a description line when none is given', () => {
    expect(
      formatHelperSection('Template helpers', {
        fmt: { exports: { date: 'Format a date' } },
      }),
    ).toBe(
      ['Template helpers:', `  ${'date'.padEnd(40)} - Format a date`].join(
        '\n',
      ),
    );
  });

  it('marks a namespace whose exports were not introspected', () => {
    expect(
      formatHelperSection('Map helpers', {
        lib: { path: './lib.js', description: 'Custom lib' },
        bare: {},
      }),
    ).toBe(
      [
        'Map helpers:',
        '  [lib] Custom lib',
        '  (no exports introspected)',
        '  (no exports introspected)',
      ].join('\n'),
    );
  });
});
