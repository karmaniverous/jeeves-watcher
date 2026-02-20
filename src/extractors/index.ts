import { readFile } from 'node:fs/promises';

import * as cheerio from 'cheerio';
import yaml from 'js-yaml';

/**
 * Result of extracting text and structured data from a file.
 */
export interface ExtractedText {
  /** Extracted plain text content. */
  text: string;
  /** Extracted YAML frontmatter (Markdown). */
  frontmatter?: Record<string, unknown>;
  /** Parsed JSON object (JSON files). */
  json?: Record<string, unknown>;
}

/**
 * Extract YAML frontmatter from a Markdown document.
 *
 * @param markdown - The raw markdown content.
 * @returns The extracted frontmatter (if any) and body.
 */
function extractMarkdownFrontmatter(markdown: string): {
  frontmatter?: Record<string, unknown>;
  body: string;
} {
  const trimmed = markdown.replace(/^\uFEFF/, '');
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/m.exec(trimmed);
  if (!match) return { body: markdown };

  const [, rawYaml, body] = match;
  const parsed = yaml.load(rawYaml);
  const frontmatter =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;

  return { frontmatter, body };
}

const JSON_TEXT_FIELDS = [
  'content',
  'body',
  'text',
  'snippet',
  'subject',
  'description',
  'summary',
  'transcript',
] as const;

/**
 * Extract meaningful text from a parsed JSON object.
 *
 * @param obj - Parsed JSON content.
 * @returns A text representation for embedding.
 */
function extractJsonText(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return JSON.stringify(obj);

  const rec = obj as Record<string, unknown>;
  for (const field of JSON_TEXT_FIELDS) {
    const value = rec[field];
    if (typeof value === 'string' && value.trim()) return value;
  }

  return JSON.stringify(obj);
}

/**
 * Extract text from a file based on extension.
 *
 * @param filePath - Path to the file.
 * @param extension - File extension (including leading dot).
 * @returns Extracted text and optional structured data.
 */
export async function extractText(
  filePath: string,
  extension: string,
): Promise<ExtractedText> {
  const ext = extension.toLowerCase();

  if (ext === '.md' || ext === '.markdown') {
    const raw = await readFile(filePath, 'utf8');
    const { frontmatter, body } = extractMarkdownFrontmatter(raw);
    return { text: body, frontmatter };
  }

  if (ext === '.txt' || ext === '.text') {
    const raw = await readFile(filePath, 'utf8');
    return { text: raw };
  }

  if (ext === '.json') {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const json =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    return { text: extractJsonText(parsed), json };
  }

  if (ext === '.pdf') {
    // TODO: Implement using @langchain/community document loaders.
    throw new Error('PDF extraction not yet implemented');
  }

  if (ext === '.docx') {
    // TODO: Implement using @langchain/community document loaders.
    throw new Error('DOCX extraction not yet implemented');
  }

  if (ext === '.html' || ext === '.htm') {
    const raw = await readFile(filePath, 'utf8');
    const $ = cheerio.load(raw);
    // Remove script and style elements
    $('script, style').remove();
    // Extract text content
    const text = $('body').text().trim() || $.text().trim();
    return { text };
  }

  // Default: treat as plaintext.
  const raw = await readFile(filePath, 'utf8');
  return { text: raw };
}
