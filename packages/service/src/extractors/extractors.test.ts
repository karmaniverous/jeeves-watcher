/**
 * @module extractors/extractors.test
 * extractText per format (markdown with frontmatter and BOM, text, JSON, HTML, DOCX, PDF) on temp files; the PDF parser emits no warning for a valid xref table.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractText } from './index';

const dirs: string[] = [];

/** A temp dir removed after the test. */
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});

describe('extractText', () => {
  it('extracts markdown body and frontmatter', async () => {
    const dir = await tempDir();
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
    const dir = await tempDir();
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
    const dir = await tempDir();
    const file = join(dir, 'doc.md');
    await writeFile(file, '# Heading\n\nBody', 'utf8');

    const result = await extractText(file, '.md');
    expect(result.frontmatter).toBeUndefined();
    expect(result.text).toContain('Body');
  });

  it('extracts plaintext as-is', async () => {
    const dir = await tempDir();
    const file = join(dir, 'doc.txt');
    await writeFile(file, 'hello world', 'utf8');

    const result = await extractText(file, '.txt');
    expect(result.text).toBe('hello world');
  });

  it('extracts JSON content fields when present', async () => {
    const dir = await tempDir();
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
    const dir = await tempDir();
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
    const dir = await tempDir();
    const file = join(dir, 'bom.txt');
    await writeFile(file, '\uFEFFhello world', 'utf8');

    const result = await extractText(file, '.txt');
    expect(result.text).toBe('hello world');
  });

  it('strips BOM from JSON', async () => {
    const dir = await tempDir();
    const file = join(dir, 'bom.json');
    await writeFile(file, '\uFEFF{"content": "test"}', 'utf8');

    const result = await extractText(file, '.json');
    expect(result.text).toBe('test');
    expect(result.json).toEqual({ content: 'test' });
  });

  it('strips BOM from HTML', async () => {
    const dir = await tempDir();
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
    const dir = await tempDir();
    const file = join(dir, 'bom.md');
    await writeFile(file, '\uFEFF---\ntitle: BOM\n---\n\nContent', 'utf8');

    const result = await extractText(file, '.md');
    expect(result.frontmatter).toEqual({ title: 'BOM' });
    expect(result.text).toContain('Content');
  });

  it('extracts PDF text content', async () => {
    const dir = await tempDir();
    const file = join(dir, 'test.pdf');

    // Minimal valid PDF with text. The xref offsets are computed so the
    // parser does not fall back to (and warn about) indexing all objects.
    const stream = 'BT\n/F1 12 Tf\n100 700 Td\n(Hello PDF World) Tj\nET';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ' +
        '/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>',
      `<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`,
    ];
    let pdfContent = '%PDF-1.4\n';
    const offsets = objects.map((body, i) => {
      const offset = pdfContent.length;
      pdfContent += `${String(i + 1)} 0 obj\n${body}\nendobj\n`;
      return offset;
    });
    const xref = pdfContent.length;
    const size = String(objects.length + 1);
    pdfContent +=
      `xref\n0 ${size}\n0000000000 65535 f \n` +
      offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
      `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
    await writeFile(file, pdfContent, 'utf8');

    const warn = vi.spyOn(console, 'warn');
    const log = vi.spyOn(console, 'log');
    const result = await extractText(file, '.pdf');
    expect(result.text).toContain('Hello PDF World');
    // Correct xref offsets: the parser does not warn about re-indexing.
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
