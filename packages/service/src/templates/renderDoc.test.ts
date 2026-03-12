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

  it('handles missing/null values gracefully', () => {
    const out = renderDoc(
      { present: 'yes' },
      {
        frontmatter: ['missing_key'],
        body: [
          { path: 'present', heading: 1 },
          { path: 'also_missing', heading: 2 },
        ],
      },
      hbs,
    );

    // Should not contain frontmatter block (no valid keys)
    expect(out).not.toContain('---');
    expect(out).toContain('# Present');
    expect(out).toContain('yes');
    expect(out).toContain('## Also Missing');
  });

  it('sorts items by sort key in each mode', () => {
    const out = renderDoc(
      {
        items: [
          { name: 'Charlie', body: 'c' },
          { name: 'Alice', body: 'a' },
          { name: 'Bob', body: 'b' },
        ],
      },
      {
        frontmatter: [],
        body: [
          {
            path: 'items',
            heading: 2,
            label: 'Items',
            each: true,
            headingTemplate: '{{name}}',
            contentPath: 'body',
            sort: 'name',
          },
        ],
      },
      hbs,
    );

    const aliceIdx = out.indexOf('Alice');
    const bobIdx = out.indexOf('Bob');
    const charlieIdx = out.indexOf('Charlie');
    expect(aliceIdx).toBeLessThan(bobIdx);
    expect(bobIdx).toBeLessThan(charlieIdx);
  });

  it('resolves glob patterns in frontmatter', () => {
    const out = renderDoc(
      {
        meta_id: 'test-1',
        name: 'Widget',
        status: 'active',
        _content: 'internal',
        _error: null,
        chunk_index: 3,
      },
      {
        frontmatter: ['meta_id', '*', '!_*', '!chunk_*'],
        body: [],
      },
      hbs,
    );

    expect(out).toContain('meta_id: test-1');
    expect(out).toContain('name: Widget');
    expect(out).toContain('status: active');
    expect(out).not.toContain('_content');
    expect(out).not.toContain('chunk_index');
  });

  it('escapes frontmatter values that need quoting', () => {
    const out = renderDoc(
      { title: 'A: Dangerous Value' },
      {
        frontmatter: ['title'],
        body: [],
      },
      hbs,
    );

    expect(out).toContain('---');
    expect(out).toContain("title: 'A: Dangerous Value'");
  });
});
