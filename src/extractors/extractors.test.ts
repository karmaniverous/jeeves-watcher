import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractText } from './index';

describe('extractText', () => {
  it('extracts markdown body and frontmatter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-'));
    const file = join(dir, 'doc.md');
    await writeFile(
      file,
      `---\ntitle: Hello\ntags:\n  - api\n---\n\n# Heading\n\nBody text.\n`,
      'utf8',
    );

    const result = await extractText(file, '.md');
    expect(result.frontmatter).toEqual({ title: 'Hello', tags: ['api'] });
    expect(result.text).toContain('# Heading');
    expect(result.text).toContain('Body text.');
  });

  it('extracts markdown without frontmatter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-'));
    const file = join(dir, 'doc.md');
    await writeFile(file, '# Heading\n\nBody', 'utf8');

    const result = await extractText(file, '.md');
    expect(result.frontmatter).toBeUndefined();
    expect(result.text).toContain('Body');
  });

  it('extracts plaintext as-is', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-'));
    const file = join(dir, 'doc.txt');
    await writeFile(file, 'hello world', 'utf8');

    const result = await extractText(file, '.txt');
    expect(result.text).toBe('hello world');
  });

  it('extracts JSON content fields when present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-'));
    const file = join(dir, 'doc.json');
    await writeFile(
      file,
      JSON.stringify({ subject: 'Subj', other: 1 }),
      'utf8',
    );

    const result = await extractText(file, '.json');
    expect(result.text).toBe('Subj');
    expect(result.json).toEqual({ subject: 'Subj', other: 1 });
  });

  it('extracts HTML content without tags', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-'));
    const file = join(dir, 'doc.html');
    await writeFile(
      file,
      '<html><head><title>Test</title><script>alert("hi")</script></head><body><h1>Hello</h1><p>World</p></body></html>',
      'utf8',
    );

    const result = await extractText(file, '.html');
    expect(result.text).toContain('Hello');
    expect(result.text).toContain('World');
    expect(result.text).not.toContain('alert');
    expect(result.text).not.toContain('<h1>');
  });

  it('extracts DOCX raw text content', async () => {
    const fixturePath = join(import.meta.dirname, '__fixtures__', 'test.docx');
    const result = await extractText(fixturePath, '.docx');
    expect(result.text).toContain('Hello DOCX World');
  });
});
