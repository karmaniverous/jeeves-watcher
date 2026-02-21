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

  it('handles markdown with horizontal rules without YAML errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-'));
    const file = join(dir, 'doc.md');
    await writeFile(
      file,
      `# Title\n\nSome intro text.\n\n---\n\nSection after rule.\n\n---\n\nAnother section.\n`,
      'utf8',
    );

    const result = await extractText(file, '.md');
    expect(result.frontmatter).toBeUndefined();
    expect(result.text).toContain('# Title');
    expect(result.text).toContain('Section after rule.');
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

  it('strips BOM from plaintext', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-'));
    const file = join(dir, 'bom.txt');
    await writeFile(file, '\uFEFFhello world', 'utf8');

    const result = await extractText(file, '.txt');
    expect(result.text).toBe('hello world');
  });

  it('strips BOM from JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-'));
    const file = join(dir, 'bom.json');
    await writeFile(file, '\uFEFF{"content": "test"}', 'utf8');

    const result = await extractText(file, '.json');
    expect(result.text).toBe('test');
    expect(result.json).toEqual({ content: 'test' });
  });

  it('strips BOM from HTML', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-'));
    const file = join(dir, 'bom.html');
    await writeFile(
      file,
      '\uFEFF<html><body><p>Hello BOM</p></body></html>',
      'utf8',
    );

    const result = await extractText(file, '.html');
    expect(result.text).toContain('Hello BOM');
  });

  it('strips BOM from markdown', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-'));
    const file = join(dir, 'bom.md');
    await writeFile(file, '\uFEFF---\ntitle: BOM\n---\n\nContent', 'utf8');

    const result = await extractText(file, '.md');
    expect(result.frontmatter).toEqual({ title: 'BOM' });
    expect(result.text).toContain('Content');
  });

  it('extracts PDF text content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-'));
    const file = join(dir, 'test.pdf');

    // Create a minimal valid PDF with text
    const pdfContent = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/Resources <<
/Font <<
/F1 <<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
>>
>>
/MediaBox [0 0 612 792]
/Contents 4 0 R
>>
endobj
4 0 obj
<<
/Length 44
>>
stream
BT
/F1 12 Tf
100 700 Td
(Hello PDF World) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000317 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
410
%%EOF
`;
    await writeFile(file, pdfContent, 'utf8');

    const result = await extractText(file, '.pdf');
    expect(result.text).toContain('Hello PDF World');
  });
});
