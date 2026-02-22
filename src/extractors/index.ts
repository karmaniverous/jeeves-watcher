/**
 * @module extractors
 *
 * Text extraction registry for supported file formats.
 */

import { readFile } from 'node:fs/promises';

import * as cheerio from 'cheerio';
import yaml from 'js-yaml';
import mammoth from 'mammoth';

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

  // Only attempt frontmatter parsing if the file starts with ---
  if (!/^\s*---/.test(trimmed)) return { body: markdown };

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

type Extractor = (filePath: string) => Promise<ExtractedText>;

async function extractMarkdown(filePath: string): Promise<ExtractedText> {
  const raw = await readFile(filePath, 'utf8');
  const { frontmatter, body } = extractMarkdownFrontmatter(raw);
  return { text: body, frontmatter };
}

async function extractPlaintext(filePath: string): Promise<ExtractedText> {
  const raw = await readFile(filePath, 'utf8');
  return { text: raw.replace(/^\uFEFF/, '') };
}

async function extractJson(filePath: string): Promise<ExtractedText> {
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as unknown;
  const json =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  return { text: extractJsonText(parsed), json };
}

async function extractPdf(filePath: string): Promise<ExtractedText> {
  const buffer = await readFile(filePath);
  const uint8Array = new Uint8Array(buffer);
  const { extractText: extractPdfText } = await import('unpdf');
  const { text } = await extractPdfText(uint8Array);
  // unpdf returns an array of strings (one per page)
  const content = Array.isArray(text) ? text.join('\n\n') : text;
  return { text: content };
}

async function extractDocx(filePath: string): Promise<ExtractedText> {
  const buffer = await readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return { text: result.value };
}

async function extractHtml(filePath: string): Promise<ExtractedText> {
  const raw = await readFile(filePath, 'utf8');
  const $ = cheerio.load(raw.replace(/^\uFEFF/, ''));
  $('script, style').remove();
  const text = $('body').text().trim() || $.text().trim();
  return { text };
}

const extractorRegistry = new Map<string, Extractor>([
  ['.md', extractMarkdown],
  ['.markdown', extractMarkdown],
  ['.txt', extractPlaintext],
  ['.text', extractPlaintext],
  ['.json', extractJson],
  ['.pdf', extractPdf],
  ['.docx', extractDocx],
  ['.html', extractHtml],
  ['.htm', extractHtml],
]);

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
  const extractor = extractorRegistry.get(extension.toLowerCase());
  if (extractor) return extractor(filePath);

  // Default: treat as plaintext.
  return extractPlaintext(filePath);
}
