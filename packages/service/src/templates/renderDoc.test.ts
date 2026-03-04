/**
 * @module templates/renderDoc.test
 * Tests for renderDoc.
 */

import { describe, expect, it } from 'vitest';

import { createHandlebarsInstance } from './engine';
import { renderDoc } from './renderDoc';

describe('renderDoc', () => {
  const hbs = createHandlebarsInstance();

  it('renders frontmatter and body sections', () => {
    const out = renderDoc(
      { key: 'WEB-1', summary: 'Hello', description: '# Inner\ntext' },
      {
        frontmatter: ['key'],
        body: [
          { path: 'summary', heading: 1 },
          {
            path: 'description',
            heading: 2,
            format: 'default',
            formatArgs: [''],
          },
        ],
      },
      hbs,
    );

    expect(out).toContain('---');
    expect(out).toContain('key: WEB-1');
    expect(out).toContain('# Summary');
  });

  it('rebases headings from formatted markdown', () => {
    // Use format=default helper to pass through string. renderDoc will rebase.
    const out = renderDoc(
      { section: '# Title\n## Sub' },
      {
        frontmatter: [],
        body: [
          { path: 'section', heading: 2, format: 'default', formatArgs: [''] },
        ],
      },
      hbs,
    );
    expect(out).toContain('### Title');
    expect(out).toContain('#### Sub');
  });

  it('supports each iteration with headingTemplate', () => {
    const out = renderDoc(
      {
        comments: [
          {
            author: { displayName: 'Alice' },
            created: '2024-01-01',
            body: 'hi',
          },
          { author: { displayName: 'Bob' }, created: '2024-01-02', body: 'yo' },
        ],
      },
      {
        frontmatter: [],
        body: [
          {
            path: 'comments',
            heading: 2,
            label: 'Comments',
            each: true,
            headingTemplate: '{{author.displayName}} ({{created}})',
            contentPath: 'body',
          },
        ],
      },
      hbs,
    );

    expect(out).toContain('### Alice (2024-01-01)');
    expect(out).toContain('### Bob (2024-01-02)');
  });
});
