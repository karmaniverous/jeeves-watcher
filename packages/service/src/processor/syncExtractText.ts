/**
 * @module processor/syncExtractText
 * Synchronous best-effort text extraction for JsonMap `fetchSiblings` (reads a file; JSON via the JSON text derivation, other formats raw). I/O: sync file read.
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

import { extractJsonText } from '../extractors';

/**
 * Synchronously extract text from a file. Returns undefined on failure.
 * Used by fetchSiblings in JsonMap lib for sibling context extraction.
 *
 * @param filePath - The file to read.
 * @returns The extracted text, or `undefined` when the file cannot be read.
 */
export function syncExtractText(filePath: string): string | undefined {
  try {
    const raw = readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
    const ext = extname(filePath).toLowerCase();

    if (ext === '.json') {
      const parsed = JSON.parse(raw) as unknown;
      return extractJsonText(parsed);
    }

    // All other supported text formats: return raw content
    return raw;
  } catch {
    return undefined;
  }
}
